import { saveV2Config, type AddedModel } from '../../utils/providers';
import { setPref } from '../../utils/prefs';
import { CODEX_PROVIDER_ID } from './policy';
import { codexRuntime } from './runtime';

let lastPublished = '';
export const codexSettingsListeners = new Set<() => void>();

export function codexEfforts(modelId?: string): string[] {
  const active = addon.data.userProviderConfigV2?.active;
  const id = modelId || (active?.providerId === CODEX_PROVIDER_ID ? active.modelId : undefined);
  if (!id) return [];
  return (
    codexRuntime.models.find((model) => model.model === id)?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ||
    addon.data.userProviderConfigV2?.addedModels.find((model) => model.providerId === CODEX_PROVIDER_ID && model.id === id)?.reasoningEfforts ||
    []
  );
}

export async function publishModels(): Promise<void> {
  const v2 = addon.data.userProviderConfigV2;
  if (!v2 || !codexRuntime.accountKey || !codexRuntime.models.length) return;
  const key = JSON.stringify(codexRuntime.models);
  if (key === lastPublished && v2.addedProviders[CODEX_PROVIDER_ID]) return;
  v2.addedProviders[CODEX_PROVIDER_ID] = { id: CODEX_PROVIDER_ID, name: 'Codex 订阅', env: [], doc: 'https://learn.chatgpt.com/docs/app-server' };
  const models: AddedModel[] = codexRuntime.models.map((model) => ({
    providerId: CODEX_PROVIDER_ID,
    id: model.model,
    name: model.displayName || model.model,
    enabled: v2.addedModels.find((existing) => existing.providerId === CODEX_PROVIDER_ID && existing.id === model.model)?.enabled ?? true,
    family: 'gpt',
    reasoning: true,
    reasoningEfforts: model.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    structured_output: true,
    temperature: false,
    modalities: { input: model.inputModalities?.includes('image') ? ['text', 'image'] : ['text'], output: ['text'] },
    open_weights: false,
    cost: { input: 0, output: 0 },
    limit: { context: 0, output: 0 },
  }));
  v2.addedModels = [...v2.addedModels.filter((model) => model.providerId !== CODEX_PROVIDER_ID), ...models];
  await saveV2Config(v2);
  lastPublished = key;
  for (const listener of codexSettingsListeners) listener();
}

export async function disconnectCodex(): Promise<void> {
  await codexRuntime.stop();
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) return;
  delete v2.addedProviders[CODEX_PROVIDER_ID];
  v2.addedModels = v2.addedModels.filter((m) => m.providerId !== CODEX_PROVIDER_ID);
  if (v2.active?.providerId === CODEX_PROVIDER_ID) {
    v2.active = undefined;
    setPref('llm.modelId', '');
  }
  lastPublished = '';
  await saveV2Config(v2);
  for (const listener of codexSettingsListeners) listener();
}
