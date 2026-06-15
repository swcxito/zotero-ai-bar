import { BasicTool } from 'zotero-plugin-toolkit';
import Addon from './addon';
import { config } from '../package.json';

const basicTool = new BasicTool();

// @ts-expect-error - Plugin instance is not typed
if (!basicTool.getGlobal('Zotero')[config.addonInstance]) {
  try {
    _globalThis.addon = new Addon();
    Zotero.debug(`[${config.addonRef}] index.ts: Addon instance created`);
    Services.console.logStringMessage(`[zaibar-index] Addon instance created`);
    defineGlobal('ztoolkit', () => {
      return _globalThis.addon.data.ztoolkit;
    });
    // @ts-expect-error - Plugin instance is not typed
    Zotero[config.addonInstance] = addon;
    Zotero.debug(`[${config.addonRef}] index.ts: Zotero.${config.addonInstance} registered`);
    Services.console.logStringMessage(`[zaibar-index] Zotero.${config.addonInstance} registered`);
  } catch (e: any) {
    const msg = `[${config.addonRef}] index.ts: Failed to create Addon: ${e?.message || e}`;
    Zotero.debug(msg);
    Services.console.logStringMessage(msg);
    throw e;
  }
} else {
  Zotero.debug(`[${config.addonRef}] index.ts: Plugin instance already exists`);
  Services.console.logStringMessage('[zaibar-index] Plugin instance already exists');
}

function defineGlobal(name: Parameters<BasicTool['getGlobal']>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
