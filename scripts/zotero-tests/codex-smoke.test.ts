import { assert } from 'chai';
import { codexRuntime, codexDirectory, runtimeNetworkEnvironment } from '../../src/modules/codex/runtime';
import { codexSettingsListeners, publishModels } from '../../src/modules/codex/settings';
import { maskAccountEmail } from '../../src/components/codexCardHeader';
import { cardDataMap } from '../../src/components/common';
import { ProviderCard } from '../../src/components/providerCard';
import { openDialog } from '../../src/modules/modelDialog';
import { CODEX_PROVIDER_ID } from '../../src/modules/codex/policy';
import { CodexRpc } from '../../src/modules/codex/protocol';
import { getString } from '../../src/utils/locale';
import { getPref, setPref } from '../../src/utils/prefs';
import { selectedAppIds } from '../../src/modules/codex/apps';

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

  it('changes a regular provider model through the displayed name and keeps its enabled state', function () {
    const doc = Zotero.getMainWindow().document.implementation.createHTMLDocument();
    let chooseModel: ((id: string, name: string) => void) | undefined;
    const card = ProviderCard({
      doc,
      providerId: 'openai',
      providerName: 'OpenAI',
      iconUrl: '',
      envKeys: [],
      envValues: {},
      isCustom: false,
      models: [{ id: 'old', name: 'Old model', enabled: false }],
      onAddModel: (select) => {
        chooseModel = select;
      },
    }) as HTMLElement;
    const name = card.querySelector<HTMLButtonElement>('button.model-row-name')!;
    assert.equal(name.textContent, 'Old model');
    assert.isNull(card.querySelector('.model-card-list input[type="text"]'));
    name.click();
    assert.isFunction(chooseModel);
    chooseModel!('new', 'New model');
    assert.equal(name.textContent, 'New model');
    assert.deepEqual(cardDataMap.get(card)!().models, [{ id: 'new', name: 'New model', enabled: false }]);
    assert.include(card.querySelector('input[type="checkbox"]')!.getAttribute('aria-label'), 'New model');
  });

  it('reveals subscription cards from the header and keeps app settings folded by default', async function () {
    const previous = addon.data.userProviderConfigV2;
    const originalLoadApps = codexRuntime.loadAppsOnce;
    const originalAppSelection = getPref('codex.apps.selection');
    let appLoads = 0;
    codexRuntime.loadAppsOnce = () => {
      appLoads++;
    };
    setPref('codex.apps.selection', JSON.stringify({ 'fixture@example.org': ['removed-app'] }));
    addon.data.userProviderConfigV2 = { addedProviders: {}, addedModels: [], env: {}, recentUsed: [] } as any;
    let dialog: Window | undefined;
    try {
      await openDialog();
      for (let i = 0; i < 50; i++) {
        await Zotero.Promise.delay(100);
        for (const win of Services.wm.getEnumerator(null)) {
          if ((win as Window).document?.getElementById('connect-chatgpt-button')) dialog = win as Window;
        }
        if (dialog?.document.querySelector('.provider-card #claude-code-settings')) break;
      }
      assert.isDefined(dialog);
      const doc = dialog!.document;
      const card = doc.getElementById('codex-provider-card')!;
      const claudeCard = doc.getElementById('claude-code-settings')!.closest<HTMLElement>('.provider-card')!;
      const grid = doc.getElementById('provider-block');
      assert.equal(card.parentElement, grid);
      assert.equal(claudeCard.parentElement, grid);
      assert.include(claudeCard.firstElementChild!.textContent!, 'Claude Code');
      assert.isNotNull(claudeCard.querySelector('#claude-code-settings input'));
      const claudePanel = claudeCard.querySelector<HTMLDetailsElement>('#claude-code-connection-panel')!;
      assert.lengthOf(claudePanel.querySelectorAll('button'), 3);
      const claudeAction = claudeCard.querySelector<HTMLButtonElement>('#claude-code-connection-action')!;

      const connect = doc.querySelector<HTMLButtonElement>('#connect-chatgpt-button')!;
      const connectLabel = doc.querySelector<HTMLElement>('#connect-chatgpt-label')!;
      const dropdown = doc.querySelector<HTMLElement>('#subscription-connect-options')!;
      const dropdownToggle = doc.querySelector<HTMLButtonElement>('#subscription-connect-toggle')!;
      const selectClaude = doc.querySelector<HTMLButtonElement>('#connect-claude-code-button')!;
      const disconnect = card.querySelector<HTMLButtonElement>('#codex-connection-action')!;
      const connectedSettings = card.querySelector<HTMLElement>('#codex-connected-settings')!;
      const panel = card.querySelector<HTMLDetailsElement>('#codex-connection-panel')!;
      assert.equal(connect.parentElement, dropdownToggle.parentElement);
      assert.equal(connectLabel.dataset.state, 'disconnected');
      assert.isTrue(card.hidden);
      assert.isTrue(claudeCard.hidden);
      assert.isTrue(dropdown.hidden);
      assert.isNotNull(panel.querySelector('#codex-install-cli-button'));
      assert.isFalse(panel.open);
      assert.isFalse(connect.disabled);
      assert.equal(dialog!.getComputedStyle(connectedSettings).display, 'none');
      assert.equal(dialog!.getComputedStyle(card.querySelector('#codex-login-wait')!).display, 'none');

      const expectedLabels = ['subscription-check-login', 'subscription-choose-program', 'subscription-install-cli'] as const;
      for (const [settings, slug] of [
        [panel, 'codex-integration'],
        [claudePanel, 'claude-code-integration'],
      ] as const) {
        assert.deepEqual(
          [...settings.querySelectorAll('button')].map((button) => button.textContent),
          expectedLabels.map((key) => getString(key))
        );
        const link = settings.querySelector('a')!;
        assert.equal(link.textContent, getString('subscription-install-help'));
        assert.match(link.href, new RegExp(`^https://zotero\\.fukeke\\.com/(en|zh-cn)/reference/${slug}/$`));
      }
      assert.equal(disconnect.textContent, getString('subscription-cancel-connect'));
      assert.equal(claudeAction.textContent, getString('subscription-cancel-connect'));
      assert.equal(claudeAction.parentElement, claudePanel.parentElement);
      assert.equal(claudeAction.className, disconnect.className);

      let claudeAttempts = 0;
      const claudeCheck = claudeCard.querySelector('#claude-code-check-login')!;
      const interceptClaudeCheck = (event: Event) => {
        event.stopImmediatePropagation();
        claudeAttempts++;
      };
      claudeCheck.addEventListener('click', interceptClaudeCheck, { capture: true });
      dropdownToggle.click();
      assert.equal(dropdownToggle.getAttribute('aria-expanded'), 'true');
      selectClaude.click();
      assert.isTrue(dropdown.hidden);
      assert.isFalse(claudeCard.hidden);
      assert.isTrue(card.hidden);
      assert.equal(claudeAttempts, 1);
      claudeAction.click();
      assert.isTrue(claudeCard.hidden);
      dropdownToggle.click();
      selectClaude.click();
      assert.isFalse(claudeCard.hidden);
      assert.equal(claudeAttempts, 2);
      claudeCheck.removeEventListener('click', interceptClaudeCheck, true);
      const originalConnect = codexRuntime.connectAccount;
      try {
        let connectSignal: AbortSignal | undefined;
        codexRuntime.connectAccount = (signal) => {
          connectSignal = signal;
          return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
        };
        connect.click();
        assert.isFalse(card.hidden);
        disconnect.click();
        assert.isTrue(card.hidden);
        assert.isTrue(connectSignal?.aborted);
        for (let i = 0; i < 50 && connect.disabled; i++) await Zotero.Promise.delay(20);
        assert.isFalse(panel.open);

        let attempts = 0;
        codexRuntime.connectAccount = async () => {
          attempts++;
          throw new Error('Fixture connection error');
        };
        connect.click();
        assert.isFalse(card.hidden);
        await Zotero.Promise.delay(0);
        assert.isTrue(panel.open, 'Connection failures expand the settings inside the card');
        assert.include(panel.textContent!, 'Fixture connection error');

        const toolkit = ztoolkit as any;
        const originalPicker = toolkit.FilePicker;
        const originalRuntimePath = getPref('codex.runtimePath');
        const selectedPath = PathUtils.join(PathUtils.profileDir, 'cli-fixture');
        try {
          toolkit.FilePicker = class {
            async open() {
              return selectedPath;
            }
          };
          card.querySelector<HTMLButtonElement>('#codex-choose-program')!.click();
          claudeCard.querySelector<HTMLButtonElement>('#claude-code-choose-program')!.click();
          await Zotero.Promise.delay(0);
          assert.equal(card.querySelector<HTMLInputElement>('#codex-runtime-path')!.value, selectedPath);
          assert.equal(claudeCard.querySelector<HTMLInputElement>('#claude-code-runtime-path')!.value, selectedPath);
          assert.equal(attempts, 1, 'Choosing a program does not initiate a connection');
          assert.equal(getPref('codex.runtimePath'), originalRuntimePath, 'The selected path is persisted only when checking login');
        } finally {
          toolkit.FilePicker = originalPicker;
        }
      } finally {
        codexRuntime.connectAccount = originalConnect;
        panel.open = false;
      }

      addon.data.userProviderConfigV2!.addedProviders[CODEX_PROVIDER_ID] = { id: CODEX_PROVIDER_ID, name: 'Codex 订阅', env: [] };
      for (const listener of codexSettingsListeners) listener();
      assert.isTrue(connectedSettings.hidden, 'Saved metadata without login keeps the card in setup mode');
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
      assert.strictEqual(doc.getElementById('codex-provider-card'), card, 'Connection updates the same card');
      assert.equal(connectLabel.dataset.state, 'connected');
      assert.equal(connect.dataset.connected, 'true');
      assert.isTrue(connect.disabled);
      assert.isFalse(connectedSettings.hidden);
      assert.equal(disconnect.textContent, getString('subscription-disconnect'));
      assert.isTrue(card.classList.contains('provider-card'), 'Reuse the shared provider card');
      assert.include(card.firstElementChild!.textContent!, getString('codex-card-title'));
      assert.include(card.firstElementChild!.textContent!, 'f***e@example.org');
      assert.notInclude(card.textContent!, 'fixture@example.org');
      assert.include(card.firstElementChild!.textContent!, 'Plus');
      const badge = card.firstElementChild!.querySelector('.rounded-full.border') as HTMLElement;
      assert.isNotNull(badge);
      assert.isTrue(badge.classList.contains('h-4'), 'Plan badge matches the email line height');
      assert.isTrue(badge.classList.contains('box-border'), 'Plan badge height includes its border');
      const name = card.querySelector('.model-card-list span.model-row-name')!;
      assert.equal(name.textContent, 'Fixture model');
      assert.isNull(card.querySelector('.model-card-list input[type="text"]'));
      const headText = card.firstElementChild!.querySelector('div.flex-col') as HTMLElement;
      assert.isTrue(headText.classList.contains('gap-1'), 'ChatGPT head rows use the tighter row gap');
      const rowIconWrapper = card.querySelector('.model-card-list [data-model-id] > div > span') as HTMLElement;
      assert.isTrue(
        rowIconWrapper.classList.contains('items-center') && rowIconWrapper.classList.contains('justify-center'),
        'Model row icon is centered in its wrapper'
      );
      const tailButton = card.querySelector('.provider-card-collapse') as HTMLButtonElement;
      assert.isTrue(tailButton.classList.contains('inline-flex'), 'Head icon button centers its icon');
      assert.include(connectedSettings.textContent!, getString('codex-models-label'));
      assert.lengthOf(card.querySelectorAll('.model-card-list [data-model-id] button'), 0, 'Model rows have no deletion buttons');
      const refreshModels = card.querySelector<HTMLButtonElement>('#codex-refresh-models')!;
      assert.isNotNull(refreshModels);
      const appsPanel = card.querySelector<HTMLDetailsElement>('[data-codex-apps]')!;
      assert.isFalse(appsPanel.open);
      assert.equal(appLoads, 0, 'The app catalog loads when the user expands its section');
      appsPanel.querySelector('summary')!.click();
      await Zotero.Promise.delay(30);
      assert.isTrue(appsPanel.open);
      assert.equal(appLoads, 1);
      assert.lengthOf(appsPanel.querySelectorAll('button'), 1, 'The apps panel has its own refresh button');
      const refreshApps = appsPanel.querySelector('button')!;
      assert.equal(refreshApps.className, refreshModels.className);
      assert.exists(refreshApps.querySelector('svg'));
      assert.equal(dialog!.getComputedStyle(refreshApps).borderTopStyle, 'dashed');
      const removedApp = appsPanel.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      assert.isTrue(removedApp.checked);
      assert.isFalse(removedApp.disabled);
      removedApp.click();
      assert.deepEqual(selectedAppIds('fixture@example.org'), []);
      assert.isNull(appsPanel.querySelector('input[type="checkbox"]'));
      assert.isTrue(appsPanel.open, 'Changing an app selection preserves the disclosure state');

      const toggleCards = doc.querySelector<HTMLButtonElement>('#toggle-provider-cards')!;
      toggleCards.click();
      assert.equal(card.dataset.collapsed, 'true');
      assert.equal(claudeCard.dataset.collapsed, 'true');
      toggleCards.click();
      assert.equal(card.dataset.collapsed, 'false');
      assert.equal(claudeCard.dataset.collapsed, 'false');
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
      assert.equal(name.textContent, 'Updated fixture model');
      assert.include(checkbox.getAttribute('aria-label'), 'Updated fixture model');
      assert.isFalse(panel.open);
      const originalRefresh = codexRuntime.refreshAccount;
      try {
        codexRuntime.refreshAccount = async () => {
          codexRuntime.changed();
        };
        refreshModels.click();
        assert.isFalse(panel.open, 'Refreshing models keeps the runtime settings collapsed');
        await Zotero.Promise.delay(0);
        for (let i = 0; i < 50 && refreshModels.disabled; i++) await Zotero.Promise.delay(100);
      } finally {
        codexRuntime.refreshAccount = originalRefresh;
      }
      assert.isFalse(panel.open, 'Runtime settings stay collapsed once the refresh settles');
      const runtimeRow = panel.parentElement!;
      const summary = panel.querySelector('summary')!;
      const rowRect = runtimeRow.getBoundingClientRect();
      const summaryRect = summary.getBoundingClientRect();
      const disconnectRect = disconnect.getBoundingClientRect();
      assert.equal(disconnect.parentElement, runtimeRow);
      assert.closeTo(disconnectRect.right, rowRect.right, 1);
      assert.closeTo(disconnectRect.top, summaryRect.top, 1);
      disconnect.click();
      for (let i = 0; i < 50 && !card.hidden; i++) await Zotero.Promise.delay(100);
      assert.strictEqual(doc.getElementById('codex-provider-card'), card);
      assert.isUndefined(addon.data.userProviderConfigV2!.addedProviders[CODEX_PROVIDER_ID]);
      assert.isTrue(connectedSettings.hidden);
      assert.isNull(card.querySelector('[data-codex-apps]'));
      assert.isTrue(card.hidden);
      assert.isFalse(claudeCard.hidden);
      assert.equal(disconnect.textContent, getString('subscription-cancel-connect'));
      assert.isFalse(panel.open);
      assert.isFalse(connect.disabled);
      assert.equal(connectLabel.dataset.state, 'disconnected');
    } finally {
      dialog?.close();
      await Zotero.Promise.delay(100);
      addon.data.userProviderConfigV2 = previous;
      codexRuntime.loadAppsOnce = originalLoadApps;
      setPref('codex.apps.selection', originalAppSelection);
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
