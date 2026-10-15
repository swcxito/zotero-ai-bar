import type { AddedModel, CommonProviders, Model, ModelSelect } from './providers';

/** Source lookup stays within the selected provider. Ambiguous display names never infer capabilities. */
export function scopedModel(selection: ModelSelect, name: string | undefined, catalog?: CommonProviders): Model | undefined {
  const models = catalog?.[selection.providerId]?.models;
  if (!models) return undefined;
  if (models[selection.modelId]) return { ...models[selection.modelId], id: selection.modelId };
  const exact = Object.values(models).filter((model) => model.id === selection.modelId);
  if (exact.length === 1) return exact[0];
  const aliases = Object.entries(models).filter(([, model]) => model.name === selection.modelId || (!!name && model.name === name));
  return aliases.length === 1 ? { ...aliases[0][1], id: aliases[0][1].id ?? aliases[0][0] } : undefined;
}

export function resolveModelCapabilities(
  selection: ModelSelect,
  sources: { added?: AddedModel[]; live?: CommonProviders; common?: CommonProviders }
): Model | undefined {
  const saved = sources.added?.find((model) => model.providerId === selection.providerId && model.id === selection.modelId);
  if (selection.providerId === 'codex-subscription') return saved; // Published by the subscription runtime, never an API catalog.
  const live = scopedModel(selection, saved?.name, sources.live);
  const common = scopedModel(selection, saved?.name, sources.common);
  if (!saved && !live && !common) return undefined;
  const result: any = { ...(common ?? live ?? saved), ...(saved ?? {}), id: selection.modelId };
  for (const key of ['reasoning', 'reasoningEfforts', 'temperature', 'structured_output', 'attachment', 'interleaved'] as const) {
    result[key] = [live, saved, common].map((model) => model?.[key]).find((value) => value !== undefined);
  }
  for (const [key, fields] of [
    ['modalities', ['input', 'output']],
    ['limit', ['context', 'output', 'input']],
  ] as const) {
    result[key] = {};
    for (const field of fields) {
      result[key][field] = [live, saved, common].map((model: any) => model?.[key]?.[field]).find((value) => value !== undefined);
    }
  }
  return result as Model;
}
