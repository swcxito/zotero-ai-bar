import { saveV2Config, type AddedModel } from '../../utils/providers';
import { getPref, setPref } from '../../utils/prefs';
import { getString } from '../../utils/locale';
import { installSubscriptionCli } from '../../utils/installSubscriptionCli';
import { createSubscriptionRuntimeSettings } from '../../components/subscriptionRuntimeSettings';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_FALLBACK_MODELS, redactClaudeError, type ClaudeCodeModel } from './protocol';
import { checkClaudeCode, listClaudeCodeModels, stopClaudeCode } from './runtime';

/** Effort levels the CLI reported for a Claude Code model (the active one by default); [] when it has none. */
export function claudeCodeEfforts(modelId?: string): string[] {
  const v2 = addon.data.userProviderConfigV2;
  const id = modelId || (v2?.active?.providerId === CLAUDE_CODE_PROVIDER_ID ? v2.active.modelId : undefined);
  if (!id) return [];
  return v2?.addedModels.find((m) => m.providerId === CLAUDE_CODE_PROVIDER_ID && m.id === id)?.reasoningEfforts ?? [];
}

/** Like Codex: publish exactly the models the official CLI offers this account. */
export async function publishClaudeCodeModels(list: ClaudeCodeModel[] = CLAUDE_FALLBACK_MODELS): Promise<void> {
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) throw new Error('Model settings have not loaded.');
  v2.addedProviders[CLAUDE_CODE_PROVIDER_ID] = {
    id: CLAUDE_CODE_PROVIDER_ID,
    name: 'Claude Code (local)',
    env: [],
    doc: 'https://code.claude.com/docs/en/overview',
  };
  const models: AddedModel[] = list.map(({ id, name, efforts }) => ({
    id,
    providerId: CLAUDE_CODE_PROVIDER_ID,
    name,
    enabled: v2.addedModels.find((m) => m.providerId === CLAUDE_CODE_PROVIDER_ID && m.id === id)?.enabled ?? true,
    family: `claude-${name
      .replace(/^Claude (Code · )?/, '')
      .split(' ')[0]
      .toLowerCase()}` as AddedModel['family'],
    reasoning: efforts.length > 0,
    reasoningEfforts: efforts,
    temperature: false,
    structured_output: false,
    modalities: { input: ['text', 'image'], output: ['text'] },
    open_weights: false,
    cost: { input: 0, output: 0 },
    limit: { context: 0, output: 0 },
  }));
  v2.addedModels = [...v2.addedModels.filter((m) => m.providerId !== CLAUDE_CODE_PROVIDER_ID), ...models];
  await saveV2Config(v2);
}

/** Older CLIs without a model list keep working with the plain aliases. */
async function discoverModels(command: string, signal: AbortSignal): Promise<ClaudeCodeModel[]> {
  return listClaudeCodeModels(command, signal).catch(() => {
    signal.throwIfAborted();
    return CLAUDE_FALLBACK_MODELS;
  });
}

let refreshing: Promise<void> | undefined;

/**
 * Aliases resolve per CLI version (after an upgrade "opus" is the next Opus), so
 * the saved names are only valid for the CLI version that listed them. Re-read
 * the list when that version changes; a failed read keeps the current list and
 * is retried next time.
 */
export function refreshClaudeCodeModels(command: string, version: string, force = false): Promise<void> {
  if (!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID]) return Promise.resolve();
  if (!force && getPref('claudeCode.modelsVersion') === version) return Promise.resolve();
  refreshing ??= (async () => {
    try {
      const models = await listClaudeCodeModels(command);
      if (!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID]) return;
      await publishClaudeCodeModels(models);
      setPref('claudeCode.modelsVersion', version);
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

export async function disconnectClaudeCode(): Promise<void> {
  await stopClaudeCode();
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) return;
  delete v2.addedProviders[CLAUDE_CODE_PROVIDER_ID];
  delete v2.env[CLAUDE_CODE_PROVIDER_ID];
  v2.addedModels = v2.addedModels.filter((m) => m.providerId !== CLAUDE_CODE_PROVIDER_ID);
  if (v2.active?.providerId === CLAUDE_CODE_PROVIDER_ID) {
    v2.active = undefined;
    setPref('llm.modelId', '');
  }
  await saveV2Config(v2);
}

/** Controls for the Claude Code card in the model dialog. */
export function createClaudeCodeSettings(doc: Document, win: Window, hide: () => void): HTMLElement {
  const root = doc.createElement('div');
  root.id = 'claude-code-settings';
  root.className = 'flex flex-col gap-3 px-4 py-3 text-sm';
  const connected = () => !!addon.data.userProviderConfigV2?.addedProviders[CLAUDE_CODE_PROVIDER_ID];
  let operation: AbortController | undefined;
  const settings = createSubscriptionRuntimeSettings(doc, win, {
    provider: 'claude-code',
    path: getPref('claudeCode.runtimePath') || '',
    description: getString('subscription-claude-description'),
    help: 'claude-code-integration',
    checkLogin: (path) =>
      void run(async (signal) => {
        setPref('claudeCode.runtimePath', path);
        const info = await checkClaudeCode(undefined, signal);
        const models = await discoverModels(info.path, signal);
        signal.throwIfAborted();
        if (win.closed) return;
        await publishClaudeCodeModels(models);
        setPref('claudeCode.modelsVersion', info.version);
        settings.status.textContent = `${info.version} · ${info.plan}\n${models.map((model) => model.name).join(', ')}`;
        settings.panel.open = true;
      }),
    install: () =>
      void run(async (signal) => {
        await installSubscriptionCli('claude-code', PathUtils.join(PathUtils.profileDir, 'zaibar', 'claude-code', 'workspace'), signal);
        settings.status.textContent = getString('subscription-cli-installed');
      }),
    disconnectOrCancel: () => {
      if (connected()) {
        void run(async () => {
          await disconnectClaudeCode();
          settings.panel.open = false;
          settings.status.textContent = '';
          hide();
        });
        return;
      }
      operation?.abort();
      settings.panel.open = false;
      settings.status.textContent = '';
      hide();
    },
  });

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation) return;
    operation = new AbortController();
    const { signal } = operation;
    settings.status.textContent = '';
    settings.setState(connected(), true);
    try {
      await action(signal);
    } catch (error) {
      if (!signal.aborted && !win.closed) {
        settings.status.textContent = redactClaudeError(String((error as Error).message || error));
        settings.panel.open = true;
      }
    } finally {
      operation = undefined;
      if (!win.closed) settings.setState(connected(), false);
    }
  }

  settings.setState(connected(), false);
  root.append(settings.root);
  if (connected()) {
    void checkClaudeCode()
      .then((info) => refreshClaudeCodeModels(info.path, info.version, true))
      .catch(() => undefined);
  }
  return root;
}
