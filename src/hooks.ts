import { initLocale } from './utils/locale';
import { registerPrefsScripts } from './modules/preferenceScript';
import { createZToolkit } from './utils/ztoolkit';
import { registerAIBarStyleSheet, registerKaTeXFontSheet, registerReaderInitializer, unregisterReaderInitializer } from './modules/readerBarPopup';
import { onModelDialogLoad } from './modules/modelDialog';
import { onPromptEditorLoad } from './modules/promptEditor';
import { getPref, setPref, registerPrefs } from './utils/prefs';
import { ensureChatWindowReady } from './utils/window';
import { registerChatToolbarButton, registerMainWindowSidePane, unregisterMainWindowSidePane } from './modules/mainWindowSidePane';
import { clearDeadChatWindowRef, isWindowAlive } from './utils/window';
import { registerTabObserver } from './modules/tabObserver';
import { preloadLLMRuntime } from './modules/llm';
import { convertLegacyLLMConfigByKey, ensureCommonProviders, initIconCache, loadV2Config, saveV2Config } from './utils/providers';
import { isReaderZoteroTab, updateSelectedZoteroTab } from './modules/chatWorkspace';

function zaibarDump(msg: string) {
  try {
    Services.console.logStringMessage(`[zaibar-hooks] ${msg}`);
  } catch (e) {
    Zotero.debug(`[zaibar-hooks] dump failed: ${e}`);
  }
}

async function onStartup() {
  const label = `[${addon.data?.config?.addonRef || 'zaibar'}] hooks.onStartup`;
  try {
    Zotero.debug(`${label} waiting for Zotero promises...`);
    zaibarDump('onStartup waiting for Zotero promises');
    await Promise.all([Zotero.initializationPromise, Zotero.unlockPromise, Zotero.uiReadyPromise]);
    Zotero.debug(`${label} Zotero promises resolved`);
    zaibarDump('Zotero promises resolved');

    initLocale();
    Zotero.debug(`${label} locale initialized`);
    zaibarDump('locale initialized');

    await preloadLLMRuntime();
    Zotero.debug(`${label} LLM runtime preloaded`);
    zaibarDump('LLM runtime preloaded');

    addon.chatManager.chatHostMode = addon.chatManager.getCurrentHostMode();
    updateSelectedZoteroTab(addon.chatManager.currentTabID, isReaderZoteroTab(addon.chatManager.currentTabID));

    registerReaderInitializer();
    registerPrefs();
    await Promise.all(Zotero.getMainWindows().map((win) => onMainWindowLoad(win)));

    // The standalone window renders ModelInfo immediately. Open it only
    // after onMainWindowLoad has loaded/migrated the provider configuration.
    if (getPref('chat.openOnStartup') && addon.chatManager.getCurrentHostMode() === 'window') {
      await ensureChatWindowReady();
    }

    // Mark initialized as true to confirm plugin loading status
    // outside the plugin (e.g. scaffold testing process)
    addon.data.initialized = true;
    Zotero.debug(`${label} completed, initialized=true`);
    zaibarDump('onStartup completed, initialized=true');
  } catch (e: any) {
    Zotero.debug(`${label} ERROR: ${e?.message || e}`);
    zaibarDump(`onStartup ERROR: ${e?.message || e}`);
    throw e;
  }
}
async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  const label = `[${addon.data?.config?.addonRef || 'zaibar'}] hooks.onMainWindowLoad`;
  try {
    Zotero.debug(`${label} started`);
    zaibarDump('onMainWindowLoad started');
    // Create ztoolkit for every window
    addon.data.ztoolkit = createZToolkit();
    // UIExampleFactory.registerStyleSheet(win);

    registerTabObserver();
    addon.chatManager.currentTabID = win.Zotero_Tabs.selectedID;
    updateSelectedZoteroTab(addon.chatManager.currentTabID, isReaderZoteroTab(addon.chatManager.currentTabID, win));
    Zotero.debug(`${label} currentTabID=${addon.chatManager.currentTabID}`);

    registerAIBarStyleSheet(win);
    registerKaTeXFontSheet(win);
    // await HelperExampleFactory.dialogExample();

    win.MozXULElement.insertFTLIfNeeded(`${addon.data.config.addonRef}-mainWindow.ftl`);

    // Config v2: load provider metadata, persisted config & icon cache in parallel
    Zotero.debug(`${label} loading v2 config...`);
    zaibarDump('loading v2 config...');
    const [, v2FromPref] = await Promise.all([ensureCommonProviders(), loadV2Config()]);
    if (v2FromPref) {
      addon.data.userProviderConfigV2 = v2FromPref;
      ztoolkit.log('[hooks] Loaded v2 config from pref:', {
        providers: Object.keys(v2FromPref.addedProviders),
        models: v2FromPref.addedModels.length,
        envKeys: Object.keys(v2FromPref.env),
      });
    } else {
      const llmConfig = getPref('llm.providerConfigs');
      ztoolkit.log('[hooks] No v2 pref, converting from legacy:', llmConfig);

      const userProviderConfigV2 = convertLegacyLLMConfigByKey(llmConfig, addon.data.commonProviders, getPref('llm.modelId'));
      addon.data.userProviderConfigV2 = userProviderConfigV2;
      await saveV2Config(userProviderConfigV2);
      ztoolkit.log('[hooks] Converted and persisted v2 config:', {
        providers: Object.keys(userProviderConfigV2.addedProviders),
        models: userProviderConfigV2.addedModels.length,
        envKeys: Object.keys(userProviderConfigV2.env),
      });
    }

    // Sync legacy llm.modelId to v2 composite format
    if (addon.data.userProviderConfigV2.active) {
      setPref('llm.modelId', `${addon.data.userProviderConfigV2.active.providerId}::${addon.data.userProviderConfigV2.active.modelId}`);
    }

    // Migrate chat.autoAttachFullText → chat.defaultMode (one-way).
    // agent.enabled is NOT migrated — the new default is 'normal' for everyone
    // who hadn't explicitly opted into full-text before.
    const legacyFullText = Zotero.Prefs.get(`${addon.data.config.prefsPrefix}.chat.autoAttachFullText`, true) as boolean | undefined;
    const legacyAgent = Zotero.Prefs.get(`${addon.data.config.prefsPrefix}.agent.enabled`, true) as boolean | undefined;
    if (legacyFullText !== undefined) {
      if (legacyFullText) {
        setPref('chat.defaultMode', 'full-text');
        ztoolkit.log('[hooks] Migrated chat.autoAttachFullText=true → chat.defaultMode=full-text');
      }
      Zotero.Prefs.clear(`${addon.data.config.prefsPrefix}.chat.autoAttachFullText`, true);
    }
    if (legacyAgent !== undefined) {
      Zotero.Prefs.clear(`${addon.data.config.prefsPrefix}.agent.enabled`, true);
    }

    // Load icon cache from file (with migration from legacy pref)
    await initIconCache();

    // Load user custom prompts
    const userPromptsConfig = getPref('prompt.userPrompts');
    if (userPromptsConfig) {
      addon.data.userPrompts = JSON.parse(userPromptsConfig);
    }

    registerChatToolbarButton(win);
    if (addon.chatManager.getCurrentHostMode() === 'sidebar') {
      registerMainWindowSidePane(win);
    }
    ztoolkit.log('stream', typeof TransformStream); // 应该是 "function"
    Zotero.debug(`${label} completed`);
    zaibarDump('onMainWindowLoad completed');
  } catch (e: any) {
    Zotero.debug(`${label} ERROR: ${e?.message || e}`);
    zaibarDump(`onMainWindowLoad ERROR: ${e?.message || e}`);
    throw e;
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  unregisterMainWindowSidePane(win);
  addon.data.dialog?.window?.close();
  clearDeadChatWindowRef();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  if (addon.data._tabObserverID) {
    Zotero.Notifier.unregisterObserver(addon.data._tabObserverID);
  }
  unregisterReaderInitializer();
  unregisterMainWindowSidePane();
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
async function onNotify(event: string, type: string, ids: Array<string | number>, extraData: { [key: string]: any }) {
  // You can add your code to the corresponding to notify type
  ztoolkit.log('notify', event, type, ids, extraData);
  if (event == 'select' && type == 'tab' && extraData[ids[0]].type == 'reader') {
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
    case 'load':
      registerPrefsScripts(data.window);
      break;
    case 'modelDialogLoad':
      onModelDialogLoad(data.window);
      ztoolkit.log('model dialog load hook called');
      break;
    case 'promptEditorLoad':
      onPromptEditorLoad(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  switch (type) {
    case 'larger':
      // KeyExampleFactory.exampleShortcutLargerCallback();
      break;
    case 'smaller':
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
