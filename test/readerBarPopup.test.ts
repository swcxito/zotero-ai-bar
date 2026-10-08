import { assert } from 'chai';
import { config } from '../package.json';
import { formatPopupActionLabel, registerReaderInitializer, unregisterReaderInitializer } from '../src/modules/readerBarPopup';

describe('readerBarPopup', function () {
  it('formats localized quick actions with locale-appropriate brackets', function () {
    assert.equal(formatPopupActionLabel('解释', 'zh-CN'), '【解释】');
    assert.equal(formatPopupActionLabel('Explain', 'en-US'), '[Explain]');
  });

  describe('auto translation', function () {
    const scope = globalThis as any;
    let originalGlobals: { addon: any; ztoolkit: any };
    let originalHandler: typeof addon.data._readerPopupHandler;
    let originalSelection: typeof addon.data.selection;
    let originalSend: typeof addon.chatManager.sendTranslationRequest;
    let host: HTMLElement;
    let reader: any;
    let position: any;
    let requests: any[];
    const prefs = ['translate.enableAuto', 'extend-selection-context', 'translate.extendContext'];
    let originalPrefs: unknown[];

    before(function () {
      originalGlobals = { addon: scope.addon, ztoolkit: scope.ztoolkit };
      scope.addon = (Zotero as any)[config.addonInstance];
      scope.ztoolkit = scope.addon.data.ztoolkit;
    });

    after(function () {
      scope.addon = originalGlobals.addon;
      scope.ztoolkit = originalGlobals.ztoolkit;
    });

    beforeEach(function () {
      originalHandler = addon.data._readerPopupHandler;
      if (originalHandler) Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', originalHandler);
      originalSelection = addon.data.selection;
      addon.data.selection = {};
      originalSend = addon.chatManager.sendTranslationRequest;
      requests = [];
      addon.chatManager.sendTranslationRequest = async (request) => {
        requests.push(request);
      };
      originalPrefs = prefs.map((pref) => Zotero.Prefs.get(`${config.prefsPrefix}.${pref}`, true));
      for (const [index, value] of [true, false, 'never'].entries()) {
        Zotero.Prefs.set(`${config.prefsPrefix}.${prefs[index]}`, value, true);
      }
      const doc = Zotero.getMainWindow().document;
      host = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div') as HTMLElement;
      doc.documentElement!.appendChild(host);
      position = { pageIndex: 0, rects: [[10, 10, 100, 20]] };
      reader = { tabID: 'auto-translation-test', _internalReader: { _type: 'pdf', getSelectionPosition: () => position } };
      registerReaderInitializer();
    });

    afterEach(function () {
      unregisterReaderInitializer();
      host.remove();
      addon.data.selection = originalSelection;
      addon.chatManager.sendTranslationRequest = originalSend;
      prefs.forEach((pref, index) => {
        const name = `${config.prefsPrefix}.${pref}`;
        const value = originalPrefs[index];
        if (value === undefined) Zotero.Prefs.clear(name, true);
        else Zotero.Prefs.set(name, value as string | boolean, true);
      });
      addon.data._readerPopupHandler = originalHandler;
      if (originalHandler) Zotero.Reader.registerEventListener('renderTextSelectionPopup', originalHandler, config.addonID);
    });

    function render(text = 'Selected text', annotationPosition = position, source = reader) {
      host.replaceChildren();
      addon.data._readerPopupHandler!({
        reader: source,
        doc: host.ownerDocument,
        params: { annotation: { text, position: annotationPosition } },
        append: (fragment: Node) => host.appendChild(fragment),
      } as any);
    }

    const flush = () => Zotero.Promise.delay(20);

    it('translates a live selection once across repeated popup renders', async function () {
      render();
      render();
      await flush();
      render();
      await flush();
      assert.lengthOf(requests, 1);
      assert.equal(requests[0].selectedText, 'Selected text');
    });

    it('ignores stale annotation text when cancellation renders the popup', async function () {
      render();
      await flush();
      const oldPosition = position;
      position = null;
      render('Selected text', oldPosition);
      await flush();
      assert.lengthOf(requests, 1);
      assert.isUndefined(addon.data.selection.text);
      assert.isUndefined(addon.data.selection.currentAnnotation);
    });

    it('does not translate a selection cleared before the popup commits', async function () {
      render();
      position = null;
      await flush();
      assert.isEmpty(requests);
      assert.isUndefined(addon.data.selection.text);
    });

    it('does not translate a popup removed before the request starts', async function () {
      render();
      host.replaceChildren();
      await flush();
      assert.isEmpty(requests);
    });

    it('translates the same text at a new document position', async function () {
      render();
      await flush();
      position = { pageIndex: 1, rects: [[10, 10, 100, 20]] };
      render();
      await flush();
      assert.lengthOf(requests, 2);
    });

    it('allows selecting the same passage again after clearing it', async function () {
      render();
      await flush();
      const oldPosition = position;
      position = null;
      render('Selected text', oldPosition);
      position = oldPosition;
      render();
      await flush();
      assert.lengthOf(requests, 2);
    });

    it('uses the newest selection when it changes before translation starts', async function () {
      render('First selection');
      render('Second selection');
      await flush();
      assert.lengthOf(requests, 1);
      assert.equal(requests[0].selectedText, 'Second selection');
    });

    it('respects disabled auto translation and empty selections', async function () {
      Zotero.Prefs.set(`${config.prefsPrefix}.translate.enableAuto`, false, true);
      render();
      await flush();
      Zotero.Prefs.set(`${config.prefsPrefix}.translate.enableAuto`, true, true);
      render('  ');
      await flush();
      assert.isEmpty(requests);
    });
  });
});
