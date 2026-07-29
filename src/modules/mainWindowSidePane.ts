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
import { InputArea, type InputAreaAPI } from '../components/inputArea';
import { getString } from '../utils/locale';
import { getPref, setPref } from '../utils/prefs';
import { Icons } from '../components/common';
import { getReaderSourceLabel } from './readerBarPopup';
import {
  GLOBAL_AGENT_SESSION_ID,
  getSessionId,
  getWorkspaceSnapshot,
  hideTranslationWorkspace,
  isReaderZoteroTab,
  removeWorkspaceSource,
  selectWorkspaceKind,
  subscribeChatWorkspace,
  updateSelectedZoteroTab,
  type ChatSessionKind,
} from './chatWorkspace';

const SPLITTER_ID = 'zaibar-sidepane-splitter';
const PANE_ID = 'zaibar-sidepane';
const DECK_ID = 'zaibar-sidepane-deck';
const TOOLBAR_BTN_ID = 'zaibar-tb-sidepane-toggle';
const TOOLBAR_STYLE_ID = 'zaibar-tb-sidepane-toggle-style';
const CHAT_ROOT_ID = 'ai-bar-chat-root';
const SHARED_INPUT_HOST_ID = 'zaibar-sidepane-shared-input';
const SESSION_ID_ATTR = 'data-session-id';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;

let unsubscribeWorkspace: (() => void) | undefined;
let readerReadyTimer: number | undefined;
let pendingReaderTabId: string | undefined;

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

/** Register the main toolbar entry for both host modes. */
export function registerChatToolbarButton(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  if (!doc.getElementById(TOOLBAR_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = TOOLBAR_STYLE_ID;
    style.textContent = `
#${TOOLBAR_BTN_ID} {
  background-image: url("chrome://${config.addonRef}/content/icons/favicon.svg");
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}`;
    doc.documentElement?.appendChild(style);
  }

  const tabsToolbar = doc.getElementById('zotero-tabs-toolbar');
  if (!tabsToolbar || doc.getElementById(TOOLBAR_BTN_ID)) return;
  const toggleBtn = (doc as any).createXULElement('toolbarbutton') as XULElement;
  toggleBtn.id = TOOLBAR_BTN_ID;
  toggleBtn.classList.add('zotero-tb-button');
  toggleBtn.setAttribute('tabindex', '-1');
  const windowMode = addon.chatManager.getCurrentHostMode() === 'window';
  toggleBtn.setAttribute('tooltiptext', windowMode ? getString('chat-window-open-tooltip' as any) : getString('sidepane-toggle-tooltip'));
  toggleBtn.addEventListener('command', async () => {
    if (addon.chatManager.getCurrentHostMode() === 'window') {
      try {
        const { ensureChatWindowReady, focusChatWindow } = await import('../utils/window');
        await ensureChatWindowReady();
        focusChatWindow();
      } catch (e) {
        ztoolkit.log('[zaibar] failed to open standalone chat window:', e);
      }
      return;
    }
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
#${PANE_ID} .zaibar-workspace-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
#${PANE_ID} .zaibar-workspace-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 150px;
  height: 28px;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fill-secondary, currentColor);
  cursor: pointer;
}
#${PANE_ID} .zaibar-workspace-tab[data-active="true"] {
  color: var(--fill-primary, currentColor);
  background: var(--material-button, rgba(127, 127, 127, .16));
}
#${PANE_ID} .zaibar-workspace-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${PANE_ID} .zaibar-workspace-tab-close {
  border: 0;
  padding: 0 2px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
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
  pane.style.paddingLeft = '6px';
  pane.style.boxSizing = 'border-box';

  // Header: workspace tabs + clear-history + collapse
  const header = createXUL('hbox');
  header.setAttribute('align', 'center');
  header.style.padding = '4px 6px 4px 0';
  header.style.borderBottom = '1px solid var(--color-border, #d9dfe3)';
  header.style.userSelect = 'none';

  const tabs = doc.createElement('div');
  tabs.classList.add('zaibar-workspace-tabs');

  const clearBtn = createXUL('toolbarbutton');
  clearBtn.classList.add('zaibar-sidepane-btn', 'zaibar-sidepane-btn-clear');
  clearBtn.setAttribute('tooltiptext', getString('sidepane-clear-tooltip'));
  clearBtn.style.marginInlineEnd = '2px';
  clearBtn.addEventListener('command', () => clearCurrentTabHistory());

  const collapseBtn = createXUL('toolbarbutton');
  collapseBtn.classList.add('zaibar-sidepane-btn', 'zaibar-sidepane-btn-collapse');
  collapseBtn.setAttribute('tooltiptext', getString('sidepane-collapse-tooltip'));
  collapseBtn.addEventListener('command', () => setSidePaneCollapsed(true));

  header.append(tabs, clearBtn, collapseBtn);

  // Per-tab pages
  const deck = createXUL('deck');
  deck.id = DECK_ID;
  deck.setAttribute('flex', '1');

  const inputHost = doc.createElement('div');
  inputHost.id = SHARED_INPUT_HOST_ID;
  inputHost.style.cssText = 'display:block; flex:0 0 auto; min-width:0; overflow:visible;';
  const inputShadow = inputHost.attachShadow({ mode: 'open' });
  injectCSS(inputShadow, 'katex.min.css');
  injectCSS(inputShadow, 'atom-one.css');
  injectCSS(inputShadow, `../app.css`);
  injectCSS(inputShadow, `../zoteroAIBar.css`);
  const sharedInput = InputArea(doc, GLOBAL_AGENT_SESSION_ID, {
    sessionKind: 'global-agent',
    chatModeAdjustable: false,
    allowScreenshot: true,
    allowSelectionHint: false,
    draftId: 'shared-input:sidebar',
    resolveMessageContainer: getSessionMessageContainer,
  });
  inputShadow.appendChild(sharedInput);
  addon.data.sharedInputAreas.add(sharedInput);

  pane.append(styleEl, header, deck, inputHost);

  // #zotero-context-pane is the hbox's last child, so appending puts the
  // pane at the window's right edge.
  hbox.append(splitter, pane);

  addon.data.sidePaneElements = { splitter, pane, deck, tabs };

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

  unsubscribeWorkspace?.();
  unsubscribeWorkspace = subscribeChatWorkspace(refreshSidePaneWorkspace);
  selectSidePaneTab(addon.chatManager.currentTabID);
  syncToggleButtonState();
}

/**
 * Remove the injected side pane (plugin shutdown / window unload).
 */
export function unregisterMainWindowSidePane(win?: Window): void {
  const els = getElements();
  const doc = win?.document ?? els?.pane.ownerDocument ?? Zotero.getMainWindow()?.document;
  doc?.getElementById(TOOLBAR_BTN_ID)?.remove();
  doc?.getElementById(TOOLBAR_STYLE_ID)?.remove();
  if (!els) return;
  cancelReaderReadyCheck();
  try {
    saveSidePaneState();
  } catch (e) {
    // Window may already be gone — nothing to persist.
  }
  const sharedInput = els.pane.querySelector(`#${SHARED_INPUT_HOST_ID}`)?.shadowRoot?.querySelector('.input-area-wrapper') as HTMLElement | null;
  if (sharedInput) addon.data.sharedInputAreas.delete(sharedInput);
  els.splitter.remove();
  els.pane.remove();
  addon.data.sidePaneElements = undefined;
  addon.data.sidePaneBodyMap?.clear();
  unsubscribeWorkspace?.();
  unsubscribeWorkspace = undefined;
}

/**
 * Switch the deck to the page belonging to `tabID`, creating it on first use.
 * Called from the tab observer on every tab select.
 */
export function selectSidePaneTab(tabID?: string, isReader?: boolean): void {
  if (!tabID) return;
  try {
    cancelReaderReadyCheck();
    const readerTab = isReader ?? isReaderZoteroTab(tabID);
    updateSelectedZoteroTab(tabID, readerTab);
    if (!getElements()) return;
    if (!readerTab && tabID !== 'zotero-pane') waitForSelectedReader(tabID);
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
  if (!tabID) return;
  if (pendingReaderTabId === tabID) cancelReaderReadyCheck();
  const sessionIds = [`article:${tabID}`, `translation:${tabID}`];
  if (els) {
    const deck = els.deck;
    for (const child of Array.from(deck.children) as Element[]) {
      if (sessionIds.includes(child.getAttribute(SESSION_ID_ATTR) || '')) {
        child.remove();
      }
    }
    for (const sessionId of sessionIds) addon.data.sidePaneBodyMap?.delete(sessionId);
  }
  removeWorkspaceSource(tabID);
}

function cancelReaderReadyCheck(): void {
  if (readerReadyTimer !== undefined) {
    const view = getElements()?.pane.ownerDocument?.defaultView ?? Zotero.getMainWindow();
    view?.clearTimeout(readerReadyTimer);
  }
  readerReadyTimer = undefined;
  pendingReaderTabId = undefined;
}

/** Refresh the workspace as soon as a newly opened reader is registered. */
function waitForSelectedReader(tabID: string): void {
  const els = getElements();
  const view = els?.pane.ownerDocument?.defaultView;
  if (!els || !view) return;
  pendingReaderTabId = tabID;
  let attempts = 0;
  const check = () => {
    readerReadyTimer = undefined;
    if (pendingReaderTabId !== tabID || addon.chatManager.currentTabID !== tabID) return;
    if (Zotero.Reader.getByTabID(tabID) || Zotero.Reader._readers?.some((reader) => reader.tabID === tabID)) {
      pendingReaderTabId = undefined;
      updateSelectedZoteroTab(tabID, true);
      return;
    }
    attempts += 1;
    if (attempts >= 300) {
      pendingReaderTabId = undefined;
      return;
    }
    readerReadyTimer = view.setTimeout(check, 200);
  };
  readerReadyTimer = view.setTimeout(check, 100);
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
export function openSidePane(): void {
  if (!getElements()) return;
  setSidePaneCollapsed(false);
  refreshSidePaneWorkspace();
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
  const snapshot = getWorkspaceSnapshot('sidebar');
  const sessionId = getSessionId(snapshot.activeKind, snapshot.sourceTabId);
  if (!sessionId) return;
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  const root = body?.querySelector(`#${CHAT_ROOT_ID}`) as HTMLElement | null;
  const messageContainer = root?.shadowRoot?.querySelector('.message-container') ?? body?.querySelector('.message-container');
  if (messageContainer) {
    (messageContainer as HTMLElement).innerHTML = '';
  }
  addon.chatManager.clearSectionHistory(sessionId);
}

function refreshSidePaneWorkspace(): void {
  const els = getElements();
  if (!els) return;
  const snapshot = getWorkspaceSnapshot('sidebar');
  const sourceTabId = snapshot.sourceTabId;
  const articleLabel = getString('workspace-article');

  const kinds: ChatSessionKind[] = sourceTabId ? ['article'] : [];
  if (sourceTabId && snapshot.translationVisible) kinds.push('translation');
  kinds.push('global-agent');

  els.tabs.innerHTML = '';
  for (const kind of kinds) {
    const tab = createWorkspaceTab(els.tabs.ownerDocument, kind, kind === 'article' ? articleLabel : undefined, snapshot.activeKind === kind);
    tab.addEventListener('click', () => selectWorkspaceKind(kind, sourceTabId));
    els.tabs.appendChild(tab);
  }

  const sessionId = getSessionId(snapshot.activeKind, sourceTabId) ?? GLOBAL_AGENT_SESSION_ID;
  const page = ensureSidePanePage(sessionId);
  selectSidePanePage(els.deck, page);
  const sharedInput = els.pane.querySelector(`#${SHARED_INPUT_HOST_ID}`)?.shadowRoot?.querySelector('.input-area-wrapper') as
    | (HTMLElement & { _inputAreaAPI?: InputAreaAPI })
    | null;
  const requestSourceTabId = snapshot.activeKind === 'global-agent' ? undefined : sourceTabId;
  const reader = sourceTabId ? Zotero.Reader.getByTabID(sourceTabId) : undefined;
  sharedInput?._inputAreaAPI?.setContext({
    sessionId,
    sessionKind: snapshot.activeKind,
    sourceTabId: requestSourceTabId,
    captureSourceTabId: sourceTabId,
    sourceLabel: requestSourceTabId && reader ? getReaderSourceLabel(reader) : undefined,
    chatModeAdjustable: snapshot.activeKind === 'article',
    allowScreenshot: true,
    allowSelectionHint: snapshot.activeKind !== 'global-agent',
  });
}

function selectSidePanePage(deck: XULElement, page: HTMLElement): void {
  const current = (deck as any).selectedPanel as HTMLElement | undefined;
  if (current === page) {
    page.style.visibility = 'visible';
    page.style.pointerEvents = '';
    if (page.dataset.enterPending === 'true') return;
    page.style.opacity = '1';
    page.style.transform = 'translateX(0)';
    return;
  }

  const currentSessionId = current?.getAttribute(SESSION_ID_ATTR) ?? '';
  const nextSessionId = page.getAttribute(SESSION_ID_ATTR) ?? '';
  const currentSourceId = currentSessionId.includes(':') ? currentSessionId.slice(currentSessionId.indexOf(':') + 1) : undefined;
  const nextSourceId = nextSessionId.includes(':') ? nextSessionId.slice(nextSessionId.indexOf(':') + 1) : undefined;
  const isArticleSwitch = !!currentSourceId && !!nextSourceId && currentSourceId !== nextSourceId;

  // XUL deck selection can settle one layout tick after selectedPanel is
  // assigned. Hide the previous message page synchronously so its text can
  // never overlap the incoming page during that tick.
  if (current) {
    current.style.transition = 'none';
    current.style.opacity = '0';
    current.style.visibility = 'hidden';
    current.style.pointerEvents = 'none';
  }

  const view = deck.ownerDocument?.defaultView;
  const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
  page.style.visibility = 'visible';
  page.style.pointerEvents = '';
  page.style.transition = 'none';
  page.style.opacity = reducedMotion ? '1' : '0';
  page.style.transform = reducedMotion ? 'none' : `translateX(${isArticleSwitch ? 10 : 4}px)`;
  (deck as any).selectedPanel = page;

  if (reducedMotion) return;
  if (!view) {
    page.style.opacity = '1';
    page.style.transform = 'translateX(0)';
    return;
  }
  page.dataset.enterPending = 'true';
  // XUL deck selection becomes paintable on the following frame. Starting
  // the transition there prevents it from completing while the target page
  // is still hidden by the deck.
  view.requestAnimationFrame(() => {
    if ((deck as any).selectedPanel !== page) {
      page.dataset.enterPending = 'false';
      return;
    }
    page.dataset.enterPending = 'false';
    const opacityDuration = isArticleSwitch ? 180 : 110;
    const transformDuration = isArticleSwitch ? 210 : 140;
    page.style.transition = `opacity ${opacityDuration}ms ease-out, transform ${transformDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    page.style.opacity = '1';
    page.style.transform = 'translateX(0)';
  });
}

function createWorkspaceTab(doc: Document, kind: ChatSessionKind, articleLabel: string | undefined, active: boolean): HTMLButtonElement {
  const tab = doc.createElement('button');
  tab.type = 'button';
  tab.classList.add('zaibar-workspace-tab');
  tab.dataset.active = String(active);
  tab.title = kind === 'article' ? articleLabel || getString('workspace-article') : getString(`workspace-${kind}` as any);

  const icon = doc.createElement('span');
  icon.style.display = 'inline-flex';
  icon.style.flex = '0 0 auto';
  if (kind === 'article') {
    const image = doc.createElement('img');
    image.src = `chrome://${config.addonRef}/content/icons/favicon.svg`;
    image.width = 16;
    image.height = 16;
    icon.appendChild(image);
  } else {
    icon.innerHTML = kind === 'translation' ? Icons.Translate : Icons.Agent;
  }

  const label = doc.createElement('span');
  label.classList.add('zaibar-workspace-tab-label');
  label.textContent = kind === 'article' ? articleLabel || getString('workspace-article') : getString(`workspace-${kind}` as any);
  tab.append(icon, label);

  if (kind === 'translation') {
    const close = doc.createElement('span');
    close.classList.add('zaibar-workspace-tab-close');
    close.textContent = '×';
    close.title = getString('workspace-close-translation');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      const sourceTabId = getWorkspaceSnapshot('sidebar').sourceTabId;
      if (sourceTabId) hideTranslationWorkspace(sourceTabId);
    });
    tab.appendChild(close);
  }
  return tab;
}

/**
 * Get (or lazily create) the deck page for a tab. The page element is what
 * gets stored in `sidePaneBodyMap` — consumers reach the chat UI via
 * `body.querySelector('#ai-bar-chat-root').shadowRoot`.
 */
function ensureSidePanePage(sessionId: string): HTMLElement {
  const els = getElements()!;
  const deck = els.deck;
  for (const child of Array.from(deck.children) as Element[]) {
    if (child.getAttribute(SESSION_ID_ATTR) === sessionId) {
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
  page.setAttribute(SESSION_ID_ATTR, sessionId);
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

  deck.appendChild(page);
  addon.data.sidePaneBodyMap!.set(sessionId, page);
  return page;
}

function getSessionMessageContainer(sessionId: string): HTMLElement | null {
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  const root = body?.querySelector(`#${CHAT_ROOT_ID}`) as HTMLElement | null;
  return (root?.shadowRoot?.querySelector('.message-container') ?? body?.querySelector('.message-container') ?? null) as HTMLElement | null;
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
