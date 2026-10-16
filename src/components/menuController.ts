import { disposeDropdownMenu } from './dropdownMenu';
import { isUsableNode } from '../utils/domLife';

export interface MenuController {
  open(): void;
  close(): void;
  toggle(): void;
  dispose(): void;
}

const activeMenus = new WeakMap<Document, Set<MenuController>>();
const bindings = new WeakMap<HTMLElement, MenuController>();

/** One lifecycle for hover and click menus, including reversible delayed dismissal. */
export function bindMenu(
  anchor: HTMLElement,
  build: () => HTMLElement | undefined,
  trigger: 'hover' | 'click',
  enabled = () => true
): MenuController {
  bindings.get(anchor)?.dispose();
  const doc = anchor.ownerDocument;
  const view = doc.defaultView;
  let menu: HTMLElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let removeTimer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const controllers = activeMenus.get(doc) ?? new Set<MenuController>();
  activeMenus.set(doc, controllers);
  function listen(target: EventTarget, name: string, handler: EventListener) {
    target.addEventListener(name, handler, true);
    cleanups.push(() => target.removeEventListener(name, handler, true));
  }
  function cancelClose() {
    clearTimeout(closeTimer);
    clearTimeout(removeTimer);
    closeTimer = removeTimer = undefined;
    if (menu) {
      menu.style.opacity = '1';
      menu.style.transform = 'scale(1)';
    }
  }
  function close() {
    clearTimeout(closeTimer);
    clearTimeout(removeTimer);
    closeTimer = removeTimer = undefined;
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
    if (menu) disposeDropdownMenu(menu);
    menu?.remove();
    menu = undefined;
    controllers.delete(controller);
    doc.removeEventListener('click', outside, true);
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('keydown', keydown, true);
  }
  function scheduleClose() {
    if (!menu || closeTimer !== undefined || removeTimer !== undefined) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      if (!menu) return;
      menu.style.opacity = '0';
      menu.style.transform = 'scale(0.95)';
      removeTimer = setTimeout(close, 150);
    }, 250);
  }
  function inRegion(event: Event) {
    const path = event.composedPath();
    return path.includes(anchor) || (!!menu && path.includes(menu));
  }
  function move(event: Event) {
    if (inRegion(event)) cancelClose();
    else scheduleClose();
  }
  function outside(event: Event) {
    if (!inRegion(event)) close();
  }
  function keydown(event: KeyboardEvent) {
    if (!menu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      anchor.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const path = event.composedPath();
    if (!inRegion(event)) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    const index = items.findIndex((item) => path.includes(item));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : index < 0
              ? items.length - 1
              : (index - 1 + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  }
  function open() {
    if (disposed || anchor.hasAttribute('disabled') || anchor.getAttribute('aria-disabled') === 'true' || !enabled()) return;
    cancelClose();
    if (menu?.isConnected) return;
    for (const other of Array.from(controllers)) other.close();
    menu = build();
    if (!menu) return;
    controllers.add(controller);
    menu.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
    menu.style.transformOrigin = 'bottom';
    menu.style.opacity = '0';
    menu.style.transform = 'scale(0.95)';
    menu.addEventListener('mouseenter', cancelClose);
    menu.addEventListener('mouseleave', scheduleClose);
    menu.addEventListener('zaibar-menu-close', close);
    menu.addEventListener('click', () => {
      if (!menu?.isConnected) close();
    });
    if (view)
      frame = view.requestAnimationFrame(() => {
        if (menu && removeTimer === undefined) {
          menu.style.opacity = '1';
          menu.style.transform = 'scale(1)';
        }
      });
    else cancelClose();
    doc.addEventListener('click', outside, true);
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('keydown', keydown, true);
  }
  const controller: MenuController = {
    open,
    close,
    toggle: () => (menu?.isConnected ? close() : open()),
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      cleanups.forEach((cleanup) => cleanup());
      bindings.delete(anchor);
    },
  };
  listen(anchor, 'mouseenter', () => {
    if (trigger === 'hover') open();
    else cancelClose();
  });
  listen(anchor, 'mouseleave', scheduleClose);
  if (trigger === 'click')
    listen(anchor, 'click', (event) => {
      event.stopPropagation();
      controller.toggle();
    });
  listen(view ?? doc, 'unload', (event) => {
    // Child reader/preview frame unloads also reach the parent window in capture.
    if (event.target === doc || event.target === view) controller.dispose();
  });
  bindings.set(anchor, controller);
  return controller;
}

export function disposeMenusWithin(root: HTMLElement): void {
  if (!isUsableNode(root)) return;
  for (const anchor of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) bindings.get(anchor)?.dispose();
}
