import { assert } from 'chai';
import { resolveModelCapabilities } from '../src/utils/modelCapabilities';
import { installWebGlobals } from '../src/utils/installWebGlobals';
import { createImageNavigation } from '../src/utils/imageNavigation';
import { createOrderedStreamRenderer } from '../src/utils/orderedStreamRenderer';
import { nativeLiteratureRequest, searchCrossrefPapers } from '../src/modules/literatureTools';
import { translationResultSchema, translationWireSchema } from '../src/utils/translation';

describe('shared model and platform infrastructure', function () {
  it('prefers live capability fields while preserving saved identity and explicit false', function () {
    const saved: any = {
      id: 'm',
      providerId: 'p',
      name: 'My model',
      structured_output: true,
      reasoning: true,
      temperature: false,
      limit: { context: 100 },
      modalities: { input: ['image'] },
    };
    const catalog: any = {
      p: { models: { m: { name: 'Catalog name', structured_output: false, modalities: { input: ['text'] }, limit: { output: 50 } } } },
      other: { models: { unknown: { reasoning: true } } },
    };
    const model = resolveModelCapabilities({ providerId: 'p', modelId: 'm' }, { added: [saved], live: catalog });
    assert.equal(model?.name, 'My model');
    assert.isFalse(model?.structured_output);
    assert.isFalse(model?.temperature);
    assert.equal(model?.limit.context, 100);
    assert.equal(model?.limit.output, 50);
    assert.deepEqual(model?.modalities.input, ['text']);
    assert.isUndefined(resolveModelCapabilities({ providerId: 'p', modelId: 'unknown' }, { live: catalog }));
    assert.isUndefined(resolveModelCapabilities({ providerId: 'codex-subscription', modelId: 'm' }, { live: catalog }));
    const fallback = resolveModelCapabilities(
      { providerId: 'p', modelId: 'm' },
      {
        added: [saved],
        common: { p: { models: { m: { reasoning: false, attachment: true } } } } as any,
      }
    );
    assert.isTrue(fallback?.reasoning, 'saved fields precede bundled fields');
    assert.isTrue(fallback?.attachment, 'bundled fields fill missing capabilities');
    assert.isUndefined(fallback?.interleaved, 'missing capabilities remain unknown');
  });

  it('fills partial global environments independently without overwriting native values', function () {
    const stream = {};
    const encoder = {};
    const target: any = { TransformStream: stream };
    installWebGlobals(target, { TransformStream: {}, ReadableStream: stream, TextEncoder: encoder });
    assert.strictEqual(target.TransformStream, stream);
    assert.strictEqual(target.ReadableStream, stream);
    assert.strictEqual(target.TextEncoder, encoder);
    assert.doesNotThrow(() => installWebGlobals({}, undefined));
  });

  it('keeps both image viewers within the same navigation bounds', function () {
    const indices: number[] = [];
    let closed = false;
    const navigation = createImageNavigation(
      2,
      99,
      (index) => indices.push(index),
      () => {
        closed = true;
      }
    );
    navigation.next();
    navigation.key('ArrowLeft');
    navigation.previous();
    navigation.key('Escape');
    assert.deepEqual(indices, [1, 1, 0, 0]);
    assert.isTrue(closed);
  });

  it('shares translation fields while accepting strict empty wire fields only where inapplicable', function () {
    assert.isTrue(translationResultSchema.safeParse({ textType: 'word', translatedText: '词' }).success);
    assert.isFalse(translationResultSchema.safeParse({ textType: 'abbreviation', translatedText: '缩略语' }).success);
    assert.isTrue(
      translationWireSchema.safeParse({
        textType: 'text',
        translatedText: '译文',
        originalText: 'text',
        pos: '',
        pronunciation: '',
        fullForm: '',
        explanation: '',
        otherMeanings: [],
      }).success
    );
  });

  it('coalesces text within each item and flushes before intervening tool/reasoning events', async function () {
    const events: string[] = [];
    const renderer = createOrderedStreamRenderer(async (key, text, isCurrent) => {
      if (isCurrent()) events.push(`${key}:${text}`);
    });
    for (let i = 1; i <= 100; i++) renderer.update('a', String(i));
    void renderer.boundary(() => {
      events.push('tool');
    });
    renderer.update('b', 'tail');
    await renderer.flush();
    renderer.dispose();
    assert.deepEqual(events, ['a:100', 'tool', 'b:tail']);
  });

  it('invalidates pending asynchronous rendering on stop', async function () {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => {
      resolve = done;
    });
    const events: string[] = [];
    const renderer = createOrderedStreamRenderer(async (_key, text, isCurrent) => {
      await gate;
      if (isCurrent()) events.push(text);
    });
    renderer.update('a', 'late');
    const completion = renderer.flush();
    await Promise.resolve();
    renderer.dispose();
    resolve();
    await completion;
    assert.isEmpty(events);
  });

  it('uses native whole-response timeout with no implicit retries and cancels the underlying request', async function () {
    const scope = globalThis as any;
    const original = scope.Zotero;
    let options: any;
    let cancelled = false;
    scope.Zotero = {
      HTTP: {
        request: (_method: string, _url: string, value: any) => {
          options = value;
          value.cancellerReceiver(() => {
            cancelled = true;
          });
          return new Promise(() => {});
        },
      },
    };
    try {
      const controller = new AbortController();
      const work = nativeLiteratureRequest('http://localhost/synthetic', { timeoutMs: 15000, signal: controller.signal });
      controller.abort();
      let error: any;
      try {
        await work;
      } catch (caught) {
        error = caught;
      }
      assert.equal(options.timeout, 15000);
      assert.equal(options.errorDelayMax, 0);
      assert.equal(options.responseType, 'text');
      assert.isTrue(cancelled);
      assert.equal(error?.name, 'AbortError');
    } finally {
      scope.Zotero = original;
    }
  });

  it('cancels retry waits without starting another Crossref request', async function () {
    let calls = 0;
    const controller = new AbortController();
    const work = searchCrossrefPapers(
      { title: 'Synthetic' },
      {
        signal: controller.signal,
        requestImpl: async () => {
          calls++;
          return { ok: false, status: 503, json: async () => ({}) };
        },
        delay: async () => {
          controller.abort();
        },
      }
    );
    let error: any;
    try {
      await work;
    } catch (caught) {
      error = caught;
    }
    assert.equal(calls, 1);
    assert.equal(error?.name, 'AbortError');
  });
});
