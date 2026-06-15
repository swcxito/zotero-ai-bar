/**
 * Most of this code is from Zotero team's official Make It Red example[1]
 * or the Zotero 7 documentation[2].
 * [1] https://github.com/zotero/make-it-red
 * [2] https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

function ensureWebStreamsGlobals(target) {
  const g = target || globalThis;
  const mainWin = Zotero.getMainWindow?.() || null;
  if (!mainWin) return;

  if (typeof g.console === 'undefined' && mainWin.console) {
    g.console = mainWin.console;
  }

  for (const name of ['TransformStream', 'ReadableStream', 'WritableStream', 'TextEncoder', 'TextDecoder', 'TextDecoderStream', 'DOMException']) {
    if (typeof g[name] === 'undefined' && mainWin[name]) {
      g[name] = mainWin[name];
    }
  }
}

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  Services.console.logStringMessage(`[zaibar-bootstrap] startup begin, version=${version}`);
  var aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1'].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + 'manifest.json');
  chromeHandle = aomStartup.registerChrome(manifestURI, [['content', '__addonRef__', rootURI + 'content/']]);

  /**
   * Global variables for plugin code.
   * The `_globalThis` is the global root variable of the plugin sandbox environment
   * and all child variables assigned to it is globally accessible.
   * See `src/index.ts` for details.
   */
  const ctx = { rootURI };
  ctx._globalThis = ctx;

  // Firefox 115 (Zotero 7) does not expose Web Streams in the addon sandbox,
  // but the bundled AI SDK needs them. Copy them from the main window before
  // loading the plugin bundle.
  try {
    ensureWebStreamsGlobals(ctx);
    Services.console.logStringMessage('[zaibar-bootstrap] Web Streams polyfill applied');
  } catch (e) {
    Services.console.logStringMessage(`[zaibar-bootstrap] Web Streams polyfill failed: ${e}`);
  }

  try {
    Services.console.logStringMessage(`[zaibar-bootstrap] loading sub-script ${rootURI}/content/scripts/__addonRef__.js`);
    Services.scriptloader.loadSubScript(`${rootURI}/content/scripts/__addonRef__.js`, ctx);
    Services.console.logStringMessage('[zaibar-bootstrap] sub-script loaded, awaiting onStartup...');
  } catch (e) {
    Services.console.logStringMessage(`[zaibar-bootstrap] FAILED to load sub-script: ${e}`);
    throw e;
  }

  try {
    await Zotero.__addonInstance__.hooks.onStartup();
    Services.console.logStringMessage('[zaibar-bootstrap] onStartup completed');
  } catch (e) {
    Services.console.logStringMessage(`[zaibar-bootstrap] onStartup FAILED: ${e}`);
    throw e;
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
