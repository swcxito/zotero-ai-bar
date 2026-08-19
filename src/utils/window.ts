import { config } from '../../package.json';
import { ensureChatWindowUI, onChatWindowLoad } from '../modules/chatWindowHost';
import { ChatWindowCloseCoordinator } from './chatWindowClose';
import { getPref } from './prefs';

export { isWindowAlive, ensureChatWindow, ensureChatWindowReady, focusChatWindow, clearDeadChatWindowRef, closeChatWindowForHostSwitch };

const closeCoordinator = new ChatWindowCloseCoordinator<Window>();

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function clearDeadChatWindowRef() {
  if (!isWindowAlive(addon.chatManager.chatWindow)) {
    addon.chatManager.chatWindow = undefined;
  }
}

function ensureChatWindow() {
  clearDeadChatWindowRef();
  if (isWindowAlive(addon.chatManager.chatWindow)) {
    return addon.chatManager.chatWindow as Window;
  }

  const alwaysOnTop = getPref('chat.windowAlwaysOnTop');

  const windowArgs: {
    onBodyLoaded: (win: Window) => void;
    onWindowClosed: (win: Window) => void;
    shouldPreventClose: (win: Window) => boolean;
  } = {
    onBodyLoaded: onChatWindowLoad,
    onWindowClosed: (win) => {
      addon.chatManager.chatWindow = undefined;
      if (closeCoordinator.consumeProgrammatic(win)) return;
      void import('../modules/chatHostController').then(({ handleStandaloneChatWindowClosed }) => handleStandaloneChatWindowClosed());
    },
    shouldPreventClose: (win) =>
      closeCoordinator.shouldPrevent(
        win,
        Array.from(addon.chatManager.sessionsMap.values()).some((session) => !!session.activeRequestPromise || !!session.pending.abortController)
      ),
  };

  const dialogWindow = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/chatWindow.html`,
    `${config.addonRef}-chat-window`,
    ['chrome', 'centerscreen', 'resizable', 'status', 'dialog=no', 'width=500', 'height=720', alwaysOnTop ? 'alwaysontop=yes' : '']
      .filter(Boolean)
      .join(','),
    windowArgs
  );

  if (!dialogWindow) {
    throw new Error('Failed to open chat window.');
  }

  addon.chatManager.chatWindow = dialogWindow;
  return dialogWindow;
}

function isChatWindowReady(chatWindow: Window) {
  if (!isWindowAlive(chatWindow)) return false;
  const doc = chatWindow.document;
  if (!doc) return false;
  if (doc.readyState !== 'complete') return false;
  ensureChatWindowUI(doc);
  return !!doc.querySelector('.zaibar-window-deck');
}

async function ensureChatWindowReady(timeoutMs = 3000) {
  const chatWindow = ensureChatWindow();
  if (isChatWindowReady(chatWindow)) {
    return chatWindow;
  }

  await new Promise<void>((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    const timer = setTimeout(() => {
      chatWindow.removeEventListener('load', onLoad);
      finish();
    }, timeoutMs);

    const onLoad = () => {
      clearTimeout(timer);
      finish();
    };

    chatWindow.addEventListener('load', onLoad, { once: true });
  });

  if (isWindowAlive(chatWindow)) {
    ensureChatWindowUI(chatWindow.document);
  }
  return chatWindow;
}

function focusChatWindow() {
  const chatWindow = ensureChatWindow();
  chatWindow.focus();
  return chatWindow;
}

async function closeChatWindowForHostSwitch(): Promise<void> {
  clearDeadChatWindowRef();
  const chatWindow = addon.chatManager.chatWindow;
  if (!isWindowAlive(chatWindow)) return;
  closeCoordinator.markProgrammatic(chatWindow as Window);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    chatWindow!.addEventListener('unload', finish, { once: true });
    chatWindow!.close();
    Zotero.getMainWindow().setTimeout(finish, 500);
  });
  addon.chatManager.chatWindow = undefined;
}
