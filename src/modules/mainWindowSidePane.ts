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
import { ChatHistoryPanel } from '../components/chatHistoryPanel';
import { getString } from '../utils/locale';
import { getPref, setPref } from '../utils/prefs';
import { Icons } from '../components/common';
import { getReaderSourceLabel } from './readerBarPopup';
import { renderPersistedTranscript } from './chatUI';
import type { Session } from './chatManager';
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
const HISTORY_HOST_ID = 'zaibar-sidepane-history';
const HISTORY_BUTTON_ID = 'zaibar-sidepane-history-button';
const NEW_CHAT_BUTTON_ID = 'zaibar-sidepane-new-chat-button';
const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 240;
const MIN_MAIN_CONTENT_WIDTH = 320;
const PANE_ANIMATION_DURATION = 180;

let unsubscribeWorkspace: (() => void) | undefined;
let readerReadyTimer: number | undefined;
let pendingReaderTabId: string | undefined;
let sidePaneHistoryVisible = false;
let sidePaneUserWidth = DEFAULT_WIDTH;
let sidePaneRenderedWidth = DEFAULT_WIDTH;
let sidePaneHistoryTransition = 0;
let sidePaneHistoryAnimating = false;
let sidePaneCollapseAnimating = false;
let sidePaneCollapsed = false;
let sidePaneResizeCleanup: (() => void) | undefined;
let sidePaneBoundsCleanup: (() => void) | undefined;

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

function isSidePaneCollapsed(): boolean {
  const els = getElements();
  if (!els || sidePaneCollapseAnimating) return sidePaneCollapsed;
  return els.pane.getAttribute('collapsed') === 'true' || els.splitter.getAttribute('state') === 'collapsed';
}

function setSidePaneButtonIcon(button: HTMLButtonElement, url: string): void {
  button.replaceChildren();
  button.style.backgroundImage = `url("${url}")`;
}

function lockSidePaneWidth(pane: XULElement, width: number): void {
  const pixelWidth = `${Math.max(MIN_WIDTH, Math.round(width))}px`;
  pane.setAttribute('width', String(Math.max(MIN_WIDTH, Math.round(width))));
  pane.style.setProperty('width', pixelWidth, 'important');
  pane.style.setProperty('min-width', pixelWidth, 'important');
  pane.style.setProperty('max-width', pixelWidth, 'important');
  pane.style.setProperty('flex', '0 0 auto', 'important');
}

function unlockSidePaneWidth(pane: XULElement): void {
  pane.style.removeProperty('width');
  pane.style.removeProperty('min-width');
  pane.style.removeProperty('max-width');
  pane.style.removeProperty('flex');
  pane.setAttribute('width', String(sidePaneRenderedWidth));
  pane.style.minWidth = `${MIN_WIDTH}px`;
  pane.style.maxWidth = 'none';
  pane.style.flex = '0 0 auto';
}

function constrainSidePaneWidth(host: HTMLElement, pane: XULElement, requestedWidth: number): number {
  const view = host.ownerDocument.defaultView;
  const hostRect = host.getBoundingClientRect();
  const mainDeck = host.ownerDocument.getElementById('tabs-deck');
  let reservedWidth = MIN_MAIN_CONTENT_WIDTH;

  for (const child of Array.from(host.children)) {
    if (child === pane || child === mainDeck || child.getAttribute('collapsed') === 'true' || child.hasAttribute('hidden')) continue;
    reservedWidth += child.getBoundingClientRect().width;
  }

  const visibleRight = Math.min(hostRect.right, view?.innerWidth ?? hostRect.right);
  const visibleHostWidth = Math.max(0, visibleRight - Math.max(0, hostRect.left));
  const maximumWidth = Math.max(MIN_WIDTH, Math.floor(visibleHostWidth - reservedWidth));
  let width = Math.min(maximumWidth, Math.max(MIN_WIDTH, Math.round(requestedWidth)));
  lockSidePaneWidth(pane, width);

  // XUL can enforce additional minimum sizes that aren't reflected in CSS.
  // Correct against the actual rendered edge so the pane never extends past
  // the visible Zotero window even when those native constraints take effect.
  const overflow = Math.ceil(pane.getBoundingClientRect().right - visibleRight);
  if (overflow > 0) {
    width = Math.max(MIN_WIDTH, width - overflow);
    lockSidePaneWidth(pane, width);
  }
  return width;
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
    if (isSidePaneCollapsed()) {
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
#${PANE_ID} .zaibar-sidepane-btn,
#${TOOLBAR_BTN_ID} {
  -moz-context-properties: fill, stroke;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 3px;
  border: 0;
  border-radius: 5px;
  box-sizing: border-box;
  background-color: transparent;
  color: var(--fill-secondary, currentColor);
  cursor: pointer;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 16px;
}
#${PANE_ID} button.zaibar-sidepane-btn:hover {
  background-color: var(--material-button-hover, rgba(127, 127, 127, .14));
}
#${PANE_ID} button.zaibar-sidepane-btn:disabled {
  cursor: default;
  opacity: .45;
}
#${SPLITTER_ID} {
  width: 5px;
  min-width: 5px;
  max-width: 5px;
  flex: 0 0 5px;
  cursor: col-resize;
  background: transparent;
  transition: background-color 120ms ease;
}
#${SPLITTER_ID}:hover,
#${SPLITTER_ID}[data-dragging="true"] {
  background: var(--color-accent-blue, rgba(60, 130, 220, .55));
}
#${PANE_ID} .zaibar-sidepane-btn-clear {
  background-image: url("chrome://zotero/skin/16/universal/empty-trash.svg");
}
#${PANE_ID} .zaibar-sidepane-btn svg {
  width: 16px;
  height: 16px;
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

  // ── Plugin-owned resize handle ───────────────────────────────────────
  // Use a plugin-owned resize handle instead of a native XUL splitter. The
  // latter also resizes Zotero's adjacent context pane and its grippy can
  // collapse the wrong sidebar.
  const splitter = createXUL('box');
  splitter.id = SPLITTER_ID;
  splitter.setAttribute('orient', 'horizontal');

  // ── Pane ──────────────────────────────────────────────────────────────
  const pane = createXUL('vbox');
  pane.id = PANE_ID;
  const savedWidth = getPref('sidepane.width');
  sidePaneUserWidth = savedWidth && savedWidth >= MIN_WIDTH ? savedWidth : DEFAULT_WIDTH;
  sidePaneRenderedWidth = sidePaneUserWidth;
  lockSidePaneWidth(pane, sidePaneRenderedWidth);
  pane.style.paddingLeft = '6px';
  pane.style.boxSizing = 'border-box';
  pane.style.overflow = 'hidden';

  // Header: workspace tabs + history/new-chat + collapse
  const header = createXUL('hbox');
  header.setAttribute('align', 'center');
  header.style.padding = '4px 6px 4px 0';
  header.style.borderBottom = '1px solid var(--color-border, #d9dfe3)';
  header.style.userSelect = 'none';

  const tabs = doc.createElement('div');
  tabs.classList.add('zaibar-workspace-tabs');

  const historyBtn = doc.createElement('button');
  historyBtn.type = 'button';
  historyBtn.id = HISTORY_BUTTON_ID;
  historyBtn.classList.add('zaibar-sidepane-btn');
  historyBtn.title = getString('history-title' as any);
  historyBtn.setAttribute('aria-label', historyBtn.title);
  setSidePaneButtonIcon(historyBtn, `chrome://${config.addonRef}/content/icons/chat-history.svg`);
  historyBtn.addEventListener('click', () => toggleSidePaneHistory());

  const newChatBtn = doc.createElement('button');
  newChatBtn.type = 'button';
  newChatBtn.id = NEW_CHAT_BUTTON_ID;
  newChatBtn.classList.add('zaibar-sidepane-btn');
  newChatBtn.title = getString('history-new-chat' as any);
  newChatBtn.setAttribute('aria-label', newChatBtn.title);
  newChatBtn.style.marginInlineEnd = '2px';
  setSidePaneButtonIcon(newChatBtn, `chrome://${config.addonRef}/content/icons/chat-new.svg`);
  newChatBtn.addEventListener('click', () => startNewSidePaneConversation());

  header.append(tabs, historyBtn, newChatBtn);

  // Per-tab pages
  const deck = createXUL('deck');
  deck.id = DECK_ID;
  deck.setAttribute('flex', '1');
  deck.style.minWidth = '0';
  deck.style.width = '100%';
  deck.style.maxWidth = '100%';
  deck.style.boxSizing = 'border-box';

  const historyHost = doc.createElement('div');
  historyHost.id = HISTORY_HOST_ID;
  historyHost.style.cssText = 'display:none;flex:1 1 auto;min-width:0;width:100%;max-width:100%;min-height:0;box-sizing:border-box;overflow:hidden;';

  const inputHost = doc.createElement('div');
  inputHost.id = SHARED_INPUT_HOST_ID;
  inputHost.style.cssText = 'display:block;flex:0 0 auto;min-width:0;width:100%;max-width:100%;box-sizing:border-box;overflow:visible;';
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

  pane.append(styleEl, header, deck, historyHost, inputHost);

  // #zotero-context-pane is the hbox's last child, so appending puts the
  // pane at the window's right edge.
  hbox.append(splitter, pane);

  addon.data.sidePaneElements = { splitter, pane, deck, tabs };

  // Restore the state from the previous Zotero session before syncing the
  // toolbar button, so startup follows the state in which the pane was closed.
  sidePaneCollapsed = getPref('sidepane.collapsed') === true;
  if (sidePaneCollapsed) {
    pane.setAttribute('collapsed', 'true');
    splitter.setAttribute('state', 'collapsed');
    splitter.setAttribute('substate', 'after');
  }

  const hostView = doc.defaultView;
  let lastViewportWidth = hostView?.innerWidth;
  const keepSidePaneWithinWindow = () => {
    const viewportWidth = hostView?.innerWidth;
    // Zotero dispatches resize-like layout work while readers are loading.
    // Ignore it unless the actual window width changed, otherwise temporary
    // native-pane sizes would alter the user's AI-Bar width.
    if (viewportWidth === undefined || viewportWidth === lastViewportWidth) return;
    lastViewportWidth = viewportWidth;
    sidePaneRenderedWidth = constrainSidePaneWidth(hbox, pane, sidePaneUserWidth);
  };
  hostView?.addEventListener('resize', keepSidePaneWithinWindow);
  sidePaneBoundsCleanup?.();
  sidePaneBoundsCleanup = () => {
    hostView?.removeEventListener('resize', keepSidePaneWithinWindow);
    sidePaneBoundsCleanup = undefined;
  };
  // Startup must restore the exact width saved at shutdown. Zotero's context
  // pane is still settling here, so constraining against its temporary size
  // would make the AI-Bar start narrower than the user's saved width.
  applySidePaneUserWidth();
  hostView?.requestAnimationFrame(() => applySidePaneUserWidth());

  splitter.addEventListener(
    'mousedown',
    (event: MouseEvent) => {
      if (event.button !== 0 || sidePaneCollapseAnimating) return;
      const view = doc.defaultView;
      if (!view) return;

      event.preventDefault();
      event.stopPropagation();
      sidePaneResizeCleanup?.();

      const startedCollapsed = isSidePaneCollapsed();
      const startX = event.clientX;
      const startWidth = startedCollapsed ? sidePaneRenderedWidth : pane.getBoundingClientRect().width;
      let openedFromDrag = !startedCollapsed;
      const previousCursor = doc.documentElement.style.cursor;
      const previousUserSelect = doc.documentElement.style.userSelect;
      splitter.setAttribute('data-dragging', 'true');
      doc.documentElement.style.cursor = 'col-resize';
      doc.documentElement.style.userSelect = 'none';

      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        if (!openedFromDrag) {
          if (startX - moveEvent.clientX < 4) return;
          openedFromDrag = true;
          sidePaneCollapsed = false;
          setPref('sidepane.collapsed', false);
          pane.removeAttribute('collapsed');
          splitter.setAttribute('state', '');
          splitter.removeAttribute('substate');
          syncToggleButtonState();
        }
        const requestedWidth = Math.round(startWidth + startX - moveEvent.clientX);
        sidePaneRenderedWidth = constrainSidePaneWidth(hbox, pane, requestedWidth);
        sidePaneUserWidth = sidePaneRenderedWidth;
      };

      const finishResize = () => {
        view.removeEventListener('mousemove', handleMouseMove, true);
        view.removeEventListener('mouseup', finishResize, true);
        view.removeEventListener('blur', finishResize);
        splitter.removeAttribute('data-dragging');
        doc.documentElement.style.cursor = previousCursor;
        doc.documentElement.style.userSelect = previousUserSelect;
        sidePaneResizeCleanup = undefined;
        saveSidePaneState();
        view.dispatchEvent(new (view as any).Event('resize'));
      };

      sidePaneResizeCleanup = finishResize;
      view.addEventListener('mousemove', handleMouseMove, true);
      view.addEventListener('mouseup', finishResize, true);
      view.addEventListener('blur', finishResize);
    },
    true
  );

  unsubscribeWorkspace?.();
  const unsubscribeChatWorkspace = subscribeChatWorkspace(refreshSidePaneWorkspace);
  const unsubscribeHistory = addon.chatManager.subscribeHistory(refreshSidePaneWorkspace);
  unsubscribeWorkspace = () => {
    unsubscribeChatWorkspace();
    unsubscribeHistory();
  };
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
  sidePaneResizeCleanup?.();
  sidePaneBoundsCleanup?.();
  try {
    saveSidePaneState();
  } catch (e) {
    // Window may already be gone — nothing to persist.
  }
  const sharedInput = els.pane.querySelector(`#${SHARED_INPUT_HOST_ID}`)?.shadowRoot?.querySelector('.input-area-wrapper') as HTMLElement | null;
  if (sharedInput) addon.data.sharedInputAreas.delete(sharedInput);
  (els.pane.querySelector(`#${HISTORY_HOST_ID}`)?.firstElementChild as any)?._disposeHistory?.();
  els.splitter.remove();
  els.pane.remove();
  addon.data.sidePaneElements = undefined;
  addon.data.sidePaneBodyMap?.clear();
  sidePaneHistoryVisible = false;
  sidePaneHistoryTransition = 0;
  sidePaneHistoryAnimating = false;
  sidePaneCollapseAnimating = false;
  sidePaneCollapsed = false;
  sidePaneUserWidth = DEFAULT_WIDTH;
  sidePaneRenderedWidth = DEFAULT_WIDTH;
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
  const view = pane.ownerDocument?.defaultView;
  const currentlyCollapsed = isSidePaneCollapsed();
  if (currentlyCollapsed === collapsed || sidePaneCollapseAnimating) return;

  // Persist the requested state immediately. This remains reliable even if
  // Zotero closes before the collapse/expand animation has finished.
  sidePaneCollapsed = collapsed;
  setPref('sidepane.collapsed', collapsed);

  const finish = () => {
    if (collapsed) {
      pane.setAttribute('collapsed', 'true');
      splitter.setAttribute('state', 'collapsed');
      splitter.setAttribute('substate', 'after');
    } else {
      pane.removeAttribute('collapsed');
      splitter.setAttribute('state', '');
      splitter.removeAttribute('substate');
    }
    pane.style.opacity = '';
    pane.style.pointerEvents = '';
    lockSidePaneWidth(pane, sidePaneRenderedWidth);
    sidePaneCollapseAnimating = false;
    if (view) view.dispatchEvent(new (view as any).Event('resize'));
    saveSidePaneState();
    syncToggleButtonState();
  };

  const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reducedMotion || !view || typeof (pane as any).animate !== 'function') {
    finish();
    return;
  }

  sidePaneCollapseAnimating = true;
  pane.style.pointerEvents = 'none';
  unlockSidePaneWidth(pane);
  pane.style.width = `${sidePaneRenderedWidth}px`;
  pane.style.minWidth = '0';
  pane.style.maxWidth = `${sidePaneRenderedWidth}px`;

  if (!collapsed) {
    pane.removeAttribute('collapsed');
    splitter.setAttribute('state', '');
    splitter.removeAttribute('substate');
  }
  const animation = (pane as unknown as HTMLElement).animate(
    collapsed
      ? [
          { width: `${sidePaneRenderedWidth}px`, opacity: 1 },
          { width: '0px', opacity: 0 },
        ]
      : [
          { width: '0px', opacity: 0 },
          { width: `${sidePaneRenderedWidth}px`, opacity: 1 },
        ],
    { duration: PANE_ANIMATION_DURATION, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
  void animation.finished.then(finish).catch(finish);
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
  if (isSidePaneCollapsed()) {
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

function applySidePaneUserWidth(): void {
  const els = getElements();
  if (!els || els.pane.getAttribute('collapsed') === 'true' || sidePaneCollapseAnimating) return;
  // Reapply the last rendered width exactly. Reader initialization changes
  // Zotero's neighboring panes several times; recalculating bounds here would
  // make the AI-Bar visibly pulse even though the window itself didn't resize.
  lockSidePaneWidth(els.pane, sidePaneRenderedWidth);
}

function saveSidePaneState(captureUserWidth = false): void {
  const els = getElements();
  if (!els) return;
  const collapsed = isSidePaneCollapsed();
  sidePaneCollapsed = collapsed;
  setPref('sidepane.collapsed', collapsed);
  if (!collapsed) {
    if (captureUserWidth) {
      const measuredWidth = Math.round(els.pane.getBoundingClientRect().width);
      if (measuredWidth >= MIN_WIDTH) {
        sidePaneUserWidth = measuredWidth;
        sidePaneRenderedWidth = measuredWidth;
      }
    }
    applySidePaneUserWidth();
    setPref('sidepane.width', sidePaneUserWidth);
  }
}

function getCurrentSidePaneSession(): Session | undefined {
  const snapshot = getWorkspaceSnapshot('sidebar');
  const sessionId = getSessionId(snapshot.activeKind, snapshot.sourceTabId);
  if (!sessionId) return undefined;
  const reader = snapshot.sourceTabId ? Zotero.Reader.getByTabID(snapshot.sourceTabId) : undefined;
  return addon.chatManager.getOrCreateSession({
    sessionId,
    kind: snapshot.activeKind,
    sourceTabId: snapshot.activeKind === 'global-agent' ? undefined : snapshot.sourceTabId,
    itemId: snapshot.activeKind === 'global-agent' ? undefined : reader?.itemID,
  });
}

function clearCurrentTabHistory(): void {
  const session = getCurrentSidePaneSession();
  if (!session) return;
  const sessionId = session.id;
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  const root = body?.querySelector(`#${CHAT_ROOT_ID}`) as HTMLElement | null;
  const messageContainer = root?.shadowRoot?.querySelector('.message-container') ?? body?.querySelector('.message-container');
  if (messageContainer) {
    (messageContainer as HTMLElement).innerHTML = '';
  }
  addon.chatManager.clearSectionHistory(sessionId);
}

function startNewSidePaneConversation(): void {
  if (sidePaneHistoryAnimating) return;
  const snapshot = getWorkspaceSnapshot('sidebar');
  if (snapshot.activeKind === 'translation') {
    clearCurrentTabHistory();
    return;
  }
  const session = getCurrentSidePaneSession();
  if (!session || !addon.chatManager.startNewConversation(session)) return;
  sidePaneHistoryVisible = false;
  refreshSidePaneWorkspace();
}

function toggleSidePaneHistory(): void {
  const session = getCurrentSidePaneSession();
  if (!session || session.kind === 'translation' || session.pending.abortController || sidePaneHistoryAnimating) return;
  sidePaneHistoryVisible = !sidePaneHistoryVisible;
  refreshSidePaneWorkspace();
}

function animateSidePaneHistoryView(deck: XULElement, inputHost: HTMLElement | null, historyHost: HTMLElement, visible: boolean): void {
  const els = getElements();
  if (!els) return;
  const renderedVisible = historyHost.dataset.visible;
  const setDisplay = () => {
    deck.style.display = visible ? 'none' : '';
    if (inputHost) inputHost.style.display = visible ? 'none' : 'block';
    historyHost.style.display = visible ? 'flex' : 'none';
  };
  applySidePaneUserWidth();
  if (renderedVisible === undefined || renderedVisible === String(visible)) {
    historyHost.dataset.visible = String(visible);
    setDisplay();
    return;
  }

  historyHost.dataset.visible = String(visible);
  const sequence = ++sidePaneHistoryTransition;
  const view = historyHost.ownerDocument.defaultView;
  const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reducedMotion || !view) {
    setDisplay();
    sidePaneHistoryAnimating = false;
    if (!visible) {
      (historyHost.firstElementChild as any)?._disposeHistory?.();
      historyHost.replaceChildren();
      delete historyHost.dataset.sessionId;
    }
    return;
  }

  sidePaneHistoryAnimating = true;
  const outgoing = visible ? [deck as unknown as HTMLElement, inputHost].filter((element): element is HTMLElement => !!element) : [historyHost];
  for (const element of outgoing) element.style.pointerEvents = 'none';
  const exitAnimations = outgoing.map((element) =>
    element.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${visible ? '-6px' : '6px'})` },
      ],
      { duration: 70, easing: 'ease-in' }
    )
  );
  void Promise.all(exitAnimations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
    if (sequence !== sidePaneHistoryTransition || historyHost.dataset.visible !== String(visible)) return;
    setDisplay();
    applySidePaneUserWidth();
    const incoming = visible ? [historyHost] : [deck as unknown as HTMLElement, inputHost].filter((element): element is HTMLElement => !!element);
    const enterAnimations = incoming.map((element) => {
      element.style.pointerEvents = 'none';
      return element.animate(
        [
          { opacity: 0, transform: `translateX(${visible ? '6px' : '-6px'})` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 110, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    });
    void Promise.all(enterAnimations.map((animation) => animation.finished.catch(() => undefined))).then(() => {
      if (sequence !== sidePaneHistoryTransition) return;
      for (const element of incoming) element.style.pointerEvents = '';
      sidePaneHistoryAnimating = false;
      if (!visible) {
        (historyHost.firstElementChild as any)?._disposeHistory?.();
        historyHost.replaceChildren();
        delete historyHost.dataset.sessionId;
      }
      applySidePaneUserWidth();
    });
  });
}

function updateSidePaneHistoryView(session: Session, page: HTMLElement): void {
  const els = getElements();
  if (!els) return;
  const historyHost = els.pane.querySelector(`#${HISTORY_HOST_ID}`) as HTMLElement | null;
  const inputHost = els.pane.querySelector(`#${SHARED_INPUT_HOST_ID}`) as HTMLElement | null;
  const historyBtn = els.pane.querySelector(`#${HISTORY_BUTTON_ID}`) as HTMLButtonElement | null;
  const newChatBtn = els.pane.querySelector(`#${NEW_CHAT_BUTTON_ID}`) as HTMLButtonElement | null;
  const supportsHistory = session.kind !== 'translation';
  if (!supportsHistory) sidePaneHistoryVisible = false;
  const busy = !!session.pending.abortController;
  if (historyBtn) {
    historyBtn.style.display = supportsHistory ? '' : 'none';
    historyBtn.disabled = busy || sidePaneHistoryAnimating;
  }
  if (newChatBtn) {
    newChatBtn.title = getString((supportsHistory ? 'history-new-chat' : 'sidepane-clear-tooltip') as any);
    newChatBtn.setAttribute('aria-label', newChatBtn.title);
    newChatBtn.disabled = busy || sidePaneHistoryAnimating;
    setSidePaneButtonIcon(
      newChatBtn,
      supportsHistory ? `chrome://${config.addonRef}/content/icons/chat-new.svg` : 'chrome://zotero/skin/16/universal/empty-trash.svg'
    );
  }
  if (!historyHost) return;
  if (sidePaneHistoryVisible && (historyHost.dataset.sessionId !== session.id || !historyHost.firstElementChild)) {
    (historyHost.firstElementChild as any)?._disposeHistory?.();
    historyHost.replaceChildren();
    historyHost.dataset.sessionId = session.id;
    historyHost.appendChild(
      ChatHistoryPanel(historyHost.ownerDocument, session, {
        onActivate: async () => {
          const container = getSessionMessageContainer(session.id);
          if (container) await renderPersistedTranscript(session, container, true);
          sidePaneHistoryVisible = false;
          refreshSidePaneWorkspace();
        },
        onCurrentDeleted: async () => {
          const container = getSessionMessageContainer(session.id);
          if (container) await renderPersistedTranscript(session, container, true);
        },
        onClose: () => {
          if (sidePaneHistoryAnimating) return;
          sidePaneHistoryVisible = false;
          refreshSidePaneWorkspace();
        },
      })
    );
  }
  animateSidePaneHistoryView(els.deck, inputHost, historyHost, sidePaneHistoryVisible);
  if (!sidePaneHistoryVisible) page.style.display = 'flex';
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
  const session = addon.chatManager.getOrCreateSession({
    sessionId,
    kind: snapshot.activeKind,
    sourceTabId: snapshot.activeKind === 'global-agent' ? undefined : sourceTabId,
    itemId: snapshot.activeKind === 'global-agent' ? undefined : reader?.itemID,
  });
  const messageContainer = getSessionMessageContainer(sessionId);
  if (messageContainer) void renderPersistedTranscript(session, messageContainer);
  updateSidePaneHistoryView(session, page);
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
  page.style.minWidth = '0';
  page.style.width = '100%';
  page.style.maxWidth = '100%';
  page.style.boxSizing = 'border-box';
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
  messageContainer.classList.add('message-container', 'flex', 'flex-col', 'flex-1', 'overflow-y-auto', 'overflow-x-auto', 'min-w-0', 'pb-7');
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
