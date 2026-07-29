import { config } from '../../package.json';
import { Icons } from '../components/common';
import { InputArea, type InputAreaAPI } from '../components/inputArea';
import { ChatHistoryPanel } from '../components/chatHistoryPanel';
import { renderMarkdown } from '../utils/markdown';
import { getString } from '../utils/locale';
import { getReaderSourceLabel } from './readerBarPopup';
import { attachCitationHandlers, renderPersistedTranscript } from './chatUI';
import type { Session } from './chatManager';
import {
  GLOBAL_AGENT_SESSION_ID,
  getSessionId,
  getWorkspaceSnapshot,
  hideTranslationWorkspace,
  selectWorkspaceKind,
  subscribeChatWorkspace,
  type ChatSessionKind,
} from './chatWorkspace';

const WINDOW_ROOT_ID = 'ai-bar-window-root';
const WINDOW_DECK_CLASS = 'zaibar-window-deck';
const SESSION_ID_ATTR = 'data-session-id';
const WINDOW_HISTORY_CLASS = 'zaibar-window-history';

type WorkspaceRoot = HTMLElement & {
  _workspaceUnsubscribe?: () => void;
  _historyTransition?: number;
  _historyAnimating?: boolean;
};

function setWindowButtonIcon(button: HTMLButtonElement, url: string): void {
  button.replaceChildren();
  button.style.backgroundImage = `url("${url}")`;
  button.style.backgroundPosition = 'center';
  button.style.backgroundRepeat = 'no-repeat';
  button.style.backgroundSize = '16px 16px';
  button.style.setProperty('-moz-context-properties', 'fill, stroke');
  button.style.setProperty('fill', 'currentColor');
  button.style.setProperty('stroke', 'currentColor');
}

function renderWindowTabs(doc: Document, tabs: HTMLElement): void {
  const snapshot = getWorkspaceSnapshot('window');
  const sourceTabId = snapshot.sourceTabId;
  const articleLabel = sourceTabId ? getString('workspace-article') : getString('workspace-no-article');
  const kinds: ChatSessionKind[] = ['article'];
  if (sourceTabId && snapshot.translationVisible) kinds.push('translation');
  kinds.push('global-agent');

  tabs.innerHTML = '';
  for (const kind of kinds) {
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.classList.add('zaibar-window-tab');
    tab.dataset.active = String(snapshot.activeKind === kind);
    const disabled = kind === 'article' && !sourceTabId;
    tab.disabled = disabled;
    tab.title = kind === 'article' ? articleLabel : getString(`workspace-${kind}` as any);

    const icon = doc.createElement('span');
    icon.classList.add('zaibar-window-tab-icon');
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
    label.classList.add('zaibar-window-tab-label');
    label.textContent = kind === 'article' ? articleLabel : getString(`workspace-${kind}` as any);
    tab.append(icon, label);
    tab.addEventListener('click', () => selectWorkspaceKind(kind, sourceTabId));

    if (kind === 'translation') {
      const close = doc.createElement('span');
      close.classList.add('zaibar-window-tab-close');
      close.textContent = '×';
      close.title = getString('workspace-close-translation');
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        if (sourceTabId) hideTranslationWorkspace(sourceTabId);
      });
      tab.appendChild(close);
    }
    tabs.appendChild(tab);
  }
}

function createWindowSessionPage(doc: Document, sessionId: string): HTMLElement {
  const page = doc.createElement('div');
  page.setAttribute(SESSION_ID_ATTR, sessionId);
  page.classList.add('zaibar-window-session-page', 'flex', 'h-full', 'min-h-0', 'flex-col', 'gap-2');
  page.style.minWidth = '0';
  page.style.width = '100%';
  page.style.maxWidth = '100%';
  page.style.boxSizing = 'border-box';
  page.style.display = 'none';

  const messageContainer = doc.createElement('div');
  messageContainer.classList.add(
    'message-container',
    'flex',
    'flex-col',
    'flex-1',
    'min-h-0',
    'min-w-0',
    'overflow-y-auto',
    'overflow-x-hidden',
    'px-1',
    'pb-2'
  );
  messageContainer.style.userSelect = 'text';

  page.appendChild(messageContainer);
  return page;
}

function ensureWindowSessionPage(doc: Document, deck: HTMLElement, sessionId: string): HTMLElement {
  const existing = Array.from(deck.children).find((child) => child.getAttribute(SESSION_ID_ATTR) === sessionId) as HTMLElement | undefined;
  if (existing) return existing;
  const page = createWindowSessionPage(doc, sessionId);
  deck.appendChild(page);
  addon.data.sidePaneBodyMap?.set(sessionId, page);
  return page;
}

export function refreshChatWindowWorkspace(doc: Document): void {
  const root = doc.getElementById(WINDOW_ROOT_ID) as HTMLElement | null;
  const tabs = root?.querySelector('.zaibar-window-tabs') as HTMLElement | null;
  const deck = root?.querySelector(`.${WINDOW_DECK_CLASS}`) as HTMLElement | null;
  if (!root || !tabs || !deck) return;

  renderWindowTabs(doc, tabs);
  const snapshot = getWorkspaceSnapshot('window');
  const sessionId = getSessionId(snapshot.activeKind, snapshot.sourceTabId) ?? GLOBAL_AGENT_SESSION_ID;
  const page = ensureWindowSessionPage(doc, deck, sessionId);
  selectWindowSessionPage(deck, page);
  const sharedInput = root.querySelector('.zaibar-window-shared-input .input-area-wrapper') as
    | (HTMLElement & { _inputAreaAPI?: InputAreaAPI })
    | null;
  const requestSourceTabId = snapshot.activeKind === 'global-agent' ? undefined : snapshot.sourceTabId;
  const reader = snapshot.sourceTabId ? Zotero.Reader.getByTabID(snapshot.sourceTabId) : undefined;
  const session = addon.chatManager.getOrCreateSession({
    sessionId,
    kind: snapshot.activeKind,
    sourceTabId: snapshot.activeKind === 'global-agent' ? undefined : snapshot.sourceTabId,
    itemId: snapshot.activeKind === 'global-agent' ? undefined : reader?.itemID,
  });
  const messageContainer = getWindowMessageContainer(sessionId);
  if (messageContainer) void renderPersistedTranscript(session, messageContainer);
  updateWindowHistoryView(doc, session, page);
  sharedInput?._inputAreaAPI?.setContext({
    sessionId,
    sessionKind: snapshot.activeKind,
    sourceTabId: requestSourceTabId,
    captureSourceTabId: snapshot.sourceTabId,
    sourceLabel: requestSourceTabId && reader ? getReaderSourceLabel(reader) : undefined,
    chatModeAdjustable: snapshot.activeKind === 'article',
    allowScreenshot: true,
    allowSelectionHint: snapshot.activeKind !== 'global-agent',
  });
}

function selectWindowSessionPage(deck: HTMLElement, page: HTMLElement): void {
  const current = Array.from(deck.children).find((child) => (child as HTMLElement).dataset.active === 'true') as HTMLElement | undefined;
  if (current === page) return;

  for (const child of Array.from(deck.children) as HTMLElement[]) {
    child.dataset.active = String(child === page);
    child.style.display = child === page ? 'flex' : 'none';
    child.style.pointerEvents = child === page ? '' : 'none';
  }

  const view = deck.ownerDocument.defaultView;
  const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
  page.style.transition = 'none';
  page.style.opacity = reducedMotion ? '1' : '0';
  page.style.transform = reducedMotion ? 'none' : 'translateX(4px)';
  if (reducedMotion) return;
  page.getBoundingClientRect();
  page.style.transition = 'opacity 110ms ease-out, transform 140ms ease-out';
  page.style.opacity = '1';
  page.style.transform = 'translateX(0)';
}

function getCurrentWindowSession(): Session | undefined {
  const snapshot = getWorkspaceSnapshot('window');
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

function clearActiveWindowHistory(doc: Document): void {
  const session = getCurrentWindowSession();
  if (!session) return;
  const sessionId = session.id;
  const page = addon.data.sidePaneBodyMap?.get(sessionId);
  const messageContainer = page?.querySelector('.message-container') as HTMLElement | null;
  if (messageContainer) messageContainer.innerHTML = '';
  addon.chatManager.clearSectionHistory(sessionId);
}

function startNewWindowConversation(doc: Document): void {
  const session = getCurrentWindowSession();
  const root = doc.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
  if (!session || root?._historyAnimating) return;
  if (session.kind === 'translation') {
    clearActiveWindowHistory(doc);
    return;
  }
  if (!addon.chatManager.startNewConversation(session)) return;
  if (root) root.dataset.historyVisible = 'false';
  refreshChatWindowWorkspace(doc);
}

function animateWindowHistoryView(
  root: WorkspaceRoot,
  deck: HTMLElement,
  inputHost: HTMLElement | null,
  historyHost: HTMLElement,
  visible: boolean
): void {
  const renderedVisible = historyHost.dataset.visible;
  const setDisplay = () => {
    deck.style.display = visible ? 'none' : 'flex';
    if (inputHost) inputHost.style.display = visible ? 'none' : '';
    historyHost.style.display = visible ? 'flex' : 'none';
  };
  if (renderedVisible === undefined || renderedVisible === String(visible)) {
    historyHost.dataset.visible = String(visible);
    setDisplay();
    return;
  }

  historyHost.dataset.visible = String(visible);
  const sequence = (root._historyTransition ?? 0) + 1;
  root._historyTransition = sequence;
  const view = root.ownerDocument.defaultView;
  const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reducedMotion || !view) {
    setDisplay();
    root._historyAnimating = false;
    if (!visible) {
      (historyHost.firstElementChild as any)?._disposeHistory?.();
      historyHost.replaceChildren();
      delete historyHost.dataset.sessionId;
    }
    return;
  }

  root._historyAnimating = true;
  const outgoing = visible ? [deck, inputHost].filter((element): element is HTMLElement => !!element) : [historyHost];
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
    if (root._historyTransition !== sequence || historyHost.dataset.visible !== String(visible)) return;
    setDisplay();
    const incoming = visible ? [historyHost] : [deck, inputHost].filter((element): element is HTMLElement => !!element);
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
      if (root._historyTransition !== sequence) return;
      for (const element of incoming) element.style.pointerEvents = '';
      root._historyAnimating = false;
      if (!visible) {
        (historyHost.firstElementChild as any)?._disposeHistory?.();
        historyHost.replaceChildren();
        delete historyHost.dataset.sessionId;
      }
    });
  });
}

function updateWindowHistoryView(doc: Document, session: Session, page: HTMLElement): void {
  const root = doc.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
  const deck = root?.querySelector(`.${WINDOW_DECK_CLASS}`) as HTMLElement | null;
  const historyHost = root?.querySelector(`.${WINDOW_HISTORY_CLASS}`) as HTMLElement | null;
  const inputHost = root?.querySelector('.zaibar-window-shared-input') as HTMLElement | null;
  const historyButton = root?.querySelector('.zaibar-window-history-button') as HTMLButtonElement | null;
  const newButton = root?.querySelector('.zaibar-window-new-chat') as HTMLButtonElement | null;
  if (!root || !deck || !historyHost) return;
  const supportsHistory = session.kind !== 'translation';
  if (!supportsHistory) root.dataset.historyVisible = 'false';
  const visible = supportsHistory && root.dataset.historyVisible === 'true';
  const busy = !!session.pending.abortController;
  if (historyButton) {
    historyButton.style.display = supportsHistory ? '' : 'none';
    historyButton.disabled = busy || !!root._historyAnimating;
  }
  if (newButton) {
    newButton.title = getString((supportsHistory ? 'history-new-chat' : 'sidepane-clear-tooltip') as any);
    newButton.setAttribute('aria-label', newButton.title);
    newButton.disabled = busy || !!root._historyAnimating;
    setWindowButtonIcon(
      newButton,
      supportsHistory ? `chrome://${config.addonRef}/content/icons/chat-new.svg` : 'chrome://zotero/skin/16/universal/empty-trash.svg'
    );
  }
  if (visible && (historyHost.dataset.sessionId !== session.id || !historyHost.firstElementChild)) {
    (historyHost.firstElementChild as any)?._disposeHistory?.();
    historyHost.replaceChildren();
    historyHost.dataset.sessionId = session.id;
    historyHost.appendChild(
      ChatHistoryPanel(doc, session, {
        onActivate: async () => {
          const container = getWindowMessageContainer(session.id);
          if (container) await renderPersistedTranscript(session, container, true);
          root.dataset.historyVisible = 'false';
          refreshChatWindowWorkspace(doc);
        },
        onCurrentDeleted: async () => {
          const container = getWindowMessageContainer(session.id);
          if (container) await renderPersistedTranscript(session, container, true);
        },
        onClose: () => {
          if (root._historyAnimating) return;
          root.dataset.historyVisible = 'false';
          refreshChatWindowWorkspace(doc);
        },
      })
    );
  }
  animateWindowHistoryView(root, deck, inputHost, historyHost, visible);
  if (!visible) page.style.display = 'flex';
}

export function ensureChatWindowUI(doc: Document) {
  const root = doc.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
  if (!root) return;
  if (root.querySelector(`.${WINDOW_DECK_CLASS}`)) {
    refreshChatWindowWorkspace(doc);
    return;
  }

  addon.data.sidePaneBodyMap = new Map<string, HTMLElement>();
  root.innerHTML = '';

  const header = doc.createElement('div');
  header.classList.add('zaibar-window-header');
  const tabs = doc.createElement('div');
  tabs.classList.add('zaibar-window-tabs');
  const history = doc.createElement('button');
  history.type = 'button';
  history.classList.add('zaibar-window-clear', 'zaibar-window-history-button');
  history.title = getString('history-title' as any);
  history.setAttribute('aria-label', history.title);
  setWindowButtonIcon(history, `chrome://${config.addonRef}/content/icons/chat-history.svg`);
  history.addEventListener('click', () => {
    const session = getCurrentWindowSession();
    if (!session || session.kind === 'translation' || session.pending.abortController || root._historyAnimating) return;
    root.dataset.historyVisible = String(root.dataset.historyVisible !== 'true');
    refreshChatWindowWorkspace(doc);
  });
  const newChat = doc.createElement('button');
  newChat.type = 'button';
  newChat.classList.add('zaibar-window-clear', 'zaibar-window-new-chat');
  newChat.title = getString('history-new-chat' as any);
  newChat.setAttribute('aria-label', newChat.title);
  setWindowButtonIcon(newChat, `chrome://${config.addonRef}/content/icons/chat-new.svg`);
  newChat.addEventListener('click', () => startNewWindowConversation(doc));
  header.append(tabs, history, newChat);

  const deck = doc.createElement('div');
  deck.classList.add(WINDOW_DECK_CLASS, 'flex', 'flex-1', 'min-h-0', 'flex-col');
  deck.style.cssText = 'min-width:0;width:100%;max-width:100%;box-sizing:border-box;';
  const historyHost = doc.createElement('div');
  historyHost.classList.add(WINDOW_HISTORY_CLASS);
  historyHost.style.cssText = 'display:none;flex:1;min-width:0;width:100%;max-width:100%;min-height:0;box-sizing:border-box;overflow:hidden;';
  const inputHost = doc.createElement('div');
  inputHost.classList.add('zaibar-window-shared-input');
  inputHost.style.cssText = 'min-width:0;width:100%;max-width:100%;box-sizing:border-box;';
  const sharedInput = InputArea(doc, GLOBAL_AGENT_SESSION_ID, {
    sessionKind: 'global-agent',
    chatModeAdjustable: false,
    allowScreenshot: true,
    allowSelectionHint: false,
    draftId: 'shared-input:window',
    resolveMessageContainer: getWindowMessageContainer,
    onRenderUserBubble: async (bubble, text, sessionId) => {
      if (!text) return;
      const msgEl = bubble.querySelector('.chat-message') as HTMLElement | null;
      if (!msgEl) return;
      msgEl.innerHTML = await renderMarkdown(text, addon.chatManager.sessionsMap.get(sessionId)?.itemId);
      attachCitationHandlers(msgEl);
      (msgEl as any).dataset.markdown = text;
    },
  });
  sharedInput.style.userSelect = 'none';
  inputHost.appendChild(sharedInput);
  addon.data.sharedInputAreas.add(sharedInput);
  root.dataset.historyVisible = 'false';
  root.append(header, deck, historyHost, inputHost);

  root._workspaceUnsubscribe?.();
  const unsubscribeWorkspace = subscribeChatWorkspace(() => refreshChatWindowWorkspace(doc));
  const unsubscribeHistory = addon.chatManager.subscribeHistory(() => refreshChatWindowWorkspace(doc));
  root._workspaceUnsubscribe = () => {
    unsubscribeWorkspace();
    unsubscribeHistory();
  };
  refreshChatWindowWorkspace(doc);
}

export function onChatWindowLoad(window: Window) {
  ensureChatWindowUI(window.document);
  window.addEventListener('unload', () => {
    const root = window.document.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
    root?._workspaceUnsubscribe?.();
    const sharedInput = root?.querySelector('.zaibar-window-shared-input .input-area-wrapper') as HTMLElement | null;
    if (sharedInput) addon.data.sharedInputAreas.delete(sharedInput);
    (root?.querySelector(`.${WINDOW_HISTORY_CLASS}`)?.firstElementChild as any)?._disposeHistory?.();
    if (window.arguments?.[0]?.onWindowClosed) {
      window.arguments[0].onWindowClosed();
    }
  });
}

function getWindowMessageContainer(sessionId: string): HTMLElement | null {
  return (addon.data.sidePaneBodyMap?.get(sessionId)?.querySelector('.message-container') as HTMLElement | null) ?? null;
}
