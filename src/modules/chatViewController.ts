import { sessionMessageContainer } from '../utils/chatSessionDOM';
import { config } from '../../package.json';
import { ChatHistoryPanel } from '../components/chatHistoryPanel';
import { resetChatEmptyState } from '../components/chatEmptyState';
import type { InputAreaContext } from '../components/inputArea';
import { getString } from '../utils/locale';
import type { Session } from './chatManager';
import { getSessionId, getWorkspaceSnapshot, type ChatWorkspaceHost } from './chatWorkspace';
import { getReaderSourceLabel } from './readerBarPopup';
import { renderPersistedTranscript } from './chatUI';

export function workspaceSession(host: ChatWorkspaceHost): Session | undefined {
  const snapshot = getWorkspaceSnapshot(host);
  const sessionId = getSessionId(snapshot.activeKind, snapshot.sourceTabId);
  if (!sessionId) return undefined;
  const sourceTabId = snapshot.activeKind === 'global-agent' ? undefined : snapshot.sourceTabId;
  return addon.chatManager.getOrCreateSession({
    sessionId,
    kind: snapshot.activeKind,
    sourceTabId,
    itemId: sourceTabId ? Zotero.Reader.getByTabID(sourceTabId)?.itemID : undefined,
  });
}

export function workspaceInputContext(host: ChatWorkspaceHost, session: Session): InputAreaContext {
  const snapshot = getWorkspaceSnapshot(host);
  const reader = session.sourceTabId ? Zotero.Reader.getByTabID(session.sourceTabId) : undefined;
  return {
    sessionId: session.id,
    sessionKind: session.kind,
    sourceTabId: session.sourceTabId,
    captureSourceTabId: snapshot.sourceTabId,
    sourceLabel: reader ? getReaderSourceLabel(reader) : undefined,
    chatModeAdjustable: session.kind === 'article',
    allowScreenshot: true,
    allowSelectionHint: session.kind !== 'global-agent',
  };
}

interface HistoryView {
  deck: HTMLElement;
  inputHost: HTMLElement | null;
  historyHost: HTMLElement;
  historyButton: HTMLButtonElement | null;
  newButton: HTMLButtonElement | null;
  refresh(): void;
  setIcon(button: HTMLButtonElement, url: string): void;
  layout?(): void;
  deckDisplay: string;
  inputDisplay: string;
}

/** Host-local state, shared conversation actions and interruptible history transitions. */
export function createChatHistoryController() {
  let visible = false;
  let animating = false;
  let sequence = 0;
  let currentView: HistoryView | undefined;
  let animations: Animation[] = [];
  function stopAnimations() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }
  function clear(session: Session) {
    sessionMessageContainer(session.id)?.replaceChildren();
    addon.chatManager.clearSectionHistory(session.id);
    resetChatEmptyState(session);
  }
  function startNew(session: Session | undefined): boolean {
    if (!session || animating || session.pending.abortController) return false;
    if (session.kind === 'translation') clear(session);
    else if (!addon.chatManager.startNewConversation(session)) return false;
    visible = false;
    return true;
  }
  function disposePanel(view: HistoryView) {
    (view.historyHost.firstElementChild as any)?._disposeHistory?.();
    view.historyHost.replaceChildren();
    delete view.historyHost.dataset.sessionId;
  }
  function update(session: Session, page: HTMLElement, view: HistoryView) {
    currentView = view;
    const supportsHistory = session.kind !== 'translation';
    if (!supportsHistory) visible = false;
    if (view.historyButton) {
      view.historyButton.style.display = supportsHistory ? '' : 'none';
      view.historyButton.disabled = !!session.pending.abortController || animating;
    }
    if (view.newButton) {
      view.newButton.title = getString((supportsHistory ? 'history-new-chat' : 'sidepane-clear-tooltip') as any);
      view.newButton.setAttribute('aria-label', view.newButton.title);
      view.newButton.disabled = !!session.pending.abortController || animating;
      view.setIcon(
        view.newButton,
        supportsHistory ? `chrome://${config.addonRef}/content/icons/chat-new.svg` : 'chrome://zotero/skin/16/universal/empty-trash.svg'
      );
    }
    if (visible && (view.historyHost.dataset.sessionId !== session.id || !view.historyHost.firstElementChild)) {
      disposePanel(view);
      view.historyHost.dataset.sessionId = session.id;
      const isCurrentPanel = () => currentView?.historyHost === view.historyHost && view.historyHost.dataset.sessionId === session.id;
      const render = async () => {
        const container = sessionMessageContainer(session.id);
        if (container) await renderPersistedTranscript(session, container, true);
      };
      view.historyHost.appendChild(
        ChatHistoryPanel(view.historyHost.ownerDocument, session, {
          onActivate: async () => {
            if (!isCurrentPanel()) return;
            await render();
            if (!isCurrentPanel()) return;
            visible = false;
            view.refresh();
          },
          onCurrentDeleted: async () => {
            if (isCurrentPanel()) await render();
          },
          onClose: () => {
            if (isCurrentPanel() && !animating) {
              visible = false;
              view.refresh();
            }
          },
        })
      );
    }
    const oldVisible = view.historyHost.dataset.visible;
    const id = ++sequence;
    stopAnimations();
    for (const element of [view.deck, view.inputHost, view.historyHost]) if (element) element.style.pointerEvents = '';
    const show = () => {
      view.deck.style.display = visible ? 'none' : view.deckDisplay;
      if (view.inputHost) view.inputHost.style.display = visible ? 'none' : view.inputDisplay;
      view.historyHost.style.display = visible ? 'flex' : 'none';
      if (!visible) page.style.display = 'flex';
      view.layout?.();
    };
    const finish = () => {
      if (id !== sequence) return;
      for (const element of [view.deck, view.inputHost, view.historyHost]) if (element) element.style.pointerEvents = '';
      animating = false;
      if (!visible) disposePanel(view);
      if (view.historyButton) view.historyButton.disabled = !!session.pending.abortController;
      if (view.newButton) view.newButton.disabled = !!session.pending.abortController;
    };
    view.historyHost.dataset.visible = String(visible);
    const win = view.historyHost.ownerDocument.defaultView;
    if (oldVisible === undefined || oldVisible === String(visible) || !win || win.matchMedia('(prefers-reduced-motion: reduce)')?.matches) {
      show();
      finish();
      return;
    }
    animating = true;
    if (view.historyButton) view.historyButton.disabled = true;
    if (view.newButton) view.newButton.disabled = true;
    const content = [view.deck, view.inputHost].filter((element): element is HTMLElement => !!element);
    const animate = async (elements: HTMLElement[], entering: boolean) => {
      animations = elements.map((element) => {
        element.style.pointerEvents = 'none';
        const offset = visible === entering ? '6px' : '-6px';
        return element.animate(
          entering
            ? [
                { opacity: 0, transform: `translateX(${offset})` },
                { opacity: 1, transform: 'translateX(0)' },
              ]
            : [
                { opacity: 1, transform: 'translateX(0)' },
                { opacity: 0, transform: `translateX(${offset})` },
              ],
          { duration: entering ? 110 : 70, easing: 'ease-out' }
        );
      });
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    };
    void animate(visible ? content : [view.historyHost], false).then(async () => {
      if (id !== sequence) return;
      show();
      await animate(visible ? [view.historyHost] : content, true);
      finish();
    });
  }
  return {
    get visible() {
      return visible;
    },
    set visible(value: boolean) {
      visible = value;
    },
    get animating() {
      return animating;
    },
    clear,
    startNew,
    update,
    toggle(session: Session | undefined) {
      if (!session || session.kind === 'translation' || session.pending.abortController || animating) return false;
      visible = !visible;
      return true;
    },
    dispose() {
      sequence++;
      stopAnimations();
      if (currentView) {
        disposePanel(currentView);
        for (const element of [currentView.deck, currentView.inputHost, currentView.historyHost]) if (element) element.style.pointerEvents = '';
      }
      currentView = undefined;
      visible = false;
      animating = false;
    },
  };
}
