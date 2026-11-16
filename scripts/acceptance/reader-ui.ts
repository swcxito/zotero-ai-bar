// Manual UI-only checks against a real PDF. Selection is temporary; no annotations are saved.
const win = Zotero.getMainWindow() as any;
const plugin = (Zotero as any).ZAIBar as typeof addon;
declare const __acceptanceOutputDirectory__: string;
const directory = __acceptanceOutputDirectory__;
const wait = (ms: number) => Zotero.Promise.delay(ms);
function ensure(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
function mouse(node: Element, type: string) {
  node.dispatchEvent(
    new node.ownerDocument.defaultView!.MouseEvent(type, { composed: true, bubbles: type !== 'mouseenter' && type !== 'mouseleave' })
  );
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 6000;
  while (!predicate()) {
    ensure(Date.now() < end, 'Native reader state timed out');
    await wait(30);
  }
}
async function run() {
  const checks: any[] = [];
  const originalTab = win.Zotero_Tabs.selectedID;
  const autoKey = 'extensions.zotero.zaibar.translate.enableAuto';
  const oldAuto = Zotero.Prefs.get(autoKey, true);
  let reader: any, view: any;
  const check = async (name: string, callback: () => any) => {
    try {
      checks.push({ name, status: 'pass', detail: await callback() });
    } catch (error) {
      checks.push({ name, status: 'fail', error: String(error), stack: (error as Error).stack });
    }
  };
  try {
    ensure(![...plugin.chatManager.sessionsMap.values()].some((s) => s.pending.userMessage), 'A user request is running');
    reader = Zotero.Reader.getByTabID(originalTab);
    ensure(reader?.type === 'pdf', 'Open a PDF in the active Zotero tab before starting');
    Zotero.Prefs.set(autoKey, false, true);
    await reader._initPromise;
    await until(() => !!win.document.getElementById('zaibar-sidepane-shared-input')?.shadowRoot?.querySelector('.input-chat-mode-btn'));
    await check('实际文献模式菜单点击后可见且未被遮挡', async () => {
      const root = win.document.getElementById('zaibar-sidepane-shared-input').shadowRoot;
      const anchor = root.querySelector('.input-chat-mode-btn');
      ensure(anchor.getAttribute('aria-disabled') !== 'true', 'Article mode menu was disabled');
      mouse(anchor, 'click');
      await wait(200);
      const menu = root.querySelector('.chat-mode-dropdown');
      ensure(menu?.isConnected, 'Actual article mode menu did not open');
      const rect = menu.getBoundingClientRect();
      const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      ensure(hit && menu.contains(hit), 'Article mode menu was clipped or covered');
      const options = [...menu.querySelectorAll('button')].map((node: any) => node.textContent);
      mouse(menu, 'mouseleave');
      await wait(450);
      ensure(!menu.isConnected, 'Article mode menu did not close');
      return { attachmentId: reader.itemID, options, size: [rect.width, rect.height] };
    });
    await check('实际阅读器更多菜单 hover 与跨间隙恢复', async () => {
      view = Cu.waiveXrays(reader._internalReader._primaryView);
      await until(() => !!view._pdfPages[0]?.chars?.length);
      const chars = view._pdfPages[0].chars.slice(50, 88);
      const rect = [
        Math.min(...chars.map((c: any) => c.rect[0])),
        Math.min(...chars.map((c: any) => c.rect[1])),
        Math.max(...chars.map((c: any) => c.rect[2])),
        Math.max(...chars.map((c: any) => c.rect[3])),
      ];
      const ranges = [
        {
          collapsed: false,
          pageIndex: 0,
          text: chars.map((c: any) => c.u).join(''),
          sortIndex: '00000|000050|00000',
          position: { pageIndex: 0, rects: [rect] },
        },
      ];
      view._setSelectionRanges(Cu.cloneInto(ranges, reader._iframeWindow));
      const doc = reader._iframeWindow.document;
      await until(() => !!doc.querySelector('.expand-trigger-btn'));
      const anchor = doc.querySelector('.expand-trigger-btn');
      mouse(anchor.closest('.expand-container'), 'mouseenter');
      await wait(180);
      const menu = doc.querySelector('.expand-container .model-dropdown-menu');
      ensure(menu?.isConnected, 'Reader more menu did not open');
      const buttons = menu.querySelectorAll('button');
      ensure(buttons.length > 0, 'Reader more options are missing');
      mouse(anchor, 'mouseleave');
      await wait(100);
      ensure(menu.isConnected, 'Menu closed in its gap');
      mouse(menu, 'mouseenter');
      await wait(200);
      ensure(menu.style.opacity === '1', 'Menu did not remain open on entry');
      mouse(menu, 'mouseleave');
      await wait(450);
      ensure(!menu.isConnected, 'Reader menu did not close');
      return { attachmentId: reader.itemID, options: buttons.length, selectionSaved: false };
    });
  } finally {
    try {
      view?._setSelectionRanges([]);
    } catch {
      /* Closing a reader already removes its unsaved selection. */
    }
    if (oldAuto === undefined) Zotero.Prefs.clear(autoKey, true);
    else Zotero.Prefs.set(autoKey, oldAuto, true);
    if (win.Zotero_Tabs._tabs.some((tab: any) => tab.id === originalTab)) win.Zotero_Tabs.select(originalTab);
    await IOUtils.writeJSON(`${directory}/reader-ui.json`, { checks, finished: new Date().toISOString() });
  }
}
win.__zaibarReaderUI = { run };
