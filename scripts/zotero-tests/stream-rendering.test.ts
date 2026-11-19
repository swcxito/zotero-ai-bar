import { assert } from 'chai';
import { Session } from '../../src/modules/chatManager';
import {
  attachMarkdownHandlers,
  consumeAgentStream,
  onLLMStreamEndV2,
  onLLMStreamUpdateV2,
  onLLMStreamErrorV2,
  onReasoningStartV2,
  onReasoningDeltaV2,
  onReasoningEndV2,
  onTokenUsageUpdateV2,
} from '../../src/modules/chatUI';
import { contextTokenInfo } from '../../src/utils/tokenUsage';
import { getString } from '../../src/utils/locale';
import { renderMarkdown, type MarkdownRenderContext } from '../../src/utils/markdown';
import { updateMarkdownContent } from '../../src/utils/markdownContent';
import katex from 'katex';
import hljs from 'highlight.js';

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

  it('reuses unchanged prefix/suffix blocks and hydrated controls, including top-level citation headers', async function () {
    const content = session.pending.currentTextSegment!;
    const context = new Map();
    const prefix = '开头\n\n```js\nconst answer = 42;\n```\n\n[cite:999999]\n\n';
    await onLLMStreamUpdateV2({ session, fullText: prefix + '旧内容\n\n结尾', force: true, renderContext: context });
    const first = content.firstChild;
    const copy = content.querySelector('.chat-code-copy');
    const cite = content.querySelector('.zaibar-cite');
    const last = content.lastChild;
    assert.isNotNull(copy);
    assert.equal(cite?.getAttribute('data-bound'), '1');
    await onLLMStreamUpdateV2({ session, fullText: prefix + '新内容\n\n结尾', force: true, renderContext: context });
    assert.strictEqual(content.firstChild, first);
    assert.strictEqual(content.lastChild, last);
    assert.strictEqual(content.querySelector('.chat-code-copy'), copy);
    assert.strictEqual(content.querySelector('.zaibar-cite'), cite);
    assert.equal(content.querySelectorAll('.chat-code-copy').length, 1);
    assert.include(content.textContent!, '新内容');
    // External error/placeholder replacement invalidates the previous snapshot.
    content.innerHTML = '<p>external replacement</p>';
    updateMarkdownContent(content, await renderMarkdown('恢复正常'), attachMarkdownHandlers);
    assert.equal(content.textContent!.trim(), '恢复正常');
  });

  it('matches a full render at every character, including unfinished syntax and late link definitions', async function () {
    const content = session.pending.currentTextSegment!;
    const expected = content.ownerDocument!.createElement('div');
    const markdown =
      '开始 $E=mc^2$\n\n$$\n\\alpha+\\beta=1\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- 项目\n  - 子项\n\n```js\nlet n = 1;\n```\n\n[后置链接][ref]\n\n[ref]: https://example.org\n\n[cite:p2]\n\n<sub>x</sub>';
    const context = new Map();
    for (let end = 1; end <= markdown.length; end++) {
      const text = markdown.slice(0, end);
      await onLLMStreamUpdateV2({ session, fullText: text, force: true, renderContext: context });
      expected.innerHTML = await renderMarkdown(text);
      attachMarkdownHandlers(expected);
      assert.equal(content.innerHTML, expected.innerHTML, `Character ${end}`);
    }
    assert.include(content.querySelector('a')!.getAttribute('href')!, 'https://example.org');
  });

  it('opens streamed web links once, including after later updates reuse the link', async function () {
    const content = session.pending.currentTextSegment!;
    const url = 'https://doi.org/10.1000/example?first=1&second=2#page';
    const markdown = `[**Paper**](${url})\n\n<http://example.org/reference>`;
    const launched: string[] = [];
    const launchURL = Zotero.launchURL;
    Zotero.launchURL = (href) => void launched.push(href);
    try {
      await onLLMStreamUpdateV2({ session, fullText: markdown, force: true });
      assert.lengthOf(content.querySelectorAll('a[href]'), 2);
      const link = content.querySelector('a')!;
      const click = new content.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true });
      assert.isNotNull(link.querySelector('strong'));
      link.querySelector('strong')!.dispatchEvent(click);
      assert.deepEqual(launched, [url]);
      assert.isTrue(click.defaultPrevented);

      await onLLMStreamUpdateV2({ session, fullText: `${markdown}\n\nMore text`, force: true });
      assert.strictEqual(content.querySelector('a'), link);
      attachMarkdownHandlers(content);
      link.click();
      content.querySelectorAll('a')[1].click();
      assert.deepEqual(launched, [url, url, 'http://example.org/reference']);
    } finally {
      Zotero.launchURL = launchURL;
    }
  });

  it('removes non-web destinations from anchors during hydration', function () {
    const doc = wrapper.ownerDocument;
    for (const href of ['other.html', 'file:///tmp/reference.pdf', 'chrome://zotero/content/', 'https://']) {
      // Build the anchor directly to exercise the link policy independently of innerHTML sanitization.
      const link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'a');
      link.setAttribute('href', href);
      link.textContent = 'Reference';
      attachMarkdownHandlers(link);
      assert.isFalse(link.hasAttribute('href'), href);
      assert.equal(link.textContent, 'Reference');
    }
  });

  it('caches math and highlighting per response without crossing concurrent contexts', async function () {
    const originalMath = katex.renderToString;
    const originalHighlight = hljs.highlight;
    let mathCalls = 0;
    let codeCalls = 0;
    try {
      katex.renderToString = (...args) => {
        mathCalls++;
        return originalMath(...args);
      };
      hljs.highlight = ((...args: any[]) => {
        codeCalls++;
        return (originalHighlight as any)(...args);
      }) as typeof hljs.highlight;
      const a = new Map();
      const b = new Map();
      const text = '$x+1$\n\n```js\nlet x = 1;\n```';
      const html = await renderMarkdown(text, undefined, a);
      assert.equal(await renderMarkdown(text + '\n\n尾字', undefined, a), html + '<p>尾字</p>\n');
      assert.equal(mathCalls, 1);
      assert.equal(codeCalls, 1);
      assert.equal(await renderMarkdown(text, undefined, b), html);
      assert.equal(mathCalls, 2);
      assert.equal(codeCalls, 2);
      await renderMarkdown('$$\nx+1\n$$', undefined, a);
      assert.equal(mathCalls, 3, 'Display math and inline math have distinct cache keys');
    } finally {
      katex.renderToString = originalMath;
      hljs.highlight = originalHighlight;
    }
  });

  it('drops an asynchronous Markdown commit when a different pending turn replaces it', async function () {
    const content = session.pending.currentTextSegment!;
    const rendering = onLLMStreamUpdateV2({ session, fullText: '不应写入旧回答', force: true, renderContext: new Map() });
    session.pending = {};
    await rendering;
    assert.equal(content.innerHTML, '');
  });

  it('keeps ordinary API text segments around reasoning without repeating the earlier text', async function () {
    const context = new Map();
    await onLLMStreamUpdateV2({ session, fullText: '前文', segmentText: '前文', force: true, renderContext: context });
    const first = session.pending.currentTextSegment;
    onReasoningStartV2(session);
    onReasoningDeltaV2(session, '重新思考');
    onReasoningEndV2(session);
    await onLLMStreamUpdateV2({ session, fullText: '前文后文', segmentText: '后文', force: true, renderContext: context });
    const segments = [...pop.querySelectorAll('.chat-message-content')];
    assert.strictEqual(segments[0], first);
    assert.deepEqual(
      segments.map((node) => node.textContent!.trim()),
      ['前文', '后文']
    );
    assert.equal(pop.dataset.markdown, '前文后文');
  });

  it('appends batched reasoning to one text node and flushes tails on end, stop and error', async function () {
    onReasoningStartV2(session);
    const element = session.pending.reasoningTextEl!;
    const node = element.firstChild;
    for (let index = 0; index < 100; index++) onReasoningDeltaV2(session, '思');
    assert.equal(element.textContent, '', 'A burst is buffered until the scheduled update');
    await Zotero.Promise.delay(50);
    assert.equal(element.textContent, '思'.repeat(100));
    assert.strictEqual(element.firstChild, node);
    onReasoningDeltaV2(session, '尾字');
    onReasoningEndV2(session);
    assert.equal(element.textContent, '思'.repeat(100) + '尾字');
    assert.strictEqual(element.firstChild, node);

    onReasoningStartV2(session);
    const stopped = session.pending.reasoningTextEl!;
    onReasoningDeltaV2(session, '停止前的思考');
    onLLMStreamEndV2(session, undefined, true);
    assert.equal(stopped.textContent, '停止前的思考');
    const html = pop.innerHTML;
    await Zotero.Promise.delay(50);
    assert.equal(pop.innerHTML, html);

    session.pending = { messagePop: pop };
    onReasoningStartV2(session);
    const failed = session.pending.reasoningTextEl!;
    onReasoningDeltaV2(session, '错误前的思考');
    onLLMStreamErrorV2({ session, error: 'test error' });
    assert.equal(failed.textContent, '错误前的思考');
    const errorHtml = pop.innerHTML;
    await Zotero.Promise.delay(50);
    assert.equal(pop.innerHTML, errorHtml);
  });

  it('follows a streaming answer without smooth scrolling and respects user pause', async function () {
    const calls: ScrollToOptions[] = [];
    wrapper.scrollTo = ((options: ScrollToOptions) => calls.push(options)) as typeof wrapper.scrollTo;
    session.pending.shouldAutoScroll = true;
    session.pending.scrollUserOverride = true;
    await onLLMStreamUpdateV2({ session, fullText: '第一段', force: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].behavior, 'instant');
    session.pending.scrollUserPaused = true;
    await onLLMStreamUpdateV2({ session, fullText: '第一段继续', force: true });
    assert.equal(calls.length, 1);
    session.pending.scrollUserPaused = false;
    await onLLMStreamUpdateV2({ session, fullText: '第一段继续跟随', force: true });
    assert.equal(calls.length, 2);
  });

  it('updates cumulative consumption while streaming and keeps reply usage separate', function () {
    const indicator = pop.ownerDocument!.createElement('span');
    indicator.classList.add('input-context-tokens');
    wrapper.appendChild(indicator);
    const actions = pop.ownerDocument!.createElement('div');
    actions.classList.add('chat-actions');
    pop.appendChild(actions);
    const usage = {
      promptTokens: 350,
      completionTokens: 90,
      totalTokens: 440,
      cumulative: { promptTokens: 450, completionTokens: 120, totalTokens: 570 },
    };
    onTokenUsageUpdateV2(session, usage);
    assert.equal(indicator.textContent, `${getString('token-usage-cumulative')}: 570`);
    assert.notInclude(indicator.textContent!, '%');
    assert.include(indicator.title, '450');
    onLLMStreamEndV2(session, usage);
    assert.equal(pop.querySelector('.chat-token-usage')!.textContent, '↑350 ↓90');
    assert.equal(session.lastUsage!.cumulative!.totalTokens, 570);
    assert.equal(contextTokenInfo(session.lastUsage, 1000).text, indicator.textContent, 'Remounted inputs restore the session usage');
  });

  it('keeps API context occupancy formatting and clears empty sessions', function () {
    assert.include(contextTokenInfo({ totalTokens: 500 }, 1000).text, '500 / 1.0K · 50%');
    assert.deepEqual(contextTokenInfo(undefined), { text: '', title: '' });
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
    let releasePdf: (() => void) | undefined;
    let pdfGate: Promise<void> | undefined;
    try {
      (Zotero.Items as any).get = (id: any) =>
        id === 999999
          ? { id, attachmentContentType: 'application/pdf', isAttachment: () => true, getField: () => '', getCreators: () => [] }
          : originalGet.call(Zotero.Items, id);
      fullText.getItemCacheFile = () => ({ exists: () => false });
      (Zotero.PDFWorker as any).getFullText = async () => {
        reads++;
        // Hold the streaming lookup until all deltas arrive. A watchdog makes
        // a blocking regression fail the assertion rather than hang the suite.
        await (pdfGate ? Promise.race([pdfGate, Zotero.Promise.delay(5000)]) : Zotero.Promise.delay(1));
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

      pdfGate = new Promise<void>((resolve) => (releasePdf = resolve));
      const result = await consumeAgentStream(session, {
        fullStream: (async function* () {
          for (let i = 0; i < 30; i++) {
            yielded++;
            yield { type: 'text-delta', text: i === 0 ? '[cite:999999:L1] ' : '正文' };
            await Zotero.Promise.delay(2);
          }
          releasePdf!();
        })(),
        response: Promise.resolve({ messages: [] }),
        usage: Promise.resolve({}),
      });
      assert.isFalse(result.failed);
      assert.equal(receivedWhileReading, 30, 'Slow Markdown must not block reading subsequent text deltas');
      assert.equal(reads, 3, 'The whole streamed response must reuse one PDF lookup');
      assert.equal(pop.dataset.markdown, '[cite:999999:L1] ' + '正文'.repeat(29));
      assert.include(pop.innerHTML, 'data-page="1"');
    } finally {
      releasePdf?.();
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
