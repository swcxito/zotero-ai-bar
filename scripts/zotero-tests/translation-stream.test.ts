import { assert } from 'chai';
import { Session } from '../../src/modules/chatManager';
import { consumeTranslationStream, buildRequestSettings, buildModelSettings, streamTranslationV2 } from '../../src/modules/llm';
import { onReasoningEndV2 } from '../../src/modules/chatUI';
import { config } from '../../package.json';

describe('shared translation streams and request options in isolated Zotero', function () {
  let wrapper: HTMLElement;
  let session: Session;

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
  });

  beforeEach(function () {
    session = new Session('translation-stream-fixture', { kind: 'translation' });
    const doc = Zotero.getMainWindow().document;
    wrapper = doc.createElement('div');
    wrapper.innerHTML = '<div class="chat-message"><div class="chat-message-content"></div></div>';
    doc.documentElement.appendChild(wrapper);
    session.pending = { messagePop: wrapper, abortController: new AbortController() };
  });

  afterEach(function () {
    onReasoningEndV2(session, true);
    wrapper.remove();
  });
  function consume(parts: AsyncIterable<any>, structured: boolean, output?: any) {
    return consumeTranslationStream(
      { fullStream: parts, output: Promise.resolve(output), usage: Promise.resolve({ outputTokens: 12 }) },
      {
        model: {},
        modelSelection: { providerId: 'openai', modelId: 'fixture' },
        messages: [],
        session,
        providerOptions: {},
        strict: false,
        selectedText: 'source',
      },
      structured
    );
  }
  async function* events(parts: any[]) {
    yield* parts;
  }
  for (const structured of [true, false]) {
    const label = `handles incremental JSON and missing reasoning-end in the ${structured ? 'schema' : 'JSON text'} path`;

    it(label, async function () {
      const output = { textType: 'text', translatedText: '译文' };
      const result = await consume(
        events([
          { type: 'reasoning-delta', text: 'thinking' },
          { type: 'text-delta', text: '{"textType":"text","translatedText":"译' },
          { type: 'text-delta', text: '文"}' },
        ]),
        structured,
        output
      );
      assert.equal(result.output?.translatedText, '译文');
      assert.equal(result.partialTranslatedText, '译文');
      assert.equal(result.usage?.outputTokens, 12);
      assert.include(wrapper.textContent!, '译文');
      assert.isUndefined(session.pending.reasoningBox);
    });
  }

  it('retains truncated JSON previews and plain-text fallback', async function () {
    const truncated = await consume(events([{ type: 'text-delta', text: '{"textType":"text","translatedText":"预览' }]), false);
    assert.equal(truncated.partialTranslatedText, '预览');
    const plain = await consume(events([{ type: 'text-delta', text: '普通译文' }]), false);
    assert.isTrue(plain.plainText);
    assert.equal(plain.rawText, '普通译文');
    assert.include(wrapper.textContent!, '普通译文');
  });
  for (const replace of [true, false]) {
    const label = `blocks late events after ${replace ? 'request replacement' : 'cancellation'}`;

    it(label, async function () {
      const stream = (async function* () {
        yield { type: 'text-delta', text: '{"textType":"text","translatedText":"保留"' };
        if (replace) session.pending.abortController = new AbortController();
        else session.pending.abortController!.abort();
        yield { type: 'text-delta', text: ',"explanation":"迟到"}' };
      })();
      let error: any;
      try {
        await consume(stream, false);
      } catch (caught) {
        error = caught;
      }
      assert.equal(error?.name, 'AbortError');
      assert.notInclude(wrapper.textContent!, '迟到');
    });
  }

  it('does not let a request awaiting context take over a replacement request', async function () {
    let resolve!: (messages: any[]) => void;
    const messages = new Promise<any[]>((done) => {
      resolve = done;
    });
    const work = streamTranslationV2(messages, session, { selectedText: 'source', targetLanguage: 'zh-CN' });
    await Zotero.Promise.delay(10);
    const replacement = { abortController: new AbortController() };
    session.pending = replacement;
    resolve([]);
    await work;
    assert.strictEqual(session.pending, replacement);
    assert.isFalse(replacement.abortController.signal.aborted);
  });

  it('preserves unlimited output and thinking headroom while using the actual model temperature capability', function () {
    const keys = ['llm.maxTokensEnabled', 'llm.maxTokens', 'llm.temperatureEnabled', 'llm.temperature100'];
    const original = keys.map((key) => Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true));
    const models = addon.data.userProviderConfigV2.addedModels;
    try {
      Zotero.Prefs.set(`${config.prefsPrefix}.llm.maxTokensEnabled`, false, true);
      assert.isUndefined(buildRequestSettings({ providerId: 'openai', modelId: 'fixture' }, 'high').maxOutputTokens);
      Zotero.Prefs.set(`${config.prefsPrefix}.llm.maxTokensEnabled`, true, true);
      Zotero.Prefs.set(`${config.prefsPrefix}.llm.maxTokens`, 2000, true);
      assert.equal(buildRequestSettings({ providerId: 'openai', modelId: 'fixture' }, 'high').maxOutputTokens, 10000);
      assert.equal(buildRequestSettings({ providerId: 'openai', modelId: 'fixture' }, 'none').maxOutputTokens, 2000);
      const anthropic = buildRequestSettings({ providerId: 'anthropic', modelId: 'fixture' }, 'high');
      assert.equal(anthropic.providerOptions.anthropic.thinking.budgetTokens, 8192);
      assert.equal(anthropic.maxOutputTokens, 14288);
      Zotero.Prefs.set(`${config.prefsPrefix}.llm.temperatureEnabled`, true, true);
      Zotero.Prefs.set(`${config.prefsPrefix}.llm.temperature100`, 70, true);
      addon.data.userProviderConfigV2.addedModels = [
        { id: 'translation-fixture', providerId: 'openai', temperature: false },
        { id: 'chat-fixture', providerId: 'openai', temperature: true },
      ] as any;
      assert.deepEqual(buildModelSettings({ providerId: 'openai', modelId: 'translation-fixture' }), {});
      assert.deepEqual(buildModelSettings({ providerId: 'openai', modelId: 'chat-fixture' }), { temperature: 0.7 });
    } finally {
      addon.data.userProviderConfigV2.addedModels = models;
      keys.forEach((key, index) => {
        const name = `${config.prefsPrefix}.${key}`;
        if (original[index] === undefined) Zotero.Prefs.clear(name, true);
        else Zotero.Prefs.set(name, original[index] as any, true);
      });
    }
  });
});
