import { assert } from 'chai';
import { codexRuntime, codexDirectory, runtimeNetworkEnvironment } from '../../src/modules/codex/runtime';
import { codexSettingsListeners, publishModels } from '../../src/modules/codex/settings';
import { maskAccountEmail } from '../../src/components/codexCardHeader';
import { openDialog } from '../../src/modules/modelDialog';
import { CODEX_PROVIDER_ID } from '../../src/modules/codex/policy';
import { CodexRpc } from '../../src/modules/codex/protocol';
import { getString } from '../../src/utils/locale';

describe('Codex in isolated Zotero', function () {
  before(function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = (Zotero as any).ZAIBar.data.ztoolkit;
  });

  after(async function () {
    await codexRuntime.stop();
  });

  it('masks short and long email prefixes without exposing the original account', function () {
    assert.equal(maskAccountEmail('abc@gmail.com'), 'a***@gmail.com');
    assert.equal(maskAccountEmail('abcd@gmail.com'), 'a***@gmail.com');
    assert.equal(maskAccountEmail('abcde@gmail.com'), 'a***e@gmail.com');
    assert.equal(maskAccountEmail('a@gmail.com'), 'a***@gmail.com');
    assert.equal(maskAccountEmail('invalid'), '***');
  });

  it('detects the installed native runtime through Gecko Subprocess', async function () {
    const result = await codexRuntime.detect();
    assert.isDefined(result, `${codexRuntime.status}: ${codexRuntime.diagnostics.join('; ')}`);
    assert.equal(result!.source, 'desktop');
    assert.include(codexDirectory(), PathUtils.profileDir);
  });

  it('initializes the app-server over stdio without a shared login', async function () {
    const rpc = await codexRuntime.connect();
    const account = await rpc.request('account/read', { refreshToken: false });
    assert.isNull(account.account);
    assert.include(codexRuntime.status, '尚未登录');
  });

  it('resolves the default Zotero system proxy without a manual plugin setting', async function () {
    assert.equal(Services.prefs.getIntPref('network.proxy.type'), 5);
    const network = await runtimeNetworkEnvironment();
    assert.isTrue(!network.HTTPS_PROXY || /^(https?|socks5h|socks4a):\/\//.test(network.HTTPS_PROXY));
  });

  it('places the ChatGPT connection button before Add Provider and only shows a connected card', async function () {
    const previous = addon.data.userProviderConfigV2;
    addon.data.userProviderConfigV2 = { addedProviders: {}, addedModels: [], env: {}, recentUsed: [] } as any;
    let dialog: Window | undefined;
    try {
      await openDialog();
      for (let i = 0; i < 50; i++) {
        await Zotero.Promise.delay(100);
        for (const win of Services.wm.getEnumerator(null)) {
          if ((win as Window).document?.getElementById('connect-chatgpt-button')) dialog = win as Window;
        }
        if (dialog?.document.getElementById('connect-chatgpt-icon')?.childElementCount) break;
      }
      assert.isDefined(dialog);
      const doc = dialog!.document;
      assert.equal(doc.getElementById('connect-chatgpt-button')?.nextElementSibling?.id, 'add-provider-button');
      assert.isNull(doc.getElementById('codex-provider-card'));
      addon.data.userProviderConfigV2!.addedProviders[CODEX_PROVIDER_ID] = { id: CODEX_PROVIDER_ID, name: 'Codex 订阅', env: [] };
      for (const listener of codexSettingsListeners) listener();
      assert.isNull(doc.getElementById('codex-provider-card'), 'Saved metadata without login must not show a card');
      assert.isTrue(doc.getElementById('codex-connection-panel')!.hidden);
      codexRuntime.account = { type: 'chatgpt', email: 'fixture@example.org', planType: 'plus' };
      codexRuntime.models = [
        {
          id: 'fixture',
          model: 'fixture',
          displayName: 'Fixture model',
          inputModalities: ['text'],
          supportedReasoningEfforts: [],
          defaultReasoningEffort: 'none',
        },
      ];
      await publishModels();
      for (const listener of codexSettingsListeners) listener();
      assert.equal(doc.getElementById('provider-block')?.firstElementChild?.id, 'codex-provider-card');
      const card = doc.getElementById('codex-provider-card')!;
      assert.isTrue((doc.getElementById('connect-chatgpt-button') as HTMLButtonElement).disabled);
      assert.isTrue(card.classList.contains('provider-card'), 'Reuse the shared provider card');
      assert.include(card.firstElementChild!.textContent!, getString('codex-card-title'));
      assert.include(card.firstElementChild!.textContent!, 'f***e@example.org');
      assert.notInclude(card.textContent!, 'fixture@example.org');
      assert.include(card.firstElementChild!.textContent!, 'Plus');
      const badge = card.firstElementChild!.querySelector('.rounded-full.border') as HTMLElement;
      assert.isNotNull(badge);
      assert.isTrue(badge.classList.contains('h-4'), 'Plan badge matches the email line height');
      assert.isTrue(badge.classList.contains('box-border'), 'Plan badge height includes its border');
      const nameInput = card.querySelector('.model-card-list input[type="text"]') as HTMLInputElement;
      assert.isNotNull(nameInput);
      assert.isTrue(nameInput.classList.contains('pointer-events-none'), 'Model name is display-only text, not a click target');
      const headText = card.firstElementChild!.querySelector('div.flex-col') as HTMLElement;
      assert.isTrue(headText.classList.contains('gap-1'), 'ChatGPT head rows use the tighter row gap');
      const rowIconWrapper = card.querySelector('.model-card-list [data-model-id] > div > span') as HTMLElement;
      assert.isTrue(
        rowIconWrapper.classList.contains('items-center') && rowIconWrapper.classList.contains('justify-center'),
        'Model row icon is centered in its wrapper'
      );
      const tailButton = card.querySelector('.provider-card-collapse') as HTMLButtonElement;
      assert.isTrue(tailButton.classList.contains('inline-flex'), 'Head icon button centers its icon');
      assert.include(card.lastElementChild!.textContent!, 'Models');
      assert.lengthOf(card.querySelectorAll('.model-card-list button'), 1, 'Only the refresh button, no model deletion buttons');
      const collapse = card.querySelector('.provider-card-collapse') as HTMLButtonElement;
      collapse.click();
      assert.isTrue(card.lastElementChild!.classList.contains('grid-rows-[0fr]'));
      collapse.click();
      assert.isTrue(card.lastElementChild!.classList.contains('grid-rows-[1fr]'));
      const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.click();
      assert.isFalse(addon.data.userProviderConfigV2!.addedModels[0].enabled);
      const mountedRow = card.querySelector('.model-card-list > div > div') as HTMLElement;
      codexRuntime.models[0].displayName = 'Updated fixture model';
      await publishModels();
      assert.strictEqual(
        card.querySelector('.model-card-list > div > div'),
        mountedRow,
        'Republishing models must keep the mounted row instead of rebuilding the card'
      );
      assert.isTrue(mountedRow.isConnected, 'Model row stays mounted while models are republished');
      assert.isFalse((doc.querySelector('#codex-provider-card input[type="checkbox"]') as HTMLInputElement).checked);
      assert.equal((doc.querySelector('#codex-provider-card input[type="text"]') as HTMLInputElement).value, 'Updated fixture model');
      const panel = doc.getElementById('codex-connection-panel') as HTMLElement;
      const refreshModels = doc.getElementById('codex-refresh-models') as HTMLButtonElement;
      assert.isTrue(panel.hidden);
      const originalRefresh = codexRuntime.refreshAccount;
      try {
        codexRuntime.refreshAccount = async () => {
          codexRuntime.changed();
        };
        refreshModels.click();
        assert.isTrue(panel.hidden, 'Refreshing models must not reveal the connection panel');
        await Zotero.Promise.delay(0);
        for (let i = 0; i < 50 && refreshModels.disabled; i++) await Zotero.Promise.delay(100);
      } finally {
        codexRuntime.refreshAccount = originalRefresh;
      }
      assert.isTrue(panel.hidden, 'Connection panel stays hidden once the refresh settles');
      const remove = doc.querySelector('#codex-provider-card button') as HTMLButtonElement;
      remove.click();
      for (let i = 0; i < 50 && addon.data.userProviderConfigV2!.addedProviders[CODEX_PROVIDER_ID]; i++) await Zotero.Promise.delay(100);
      assert.isNull(doc.getElementById('codex-provider-card'));
      assert.isUndefined(addon.data.userProviderConfigV2!.addedProviders[CODEX_PROVIDER_ID]);
      assert.isFalse((doc.getElementById('connect-chatgpt-button') as HTMLButtonElement).disabled);
    } finally {
      dialog?.close();
      await Zotero.Promise.delay(100);
      addon.data.userProviderConfigV2 = previous;
    }
  });

  it('waits for browser authorization and handles success, failure, cancellation and timeout', async function () {
    const originalConnect = codexRuntime.connect;
    const originalLaunch = Zotero.launchURL;
    const originalRpc = codexRuntime.rpc;
    try {
      Zotero.launchURL = (() => {}) as typeof Zotero.launchURL;
      for (const outcome of ['success', 'failure', 'cancel', 'timeout', 'disconnect']) {
        const requests: string[] = [];
        const rpc = new CodexRpc(async (text) => {
          const message = JSON.parse(text);
          requests.push(message.method);
          const result =
            message.method === 'account/login/start'
              ? { loginId: 'test-login', authUrl: 'https://auth.openai.com/test' }
              : message.method === 'account/read'
                ? { account: { type: 'chatgpt', email: 'fixture@example.org' } }
                : { data: [], nextCursor: null };
          rpc.feed(JSON.stringify({ id: message.id, result }) + '\n');
        });
        codexRuntime.rpc = rpc;
        codexRuntime.account = undefined;
        codexRuntime.connect = async () => rpc;
        const result = codexRuntime.login(outcome === 'timeout' ? 20 : 2000).then(
          () => undefined,
          (error) => error as Error
        );
        await Zotero.Promise.delay(0);
        assert.isTrue(codexRuntime.loginPending);
        assert.isUndefined(codexRuntime.accountKey);
        if (outcome === 'cancel') codexRuntime.cancelLogin();
        else if (outcome === 'disconnect') rpc.close();
        else if (outcome !== 'timeout')
          rpc.feed(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'test-login', success: outcome === 'success' } }) + '\n');
        const error = await result;
        assert.isFalse(codexRuntime.loginPending);
        if (outcome === 'success') {
          assert.isUndefined(error);
          assert.equal(codexRuntime.accountKey, 'fixture@example.org');
        } else {
          assert.instanceOf(error, Error);
          assert.isUndefined(codexRuntime.accountKey);
          rpc.feed(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'test-login', success: true } }) + '\n');
          assert.isUndefined(codexRuntime.accountKey, 'A late result must not restore a cancelled login');
          if (outcome !== 'disconnect') assert.include(requests, 'account/login/cancel');
        }
        rpc.close();
      }
    } finally {
      codexRuntime.cancelLogin();
      codexRuntime.connect = originalConnect;
      Zotero.launchURL = originalLaunch;
      codexRuntime.rpc = originalRpc;
      codexRuntime.account = undefined;
      codexRuntime.models = [];
    }
  });
});
