import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { UserPrompt } from "./types";
import type { CommonProviders, UserProviderConfigV2 } from "./utils/providers";
import { ChatManager } from "./modules/chatManager";

function resolveInitialTabID(): string {
  const initialTabID = Zotero.getMainWindow().Zotero_Tabs.selectedID;
  if (!initialTabID.trim()) {
    throw new Error(
      "Failed to initialize ChatManager: selected tab ID is empty.",
    );
  }
  return initialTabID;
}

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
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
      currentReader?: _ZoteroTypes.ReaderInstance<"pdf" | "epub" | "snapshot">;
    };
    commonProviders?: CommonProviders;
    liveProviders?: CommonProviders;
    userProviderConfigV2?: UserProviderConfigV2;
    userPrompts?: UserPrompt[];
    // map tab IDs to their side pane root elements
    sidePaneBodyMap?: Map<string, HTMLElement>;
  };
  // Chat state and logic
  public chatManager: ChatManager;
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      selection: {},
    };
    this.chatManager = new ChatManager(resolveInitialTabID());
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
