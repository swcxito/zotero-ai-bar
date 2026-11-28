import type { TagElementProps } from 'zotero-plugin-toolkit';
import { saveV2Config, type AddedModel, type UserProviderConfigV2 } from '../../utils/providers';
import { getPref, setPref } from '../../utils/prefs';
import { getString } from '../../utils/locale';
import { analyzeModelName, getModelIconPath } from '../../utils/modelAnalyzer';
import { createSubscriptionRuntimeSettings } from '../../components/subscriptionRuntimeSettings';
import { CardModelRow, setCardModelName } from '../../components/modelRow';
import { InlineButton } from '../../components/buttons/inlineButton';
import { Icons } from '../../components/common';
import { AGY_PROVIDER_ID, agyModelFamily, redactAgyError, type AgyModel } from './protocol';
import { checkAgy, stopAgy } from './runtime';

const AGY_HELP_URL = 'https://antigravity.google/docs/cli/reference';
export const AGY_HEAD_DETAILS_CLASS = 'agy-head-details';
const AGY_MODEL_LIST_ID = 'agy-model-list';

let lastAgyInfo: { version?: string; plan?: string } = {};

/** Effort levels reported for an Antigravity model (the active one by default); [] when it has none. */
export function agyEfforts(modelId?: string): string[] {
  const v2 = addon.data.userProviderConfigV2;
  const id = modelId || (v2?.active?.providerId === AGY_PROVIDER_ID ? v2.active.modelId : undefined);
  if (!id) return [];
  return v2?.addedModels.find((m) => m.providerId === AGY_PROVIDER_ID && m.id === id)?.reasoningEfforts ?? [];
}

/** Publish exactly the models the official Antigravity CLI offers this account. */
export async function publishAgyModels(list: AgyModel[], contextWindow = 0): Promise<void> {
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) throw new Error('Model settings have not loaded.');
  v2.addedProviders[AGY_PROVIDER_ID] = {
    id: AGY_PROVIDER_ID,
    name: 'Antigravity (local)',
    env: [],
    doc: AGY_HELP_URL,
  };
  const models: AddedModel[] = list.map(({ id, name, efforts }) => {
    const existing = v2.addedModels.find((m) => m.providerId === AGY_PROVIDER_ID && m.id === id);
    return {
      id,
      providerId: AGY_PROVIDER_ID,
      name,
      enabled: existing?.enabled ?? true,
      family: agyModelFamily(id) as AddedModel['family'],
      reasoning: efforts.length > 0,
      reasoningEfforts: efforts,
      temperature: false,
      structured_output: false,
      modalities: { input: ['text', 'image'], output: ['text'] },
      open_weights: false,
      cost: { input: 0, output: 0 },
      limit: { context: contextWindow || existing?.limit?.context || 0, output: 0 },
    };
  });
  v2.addedModels = [...v2.addedModels.filter((m) => m.providerId !== AGY_PROVIDER_ID), ...models];
  await saveV2Config(v2);
}

let refreshing: Promise<void> | undefined;

/**
 * Re-reads the model list when the Antigravity CLI version changes (or when forced
 * from the model dialog). A failed read keeps the existing list and retries next time.
 */
export function refreshAgyModels(version: string, force = false): Promise<void> {
  if (!addon.data.userProviderConfigV2?.addedProviders[AGY_PROVIDER_ID]) return Promise.resolve();
  if (!force && getPref('agy.modelsVersion') === version) return Promise.resolve();
  refreshing ??= (async () => {
    try {
      const info = await checkAgy();
      if (!addon.data.userProviderConfigV2?.addedProviders[AGY_PROVIDER_ID]) return;
      lastAgyInfo = { version: info.version, plan: info.plan };
      await publishAgyModels(info.models, info.contextWindow);
      setPref('agy.modelsVersion', info.version);
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
}

export async function disconnectAgy(): Promise<void> {
  await stopAgy();
  lastAgyInfo = {};
  const v2 = addon.data.userProviderConfigV2;
  if (!v2) return;
  delete v2.addedProviders[AGY_PROVIDER_ID];
  delete v2.env[AGY_PROVIDER_ID];
  v2.addedModels = v2.addedModels.filter((m) => m.providerId !== AGY_PROVIDER_ID);
  if (v2.active?.providerId === AGY_PROVIDER_ID) {
    v2.active = undefined;
    setPref('llm.modelId', '');
  }
  await saveV2Config(v2);
}

function tierBadgeColors(plan: string): string[] {
  const lower = plan.toLowerCase();
  if (lower.includes('ultra') || lower.includes('enterprise')) return ['border-rose-500', 'text-rose-700', 'dark:text-rose-300'];
  if (lower.includes('pro')) return ['border-purple-500', 'text-purple-700', 'dark:text-purple-300'];
  if (lower.includes('business') || lower.includes('team')) return ['border-emerald-500', 'text-emerald-700', 'dark:text-emerald-300'];
  if (lower.includes('plus')) return ['border-blue-500', 'text-blue-700', 'dark:text-blue-300'];
  return ['border-zinc-400', 'text-zinc-600', 'dark:text-zinc-300'];
}

export function agyHeadDetailsBlock(connected: boolean): TagElementProps {
  if (!connected) {
    return {
      tag: 'div',
      classList: [AGY_HEAD_DETAILS_CLASS, 'text-xs', 'text-zinc-600', 'dark:text-zinc-300'],
      properties: { textContent: getString('subscription-agy-not-logged-in') },
    };
  }
  const version = lastAgyInfo.version || getPref('agy.modelsVersion')?.trim();
  const plan = lastAgyInfo.plan;
  const children: TagElementProps[] = [];
  if (plan) {
    children.push({
      tag: 'div',
      classList: ['flex', 'flex-wrap', 'items-center', 'gap-x-3', 'gap-y-1', 'text-xs', 'text-zinc-600', 'dark:text-zinc-300'],
      children: [
        {
          tag: 'span',
          classList: [
            'inline-flex',
            'box-border',
            'h-4',
            'shrink-0',
            'items-center',
            'rounded-full',
            'border',
            'px-2',
            'text-xs',
            'leading-none',
            'font-medium',
            ...tierBadgeColors(plan),
          ],
          properties: { textContent: plan },
        },
      ],
    });
  }
  children.push({
    tag: 'div',
    classList: ['text-xs', 'text-zinc-500', 'dark:text-zinc-400', 'break-words'],
    properties: { textContent: version ? `agy ${version}` : 'Antigravity CLI' },
  });
  return {
    tag: 'div',
    classList: [AGY_HEAD_DETAILS_CLASS, 'flex', 'flex-col', 'gap-1', 'min-w-0'],
    children,
  };
}

function createAgyModelRow(doc: Document, model: AddedModel, v2: UserProviderConfigV2): HTMLElement {
  const iconFamily = analyzeModelName(model.name).family;
  return CardModelRow({
    doc,
    data: model,
    iconMarkup: getModelIconPath(iconFamily),
    removable: false,
    onEnabledChange: (enabled) => {
      const current = addon.data.userProviderConfigV2 ?? v2;
      const target = current.addedModels.find((item) => item.providerId === AGY_PROVIDER_ID && item.id === model.id);
      if (target) target.enabled = enabled;
      else model.enabled = enabled;
      void saveV2Config(current);
    },
  }) as HTMLElement;
}

/** Controls and model list for the Antigravity (agy) card in the model dialog, matching the Codex card layout. */
export function createAgySettings(doc: Document, win: Window, hide: () => void, onHeaderChange?: () => void): HTMLElement {
  const root = doc.createElement('div');
  root.id = 'agy-settings';
  root.className = 'flex flex-col gap-3 px-4 py-3 text-sm';
  const connected = () => !!addon.data.userProviderConfigV2?.addedProviders[AGY_PROVIDER_ID];
  let operation: AbortController | undefined;

  const modelsSection = doc.createElement('section');
  modelsSection.id = 'agy-connected-settings';
  modelsSection.className = 'flex flex-col gap-2';
  const modelsTitle = doc.createElement('h3');
  modelsTitle.className = 'text-xs font-semibold text-zinc-600 dark:text-zinc-300';
  modelsTitle.textContent = getString('codex-models-label');
  const modelList = doc.createElement('div');
  modelList.id = AGY_MODEL_LIST_ID;
  modelList.className = 'model-card-list flex flex-col gap-2';
  const refreshButton = ztoolkit.UI.createElement(
    doc,
    'button',
    InlineButton({
      label: getString('codex-refresh-models'),
      iconMarkup: Icons.Redo,
      onClicked: () => void checkAndPublish(getPref('agy.runtimePath') || ''),
    })
  ) as HTMLButtonElement;
  refreshButton.id = 'agy-refresh-models';
  modelList.append(refreshButton);
  modelsSection.append(modelsTitle, modelList);

  const settings = createSubscriptionRuntimeSettings(doc, win, {
    provider: 'agy',
    path: getPref('agy.runtimePath') || '',
    description: getString('subscription-agy-description'),
    helpUrl: AGY_HELP_URL,
    checkLogin: (path) => void checkAndPublish(path),
    disconnectOrCancel: () => {
      if (connected()) {
        void run(async () => {
          await disconnectAgy();
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

  function syncModels(isConnected: boolean, busy: boolean) {
    modelsSection.hidden = !isConnected;
    refreshButton.disabled = busy;
    const v2 = addon.data.userProviderConfigV2;
    const models = isConnected && v2 ? v2.addedModels.filter((m) => m.providerId === AGY_PROVIDER_ID) : [];
    const rows = new Map<string, HTMLElement>();
    modelList.querySelectorAll<HTMLElement>(':scope > [data-model-id]').forEach((row) => rows.set(row.dataset.modelId ?? '', row));
    const wanted = new Set(models.map((m) => m.id));
    for (const [id, row] of rows) {
      if (wanted.has(id)) continue;
      row.remove();
      rows.delete(id);
    }
    if (v2) {
      for (const model of models) {
        const row = rows.get(model.id);
        if (!row) {
          rows.set(model.id, createAgyModelRow(doc, model, v2));
          continue;
        }
        setCardModelName(row, model.name);
      }
    }
    let anchor: Node | null = refreshButton;
    for (let i = models.length - 1; i >= 0; i--) {
      const row = rows.get(models[i].id);
      if (!row) continue;
      if (row.parentElement !== modelList || row.nextElementSibling !== anchor) modelList.insertBefore(row, anchor);
      anchor = row;
    }
  }

  function syncUi(busy: boolean) {
    if (win.closed) return;
    const isConnected = connected();
    settings.setState(isConnected, busy);
    syncModels(isConnected, busy);
    onHeaderChange?.();
  }

  async function checkAndPublish(path: string) {
    await run(async (signal) => {
      setPref('agy.runtimePath', path);
      const info = await checkAgy(undefined, signal);
      signal.throwIfAborted();
      if (win.closed) return;
      lastAgyInfo = { version: info.version, plan: info.plan };
      await publishAgyModels(info.models, info.contextWindow);
      setPref('agy.modelsVersion', info.version);
      settings.status.textContent = `agy ${info.version} · ${info.plan}`;
      settings.panel.open = false;
    });
  }

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation) return;
    operation = new AbortController();
    const { signal } = operation;
    settings.status.textContent = '';
    syncUi(true);
    try {
      await action(signal);
    } catch (error) {
      if (!signal.aborted && !win.closed) {
        settings.status.textContent = redactAgyError(String((error as Error).message || error));
        settings.panel.open = true;
      }
    } finally {
      operation = undefined;
      syncUi(false);
    }
  }

  root.append(modelsSection, settings.root);
  syncUi(false);
  if (connected()) {
    void refreshAgyModels(getPref('agy.modelsVersion') || '', true)
      .then(() => syncUi(!!operation))
      .catch(() => undefined);
  }
  return root;
}
