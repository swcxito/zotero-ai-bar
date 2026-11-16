import { config } from '../../package.json';
import { searchItemAttachments } from '../../src/utils/zoteroItemAccess';
import { nativeLiteratureRequest, searchCrossrefPapers } from '../../src/modules/literatureTools';

const win = Zotero.getMainWindow() as any;
const h = win.__zaibarAcceptance;
const plugin = (Zotero as any).ZAIBar as typeof addon;
declare const __acceptanceOutputDirectory__: string;
const directory = __acceptanceOutputDirectory__;
const wait = (ms: number) => Zotero.Promise.delay(ms);
function ensure(condition: any, message: string) {
  if (!condition) throw new Error(message);
}
async function until(condition: () => boolean, timeout = 2500) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Native UI state timeout');
    await wait(20);
  }
}
async function check(name: string, run: () => any) {
  h.report.stage = name;
  await IOUtils.writeJSON(`${directory}/results.json`, h.report);
  const start = Date.now();
  try {
    const detail = await run();
    h.report.checks.push({ name, status: 'pass', milliseconds: Date.now() - start, detail });
  } catch (error) {
    h.report.checks.push({ name, status: 'fail', milliseconds: Date.now() - start, error: String((error as Error).message).slice(0, 700) });
  }
  await IOUtils.writeJSON(`${directory}/results.json`, h.report);
}
function mouse(node: Element, type: string) {
  node.dispatchEvent(
    new node.ownerDocument.defaultView!.MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'mouseleave', composed: true })
  );
}
async function run() {
  const session = h.session;
  ensure(!session.activeRequestPromise, 'A real request is still running');
  await check('实际侧栏菜单复核：关闭时序与淡出后重新移入', async () => {
    const wrapper = [...plugin.data.sharedInputAreas].find((node) => node.dataset.sessionId === session.id && node.isConnected)!;
    const root = wrapper.getRootNode() as ShadowRoot;
    const timings: any[] = [];
    mouse(win.document.documentElement, 'click');
    for (const title of ['思考强度', '对话模式']) {
      const anchor = [...wrapper.querySelectorAll('button')].find((button) => button.title === title)!;
      ensure(anchor, `Missing native ${title} button`);
      mouse(anchor, 'mouseenter');
      const menu = root.querySelector(title === '思考强度' ? '.thinking-effort-dropdown' : '.chat-mode-dropdown') as HTMLElement;
      ensure(menu, 'Native hover menu did not open');
      mouse(anchor, 'mouseleave');
      await wait(280);
      ensure(menu.style.opacity === '0', 'Native menu was not fading after the leave delay');
      mouse(menu, 'mouseenter');
      await wait(180);
      ensure(menu.isConnected && menu.style.opacity === '1', 'Fade re-entry did not restore the native menu');
      const left = Date.now();
      mouse(menu, 'mouseleave');
      await until(() => !menu.isConnected);
      ensure(Date.now() - left >= 370 && Date.now() - left < 800, 'Native dismissal deviated from 250ms wait plus 150ms fade');
      timings.push({ title, milliseconds: Date.now() - left });
    }
    return { timings, note: 'The earlier menu run overlapped native-window pointer/focus changes; this isolated rerun waits for actual removal.' };
  });
  await check('实际阅读器更多菜单：原生真实选段、hover 展开和移出关闭', async () => {
    const reader = Zotero.Reader.getByTabID(session.sourceTabId) as any;
    const view = reader._internalReader._primaryView;
    const chars = view._pdfPages[0].chars.slice(50, 88);
    const rect = [
      Math.min(...chars.map((char: any) => char.rect[0])),
      Math.min(...chars.map((char: any) => char.rect[1])),
      Math.max(...chars.map((char: any) => char.rect[2])),
      Math.max(...chars.map((char: any) => char.rect[3])),
    ];
    const autoKey = `${config.prefsPrefix}.translate.enableAuto`;
    const oldAuto = Zotero.Prefs.get(autoKey, true);
    const oldRanges = view._selectionRanges;
    const oldSelection = { ...plugin.data.selection };
    try {
      Zotero.Prefs.set(autoKey, false, true);
      view._setSelectionRanges([
        {
          collapsed: false,
          pageIndex: 0,
          text: chars.map((char: any) => char.u).join(''),
          sortIndex: '00000|000050|00000',
          position: { pageIndex: 0, rects: [rect] },
        },
      ]);
      const doc = reader._iframeWindow.document;
      await until(() => !!doc.querySelector('.ai-bar-container .expand-trigger-btn'));
      const anchor = doc.querySelector('.expand-trigger-btn') as HTMLElement;
      mouse(anchor.closest('.expand-container')!, 'mouseenter');
      const menu = doc.querySelector('.expand-container .model-dropdown-menu') as HTMLElement;
      ensure(menu?.querySelectorAll('button').length > 0, 'Native reader menu did not render XML-safe options');
      mouse(anchor, 'mouseleave');
      await wait(100);
      ensure(menu.isConnected, 'Reader menu cannot cross its gap');
      mouse(menu, 'mouseenter');
      await wait(200);
      ensure(menu.isConnected, 'Reader menu re-entry did not cancel closing');
      mouse(menu, 'mouseleave');
      await until(() => !menu.isConnected);
      return { attachmentId: reader.itemID, selectedCharacters: chars.length, optionsAreNativeButtons: true, annotationsSaved: false };
    } finally {
      view._setSelectionRanges(oldRanges);
      if (oldAuto === undefined) Zotero.Prefs.clear(autoKey, true);
      else Zotero.Prefs.set(autoKey, oldAuto as boolean, true);
      await wait(500);
      plugin.data.selection = oldSelection;
    }
  });
  await check('真实附件异步读取中取消：不能变成不可读错误', async () => {
    const controller = new win.AbortController();
    const work = searchItemAttachments(h.report.environment.document.parentId, '[A-Za-z]', true, 10, 0, controller.signal);
    controller.abort();
    let error: any;
    try {
      await work;
    } catch (caught) {
      error = caught;
    }
    ensure(error?.name === 'AbortError', 'In-flight extraction cancellation was swallowed');
    return { name: error.name };
  });
  await check('真实 HTTP 超时：两次尝试结束且无原生隐式叠加', async () => {
    let attempts = 0;
    let error: any;
    try {
      await searchCrossrefPapers(
        { title: h.report.environment.document.title },
        {
          timeoutMs: 1,
          delay: async () => {},
          requestImpl: (url, options) => {
            attempts++;
            return nativeLiteratureRequest(url, options);
          },
        }
      );
    } catch (caught) {
      error = caught;
    }
    ensure(error && attempts === 2, 'Native real-network timeout did not terminate after exactly two attempts');
    return { attempts, timeoutMsForFaultInjection: 1, error: error.name, detail: String(error.message).slice(0, 200) };
  });
  h.report.stage = 'edges-complete';
  await IOUtils.writeJSON(`${directory}/results.json`, h.report);
}
win.__zaibarAcceptanceEdges = { run };
