import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { UserProviderConfig, UserPrompt } from "./types";
import { ChatManager } from "./modules/chatManager";

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
    selectedText?: string;
    selectionContextPromise?: Promise<Array<string> | undefined>;
    userProviderConfigs?: UserProviderConfig[];
    userPrompts?: UserPrompt[];
    sidePaneMap?: Map<number, HTMLElement>;
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
    };
    this.chatManager = new ChatManager();
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
