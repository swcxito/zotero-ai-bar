import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import {
  registerAIBarStyleSheet,
  registerReaderInitializer,
} from "./modules/readerBarPopup";
import { onModelDialogLoad } from "./modules/modelDialog";
import { getPref, registerPrefs } from "./utils/prefs";
import { registerReaderItemPaneSection, resizeReaderItemPaneHeight } from "./modules/readerItemPane";
import { ChatBox } from "./components/chatBox";
import { renderMarkdown } from "./utils/markdown";

const chatPopMap = new Map<string, Element>();

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

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
  await registerReaderItemPaneSection();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
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

  if (!addon.data.sectionMap) return;

  // Find the first available shadowRoot to add chat popup
  const body = addon.data.sectionMap.get(addon.data.currentSection ?? "");
  if (body) {
    const root = body.querySelector("#ai-bar-chat-root");
    if (root?.shadowRoot) {
      const doc = body.ownerDocument;
      resizeReaderItemPaneHeight(body, "maximize");
      const container = root.shadowRoot.querySelector(".message-container");
      if (!doc || !container) return;
      const pop = ChatBox(doc, addon.data.currentAnnotation, false); // AI response should be false
      pop.setAttribute("data-request-id", data.requestId);
      const chatMessage = pop.querySelector(".chat-message");
      if (chatMessage) chatMessage.innerHTML = "Thinking...";
      container.appendChild(pop);
      chatPopMap.set(data.requestId, pop);

      const inputArea = root.shadowRoot.querySelector(".input-area");
      if (inputArea) {
        inputArea.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }
  }
}

async function onLLMStreamUpdate(data: {
  requestId: string;
  fullText: string;
}) {
  // ztoolkit.log("LLM stream update:", data.requestId, data.fullText.length);
  const pop = chatPopMap.get(data.requestId);
  if (pop) {
    const chatMessage = pop.querySelector(".chat-message");
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
}

function onLLMStreamError(data: { requestId: string; error: string }) {
  ztoolkit.log("LLM stream error:", data.requestId, data.error);
  const pop = chatPopMap.get(data.requestId);
  if (pop) {
    const actions = pop.querySelector(".chat-actions");
    if (actions) {
      actions.classList.remove("hidden");
    }
    const doc = pop.ownerDocument!;
    const errorDiv = doc.createElement("div");
    errorDiv.style.color = "red";
    errorDiv.style.marginTop = "8px";
    errorDiv.textContent = `Error: ${data.error}`;
    pop.appendChild(errorDiv);
    const container = pop.parentElement;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }
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
