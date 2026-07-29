import { config } from '../package.json';
import { ColumnOptions, DialogHelper } from 'zotero-plugin-toolkit';
import hooks from './hooks';
import { createZToolkit } from './utils/ztoolkit';
import { UserPrompt } from './types';
import type { CommonProviders, UserProviderConfigV2 } from './utils/providers';
import { ChatManager } from './modules/chatManager';

function resolveInitialTabID(): string {
  const initialTabID = Zotero.getMainWindow().Zotero_Tabs.selectedID;
  if (!initialTabID.trim()) {
    throw new Error('Failed to initialize ChatManager: selected tab ID is empty.');
  }
  return initialTabID;
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: 'development' | 'production';
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    dialog?: DialogHelper;
    selection: {
      text?: string;
      contextPromise?: Promise<Array<string> | undefined>;
      currentAnnotation?: _ZoteroTypes.Annotations.AnnotationJson;
      currentReader?: _ZoteroTypes.ReaderInstance<'pdf' | 'epub' | 'snapshot'>;
    };
    commonProviders?: CommonProviders;
    liveProviders?: CommonProviders;
    userProviderConfigV2?: UserProviderConfigV2;
    userPrompts?: UserPrompt[];
    // Map chat session IDs to their rendered host page (sidebar or window).
    sidePaneBodyMap?: Map<string, HTMLElement>;
    // One host-level input area per active chat host. Unlike message pages,
    // these are shared while switching article/translation/global sessions.
    sharedInputAreas: Set<HTMLElement>;
    // Injected main-window side pane elements (splitter + pane + deck).
    // Set by mainWindowSidePane.registerMainWindowSidePane, cleared on unregister.
    sidePaneElements?: { splitter: XULElement; pane: XULElement; deck: XULElement; tabs: HTMLElement };
    inputImages: Map<string, string[]>;
    _tabObserverID?: string;
    _readerPopupHandler?: (event: any) => void;
    // ModelInfo anchor elements across windows (sidebar, reader popup).
    // Refreshed when the active model changes anywhere.
    modelInfoAnchors: Set<HTMLElement>;
    refreshModelInfoAnchors?: () => void;
  };
  // Chat state and logic
  public chatManager: ChatManager;
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    try {
      this.data = {
        alive: true,
        config,
        env: __env__,
        initialized: false,
        ztoolkit: createZToolkit(),
        selection: {},
        inputImages: new Map<string, string[]>(),
        sharedInputAreas: new Set<HTMLElement>(),
        modelInfoAnchors: new Set<HTMLElement>(),
      };
      Services.console.logStringMessage('[zaibar-addon] data initialized');
      this.chatManager = new ChatManager(resolveInitialTabID());
      Services.console.logStringMessage('[zaibar-addon] ChatManager created');
      this.hooks = hooks;
      this.api = {};
      Zotero.debug(`[${config.addonRef}] Addon constructor finished`);
      Services.console.logStringMessage('[zaibar-addon] constructor finished');
    } catch (e: any) {
      const msg = `[${config.addonRef}] Addon constructor failed: ${e?.message || e}`;
      Zotero.debug(msg);
      Services.console.logStringMessage(msg);
      throw e;
    }
  }
}

export default Addon;
