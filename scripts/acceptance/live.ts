// Explicitly loaded through Zotero's Run JavaScript window, never by an automatic test runner.
// Reads the real library; model requests use the installed plugin and existing credentials.
import { itemAttachments, metadataItem, resolveAttachment, AttachmentSelectionError } from '../../src/utils/attachments';
import { getItemMetadata } from '../../src/utils/itemContext';
import { getItemFullTextByPage, readItemText, searchItemAttachments } from '../../src/utils/zoteroItemAccess';
import { capturePageByNumber, getOrOpenPDFReaderForItem, openCapturePreview } from '../../src/modules/capture';
import { openCitation } from '../../src/modules/citationAction';
import { htmlToMarkdown, htmlToPlainText, selectionToHtml } from '../../src/utils/chatSelectionCopy';
import { getModelMetadata } from '../../src/utils/providers';
import { installWebGlobals } from '../../src/utils/installWebGlobals';
import { createImageNavigation } from '../../src/utils/imageNavigation';
import { createImageViewer } from '../../src/components/imagePreview';
import { nativeLiteratureRequest, searchCrossrefPapers } from '../../src/modules/literatureTools';
import { createDocumentFingerprint } from '../../src/utils/documentSnapshot';
import { contextFingerprint } from '../../src/modules/codex/policy';
import { textFingerprint, escapeRegExp } from '../../src/utils/textPrimitives';
import { config } from '../../package.json';

declare const __acceptanceOutputDirectory__: string;
const directory = __acceptanceOutputDirectory__;
const win = Zotero.getMainWindow();
const plugin = (Zotero as any).ZAIBar as typeof addon;
const manager = plugin.chatManager;
const report: any = { started: new Date().toISOString(), environment: {}, checks: [], stage: 'ready' };
let original: any;
let reader: any;
let regular: Zotero.Item[];
let image: any;
let session: any;
const created = new Set<string>();
const pause = (ms: number) => Zotero.Promise.delay(ms);
const ensure = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const pref = (key: string) => `${config.prefsPrefix}.${key}`;
const prefs = [
  'translate.separateTab',
  'translate.useAlternativeModel',
  'translate.useModelForWords',
  'translate.modelId',
  'translate.thinkingDepth',
];
async function save() {
  await IOUtils.writeJSON(`${directory}/results.json`, report);
}
async function check(name: string, action: () => Promise<any> | any) {
  report.stage = name;
  await save();
  const started = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, status: 'pass', milliseconds: Date.now() - started, detail });
  } catch (error) {
    report.checks.push({ name, status: 'fail', milliseconds: Date.now() - started, error: String((error as Error).message).slice(0, 700) });
  }
  await save();
}
function input() {
  return [...plugin.data.sharedInputAreas].find((node) => node.isConnected && node.dataset.sessionId === session?.id) as HTMLElement;
}
function content() {
  const body = plugin.data.sidePaneBodyMap.get(session.id);
  return body?.querySelector('#ai-bar-chat-root')?.shadowRoot?.querySelector('.message-container') ?? body?.querySelector('.message-container');
}
function event(node: Element, type: string) {
  node.dispatchEvent(
    new node.ownerDocument.defaultView!.MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'mouseleave', composed: true })
  );
}
function select(model: any) {
  plugin.data.userProviderConfigV2.active = { providerId: model.providerId, modelId: model.id };
  plugin.data.refreshModelInfoAnchors?.();
}
async function beginConversation() {
  ensure(!session.pending.abortController, 'A request is already running');
  ensure(manager.startNewConversation(session), 'Cannot create test conversation');
  created.add(session.conversationId);
  await pause(50);
}
async function request(model: any, prompt: string, options: any = {}) {
  select(model);
  await beginConversation();
  session.chatMode = options.mode ?? 'normal';
  session.thinkingEffort = options.effort ?? 'none';
  const before = Date.now();
  const work = manager.sendChatRequest({
    userPrompt: prompt,
    sessionId: session.id,
    sessionKind: 'article',
    sourceTabId: reader.tabID,
    itemId: reader.itemID,
    selectionSnapshot: { text: undefined },
    isFromPopup: true,
    sourceLabel: '真实文献验收',
    ...options.params,
  });
  const timer = win.setTimeout(() => session.pending.abortController?.abort(), 90_000);
  try {
    await work;
  } finally {
    win.clearTimeout(timer);
  }
  ensure(!session.activeRequestPromise && !session.pending.abortController, 'Request did not restore its idle state');
  const pop = session.lastAssistantPop as HTMLElement | undefined;
  const text = pop?.dataset.markdown ?? '';
  ensure(text.trim(), `Model returned no saved text: ${pop?.textContent?.slice(-350) ?? 'no response card'}`);
  ensure(!pop?.querySelector('.chat-message-content.text-red-600'), 'Response contains a rendered error');
  const history = session.conversationHistory.at(-1);
  ensure(history?.role === 'assistant', 'Reply was not saved to conversation history');
  return {
    model: `${model.providerId}::${model.id}`,
    milliseconds: Date.now() - before,
    text: text.slice(0, 800),
    usage: session.lastUsage,
    cards: pop?.querySelectorAll('.tool-call-box').length,
  };
}

async function initialize() {
  if (original) return;
  ensure(
    ![...manager.sessionsMap.values()].some((entry) => entry.activeRequestPromise || entry.pending.abortController),
    'Finish the current user request before testing'
  );
  reader = Zotero.Reader.getByTabID((win as any).Zotero_Tabs.selectedID) ?? Zotero.Reader._readers[0];
  ensure(reader?.itemID, 'Open a real PDF reader before starting');
  const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true);
  regular = items.filter((item) => item.isRegularItem());
  session = manager.getOrCreateSession({ sessionId: `article:${reader.tabID}`, kind: 'article', sourceTabId: reader.tabID, itemId: reader.itemID });
  original = {
    active: plugin.data.userProviderConfigV2.active,
    conversationId: session.conversationId,
    chatMode: session.chatMode,
    thinkingEffort: session.thinkingEffort,
    codexThinkingEffort: session.codexThinkingEffort,
    selectedTab: (win as any).Zotero_Tabs.selectedID,
    prefs: prefs.map((key) => Zotero.Prefs.get(pref(key), true)),
    library: regular.map((item) => [item.id, item.dateModified, item.getAttachments()]),
    existingIds: new Set(manager.listConversations(session).map((entry) => entry.id)),
  };
  report.environment = {
    zotero: Zotero.version,
    profile: PathUtils.profileDir,
    itemCount: regular.length,
    document: {
      attachmentId: reader.itemID,
      parentId: metadataItem(Zotero.Items.get(reader.itemID)).id,
      title: metadataItem(Zotero.Items.get(reader.itemID)).getField('title'),
    },
    models: plugin.data.userProviderConfigV2.addedModels.map((model) => ({ id: model.id, providerId: model.providerId, enabled: model.enabled })),
  };
  await save();
}

async function local() {
  await initialize();
  await check('真实附件：元数据与页行读取、越界和来源 ID', async () => {
    const attachment = Zotero.Items.get(reader.itemID);
    const parent = metadataItem(attachment);
    const metadata = getItemMetadata(attachment.id);
    ensure(metadata?.title === parent.getField('title'), 'Attachment metadata lost parent title');
    const pages = await getItemFullTextByPage(attachment.id);
    ensure(pages && pages.pageTexts.length > 1, 'Could not extract real multipage PDF');
    const first: any = await readItemText(attachment.id, 1);
    ensure(
      first.attachmentId === attachment.id && first.parentItemId === parent.id && first.page === 1,
      'Read provenance differs from the requested file'
    );
    ensure(first.text?.length > 100, 'Page extraction returned too little text');
    ensure('error' in (await readItemText(attachment.id, pages!.pageTexts.length + 1)), 'Out-of-range page was accepted');
    ensure('error' in (await readItemText(attachment.id, 0)), 'Page zero was accepted');
    return { attachmentId: attachment.id, parentId: parent.id, pages: pages!.pageTexts.length, pageOneCharacters: first.text.length };
  });
  await check('真实多附件：明确选择、跨附件分页、稳定顺序和不可读附件', async () => {
    const parent = regular.find(
      (item) => itemAttachments(item.id).filter((attachment) => attachment.attachmentContentType === 'application/pdf').length > 1
    );
    ensure(parent, 'No parent with multiple PDFs exists');
    const files = itemAttachments(parent!.id);
    let ambiguous = false;
    try {
      resolveAttachment(parent!.id, 'pdf');
    } catch (error) {
      ambiguous = error instanceof AttachmentSelectionError;
    }
    ensure(ambiguous, 'Ambiguous parent silently selected a PDF');
    const read: any = await readItemText(parent!.id, 1);
    ensure(read.candidates?.length > 1, 'Read did not return attachment candidates');
    const first = await searchItemAttachments(parent!.id, '[A-Za-z]', true, 2);
    ensure(first.totalMatches > 2 && first.nextOffset === 2, 'Global pagination did not expose continuation');
    const again = await searchItemAttachments(parent!.id, '[A-Za-z]', true, 2);
    ensure(JSON.stringify(first.excerpts) === JSON.stringify(again.excerpts), 'Search order was unstable');
    const counts = await Promise.all(files.map(async (file) => ({ id: file.id, result: await searchItemAttachments(file.id, '[A-Za-z]', true, 1) })));
    const readable = counts.filter((entry) => entry.result.totalMatches > 0);
    ensure(readable.length >= 2, 'Selected multi-PDF item does not contain two readable files');
    const offset = counts.slice(0, counts.indexOf(readable[0]) + 1).reduce((sum, entry) => sum + entry.result.totalMatches, 0) - 1;
    const boundary = await searchItemAttachments(parent!.id, '[A-Za-z]', true, 2, offset);
    ensure(boundary.excerpts[0].attachmentId !== boundary.excerpts[1]?.attachmentId, 'Pagination did not cross the attachment boundary');
    const cancelled = new win.AbortController();
    cancelled.abort();
    let aborted = false;
    try {
      await searchItemAttachments(parent!.id, 'the', false, 2, 0, cancelled.signal);
    } catch (error) {
      aborted = (error as Error).name === 'AbortError';
    }
    ensure(aborted, 'Cancellation became an unreadable-file result');
    const missing = await searchItemAttachments(parent!.id, 'ZAIBAR_NONEXISTENT_20261015', false, 2);
    ensure(missing.totalMatches === 0 && !missing.truncated && missing.nextOffset === undefined, 'No-match search pagination is inconsistent');
    return {
      parentId: parent!.id,
      files: counts.map((entry) => ({ id: entry.id, matches: entry.result.totalMatches, unreadable: entry.result.unreadableAttachments })),
      boundary: boundary.excerpts.map(({ attachmentId, parentItemId, page, line }) => ({ attachmentId, parentItemId, page, line })),
    };
  });
  await check('真实非 PDF：行号、不编造页码及不可读来源', async () => {
    const files = regular.flatMap((item) => itemAttachments(item.id));
    const candidates = files.filter(
      (item) =>
        item.attachmentContentType !== 'application/pdf' &&
        (item.attachmentContentType?.startsWith('text/') || item.attachmentContentType === 'application/epub+zip')
    );
    for (const candidate of candidates.slice(0, 30)) {
      const result = await searchItemAttachments(candidate.id, '[A-Za-z]', true, 2);
      if (!result.totalMatches) continue;
      ensure(
        result.excerpts.every((match) => match.page === undefined && match.line > 0),
        'Non-PDF search invented a page'
      );
      const text: any = await readItemText(candidate.id, undefined, 1, 3);
      ensure(text.attachmentId === candidate.id && text.page === undefined, 'Non-PDF read lost its identity or added a page');
      return { id: candidate.id, type: candidate.attachmentContentType, matches: result.totalMatches };
    }
    throw new Error(
      `No readable non-PDF fixture found in the first ${Math.min(30, candidates.length)} real candidates; do not count this case as passed`
    );
  });
  await check('真实 PDF 截图：有效页、两端越界和最终文件', async () => {
    const found = await getOrOpenPDFReaderForItem(reader.itemID);
    ensure(found === reader, 'Explicit attachment did not reuse its reader');
    image = await capturePageByNumber(reader, 1);
    ensure(image.dataUrl.startsWith('data:image/png;base64,') && image.width > 0 && image.height > 0, 'Screenshot is empty');
    const bytes = Uint8Array.from(atob(image.dataUrl.split(',')[1]), (character) => character.charCodeAt(0));
    await IOUtils.write(`${directory}/real-pdf-page-1.png`, bytes);
    for (const page of [0, 100000]) {
      let rejected = false;
      try {
        await capturePageByNumber(reader, page);
      } catch {
        rejected = true;
      }
      ensure(rejected, `Invalid screenshot page accepted: ${page}`);
    }
    return { attachmentId: reader.itemID, page: 1, width: image.width, height: image.height, bytes: bytes.length };
  });
  await check('真实引用导航：显式附件复用且不重复打开', async () => {
    const before = Zotero.Reader._readers.length;
    await openCitation(reader.itemID, 1);
    await openCitation(reader.itemID, 1);
    ensure(Zotero.Reader._readers.length === before, 'Citation navigation opened duplicate readers');
    return { attachmentId: reader.itemID, readers: before };
  });
  await check('真实模型：同提供商能力解析、关闭联网与禁用条目保留', () => {
    const models = plugin.data.userProviderConfigV2.addedModels;
    const resolved = models.map((model) => {
      const metadata = getModelMetadata({ providerId: model.providerId, modelId: model.id });
      ensure(metadata?.name === model.name, 'Saved display name was overwritten');
      return {
        id: model.id,
        providerId: model.providerId,
        reasoning: metadata?.reasoning,
        temperature: metadata?.temperature,
        image: metadata?.modalities?.input?.includes('image'),
        structured: metadata?.structured_output,
      };
    });
    ensure(!getModelMetadata({ providerId: 'nonexistent-provider', modelId: models[0].id }), 'Capabilities leaked across providers');
    return resolved;
  });
  await check('真实聊天输入：模型点击、其余 hover、间隙与淡出恢复', async () => {
    const wrapper = input();
    ensure(wrapper, 'Live shared input not mounted');
    const buttons = wrapper.querySelectorAll('button');
    const thinking = [...buttons].find((button) => button.title === '思考强度' || button.title.toLowerCase().includes('thinking'));
    const mode = [...buttons].find((button) => button.title === '对话模式' || button.title.toLowerCase().includes('chat mode'));
    const model = wrapper.querySelector('.model-info-container')!;
    const root = wrapper.getRootNode() as ShadowRoot;
    ensure(thinking && mode && model, 'Live menu anchors unavailable');
    event(model, 'mouseenter');
    ensure(!root.querySelector('#ai-bar-model-dropdown'), 'Model selector opened on hover');
    event(model, 'click');
    ensure(root.querySelector('#ai-bar-model-dropdown'), 'Model selector did not open on click');
    const labels = [...root.querySelectorAll('#ai-bar-model-dropdown button')].map((button) => button.textContent);
    ensure(!labels.some((label) => label?.includes('GPT-6-Sol')), 'Disabled model is visible');
    event(win.document.documentElement, 'click');
    ensure(!root.querySelector('#ai-bar-model-dropdown'), 'Shadow DOM outside click did not close the model menu');
    for (const [anchor, selector] of [
      [thinking, '.thinking-effort-dropdown'],
      [mode, '.chat-mode-dropdown'],
    ] as const) {
      event(anchor!, 'mouseenter');
      ensure(!root.querySelector(selector), 'Composer menu opened on hover');
      event(anchor!, 'click');
      const menu = root.querySelector(selector) as HTMLElement;
      ensure(menu, 'Composer menu did not open on click');
      event(anchor!, 'mouseleave');
      await pause(100);
      ensure(menu.isConnected && menu.style.opacity !== '0', 'Menu closed while traversing its gap');
      event(menu, 'mouseenter');
      await pause(180);
      ensure(menu.isConnected, 'Re-entry did not cancel dismissal');
      event(menu, 'mouseleave');
      await pause(280);
      ensure(menu.style.opacity === '0', '250ms leave delay was not applied');
      event(menu, 'mouseenter');
      await pause(170);
      ensure(menu.isConnected && menu.style.opacity === '1', 'Fade-out could not be reversed');
      event(menu, 'mouseleave');
      await pause(430);
      ensure(!menu.isConnected, 'Menu did not finish closing');
      event(anchor!, 'mouseenter');
      event(anchor!, 'mouseleave');
      await pause(430);
      ensure(!root.querySelector(selector), 'Reopened menu lost its timer');
    }
    return { liveControls: true, enabledModelLabels: labels };
  });
  await check('真实复制环境：公式、整表、嵌套列表、编号与代码围栏', async () => {
    ensure(htmlToMarkdown('<p>*literal* _under_ [bracket]</p>').includes('\\*literal\\*'), 'Markdown literals were not escaped');
    ensure(/^7\./.test(htmlToMarkdown('<ol start="7"><li>Seventh<ul><li>Nested</li></ul></li></ol>')), 'Ordered list start was lost');
    const code = htmlToMarkdown('<pre><code>line1\n```\nline2\n\n\nline3</code></pre>');
    ensure(code.startsWith('````\n') && code.includes('line2\n\n\nline3'), 'Code fence or whitespace was damaged');
    const element = win.document.createElement('div');
    element.innerHTML = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></tbody></table>';
    win.document.documentElement.appendChild(element);
    const range = win.document.createRange();
    range.selectNodeContents(element.querySelector('td')!);
    const selection = win.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const html = selectionToHtml(selection, win.document);
    selection.removeAllRanges();
    element.remove();
    ensure(html.includes('<table') && html.includes('two'), 'Partial table selection did not expand to the full table');
    const math = '<span data-zaibar-math="inline">x_1 + \\alpha</span>';
    ensure(htmlToMarkdown(math) === '$x_1 + \\alpha$', 'LaTeX was escaped by the generic converter');
    ensure(htmlToPlainText(math).includes('$x_1'), 'Plain text copy lost LaTeX');
    ensure(htmlToMarkdown('<p>Keep<span data-zaibar-copy-ignore="true">Ignore</span></p>') === 'Keep', 'Chat controls entered copied content');
    return { markdown: htmlToMarkdown(html), code };
  });
  await check('真实图片预览：两种宿主共用导航、计数与键盘', async () => {
    ensure(image, 'A real PDF screenshot is required');
    const viewer = createImageViewer([image.dataUrl, image.dataUrl], 99, win.document.documentElement, win.document);
    ensure(viewer.overlay.textContent?.includes('2 / 2'), 'Image viewer did not clamp its initial index');
    viewer.overlay.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    ensure(viewer.overlay.textContent?.includes('1 / 2'), 'Keyboard navigation did not update the counter');
    viewer.overlay.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    ensure(!viewer.overlay.isConnected, 'Escape did not release the viewer');
    openCapturePreview([image.dataUrl, image.dataUrl], 1);
    await pause(400);
    const windows = Services.wm.getEnumerator(null);
    let preview: Window | undefined;
    while (windows.hasMoreElements()) {
      const candidate = windows.getNext() as Window;
      if (candidate.location?.href.includes('captureWindow')) preview = candidate;
    }
    ensure(preview, 'Standalone preview did not open');
    ensure(preview!.document.body.textContent?.includes('2 / 2'), 'Standalone counter differs from overlay');
    preview!.document.dispatchEvent(new preview!.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    ensure(preview!.document.body.textContent?.includes('1 / 2'), 'Standalone keyboard navigation failed');
    preview!.close();
    return { overlay: true, standalone: true, realPdfImage: true };
  });
  await check('启动补齐与小工具：部分缺失、无主窗口及持久指纹格式', () => {
    const target: any = { TransformStream: win.TransformStream };
    installWebGlobals(target, win);
    ensure(
      target.TransformStream === win.TransformStream && target.TextEncoder === win.TextEncoder && target.ReadableStream === win.ReadableStream,
      'Partial globals were not completed'
    );
    installWebGlobals({}, undefined);
    const text = '真实文献 😀\n';
    ensure(createDocumentFingerprint(text) === `${text.length}-${textFingerprint(text).toString(16)}`, 'Document fingerprint encoding changed');
    const serialized = JSON.stringify({ text });
    ensure(contextFingerprint({ text }) === `${serialized.length}:${textFingerprint(serialized)}`, 'Codex fingerprint encoding changed');
    ensure(new RegExp(escapeRegExp('[x].*')).test('[x].*'), 'Shared regexp escaping changed literal semantics');
    return { document: createDocumentFingerprint(text), codex: contextFingerprint({ text }) };
  });
  report.stage = 'local-complete';
  await save();
  return report;
}

async function models() {
  await initialize();
  const enabled = plugin.data.userProviderConfigV2.addedModels.filter((model) => model.enabled !== false);
  const deepseek = enabled.find((model) => model.providerId === 'deepseek');
  const qwen = enabled.find((model) => model.id.startsWith('qwen-mt'));
  if (deepseek) {
    await check('真实 DeepSeek：文献问答、流式结束和持久化一致', async () => {
      const result = await request(deepseek, '验收测试：请只用一句中文概括当前文献研究了什么，不要调用工具。');
      ensure(result.text.length > 5, 'Live chat response too short');
      return result;
    });
    await check('真实 DeepSeek：Agent 检索读取及工具前后文本顺序', async () => {
      const result = await request(
        deepseek,
        `验收测试：请先用 grep 在附件 ${reader.itemID} 检索 sweep，再用 read 读取一处命中的上下文，最后用一句中文说明本文如何提高 LED 速度。只读文献，不执行任何入库或修改操作。`,
        { mode: 'agent' }
      );
      const pop = session.lastAssistantPop as HTMLElement;
      ensure(pop.querySelectorAll('.tool-call-box').length >= 2, 'Live Agent did not exercise the requested tools');
      ensure(pop.dataset.markdown === session.persistedTurns.at(-1).assistantMarkdown, 'Displayed full reply differs from persisted reply');
      return result;
    });
    await check('真实 DeepSeek：专用结构化单词翻译', () =>
      request(deepseek, 'Translate the selected word into Chinese.', {
        params: { translationRequest: { selectedText: 'capacitance', targetLanguage: 'zh-CN', modelKey: `${deepseek.providerId}::${deepseek.id}` } },
      })
    );
    await check('真实 DeepSeek：主动停止、迟到事件与输入恢复', async () => {
      select(deepseek);
      await beginConversation();
      session.chatMode = 'normal';
      const before = session.persistedTurns.length;
      const work = manager.sendChatRequest({
        userPrompt: '验收停止测试：请从1一直列举到1000，每个数字另起一行。',
        sessionId: session.id,
        sessionKind: 'article',
        sourceTabId: reader.tabID,
        itemId: reader.itemID,
        isFromPopup: true,
        selectionSnapshot: { text: undefined },
      });
      for (let index = 0; index < 100 && !session.pending.abortController; index++) await pause(20);
      ensure(session.pending.abortController, 'Stop test did not enter a pending state');
      await pause(600);
      session.pending.abortController?.abort();
      await work;
      const text = session.lastAssistantPop?.textContent;
      await pause(500);
      ensure(!session.activeRequestPromise && !session.pending.abortController, 'Stop did not restore idle state');
      ensure(session.lastAssistantPop?.textContent === text, 'Late model events changed the stopped response');
      ensure(session.persistedTurns.length === before, 'Cancelled response was saved as a completed turn');
      return { aborted: true, persistedNewTurns: session.persistedTurns.length - before };
    });
  }
  if (qwen)
    await check('真实 Qwen-MT：翻译模型覆盖、专用接口及中文译文', async () => {
      select(deepseek ?? qwen);
      const result = await request(deepseek ?? qwen, 'Translate this selected text.', {
        params: {
          translationRequest: {
            selectedText: 'The LED modulation speed is limited by the remaining carriers in the depletion capacitance.',
            targetLanguage: 'zh-CN',
            modelKey: `${qwen.providerId}::${qwen.id}`,
          },
        },
      });
      ensure(/[\u4e00-\u9fff]/.test(result.text), 'Dedicated translation did not return Chinese');
      return { ...result, actualTranslationModel: `${qwen.providerId}::${qwen.id}` };
    });
  for (const codex of enabled.filter((model) => model.providerId === 'codex-subscription')) {
    await check(`真实 Codex：${codex.id} 流式回复及运行时能力`, () =>
      request(codex, '验收测试：请只用一句中文说明当前文献讨论的器件是什么。不要调用工具。')
    );
  }
  const codex = enabled.find((model) => model.providerId === 'codex-subscription');
  if (codex) {
    await check('真实 Codex：多文本段、工具调用、最终保存', async () => {
      const result = await request(
        codex,
        `验收测试：先说“开始读取”，再调用 read 读取附件 ${reader.itemID} 第一页，最后用一句中文概括，禁止修改或入库。`,
        { mode: 'agent', effort: 'low' }
      );
      const pop = session.lastAssistantPop as HTMLElement;
      ensure(pop.querySelector('.tool-call-box'), 'Codex did not call a document tool');
      ensure(pop.dataset.markdown === session.conversationHistory.at(-1).content, 'Codex persisted text differs from full displayed reply');
      return { ...result, textSegments: pop.querySelectorAll('.chat-message-content').length };
    });
    await check('真实 Codex：完整结构化翻译字段与适配', () =>
      request(codex, 'Translate the selected word.', {
        params: { translationRequest: { selectedText: 'depletion', targetLanguage: 'zh-CN', modelKey: `${codex.providerId}::${codex.id}` } },
      })
    );
  }
  report.stage = 'models-complete';
  await save();
  return report;
}

async function cleanup() {
  if (!original) return;
  if (session.activeRequestPromise) {
    session.pending.abortController?.abort();
    await session.activeRequestPromise;
  }
  plugin.data.userProviderConfigV2.active = original.active;
  plugin.data.refreshModelInfoAnchors?.();
  session.chatMode = original.chatMode;
  session.thinkingEffort = original.thinkingEffort;
  session.codexThinkingEffort = original.codexThinkingEffort;
  for (const id of created) if (!original.existingIds.has(id)) manager.deleteConversation(session, id);
  if (original.conversationId && manager.historyStore.get(original.conversationId)) manager.activateConversation(session, original.conversationId);
  else manager.startNewConversation(session);
  prefs.forEach((key, index) => {
    const value = original.prefs[index];
    if (value === undefined) Zotero.Prefs.clear(pref(key), true);
    else Zotero.Prefs.set(pref(key), value, true);
  });
  await manager.flushHistory();
  await check('清理验收：原模型恢复、测试会话清理与真实文献无修改', async () => {
    const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true);
    const now = items.filter((item) => item.isRegularItem()).map((item) => [item.id, item.dateModified, item.getAttachments()]);
    ensure(JSON.stringify(now) === JSON.stringify(original.library), 'Library item timestamps or attachment bindings changed during acceptance');
    ensure(JSON.stringify(plugin.data.userProviderConfigV2.active) === JSON.stringify(original.active), 'Original active model not restored');
    return { testConversationsRemoved: created.size, libraryUnchanged: true, active: original.active };
  });
  report.stage = 'complete';
  report.finished = new Date().toISOString();
  await save();
  return report;
}

(win as any).__zaibarAcceptance = {
  report,
  local,
  models,
  cleanup,
  request,
  get session() {
    return session;
  },
  get image() {
    return image;
  },
};
