import { assert } from 'chai';
import { config } from '../../package.json';

describe('translation cancellation in isolated Zotero', function () {
  let plugin: typeof addon;
  let wrapper: HTMLElement;
  let states: boolean[];
  let originalSeparateTab: unknown;
  const sourceTabId = 'translation-stop-test';
  const sessionId = `article:${sourceTabId}`;
  let pref: string;

  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    plugin = (Zotero as any).ZAIBar;
    pref = `${config.prefsPrefix}.translate.separateTab`;
  });

  beforeEach(function () {
    originalSeparateTab = Zotero.Prefs.get(pref, true);
    Zotero.Prefs.set(pref, false, true);
    states = [];
    wrapper = Zotero.getMainWindow().document.createElement('div');
    wrapper.dataset.sessionId = sessionId;
    (wrapper as any)._inputAreaAPI = {
      setStreaming: (id: string, streaming: boolean) => {
        if (id === sessionId) states.push(streaming);
      },
    };
    plugin.data.sharedInputAreas.add(wrapper);
  });

  afterEach(function () {
    plugin.data.sharedInputAreas.delete(wrapper);
    plugin.chatManager.sessionsMap.delete(sessionId);
    if (originalSeparateTab === undefined) Zotero.Prefs.clear(pref, true);
    else Zotero.Prefs.set(pref, originalSeparateTab as boolean, true);
  });

  async function waitForStart(count: number) {
    for (let i = 0; i < 200; i++) {
      if (states.filter(Boolean).length >= count) return;
      await Zotero.Promise.delay(10);
    }
    assert.fail('Translation did not enter the streaming state');
  }

  function translate() {
    return plugin.chatManager.sendTranslationRequest({
      selectedText: 'LA',
      targetLanguage: 'zh-CN',
      sourceTabId,
      isFromPopup: true,
      contextPromise: new Promise<string[] | undefined>(() => undefined),
    });
  }

  async function expectStopped(request: Promise<void>) {
    // Longer than a normal event-loop turn, shorter than the context timeout.
    let settled = false;
    const completion = request.then(() => {
      settled = true;
    });
    await Promise.race([completion, Zotero.Promise.delay(1000)]);
    assert.isTrue(settled, 'Stop must not wait for the PDF context timeout');
    assert.isFalse(states.at(-1), 'Restore the Send button state');
    const session = plugin.chatManager.sessionsMap.get(sessionId)!;
    assert.isUndefined(session.activeRequestPromise);
    assert.isUndefined(session.pending.abortController);
    assert.isEmpty(session.conversationHistory);
  }

  it('stops while the PDF worker is pending and permits another translation', async function () {
    for (const count of [1, 2]) {
      const request = translate();
      await waitForStart(count);
      // This is the same cancellation path used by the input Stop button.
      plugin.chatManager.sessionsMap.get(sessionId)!.pending.abortController!.abort();
      await expectStopped(request);
    }
  });

  it('supersedes a pending popup translation without waiting for its PDF worker', async function () {
    const first = translate();
    await waitForStart(1);
    const second = translate();
    await waitForStart(2);
    await first;
    assert.deepEqual(states.slice(0, 3), [true, false, true]);
    plugin.chatManager.sessionsMap.get(sessionId)!.pending.abortController!.abort();
    await expectStopped(second);
  });
});
