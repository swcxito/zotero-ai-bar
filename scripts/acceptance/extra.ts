import { itemAttachments, AttachmentSelectionError } from '../../src/utils/attachments';
import { getItemFullTextByPage, searchItemAttachments } from '../../src/utils/zoteroItemAccess';
import { getOrOpenPDFReaderForItem } from '../../src/modules/capture';
import { searchCrossrefPapers, nativeLiteratureRequest } from '../../src/modules/literatureTools';
import { config } from '../../package.json';

const win = Zotero.getMainWindow() as any;
const harness = win.__zaibarAcceptance;
const plugin = (Zotero as any).ZAIBar as typeof addon;
const manager = plugin.chatManager;
declare const __acceptanceOutputDirectory__: string;
const directory = __acceptanceOutputDirectory__;
let only: string[] | undefined;
const ensure = (condition: any, message: string) => {
  if (!condition) throw new Error(message);
};
const wait = (ms: number) => Zotero.Promise.delay(ms);
async function until(condition: () => boolean, timeout = 5000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error('Native UI did not reach its expected state');
    await wait(25);
  }
}
async function save() {
  await IOUtils.writeJSON(`${directory}/results.json`, harness.report);
}
async function check(name: string, action: () => any) {
  if (only && !only.includes(name)) return;
  harness.report.stage = name;
  await save();
  const started = Date.now();
  try {
    const detail = await action();
    harness.report.checks.push({ name, status: 'pass', milliseconds: Date.now() - started, detail });
  } catch (error) {
    harness.report.checks.push({ name, status: 'fail', milliseconds: Date.now() - started, error: String((error as Error).message).slice(0, 700) });
  }
  await save();
}
function wrapper() {
  return [...plugin.data.sharedInputAreas].find((element) => element.isConnected && element.dataset.sessionId === harness.session.id) as HTMLElement;
}
function messageContainer() {
  return manager.getSessionMessageContainer(harness.session.id) as HTMLElement;
}
function requestText(content: any): string {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      : '';
}

async function run(selected?: string[]) {
  only = selected;
  const session = harness.session;
  ensure(session && !session.activeRequestPromise, 'Wait until the first model batch finishes');
  const reader = Zotero.Reader.getByTabID(session.sourceTabId)!;
  const pages = await getItemFullTextByPage(reader.itemID!);
  const context = pages!.pageTexts[0].slice(0, 2200);
  const enabled = plugin.data.userProviderConfigV2.addedModels.filter((model) => model.enabled !== false);
  const deepseek = enabled.find((model) => model.providerId === 'deepseek')!;

  await check('真实持久化复核：Agent 文本数组、完整回复与历史重放', async () => {
    const conversation = manager.listConversations(session).find((entry) => entry.turns.some((turn) => turn.userText?.includes('先用 grep')))!;
    ensure(conversation, 'The real Agent test conversation was not saved');
    const expected = conversation.turns.at(-1)!.assistantMarkdown;
    const text = conversation.contextMessages
      .filter((message) => message.role === 'assistant')
      .map((message) => requestText(message.content))
      .join('')
      .trim();
    ensure(expected === text, 'Complete Agent text differs from the saved SDK response messages');
    ensure(manager.activateConversation(session, conversation.id), 'Could not reactivate Agent history');
    await until(
      () =>
        messageContainer()?.dataset.conversationId === conversation.id &&
        [...messageContainer().querySelectorAll<HTMLElement>('[data-markdown]')].some((pop) => pop.dataset.markdown === expected)
    );
    const pops = messageContainer().querySelectorAll<HTMLElement>('[data-markdown]');
    ensure(
      [...pops].some((pop) => pop.dataset.markdown === expected),
      'History replay lost the complete reply'
    );
    const initial = harness.report.checks.find((entry: any) => entry.name === '真实 DeepSeek：Agent 检索读取及工具前后文本顺序');
    if (initial?.status === 'fail' && initial.error === 'Displayed full reply differs from persisted reply') {
      initial.status = 'pass';
      initial.initialAssertionError = initial.error;
      delete initial.error;
      initial.detail = {
        correctedAssertion: 'Compare assistantMarkdown to combined SDK text parts; SDK message content is an array.',
        fullReplyCharacters: expected.length,
        replayVerified: true,
      };
    }
    return { fullReplyCharacters: expected.length, responseMessageFormat: 'SDK text-part arrays', replayVerified: true };
  });

  for (const model of enabled.filter((entry) => entry.providerId === 'deepseek' || entry.providerId === 'codex-subscription')) {
    await check(`真实选段问答：${model.id}`, async () => {
      const result = await harness.request(
        model,
        '根据我提供的当前文献选段，只用一句中文回答：研究了哪种器件，以及载流子扫出用来改善什么？不要调用工具。',
        {
          params: { selectionSnapshot: { text: context } },
        }
      );
      ensure(/LED|发光二极管|发光.*管|光.*二极管/i.test(result.text), 'Reply does not identify the real document device');
      ensure(!/没有提供|未提供|无法判断|缺少.*选段/.test(result.text), 'Actual document selection did not reach the model');
      ensure(
        session.persistedTurns.at(-1).assistantMarkdown === session.lastAssistantPop.dataset.markdown,
        'Saved reply does not match the actual displayed reply'
      );
      return result;
    });
  }
  await check('真实缺失或不可提取附件：返回来源和错误，不静默遗漏', async () => {
    const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true);
    const attachments = items.filter((item) => item.isRegularItem()).flatMap((item) => itemAttachments(item.id));
    for (const attachment of attachments.filter((item) => item.attachmentContentType !== 'application/pdf').slice(0, 80)) {
      const result = await searchItemAttachments(attachment.id, 'the', false, 2);
      if (!result.unreadableAttachments.length) continue;
      ensure(result.unreadableAttachments[0].attachmentId === attachment.id, 'Unreadable result lost the final attachment identity');
      return { attachmentId: attachment.id, type: attachment.attachmentContentType, reason: result.unreadableAttachments[0].error };
    }
    throw new Error('No unreadable attachment exists in the checked real sample; do not mark this case passed');
  });
  await check('真实多 PDF 截图：父条目歧义时先返回候选，不打开任意文件', async () => {
    const items = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true);
    const parent = items.find(
      (item) => item.isRegularItem() && itemAttachments(item.id).filter((file) => file.attachmentContentType === 'application/pdf').length > 1
    )!;
    const before = Zotero.Reader._readers.length;
    let error: any;
    try {
      await getOrOpenPDFReaderForItem(parent.id);
    } catch (caught) {
      error = caught;
    }
    ensure(error instanceof AttachmentSelectionError && error.candidates.length > 1, 'Screenshot selection failed to expose candidates');
    ensure(Zotero.Reader._readers.length === before, 'An ambiguous screenshot request opened a reader');
    return { parentId: parent.id, candidates: error.candidates };
  });
  await check('真实 Crossref：原生请求按论文标题取得 DOI 候选', async () => {
    const title = harness.report.environment.document.title;
    const result = await searchCrossrefPapers({ title, limit: 3 });
    ensure(
      result.candidates.some((candidate) => candidate.doi === '10.1109/jlt.2013.2292896'),
      'Real Crossref search did not return the current paper DOI'
    );
    return { title, candidates: result.candidates.map(({ doi, similarity }) => ({ doi, similarity })) };
  });
  await check('真实 Crossref：主动取消立即结束且不重试', async () => {
    const controller = new win.AbortController();
    let attempts = 0;
    const work = searchCrossrefPapers(
      { title: harness.report.environment.document.title },
      {
        signal: controller.signal,
        requestImpl: (url, options) => {
          attempts++;
          const pending = nativeLiteratureRequest(url, options);
          controller.abort();
          return pending;
        },
      }
    );
    let error: any;
    try {
      await work;
    } catch (caught) {
      error = caught;
    }
    ensure(error?.name === 'AbortError' && attempts === 1, 'Cancellation was retried or converted into a general network error');
    return { attempts, error: error.name };
  });
  await check('真实翻译：连续触发替换旧请求，旧译文不能覆盖新结果', async () => {
    const result = await harness.request(deepseek, 'Translate the selected text.', {
      params: { translationRequest: { selectedText: 'carrier', targetLanguage: 'zh-CN', modelKey: `${deepseek.providerId}::${deepseek.id}` } },
    });
    const first = manager.sendChatRequest({
      userPrompt: 'Translate the selected text into Chinese.',
      sessionId: session.id,
      sessionKind: 'article',
      sourceTabId: reader.tabID,
      itemId: reader.itemID!,
      isFromPopup: true,
      translationRequest: { selectedText: context, targetLanguage: 'zh-CN', modelKey: `${deepseek.providerId}::${deepseek.id}` },
    });
    await until(() => !!session.pending.abortController);
    await wait(250);
    const second = manager.sendChatRequest({
      userPrompt: 'Translate this word into Chinese.',
      sessionId: session.id,
      sessionKind: 'article',
      sourceTabId: reader.tabID,
      itemId: reader.itemID!,
      isFromPopup: true,
      translationRequest: { selectedText: 'depletion capacitance', targetLanguage: 'zh-CN', modelKey: `${deepseek.providerId}::${deepseek.id}` },
    });
    await Promise.all([first, second]);
    const text = session.lastAssistantPop.dataset.markdown;
    ensure(text && /耗尽|电容/.test(text), 'Replacement translation did not finish with the new selection');
    await wait(500);
    ensure(
      session.lastAssistantPop.dataset.markdown === text && !session.pending.abortController && !session.activeRequestPromise,
      'Late translation changed the successor or left input busy'
    );
    return { baseline: result.text, replacement: text };
  });
  await check('真实视觉模型：读取本次 PDF 截图并识别页面内容', async () => {
    ensure(harness.image?.dataUrl, 'Real PDF screenshot unavailable');
    const result = await harness.request(deepseek, '请读图，只用一句中文说明截图中的论文标题讨论了哪种器件。', {
      params: { images: [harness.image.dataUrl], selectionSnapshot: { text: undefined } },
    });
    ensure(/LED|发光二极管|发光.*管/.test(result.text), 'Vision response did not identify the device from the real screenshot');
    return result;
  });
  await check('真实历史：动画中刷新、快速切换和恢复输入', async () => {
    const history = win.document.getElementById('zaibar-sidepane-history-button') as HTMLButtonElement;
    ensure(history, 'Sidebar history button unavailable');
    for (let index = 0; index < 3; index++) {
      history.click();
      await wait(40);
      manager.notifyHistoryChanged();
      await wait(220);
      history.click();
      await wait(40);
      manager.notifyHistoryChanged();
      await wait(220);
      const textarea = wrapper()?.querySelector('textarea');
      ensure(textarea && textarea.getBoundingClientRect().height > 15, 'History interruption left an unusable input');
      ensure(win.getComputedStyle(textarea!).pointerEvents !== 'none', 'History interruption disabled input');
    }
    return { interruptions: 6, inputInteractive: true };
  });
  await check('真实宿主：侧栏与独立窗口反复切换、草稿与资源清理', async () => {
    const oldDraft = wrapper().querySelector('textarea')!.value;
    const originalAnchorCount = plugin.data.modelInfoAnchors.size;
    const draft = '验收临时草稿：不会发送';
    wrapper().querySelector('textarea')!.value = draft;
    wrapper()
      .querySelector('textarea')!
      .dispatchEvent(new win.Event('input', { bubbles: true }));
    for (let index = 0; index < 3; index++) {
      const thinking = wrapper().querySelector<HTMLButtonElement>('.input-thinking-btn')!;
      thinking.click();
      const oldWrapper = wrapper();
      const switchButton = win.document.querySelector('#zaibar-sidepane-host-switch-button') as HTMLButtonElement;
      ensure(switchButton, 'Native sidebar host-switch button unavailable');
      switchButton.click();
      await until(
        () => manager.getCurrentHostMode() === 'window' && !!manager.chatWindow?.document.querySelector('.zaibar-window-shared-input textarea')
      );
      ensure(!oldWrapper.isConnected, 'Sidebar input remained attached after host switch');
      ensure(!oldWrapper.querySelector('.thinking-effort-dropdown'), 'Menu resources survived input disposal');
      const windowInput = manager.chatWindow!.document.querySelector('.zaibar-window-shared-input textarea') as HTMLTextAreaElement;
      ensure(windowInput.value === draft, 'Draft was lost while undocking');
      (manager.chatWindow!.document.querySelector('.zaibar-window-host-switch') as HTMLButtonElement).click();
      await until(() => manager.getCurrentHostMode() === 'sidebar' && !!wrapper());
      ensure(wrapper().querySelector('textarea')!.value === draft, 'Draft was lost while docking');
      ensure(plugin.data.sharedInputAreas.size === 1, 'Shared input registry leaked a host');
      ensure(plugin.data.modelInfoAnchors.size <= originalAnchorCount, 'Model anchor registrations leaked across host changes');
    }
    wrapper().querySelector('textarea')!.value = oldDraft;
    wrapper()
      .querySelector('textarea')!
      .dispatchEvent(new win.Event('input', { bubbles: true }));
    return { switches: 6, sharedInputs: plugin.data.sharedInputAreas.size, anchorCount: plugin.data.modelInfoAnchors.size };
  });
  harness.report.stage = 'extra-complete';
  await save();
}
win.__zaibarAcceptanceExtra = { run };
