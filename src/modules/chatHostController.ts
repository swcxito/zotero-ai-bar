import type { ChatHostMode } from './chatManager';
import { openSidePane, registerMainWindowSidePane, refreshChatToolbarButton, unregisterMainWindowSidePane } from './mainWindowSidePane';
import { closeChatWindowForHostSwitch, ensureChatWindowReady, focusChatWindow, isWindowAlive } from '../utils/window';
import { setPref } from '../utils/prefs';

export interface ChatHostControllerDependencies {
  getMode: () => ChatHostMode;
  hasActiveRequests: () => boolean;
  activate: (mode: ChatHostMode) => Promise<void> | void;
  deactivate: (mode: ChatHostMode) => Promise<void> | void;
  commitMode: (mode: ChatHostMode) => Promise<void> | void;
  refresh: () => Promise<void> | void;
  log?: (message: string, error?: unknown) => void;
}

export interface ChatHostController {
  switchChatHost: (target: ChatHostMode) => Promise<boolean>;
  isSwitching: () => boolean;
  isBlocked: () => boolean;
}

/**
 * Build the serialized host transition state machine. Dependencies are
 * injected so rollback and concurrent-click behavior can be tested without a
 * live Zotero window.
 */
export function createChatHostController(deps: ChatHostControllerDependencies): ChatHostController {
  let transition: Promise<boolean> | undefined;

  const switchChatHost = (target: ChatHostMode): Promise<boolean> => {
    if (transition) return transition;
    if (deps.hasActiveRequests()) return Promise.resolve(false);

    const previous = deps.getMode();
    if (previous === target) {
      transition = Promise.resolve(deps.activate(target))
        .then(async () => {
          await deps.refresh();
          return true;
        })
        .catch((error) => {
          deps.log?.(`[chatHost] failed to activate ${target}`, error);
          return false;
        })
        .finally(() => {
          transition = undefined;
        });
      return transition;
    }

    transition = (async () => {
      let previousDeactivated = false;
      try {
        await deps.deactivate(previous);
        previousDeactivated = true;
        await deps.activate(target);
        await deps.commitMode(target);
        await deps.refresh();
        return true;
      } catch (error) {
        deps.log?.(`[chatHost] failed to switch from ${previous} to ${target}`, error);
        if (previousDeactivated) {
          try {
            await deps.deactivate(target);
          } catch (cleanupError) {
            deps.log?.(`[chatHost] failed to clean up ${target} after rollback`, cleanupError);
          }
        }
        try {
          await deps.activate(previous);
          await deps.commitMode(previous);
          await deps.refresh();
        } catch (rollbackError) {
          deps.log?.(`[chatHost] failed to restore ${previous}`, rollbackError);
        }
        return false;
      }
    })().finally(() => {
      transition = undefined;
    });
    return transition;
  };

  return {
    switchChatHost,
    isSwitching: () => !!transition,
    isBlocked: () => !!transition || deps.hasActiveRequests(),
  };
}

function hasActiveRequests(): boolean {
  return Array.from(addon.chatManager.sessionsMap.values()).some((session) => !!session.activeRequestPromise || !!session.pending.abortController);
}

function getMainWindow(): _ZoteroTypes.MainWindow {
  const win = Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined;
  if (!win || (win as unknown as Window).closed) throw new Error('Zotero main window is unavailable.');
  return win;
}

async function activateHost(mode: ChatHostMode): Promise<void> {
  if (mode === 'window') {
    const win = await ensureChatWindowReady();
    if (!isWindowAlive(win) || !win.document.querySelector('.zaibar-window-deck')) {
      throw new Error('Standalone chat window did not become ready.');
    }
    focusChatWindow();
    return;
  }

  const win = getMainWindow();
  registerMainWindowSidePane(win);
  if (!addon.data.sidePaneElements) throw new Error('Sidebar host could not be mounted.');
  openSidePane();
}

async function deactivateHost(mode: ChatHostMode): Promise<void> {
  if (mode === 'window') {
    await closeChatWindowForHostSwitch();
    addon.data.sidePaneBodyMap?.clear();
    return;
  }
  unregisterMainWindowSidePane(undefined, { removeToolbar: false });
}

function commitHostMode(mode: ChatHostMode): void {
  addon.chatManager.chatHostMode = mode;
  setPref('chat.location', mode);
}

function refreshHostChrome(): void {
  const win = Zotero.getMainWindow() as _ZoteroTypes.MainWindow | undefined;
  if (win) refreshChatToolbarButton(win);
}

const controller = createChatHostController({
  getMode: () => addon.chatManager.getCurrentHostMode(),
  hasActiveRequests,
  activate: activateHost,
  deactivate: deactivateHost,
  commitMode: commitHostMode,
  refresh: refreshHostChrome,
  log: (message, error) => ztoolkit.log(message, error),
});

export function switchChatHost(target: ChatHostMode): Promise<boolean> {
  return controller.switchChatHost(target);
}

export function isChatHostSwitchBlocked(): boolean {
  return controller.isBlocked();
}

/** Native window-close fallback. Normal programmatic closes are suppressed in window.ts. */
export async function handleStandaloneChatWindowClosed(): Promise<void> {
  addon.chatManager.chatWindow = undefined;
  if (addon.chatManager.getCurrentHostMode() !== 'window') return;

  const active = Array.from(addon.chatManager.sessionsMap.values()).filter(
    (session) => !!session.activeRequestPromise || !!session.pending.abortController
  );
  for (const session of active) session.pending.abortController?.abort();
  await Promise.allSettled(active.map((session) => session.activeRequestPromise).filter((promise): promise is Promise<void> => !!promise));
  await switchChatHost('sidebar');
}
