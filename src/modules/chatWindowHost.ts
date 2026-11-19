import { setButtonIcon } from '../components/buttonIcon';
import { sessionMessageContainer } from '../utils/chatSessionDOM';
import { createChatHistoryController, workspaceSession, workspaceInputContext } from './chatViewController';
import { config } from '../../package.json';
import { Icons } from '../components/common';
import { IconView } from '../components/iconView';
import { InputArea, type InputAreaAPI } from '../components/inputArea';
import { createChatTurnNavigator, disposeChatTurnNavigatorHost, setChatTurnNavigatorHost } from '../components/chatTurnNavigator';
import { mountChatEmptyState, syncChatEmptyState } from '../components/chatEmptyState';
import { renderMarkdown } from '../utils/markdown';
import { getString } from '../utils/locale';
import { installChatSelectionCopyHandler, registerChatSelectionCopyContainer, uninstallChatSelectionCopyHandler } from '../utils/chatSelectionCopy';
import { SHARED_CHAT_DRAFT_ID } from '../utils/chatDraft';
import { attachMarkdownHandlers, renderPersistedTranscript } from './chatUI';
import { applyChatFontSize } from '../utils/chatFontSize';
import { registerChatSkinRoot } from '../utils/chatSkin';
import { disposeChatTabHighlight, syncChatTabHighlight } from '../utils/chatTabHighlight';
import { createSkinPreview } from '../components/skinPreview';
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

const windowHistories = new WeakMap<Document, ReturnType<typeof createChatHistoryController>>();
function windowHistory(doc: Document) {
  let history = windowHistories.get(doc);
  if (!history) {
    history = createChatHistoryController();
    windowHistories.set(doc, history);
  }
  return history;
}

const WINDOW_ROOT_ID = 'ai-bar-window-root';
const WINDOW_DECK_CLASS = 'zaibar-window-deck';
const SESSION_ID_ATTR = 'data-session-id';
const SKIN_PREVIEW_SESSION_ID = '__skin-preview__';
const WINDOW_HISTORY_CLASS = 'zaibar-window-history';
const WINDOW_HOST_SWITCH_CLASS = 'zaibar-window-host-switch';

type WorkspaceRoot = HTMLElement & {
  _workspaceUnsubscribe?: () => void;
};

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
    tab.dataset.active = String(tabs.closest(`#${WINDOW_ROOT_ID}`)?.getAttribute('data-skin-preview') !== 'true' && snapshot.activeKind === kind);
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
      ztoolkit.UI.appendElement(IconView({ iconMarkup: kind === 'translation' ? Icons.Translate : Icons.Agent }), icon);
    }
    const label = doc.createElement('span');
    label.classList.add('zaibar-window-tab-label');
    label.textContent = kind === 'article' ? articleLabel : getString(`workspace-${kind}` as any);
    tab.append(icon, label);
    tab.addEventListener('click', () => {
      const root = tabs.closest(`#${WINDOW_ROOT_ID}`) as HTMLElement | null;
      if (root) root.dataset.skinPreview = 'false';
      selectWorkspaceKind(kind, sourceTabId);
      refreshChatWindowWorkspace(doc);
    });

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
  if (__env__ !== 'production') {
    const previewTab = doc.createElement('button');
    previewTab.type = 'button';
    previewTab.classList.add('zaibar-window-tab');
    previewTab.dataset.active = String(tabs.closest(`#${WINDOW_ROOT_ID}`)?.getAttribute('data-skin-preview') === 'true');
    previewTab.textContent = '皮肤预览';
    previewTab.addEventListener('click', () => {
      const root = tabs.closest(`#${WINDOW_ROOT_ID}`) as HTMLElement | null;
      if (root) {
        root.dataset.skinPreview = 'true';
        windowHistory(doc).visible = false;
      }
      refreshChatWindowWorkspace(doc);
    });
    tabs.appendChild(previewTab);
  }
  syncChatTabHighlight(tabs);
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
    'pb-7'
  );
  messageContainer.style.userSelect = 'text';
  applyChatFontSize(messageContainer);
  registerChatSelectionCopyContainer(messageContainer);

  const navigator = createChatTurnNavigator(doc, messageContainer);
  registerChatSkinRoot(navigator.shell);
  const disposeEmptyState = mountChatEmptyState(doc, messageContainer, navigator.shell);
  page.appendChild(navigator.shell);
  setChatTurnNavigatorHost(page, () => {
    disposeEmptyState();
    navigator.dispose();
  });
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

  const hostSwitch = root.querySelector(`.${WINDOW_HOST_SWITCH_CLASS}`) as HTMLButtonElement | null;
  if (hostSwitch) {
    const blocked = Array.from(addon.chatManager.sessionsMap.values()).some(
      (session) => !!session.activeRequestPromise || !!session.pending.abortController
    );
    hostSwitch.disabled = blocked;
    hostSwitch.title = getString((blocked ? 'chat-host-switch-busy' : 'chat-host-switch-to-sidebar') as any);
    hostSwitch.setAttribute('aria-label', hostSwitch.title);
  }

  renderWindowTabs(doc, tabs);
  if (__env__ !== 'production' && root.dataset.skinPreview === 'true') {
    const previewPage = ensureWindowSessionPage(doc, deck, SKIN_PREVIEW_SESSION_ID);
    const previewContainer = previewPage.querySelector('.message-container') as HTMLElement | null;
    if (previewContainer && !previewContainer.firstElementChild) previewContainer.appendChild(createSkinPreview(doc));
    selectWindowSessionPage(deck, previewPage);
    const inputHost = root.querySelector('.zaibar-window-shared-input') as HTMLElement | null;
    const historyHost = root.querySelector(`.${WINDOW_HISTORY_CLASS}`) as HTMLElement | null;
    if (inputHost) inputHost.style.display = 'none';
    if (historyHost) historyHost.style.display = 'none';
    return;
  }
  const snapshot = getWorkspaceSnapshot('window');
  const sessionId = getSessionId(snapshot.activeKind, snapshot.sourceTabId) ?? GLOBAL_AGENT_SESSION_ID;
  const page = ensureWindowSessionPage(doc, deck, sessionId);
  selectWindowSessionPage(deck, page);
  const sharedInput = root.querySelector('.zaibar-window-shared-input .input-area-wrapper') as
    | (HTMLElement & { _inputAreaAPI?: InputAreaAPI })
    | null;
  const session = workspaceSession('window')!;
  const messageContainer = getWindowMessageContainer(sessionId);
  if (messageContainer) {
    syncChatEmptyState(session, messageContainer);
    void renderPersistedTranscript(session, messageContainer);
  }
  updateWindowHistoryView(doc, session, page);
  sharedInput?._inputAreaAPI?.setContext(workspaceInputContext('window', session));
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
  return workspaceSession('window');
}
function startNewWindowConversation(doc: Document): void {
  if (windowHistory(doc).startNew(getCurrentWindowSession())) refreshChatWindowWorkspace(doc);
}
function updateWindowHistoryView(doc: Document, session: Session, page: HTMLElement): void {
  const root = doc.getElementById(WINDOW_ROOT_ID);
  const deck = root?.querySelector(`.${WINDOW_DECK_CLASS}`) as HTMLElement | null;
  const historyHost = root?.querySelector(`.${WINDOW_HISTORY_CLASS}`) as HTMLElement | null;
  if (!root || !deck || !historyHost) return;
  windowHistory(doc).update(session, page, {
    deck,
    historyHost,
    inputHost: root.querySelector('.zaibar-window-shared-input'),
    historyButton: root.querySelector('.zaibar-window-history-button'),
    newButton: root.querySelector('.zaibar-window-new-chat'),
    refresh: () => refreshChatWindowWorkspace(doc),
    setIcon: setButtonIcon,
    deckDisplay: 'flex',
    inputDisplay: '',
  });
}

export function ensureChatWindowUI(doc: Document) {
  registerChatSkinRoot(doc.documentElement);
  const root = doc.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
  if (!root) return;

  installChatSelectionCopyHandler(doc);
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
  setButtonIcon(history, `chrome://${config.addonRef}/content/icons/chat-history.svg`);
  history.addEventListener('click', () => {
    if (windowHistory(doc).toggle(getCurrentWindowSession())) refreshChatWindowWorkspace(doc);
  });
  const newChat = doc.createElement('button');
  newChat.type = 'button';
  newChat.classList.add('zaibar-window-clear', 'zaibar-window-new-chat');
  newChat.title = getString('history-new-chat' as any);
  newChat.setAttribute('aria-label', newChat.title);
  setButtonIcon(newChat, `chrome://${config.addonRef}/content/icons/chat-new.svg`);
  newChat.addEventListener('click', () => startNewWindowConversation(doc));
  const hostSwitch = doc.createElement('button');
  hostSwitch.type = 'button';
  hostSwitch.classList.add('zaibar-window-clear', WINDOW_HOST_SWITCH_CLASS);
  hostSwitch.title = getString('chat-host-switch-to-sidebar' as any);
  hostSwitch.setAttribute('aria-label', hostSwitch.title);
  setButtonIcon(hostSwitch, `chrome://${config.addonRef}/content/icons/chat-dock-sidebar.svg`);
  hostSwitch.addEventListener('click', async () => {
    if (hostSwitch.disabled) return;
    const { switchChatHost } = await import('./chatHostController');
    await switchChatHost('sidebar');
  });
  header.append(tabs, history, newChat, hostSwitch);

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
    draftId: SHARED_CHAT_DRAFT_ID,
    resolveMessageContainer: getWindowMessageContainer,
    onRenderUserBubble: async (bubble, text, sessionId) => {
      if (!text) return;
      const msgEl = bubble.querySelector('.chat-message') as HTMLElement | null;
      if (!msgEl) return;
      msgEl.innerHTML = await renderMarkdown(text, addon.chatManager.sessionsMap.get(sessionId)?.itemId);
      attachMarkdownHandlers(msgEl);
      (msgEl as any).dataset.markdown = text;
    },
  });
  sharedInput.style.userSelect = 'none';
  inputHost.appendChild(sharedInput);
  addon.data.sharedInputAreas.add(sharedInput);
  windowHistory(doc).visible = false;
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
  const preventCloseWhileStreaming = (event: BeforeUnloadEvent) => {
    if (!window.arguments?.[0]?.shouldPreventClose?.(window)) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', preventCloseWhileStreaming);
  window.addEventListener('unload', () => {
    uninstallChatSelectionCopyHandler(window.document);
    window.removeEventListener('beforeunload', preventCloseWhileStreaming);
    windowHistory(window.document).dispose();
    const root = window.document.getElementById(WINDOW_ROOT_ID) as WorkspaceRoot | null;
    const tabs = root?.querySelector('.zaibar-window-tabs') as HTMLElement | null;
    if (tabs) disposeChatTabHighlight(tabs);
    root?._workspaceUnsubscribe?.();
    const sharedInput = root?.querySelector('.zaibar-window-shared-input .input-area-wrapper') as HTMLElement | null;
    if (sharedInput) {
      (sharedInput as HTMLElement & { _inputAreaAPI?: InputAreaAPI })._inputAreaAPI?.dispose();
      addon.data.sharedInputAreas.delete(sharedInput);
    }
    root?.querySelectorAll(`.${WINDOW_DECK_CLASS} > [${SESSION_ID_ATTR}]`).forEach((page) => disposeChatTurnNavigatorHost(page));
    (root?.querySelector(`.${WINDOW_HISTORY_CLASS}`)?.firstElementChild as any)?._disposeHistory?.();
    addon.data.sidePaneBodyMap?.clear();
    if (window.arguments?.[0]?.onWindowClosed) {
      window.arguments[0].onWindowClosed(window);
    }
  });
}

const getWindowMessageContainer = sessionMessageContainer;
