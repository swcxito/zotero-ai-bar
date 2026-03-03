import { config } from "../../package.json";
import {
  CHAT_WINDOW_MESSAGE_CONTAINER_ID,
  ensureChatWindowUI,
  onChatWindowLoad,
} from "../modules/chatWindowHost";
import { getPref } from "./prefs";

export {
  isWindowAlive,
  ensureChatWindow,
  ensureChatWindowReady,
  focusChatWindow,
  clearDeadChatWindowRef,
};

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

function clearDeadChatWindowRef() {
  if (!isWindowAlive(addon.data.chatWindow)) {
    addon.data.chatWindow = undefined;
  }
}

function ensureChatWindow() {
  clearDeadChatWindowRef();
  if (isWindowAlive(addon.data.chatWindow)) {
    return addon.data.chatWindow as Window;
  }

  const alwaysOnTop = getPref("chat.windowAlwaysOnTop");

  const windowArgs: {
    onBodyLoaded: (win: Window) => void;
    onWindowClosed: () => void;
  } = {
    onBodyLoaded: onChatWindowLoad,
    onWindowClosed: () => {
      addon.data.chatWindow = undefined;
    },
  };

  const dialogWindow = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/chatWindow.html`,
    `${config.addonRef}-chat-window`,
    [
      "chrome",
      "centerscreen",
      "resizable",
      "status",
      "dialog=no",
      "width=500",
      "height=720",
      alwaysOnTop ? "alwaysontop=yes" : "",
    ]
      .filter(Boolean)
      .join(","),
    windowArgs,
  );

  if (!dialogWindow) {
    throw new Error("Failed to open chat window.");
  }

  addon.data.chatWindow = dialogWindow;
  return dialogWindow;
}

function isChatWindowReady(chatWindow: Window) {
  if (!isWindowAlive(chatWindow)) return false;
  const doc = chatWindow.document;
  if (!doc) return false;
  if (doc.readyState !== "complete") return false;
  ensureChatWindowUI(doc);
  return !!doc.querySelector(`#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`);
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
      chatWindow.removeEventListener("load", onLoad);
      finish();
    }, timeoutMs);

    const onLoad = () => {
      clearTimeout(timer);
      finish();
    };

    chatWindow.addEventListener("load", onLoad, { once: true });
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
