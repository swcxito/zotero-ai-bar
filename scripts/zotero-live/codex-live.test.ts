import { assert } from 'chai';
import { codexRuntime, runtimeNetworkEnvironment } from '../../src/modules/codex/runtime';
import { publishModels } from '../../src/modules/codex/settings';
import { CODEX_PROVIDER_ID } from '../../src/modules/codex/policy';
import { saveV2Config } from '../../src/utils/providers';

// Explicit --live only. Isolated Zotero profile, existing login, synthetic greeting, no documents.
describe('Live Codex subscription through Zotero', function () {
  it('renders a 5.6 Luna reply through the actual chat request pipeline', async function () {
    assert.include(PathUtils.profileDir.replace(/\\/g, '/'), '/.scaffold/test/profile');
    (globalThis as any).addon = (Zotero as any).ZAIBar;
    (globalThis as any).ztoolkit = addon.data.ztoolkit;
    const network = await runtimeNetworkEnvironment();
    assert.isString(network.HTTPS_PROXY, 'This machine has a system proxy; it must be resolved without manual settings');
    codexRuntime.sharedLogin = true;
    try {
      await codexRuntime.connect();
      assert.isDefined(codexRuntime.accountKey, 'No login flow should be required');
      const model = codexRuntime.models.find((m) => /5\.6.*luna/i.test(m.model));
      assert.isDefined(model);
      await publishModels();
      const v2 = addon.data.userProviderConfigV2!;
      v2.active = { providerId: CODEX_PROVIDER_ID, modelId: model!.model };
      await saveV2Config(v2);
      await addon.chatManager.sendChatRequest({
        sessionId: 'global-agent',
        sessionKind: 'global-agent',
        userPrompt: 'Reply only OK. Do not use any tools.',
        isFromPopup: true,
      });
      const session = addon.chatManager.getOrCreateSession({ sessionId: 'global-agent', kind: 'global-agent' });
      assert.isDefined(session.codex, 'Turn should complete successfully');
      assert.include(session.lastAssistantPop?.textContent || '', 'OK', 'Reply must be visible, not only received by the runtime');
      assert.isUndefined(session.pending.abortController, 'Loading state must finish');
    } finally {
      await codexRuntime.stop();
    }
  });
});
