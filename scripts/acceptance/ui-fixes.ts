// Manual verification in the installed plugin; no model or library writes.
import { ActionButton } from '../../src/components/buttons/actionButton';
import { renderMarkdown } from '../../src/utils/markdown';
import { refreshAllModelInfoAnchors, registerModelInfoAnchor } from '../../src/components/modelInfo';

const win = Zotero.getMainWindow() as any;
const plugin = (Zotero as any).ZAIBar as typeof addon;
declare const __acceptanceOutputDirectory__: string;
const directory = __acceptanceOutputDirectory__;
const report: any = { started: new Date().toISOString(), checks: [], stage: 'ready' };
const wait = (ms: number) => Zotero.Promise.delay(ms);
function ensure(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
function mouse(node: Element, type: string) {
  node.dispatchEvent(
    new node.ownerDocument.defaultView!.MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'mouseleave', composed: true })
  );
}
async function check(name: string, run: () => any) {
  report.stage = name;
  try {
    report.checks.push({ name, status: 'pass', detail: await run() });
  } catch (error) {
    report.checks.push({ name, status: 'fail', error: String(error) });
  }
  await IOUtils.writeJSON(`${directory}/ui-fixes.json`, report);
}
async function run() {
  const doc = win.document as Document;
  await check('实际皮肤中的顶部图标可见', async () => {
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('.zaibar-sidepane-btn')];
    ensure(buttons.length === 3, `Expected three header buttons, got ${buttons.length}`);
    await wait(100);
    return buttons.map((button) => {
      const image = button.querySelector('img')!;
      ensure(image?.complete && image.naturalWidth > 0, `${button.title}: icon image failed to load`);
      const rect = image.getBoundingClientRect();
      ensure(rect.width > 0 && rect.height > 0, 'Header icon has no visible dimensions');
      return { title: button.title, size: [rect.width, rect.height], fill: win.getComputedStyle(image).fill };
    });
  });
  await check('实际聊天皮肤的复制波纹颜色', () => {
    const host = doc.getElementById('zaibar-sidepane-shared-input')!;
    const root = host.shadowRoot!;
    const wrapper = root.querySelector('.input-area-wrapper')!;
    const button = ztoolkit.UI.createElement(doc, 'button', ActionButton({ label: 'COPY' })) as HTMLButtonElement;
    wrapper.appendChild(button);
    try {
      mouse(button, 'click');
      const ripple = button.querySelector('.ripple')!;
      ensure(ripple, 'Action button did not create a ripple');
      const probe = doc.createElement('span');
      probe.style.background = 'var(--accent-soft)';
      button.appendChild(probe);
      const actual = win.getComputedStyle(ripple).backgroundColor;
      const expected = win.getComputedStyle(probe).backgroundColor;
      ensure(actual === expected, `Ripple ${actual} differs from theme ${expected}`);
      return { actual, expected };
    } finally {
      button.remove();
    }
  });
  await check('关闭子文档后实际思考菜单仍展开且可点击', async () => {
    const root = doc.getElementById('zaibar-sidepane-shared-input')!.shadowRoot!;
    const wrapper = root.querySelector('.input-area-wrapper')!;
    const child = doc.createElement('iframe');
    child.style.display = 'none';
    wrapper.appendChild(child);
    await wait(20);
    child.remove();
    await wait(20);
    const anchor = root.querySelector('.input-thinking-btn')!;
    mouse(anchor, 'click');
    await wait(180);
    const menu = root.querySelector('.thinking-effort-dropdown') as HTMLElement;
    ensure(menu?.isConnected, 'Actual installed menu did not open on click after child unload');
    const rect = menu.getBoundingClientRect();
    ensure(rect.width > 0 && rect.height > 0, 'Menu has no visible size');
    const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ensure(hit && menu.contains(hit), `Menu is clipped or covered: ${hit?.className}`);
    mouse(anchor, 'mouseleave');
    await wait(280);
    ensure(menu.style.opacity === '0', 'Menu did not start fading');
    mouse(menu, 'mouseenter');
    await wait(180);
    ensure(menu.isConnected && menu.style.opacity === '1', 'Menu did not recover during fade');
    mouse(menu, 'mouseleave');
    await wait(430);
    ensure(!menu.isConnected, 'Menu did not close');
    return { size: [rect.width, rect.height], hit: hit?.tagName, unloadSurvived: true };
  });
  await check('真实条目与父条目行内引用省略名称', async () => {
    const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    const attachment = reader && Zotero.Items.get(reader.itemID);
    ensure(attachment?.isPDFAttachment() && attachment.parentID, 'Open a PDF attached to a parent item before starting');
    const attachmentId = attachment.id;
    const parentId = attachment.parentID;
    const container = doc.createElement('div');
    container.innerHTML = await renderMarkdown(`正文 [cite:${attachmentId}:2] [cite:${parentId}:3] [cite:${parentId}]`, attachmentId);
    const labels = [...container.querySelectorAll('.zaibar-cite')].map((node) => node.textContent);
    ensure(labels[0] === 'p.2' && labels[1] === 'p.3' && labels[2] === '本文', `Unexpected current-document labels: ${JSON.stringify(labels)}`);
    return { attachmentId, parentId, labels };
  });
  await check('关闭 Gecko 上下文不会破坏模型刷新', () => {
    const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { freshCompartment: true });
    const dead = Cu.evalInSandbox('({nodeType: 1, isConnected: true})', sandbox) as HTMLElement;
    Cu.nukeSandbox(sandbox);
    registerModelInfoAnchor(dead);
    refreshAllModelInfoAnchors();
    ensure(!plugin.data.modelInfoAnchors.has(dead), 'Dead model anchor was retained');
    plugin.data.refreshModelInfoAnchors?.();
    return { anchors: plugin.data.modelInfoAnchors.size, deadPurged: true };
  });
  report.stage = 'complete';
  report.finished = new Date().toISOString();
  await IOUtils.writeJSON(`${directory}/ui-fixes.json`, report);
}
win.__zaibarUiFixes = { run, report };
