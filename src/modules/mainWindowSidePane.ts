/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * mainWindowSidePane.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

/**
 * Independent main-window side pane.
 *
 * Zotero has no official API for registering a standalone sidebar, so this
 * module injects a `splitter + vbox` pair directly into the main window's
 * outer hbox, appended after `#zotero-context-pane` (the last hbox child,
 * see zoteroPane.xhtml), so the pane sits at the window's right edge in
 * every tab — library and reader alike. The pane lives outside
 * `#tabs-deck`, so it is shared by all tabs.
 *
 * Layout:
 *   hbox
 *     ├─ #tabs-deck
 *     ├─ #zotero-context-splitter
 *     ├─ #zotero-context-pane
 *     ├─ #zaibar-sidepane-splitter   ← drag-resize + grippy collapse (native XUL)
 *     └─ #zaibar-sidepane (vbox)     ← header (hbox) + deck (one page per tab)
 *
 * Each deck page holds a `#ai-bar-chat-root` div whose shadow root contains
 * the message container + InputArea — the exact structure chatUI.ts and
 * selectionHint.ts already consume via `addon.data.sidePaneBodyMap`.
 *
 * A toggle button (`#zaibar-tb-sidepane-toggle`, plugin favicon) is added to
 * `#zotero-tabs-toolbar`; its `selected` attribute mirrors the expanded
 * state. Header icons use Zotero's context-fill SVGs + `fill: currentColor`
 * so they adapt to dark mode via `--fill-secondary`.
 *
 * Width/collapse state is persisted in plugin prefs (`sidepane.width`,
 * `sidepane.collapsed`) rather than Zotero's `zotero-persist`, because
 * `ZoteroPane.unserializePersist` runs before plugins inject their UI.
 */

import { config } from '../../package.json';
import { InputArea } from '../components/inputArea';
import { getString } from '../utils/locale';
import { getPref, setPref } from '../utils/prefs';

const SPLITTER_ID = 'zaibar-sidepane-splitter';
const PANE_ID = 'zaibar-sidepane';
const DECK_ID = 'zaibar-sidepane-deck';
const TOOLBAR_BTN_ID = 'zaibar-tb-sidepane-toggle';
const CHAT_ROOT_ID = 'ai-bar-chat-root';
const TAB_ID_ATTR = 'data-tab-id';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;

export function injectCSS(doc: Document | ShadowRoot, filename: string) {
  // 获取插件内资源的 URL
  const url = `chrome://${config.addonRef}/content/styles/${filename}`;

  // 防止重复注入
  if (doc.querySelector(`link[href="${url}"]`)) return;

  // 判断是否是 ShadowRoot（通过检查 host 属性而不是 instanceof）
  const isShadowRoot = 'host' in doc && !('head' in doc);
  const ownerDoc = isShadowRoot ? (doc as any).ownerDocument : (doc as Document);

  const link = ownerDoc.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = url;

  // 处理 ShadowRoot 和 Document 的区别
  if (isShadowRoot) {
    doc.appendChild(link);
  } else {
    (doc as Document).head.appendChild(link);
  }
}

function getElements() {
  return addon.data.sidePaneElements;
}

/**
 * Inject the side pane into a main window. Idempotent — safe to call once
 * per window from `onMainWindowLoad`.
 */
export function registerMainWindowSidePane(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  if (doc.getElementById(PANE_ID)) return;

  if (!addon.data.sidePaneBodyMap) {
    addon.data.sidePaneBodyMap = new Map<string, HTMLElement>();
  }

  // Mount at the right edge of the shared hbox (after #zotero-context-pane,
  // its last child), so the pane is rightmost in every tab — same position
  // it has on the library tab, where the context pane stays collapsed.
  const hbox = doc.getElementById('zotero-context-pane')?.parentElement ?? doc.getElementById('tabs-deck')?.parentElement;
  if (!hbox) {
    Zotero.debug('[zaibar] sidePane: outer hbox not found, skipping injection');
    return;
  }

  const createXUL = (tag: string) => (doc as any).createXULElement(tag) as XULElement;

  // Pane-scoped stylesheet (auto-removed with the pane on unregister):
  // - `fill/stroke: currentColor` feeds Zotero's context-fill icons so they
  //   follow --fill-secondary in dark mode (Zotero's global toolbarbutton
  //   rule supplies `-moz-context-properties` + `color`, but not `fill`).
  // - Icons are set via background-image (like Zotero's svgicon mixin) so
  //   they scale to the button box; the `image` attribute can't scale.
  const styleEl = doc.createElement('style');
  styleEl.textContent = `
#${PANE_ID} toolbarbutton,
#${TOOLBAR_BTN_ID} {
  fill: currentColor;
  stroke: currentColor;
}
#${PANE_ID} .zaibar-sidepane-logo {
  width: 16px;
  height: 16px;
  margin-inline-end: 6px;
  background: url("chrome://${config.addonRef}/content/icons/favicon.svg") no-repeat center / contain;
}
#${PANE_ID} .zaibar-sidepane-btn {
  width: 22px;
  height: 22px;
  padding: 3px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 16px;
}
#${PANE_ID} .zaibar-sidepane-btn-clear {
  background-image: url("chrome://zotero/skin/16/universal/empty-trash.svg");
}
#${PANE_ID} .zaibar-sidepane-btn-collapse {
  background-image: url("chrome://zotero/skin/20/universal/sidebar.svg");
}
#${TOOLBAR_BTN_ID} {
  background-image: url("chrome://${config.addonRef}/content/icons/favicon.svg");
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
`;

  // ── Splitter (native drag-resize + grippy collapse) ───────────────────
  const splitter = createXUL('splitter');
  splitter.id = SPLITTER_ID;
  splitter.setAttribute('collapse', 'after');
  splitter.setAttribute('resizebefore', 'closest');
  splitter.setAttribute('resizeafter', 'closest');
  splitter.setAttribute('orient', 'horizontal');
  splitter.appendChild(createXUL('grippy'));

  // ── Pane ──────────────────────────────────────────────────────────────
  const pane = createXUL('vbox');
  pane.id = PANE_ID;
  const savedWidth = getPref('sidepane.width');
  pane.setAttribute('width', String(savedWidth && savedWidth >= MIN_WIDTH ? savedWidth : DEFAULT_WIDTH));
  pane.style.minWidth = `${MIN_WIDTH}px`;

  // Header: icon + title + clear-history + collapse
  const header = createXUL('hbox');
  header.setAttribute('align', 'center');
  header.style.padding = '4px 6px';
  header.style.borderBottom = '1px solid var(--color-border, #d9dfe3)';
  header.style.userSelect = 'none';

  // Logo via background-image (scales cleanly; favicon is a fixed-color
  // brand icon so it needs no dark-mode adaptation).
  const icon = createXUL('box');
  icon.classList.add('zaibar-sidepane-logo');

  const title = createXUL('label');
  title.setAttribute('value', getString('sidepane-title'));
  title.setAttribute('flex', '1');
  title.setAttribute('crop', 'end');
  title.style.fontWeight = '600';

  const clearBtn = createXUL('toolbarbutton');
  clearBtn.classList.add('zaibar-sidepane-btn', 'zaibar-sidepane-btn-clear');
  clearBtn.setAttribute('tooltiptext', getString('sidepane-clear-tooltip'));
  clearBtn.style.marginInlineEnd = '2px';
  clearBtn.addEventListener('command', () => clearCurrentTabHistory());

  const collapseBtn = createXUL('toolbarbutton');
  collapseBtn.classList.add('zaibar-sidepane-btn', 'zaibar-sidepane-btn-collapse');
  collapseBtn.setAttribute('tooltiptext', getString('sidepane-collapse-tooltip'));
  collapseBtn.addEventListener('command', () => setSidePaneCollapsed(true));

  header.append(icon, title, clearBtn, collapseBtn);

  // Per-tab pages
  const deck = createXUL('deck');
  deck.id = DECK_ID;
  deck.setAttribute('flex', '1');

  pane.append(styleEl, header, deck);

  // #zotero-context-pane is the hbox's last child, so appending puts the
  // pane at the window's right edge.
  hbox.append(splitter, pane);

  addon.data.sidePaneElements = { splitter, pane, deck };

  // ── Toggle button in the tabs toolbar ─────────────────────────────────
  const tabsToolbar = doc.getElementById('zotero-tabs-toolbar');
  if (tabsToolbar && !doc.getElementById(TOOLBAR_BTN_ID)) {
    const toggleBtn = createXUL('toolbarbutton');
    toggleBtn.id = TOOLBAR_BTN_ID;
    toggleBtn.classList.add('zotero-tb-button');
    toggleBtn.setAttribute('tabindex', '-1');
    toggleBtn.setAttribute('tooltiptext', getString('sidepane-toggle-tooltip'));
    toggleBtn.addEventListener('command', () => {
      const els = getElements();
      if (!els) return;
      if (els.pane.getAttribute('collapsed') === 'true') {
        openSidePane();
      } else {
        setSidePaneCollapsed(true);
      }
    });
    tabsToolbar.insertBefore(toggleBtn, tabsToolbar.firstChild);
  }

  // Restore collapsed state
  if (getPref('sidepane.collapsed')) {
    pane.setAttribute('collapsed', 'true');
    splitter.setAttribute('state', 'collapsed');
    splitter.setAttribute('substate', 'after');
  }

  // Persist width/collapse and sync the toggle button after user
  // interactions with the splitter. Deferred so the native splitter
  // handlers settle first.
  const deferredSync = () => {
    doc.defaultView?.setTimeout(() => {
      saveSidePaneState();
      syncToggleButtonState();
    }, 0);
  };
  splitter.addEventListener('mouseup', deferredSync);
  splitter.addEventListener('command', deferredSync);

  selectSidePaneTab(addon.chatManager.currentTabID);
  syncToggleButtonState();
}

/**
 * Remove the injected side pane (plugin shutdown / window unload).
 */
export function unregisterMainWindowSidePane(): void {
  const els = getElements();
  if (!els) return;
  try {
    saveSidePaneState();
  } catch (e) {
    // Window may already be gone — nothing to persist.
  }
  els.pane.ownerDocument?.getElementById(TOOLBAR_BTN_ID)?.remove();
  els.splitter.remove();
  els.pane.remove();
  addon.data.sidePaneElements = undefined;
  addon.data.sidePaneBodyMap?.clear();
}

/**
 * Switch the deck to the page belonging to `tabID`, creating it on first use.
 * Called from the tab observer on every tab select.
 */
export function selectSidePaneTab(tabID?: string): void {
  const els = getElements();
  if (!els || !tabID) return;
  try {
    const page = ensureSidePanePage(tabID);
    (els.deck as any).selectedPanel = page;
  } catch (e) {
    ztoolkit.log('[zaibar] sidePane selectSidePaneTab error:', e);
  }
}

/**
 * Drop a tab's deck page (tab closed). The chat session itself is kept —
 * only the DOM is discarded.
 */
export function removeSidePaneTab(tabID?: string): void {
  const els = getElements();
  if (!els || !tabID) return;
  const deck = els.deck;
  let removedSelected = false;
  for (const child of Array.from(deck.children) as Element[]) {
    if (child.getAttribute(TAB_ID_ATTR) === tabID) {
      removedSelected = (deck as any).selectedPanel === child;
      child.remove();
      break;
    }
  }
  addon.data.sidePaneBodyMap?.delete(tabID);
  if (removedSelected && deck.children.length > 0) {
    (deck as any).selectedIndex = 0;
  }
}

export function setSidePaneCollapsed(collapsed: boolean): void {
  const els = getElements();
  if (!els) return;
  const { pane, splitter } = els;
  if (collapsed) {
    pane.setAttribute('collapsed', 'true');
    splitter.setAttribute('state', 'collapsed');
    splitter.setAttribute('substate', 'after');
  } else {
    pane.removeAttribute('collapsed');
    splitter.setAttribute('state', '');
  }
  const view = pane.ownerDocument?.defaultView;
  if (view) {
    view.dispatchEvent(new (view as any).Event('resize'));
  }
  saveSidePaneState();
  syncToggleButtonState();
}

/**
 * Reflect the pane's collapse state on the tabs-toolbar toggle button
 * (`selected` = expanded → pressed background via Zotero's toolbarbutton CSS).
 */
function syncToggleButtonState(): void {
  const els = getElements();
  if (!els) return;
  const btn = els.pane.ownerDocument?.getElementById(TOOLBAR_BTN_ID);
  if (!btn) return;
  if (els.pane.getAttribute('collapsed') === 'true') {
    btn.removeAttribute('selected');
  } else {
    btn.setAttribute('selected', 'true');
  }
}

/**
 * Reveal the pane and show the given tab's page. Called when a chat request
 * is dispatched in sidebar mode (mirrors `focusChatWindow` in window mode).
 */
export function openSidePane(tabID?: string): void {
  if (!getElements()) return;
  setSidePaneCollapsed(false);
  selectSidePaneTab(tabID ?? addon.chatManager.currentTabID);
}

function saveSidePaneState(): void {
  const els = getElements();
  if (!els) return;
  const collapsed = els.pane.getAttribute('collapsed') === 'true';
  setPref('sidepane.collapsed', collapsed);
  if (!collapsed) {
    const attrWidth = parseInt(els.pane.getAttribute('width') || '', 10);
    const width = Number.isFinite(attrWidth) ? attrWidth : Math.round(els.pane.getBoundingClientRect().width);
    if (width >= MIN_WIDTH) {
      setPref('sidepane.width', width);
    }
  }
}

function clearCurrentTabHistory(): void {
  const currentTab = addon.chatManager.currentTabID;
  if (!currentTab) return;
  const body = addon.data.sidePaneBodyMap?.get(currentTab);
  const root = body?.querySelector(`#${CHAT_ROOT_ID}`) as HTMLElement | null;
  const messageContainer = root?.shadowRoot?.querySelector('.message-container');
  if (messageContainer) {
    (messageContainer as HTMLElement).innerHTML = '';
  }
  addon.chatManager.clearSectionHistory(currentTab);
}

/**
 * Get (or lazily create) the deck page for a tab. The page element is what
 * gets stored in `sidePaneBodyMap` — consumers reach the chat UI via
 * `body.querySelector('#ai-bar-chat-root').shadowRoot`.
 */
function ensureSidePanePage(tabID: string): HTMLElement {
  const els = getElements()!;
  const deck = els.deck;
  for (const child of Array.from(deck.children) as Element[]) {
    if (child.getAttribute(TAB_ID_ATTR) === tabID) {
      return child as unknown as HTMLElement;
    }
  }

  const doc = deck.ownerDocument;
  // Page sizing mirrors Zotero's own deck-children pattern
  // (scss/elements/_contextPane.scss): absolute + 100% × 100% inside the
  // deck, so the page fills it without relying on XUL box layout to size
  // children. CSS flex on the page then gives the chat root a definite
  // height (XUL layout can't size HTML children).
  const page = (doc as any).createXULElement('vbox') as HTMLElement;
  page.setAttribute(TAB_ID_ATTR, tabID);
  page.style.position = 'absolute';
  page.style.width = '100%';
  page.style.height = '100%';
  page.style.display = 'flex';
  page.style.flexDirection = 'column';
  page.style.overflow = 'hidden';

  const root = doc.createElement('div');
  root.id = CHAT_ROOT_ID;
  root.setAttribute(
    'style',
    'flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; gap: 8px; padding-top: 8px; width: 100%; contain: inline-size;'
  );
  page.appendChild(root);

  const shadowRoot = root.attachShadow({ mode: 'open' });
  injectCSS(shadowRoot, 'katex.min.css');
  injectCSS(shadowRoot, 'atom-one.css');
  injectCSS(shadowRoot, `../app.css`);
  // Model selector button + dropdown styles live in zoteroAIBar.css (shared
  // with the reader popup). Inject so the reused ModelInfo component
  // renders correctly inside the sidebar's Shadow DOM.
  injectCSS(shadowRoot, `../zoteroAIBar.css`);

  const messageContainer = doc.createElement('div');
  messageContainer.classList.add('message-container', 'flex', 'flex-col', 'flex-1', 'overflow-y-auto', 'overflow-x-auto', 'min-w-0');
  messageContainer.style.userSelect = 'text';
  shadowRoot.appendChild(messageContainer);
  shadowRoot.appendChild(InputArea(doc, tabID));

  deck.appendChild(page);
  addon.data.sidePaneBodyMap!.set(tabID, page);
  return page;
}

export function scrollToBottom(container: HTMLElement) {
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

const BTN_ENABLED = ['bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600'] as const;
const BTN_DISABLED = ['bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600'] as const;

export function setSendBtnEnabled(btn: HTMLButtonElement, enabled: boolean) {
  if (enabled) {
    btn.disabled = false;
    btn.classList.remove(...BTN_DISABLED);
    btn.classList.add(...BTN_ENABLED);
  } else {
    btn.disabled = true;
    btn.classList.remove(...BTN_ENABLED);
    btn.classList.add(...BTN_DISABLED);
  }
}
