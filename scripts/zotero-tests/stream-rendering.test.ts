import { assert } from 'chai';
import { Session } from '../../src/modules/chatManager';
import { consumeAgentStream, onLLMStreamEndV2, onLLMStreamUpdateV2, onReasoningStartV2 } from '../../src/modules/chatUI';
import { renderMarkdown, type MarkdownRenderContext } from '../../src/utils/markdown';

describe('API text streaming in isolated Zotero', function () {
  let wrapper: HTMLElement;
  let pop: HTMLElement;
  let session: Session;

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
  });

  beforeEach(function () {
    const doc = Zotero.getMainWindow().document;
    session = new Session('stream-render-test', { kind: 'translation' });
    wrapper = doc.createElement('div');
    wrapper.dataset.sessionId = session.id;
    pop = doc.createElement('div');
    pop.innerHTML = '<div class="chat-message"><div class="chat-message-content"></div></div>';
    wrapper.appendChild(pop);
    doc.documentElement.appendChild(wrapper);
    session.pending = { messagePop: pop, currentTextSegment: pop.querySelector('.chat-message-content'), isAgentMode: true };
    addon.data.sharedInputAreas.add(wrapper);
  });

  afterEach(function () {
    addon.data.sharedInputAreas.delete(wrapper);
    wrapper.remove();
  });

  async function consume(parts: any[]) {
    return consumeAgentStream(session, {
      fullStream: (async function* () {
        yield* parts;
      })(),
      response: Promise.resolve({ messages: [] }),
      usage: Promise.resolve({}),
    });
  }

  it('shows short realtime updates without the twenty-character gate', async function () {
    await onLLMStreamUpdateV2({ session, fullText: '答', force: true });
    await onLLMStreamUpdateV2({ session, fullText: '答案', force: true });
    assert.equal(pop.querySelector('.chat-message-content')!.textContent!.trim(), '答案');
  });

  it('retains identical text on both sides of a tool boundary and saves the final tail', async function () {
    const outcome = await consume([
      { type: 'text-delta', text: '相同内容' },
      { type: 'tool-call', toolCallId: 'read-test', toolName: 'read', input: {} },
      { type: 'tool-result', toolCallId: 'read-test', toolName: 'read', output: { text: 'tool result' } },
      { type: 'text-delta', text: '相同内容' },
      { type: 'text-delta', text: '。' },
    ]);
    assert.isFalse(outcome.failed);
    const segments = [...pop.querySelectorAll('.chat-message-content')];
    assert.deepEqual(
      segments.map((node) => node.textContent!.trim()),
      ['相同内容', '相同内容。']
    );
    assert.equal(pop.dataset.markdown, '相同内容相同内容。');
    const nodes = [...pop.querySelector('.chat-message')!.children];
    assert.isAbove(nodes.indexOf(segments[1]), nodes.indexOf(segments[0]) + 1);
  });

  it('preserves text order around reasoning and cancels all pending updates on stop', async function () {
    const outcome = await consume([
      { type: 'text-delta', text: '前文' },
      { type: 'reasoning-start' },
      { type: 'reasoning-delta', text: '思考' },
      { type: 'reasoning-end' },
      { type: 'text-delta', text: '后文' },
    ]);
    assert.isFalse(outcome.failed);
    assert.deepEqual(
      [...pop.querySelectorAll('.chat-message-content')].map((node) => node.textContent!.trim()),
      ['前文', '后文']
    );

    session.pending = { messagePop: pop, isAgentMode: true, abortController: new AbortController() };
    const stopped = await consumeAgentStream(session, {
      fullStream: (async function* () {
        yield { type: 'text-delta', text: '部分回答' };
        session.pending.abortController!.abort();
        yield { type: 'text-delta', text: '丢弃' };
      })(),
    });
    assert.isTrue(stopped.failed);
    assert.equal(pop.dataset.markdown, '部分回答');
    const html = pop.innerHTML;
    await Zotero.Promise.delay(50);
    assert.equal(pop.innerHTML, html, 'No timer may update the completed/stopped turn');
    assert.isEmpty(session.pending);
  });

  it('loads each cited PDF once per response and continues receiving deltas during citation lookup', async function () {
    const originalGet = Zotero.Items.get;
    const fullText = (Zotero as any).FullText ?? (Zotero as any).Fulltext;
    const originalCacheFile = fullText.getItemCacheFile;
    const originalPdfText = Zotero.PDFWorker.getFullText;
    let reads = 0;
    let yielded = 0;
    let receivedWhileReading = 0;
    try {
      (Zotero.Items as any).get = (id: any) =>
        id === 999999
          ? { id, attachmentContentType: 'application/pdf', isAttachment: () => true, getField: () => '', getCreators: () => [] }
          : originalGet.call(Zotero.Items, id);
      fullText.getItemCacheFile = () => ({ exists: () => false });
      (Zotero.PDFWorker as any).getFullText = async () => {
        reads++;
        await Zotero.Promise.delay(80);
        receivedWhileReading = yielded;
        return { text: 'page one\fpage two\nline three' };
      };
      const context: MarkdownRenderContext = new Map();
      const first = await renderMarkdown('[cite:999999:L1]', undefined, context);
      const second = await renderMarkdown('[cite:999999:L1] and [cite:999999:L3]', undefined, context);
      assert.include(first, 'data-page="1"');
      assert.include(second, 'data-page="2"');
      assert.equal(reads, 1);
      await renderMarkdown('[cite:999999:L1]', undefined, new Map());
      assert.equal(reads, 2, 'A new response has a fresh citation cache');

      const result = await consumeAgentStream(session, {
        fullStream: (async function* () {
          for (let i = 0; i < 30; i++) {
            yielded++;
            yield { type: 'text-delta', text: i === 0 ? '[cite:999999:L1] ' : '正文' };
            await Zotero.Promise.delay(2);
          }
        })(),
        response: Promise.resolve({ messages: [] }),
        usage: Promise.resolve({}),
      });
      assert.isFalse(result.failed);
      assert.isAbove(receivedWhileReading, 10, 'Slow Markdown must not block reading subsequent text deltas');
      assert.equal(reads, 3, 'The whole streamed response must reuse one PDF lookup');
      assert.equal(pop.dataset.markdown, '[cite:999999:L1] ' + '正文'.repeat(29));
      assert.include(pop.innerHTML, 'data-page="1"');
    } finally {
      Zotero.Items.get = originalGet;
      fullText.getItemCacheFile = originalCacheFile;
      Zotero.PDFWorker.getFullText = originalPdfText;
    }
  });

  it('clears the thinking placeholder and restores input when stopped before any output', function () {
    const placeholder = pop.ownerDocument!.createElement('div');
    placeholder.classList.add('zaibar-thinking-placeholder');
    pop.querySelector('.chat-message-content')!.appendChild(placeholder);
    const states: boolean[] = [];
    (wrapper as any)._inputAreaAPI = { setStreaming: (_id: string, streaming: boolean) => states.push(streaming) };
    onLLMStreamEndV2(session, undefined, true);
    assert.isNull(pop.querySelector('.zaibar-thinking-placeholder'));
    assert.deepEqual(states, [false]);
    assert.isEmpty(session.pending);
  });

  it('finishes a reasoning card on Stop and handles SDK abort events without saving a turn', async function () {
    onReasoningStartV2(session);
    const card = session.pending.reasoningBox!;
    const title = card.querySelector('.tool-call-summary')!.textContent;
    session.pending.userMessage = { role: 'user', content: 'Question' };
    const outcome = await consume([{ type: 'abort' }]);
    assert.isTrue(outcome.failed);
    assert.notEqual(card.querySelector('.tool-call-summary')!.textContent, title);
    assert.isTrue(card.querySelector('.tool-call-details')!.classList.contains('max-h-0'));
    assert.isEmpty(session.conversationHistory);
    assert.isEmpty(session.pending);
  });
});
