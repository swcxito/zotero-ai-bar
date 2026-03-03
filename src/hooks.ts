import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import {
  registerAIBarStyleSheet,
  registerReaderInitializer,
} from "./modules/readerBarPopup";
import { onModelDialogLoad } from "./modules/modelDialog";
import { getPref, registerPrefs } from "./utils/prefs";
import {
  registerReaderItemPaneSection,
  resizeReaderItemPaneHeight,
} from "./modules/readerItemPane";
import {
  CHAT_WINDOW_MESSAGE_CONTAINER_ID,
  ensureChatWindowUI,
} from "./modules/chatWindowHost";
import { ChatBox } from "./components/chatBox";
import { renderMarkdown } from "./utils/markdown";
import { streamLLM } from "./utils/llmRequest";
import {
  clearDeadChatWindowRef,
  ensureChatWindow,
  isWindowAlive,
} from "./utils/window";

const chatPopMap = new Map<string, Element>();

function getCurrentHostMode() {
  const location = addon.data.chatHostMode || getPref("chat.location");
  return location === "window" ? "window" : "sidebar";
}

function ensureRequestMaps() {
  if (!addon.data.requestHostMap) addon.data.requestHostMap = new Map();
  if (!addon.data.requestSourceMap) addon.data.requestSourceMap = new Map();
}

function getMessageContainerByRequest(requestId: string) {
  const route = addon.data.requestHostMap?.get(requestId);
  const mode = route?.mode || getCurrentHostMode();

  if (mode === "window") {
    const chatWindow = ensureChatWindow();
    ensureChatWindowUI(chatWindow.document);
    return chatWindow.document.querySelector(
      `#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`,
    ) as HTMLElement | null;
  }

  if (!addon.data.sectionMap) return null;
  const sectionId = route?.sectionId ?? addon.data.currentSection;
  const body = addon.data.sectionMap.get(sectionId ?? "");
  if (!body) return null;
  const root = body.querySelector("#ai-bar-chat-root");
  if (!root?.shadowRoot) return null;

  resizeReaderItemPaneHeight(body, "maximize");
  return root.shadowRoot.querySelector(".message-container") as HTMLElement;
}

function cleanupRequestData(requestId: string) {
  addon.data.requestHostMap?.delete(requestId);
  addon.data.requestSourceMap?.delete(requestId);
}

async function regenerateResponse() {
  const messagesPromise = addon.data.lastMessagesPromise;
  if (!messagesPromise) return;

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  ensureRequestMaps();
  addon.data.requestHostMap?.set(requestId, {
    mode: addon.data.lastRequestHost?.mode || getCurrentHostMode(),
    sectionId:
      addon.data.lastRequestHost?.sectionId ?? addon.data.currentSection,
  });
  addon.data.requestSourceMap?.set(
    requestId,
    addon.data.lastRequestSource || "Unknown Source",
  );

  await streamLLM(messagesPromise, {
    onStart: () => {
      onLLMStreamStart({ requestId });
    },
    onUpdate: async (fullText) => {
      onLLMStreamUpdate({ requestId, fullText });
    },
    onEnd: () => {
      onLLMStreamEnd({ requestId });
    },
    onError: (error) => {
      onLLMStreamError({ requestId, error });
    },
  });
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  addon.data.chatHostMode = getCurrentHostMode();
  ensureRequestMaps();

  registerReaderInitializer();

  registerPrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // UIExampleFactory.registerStyleSheet(win);
  registerAIBarStyleSheet(win);
  // await HelperExampleFactory.dialogExample();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const llmConfig = getPref("llm.providerConfigs");
  if (llmConfig)
    addon.data.userProviderConfigs = JSON.parse(getPref("llm.providerConfigs"));
  if (getCurrentHostMode() === "sidebar") {
    await registerReaderItemPaneSection();
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  clearDeadChatWindowRef();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  if (isWindowAlive(addon.data.chatWindow)) {
    addon.data.chatWindow?.close();
  }
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this function clear.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // You can add your code to the corresponding to notify type
  ztoolkit.log("notify", event, type, ids, extraData);
  if (
    event == "select" &&
    type == "tab" &&
    extraData[ids[0]].type == "reader"
  ) {
    // BasicExampleFactory.exampleNotifierCallback();
  } else {
    return;
  }
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this function clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    case "modelDialogLoad":
      onModelDialogLoad(data.window);
      ztoolkit.log("model dialog load hook called");
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    case "larger":
      // KeyExampleFactory.exampleShortcutLargerCallback();
      break;
    case "smaller":
      // KeyExampleFactory.exampleShortcutSmallerCallback();
      break;
    default:
      break;
  }
}

function onDialogEvents(type: string) {
  switch (type) {
    case "dialogExample":
      // HelperExampleFactory.dialogExample();
      break;
    case "clipboardExample":
      // HelperExampleFactory.clipboardExample();
      break;
    case "filePickerExample":
      // HelperExampleFactory.filePickerExample();
      break;
    case "progressWindowExample":
      // HelperExampleFactory.progressWindowExample();
      break;
    case "vtableExample":
      // HelperExampleFactory.vtableExample();
      break;
    default:
      break;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise, the code would be hard to read and maintain.

// Callbacks for LLM streaming events
function onLLMStreamStart(data: { requestId: string }) {
  ztoolkit.log("LLM stream started:", data.requestId);

  const container = getMessageContainerByRequest(data.requestId);
  if (!container) return;

  const doc = container.ownerDocument;
  if (!doc) return;

  const pop = ChatBox({
    doc,
    annotation: addon.data.currentAnnotation,
    isUser: false,
    onRegenerate: () => regenerateResponse(),
  }) as HTMLElement;
  pop.setAttribute("data-request-id", data.requestId);

  const chatMessage = pop.querySelector(".chat-message") as HTMLElement | null;
  if (chatMessage) {
    const sourceLabel = addon.data.requestSourceMap?.get(data.requestId);
    if (sourceLabel) {
      const sourceEl = doc.createElement("div");
      sourceEl.classList.add(
        "text-xs",
        "tracking-wider",
        "font-semibold",
        "text-slate-400",
        "dark:text-neutral-500",
        "mb-1",
      );
      sourceEl.textContent = `Source: ${sourceLabel}`;
      chatMessage.appendChild(sourceEl);
    }

    const contentEl = doc.createElement("div");
    contentEl.classList.add("chat-message-content");
    contentEl.innerHTML = "Thinking...";
    chatMessage.appendChild(contentEl);
  }

  container.appendChild(pop);
  chatPopMap.set(data.requestId, pop);
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}

async function onLLMStreamUpdate(data: {
  requestId: string;
  fullText: string;
}) {
  // ztoolkit.log("LLM stream update:", data.requestId, data.fullText.length);
  const pop = chatPopMap.get(data.requestId);
  if (pop) {
    const chatMessage = pop.querySelector(".chat-message-content");
    if (chatMessage) {
      chatMessage.innerHTML = await renderMarkdown(data.fullText);
      (pop as HTMLElement).dataset.markdown = data.fullText;
    }
    const container = pop.parentElement;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }
}

function onLLMStreamEnd(data: { requestId: string }) {
  ztoolkit.log("LLM stream ended:", data.requestId);
  const pop = chatPopMap.get(data.requestId);
  if (pop) {
    const actions = pop.querySelector(".chat-actions");
    if (actions) {
      actions.classList.remove("hidden");
    }
  }
  cleanupRequestData(data.requestId);
}

function onLLMStreamError(data: { requestId: string; error: string }) {
  ztoolkit.log("LLM stream error:", data.requestId, data.error);
  const pop = chatPopMap.get(data.requestId);
  if (pop) {
    const actions = pop.querySelector(".chat-actions");
    if (actions) {
      actions.classList.remove("hidden");
    }
    const chatMessage = pop.querySelector(".chat-message-content");
    if (chatMessage) {
      chatMessage.innerHTML = `<div style="color: red; white-space: pre-wrap; word-break: break-word;">${data.error}</div>`;
    }
    const container = pop.parentElement;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }
  cleanupRequestData(data.requestId);
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
  onLLMStreamStart,
  onLLMStreamUpdate,
  onLLMStreamEnd,
  onLLMStreamError,
};
