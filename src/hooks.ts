import { initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import {
  registerAIBarStyleSheet,
  registerReaderInitializer,
} from "./modules/readerBarPopup";
import { onModelDialogLoad } from "./modules/modelDialog";
import { onPromptEditorLoad } from "./modules/promptEditor";
import { getPref, registerPrefs } from "./utils/prefs";
import { ensureChatWindowReady } from "./utils/window";
import { registerReaderItemPaneSection } from "./modules/readerItemPane";
import { clearDeadChatWindowRef, isWindowAlive } from "./utils/window";
import { registerTabObserver } from "./modules/tabObserver";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  addon.chatManager.chatHostMode = addon.chatManager.getCurrentHostMode();
  addon.chatManager.ensureRequestMaps();

  if (
    getPref("chat.openOnStartup") === true &&
    addon.chatManager.getCurrentHostMode() === "window"
  ) {
    await ensureChatWindowReady();
  }

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

  registerTabObserver();
  addon.chatManager.currentTabID = win.Zotero_Tabs.selectedID;
  registerAIBarStyleSheet(win);
  // await HelperExampleFactory.dialogExample();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const llmConfig = getPref("llm.providerConfigs");
  if (llmConfig)
    addon.data.userProviderConfigs = JSON.parse(getPref("llm.providerConfigs"));

  // Load user custom prompts
  const userPromptsConfig = getPref("prompt.userPrompts");
  if (userPromptsConfig) {
    addon.data.userPrompts = JSON.parse(userPromptsConfig);
  }

  if (addon.chatManager.getCurrentHostMode() === "sidebar") {
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
  if (isWindowAlive(addon.chatManager.chatWindow)) {
    addon.chatManager.chatWindow?.close();
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
    case "promptEditorLoad":
      onPromptEditorLoad(data.window);
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

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise, the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
};
