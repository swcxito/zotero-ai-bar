/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelDialog.ts
 *
 * This file is part of Zotero AI Bar.
 * Zotero AI Bar - A handy AI assistant integration for Zotero
 *
 * Copyright (c) 2026. swcxito <120201848+swcxito@users.noreply.github.com>
 *
 * Zotero AI Bar is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
 *
 * Zotero AI Bar is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
 *
 * Repository: https://github.com/swcxito/zotero-ai-bar
 */

import { config } from '../../package.json';
import { ProviderLogoButton } from '../components/buttons/providerLogoButton';
import { ProviderCard } from '../components/providerCard';
import { getString } from '../utils/locale';
import {
  getModelsDevLogoUrl,
  resolveProviderIcon,
  cacheProviderIcon,
  findModelMetadata,
  ensureCommonProviders,
  fetchLiveProviders,
  saveV2Config,
  filterGoogleEnvKeys,
  migrateGoogleEnvValues,
} from '../utils/providers';
import { getModelIconPath } from '../utils/modelAnalyzer';
import { cardDataMap, ModelIcons } from '../components/common';
import { CODEX_PROVIDER_ID } from './codex/policy';
import { publishModels, disconnectCodex, codexSettingsListeners } from './codex/settings';
import { codexRuntime } from './codex/runtime';
import { IconView } from '../components/iconView';
import { CardModelRow } from '../components/modelRow';
import { InlineButton } from '../components/buttons/inlineButton';
import { codexHeadDetailsBlock, CODEX_HEAD_DETAILS_CLASS } from '../components/codexCardHeader';
import { Icons } from '../components/common';
import type { UserProviderConfigV2, CommonProviders, AddedProvider, AddedModel, ProviderId, Provider } from '../utils/providers';

/** Stable hook for the ChatGPT card's model list so refreshes can diff rows in place. */
const CODEX_MODEL_LIST_ID = 'codex-model-list';

/** Theme-coloured inline link, used for the external install guides in the connection panel. */
const CONNECTION_PANEL_LINK_CLASS =
  'cursor-pointer text-rose-600 underline underline-offset-2 transition-colors duration-200 hover:text-rose-500 dark:text-rose-400 dark:hover:text-rose-300';

function buildModelRows(v2: UserProviderConfigV2, providerId: string): { id: string; name: string; enabled: boolean }[] {
  return (v2.addedModels ?? []).filter((m) => m.providerId === providerId).map((m) => ({ id: m.id, name: m.name, enabled: m.enabled }));
}

export async function openDialog(onDialogClosed: () => void = () => {}) {
  const windowArgs = {
    onBodyLoaded: onModelDialogLoad,
    onWindowClosed: onDialogClosed,
  };

  Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/modelDialog.html`,
    `${config.addonRef}-model-dialog`,
    'chrome,centerscreen,resizable,status,dialog=no,width=800,height=600',
    windowArgs
  );
}

class ModelDialogV2 {
  private readonly doc: Document;
  private readonly root: HTMLElement | null;
  private readonly overlay: HTMLElement | null;
  private readonly addProviderButton: HTMLElement | null;
  private readonly searchInput: HTMLInputElement | null;
  private readonly providerList: HTMLElement | null;
  private readonly customButtonContainer: HTMLElement | null;
  private readonly modelOverlay: HTMLElement | null;
  private readonly modelSearchInput: HTMLInputElement | null;
  private readonly modelList: HTMLElement | null;
  private liveFetchPromise: Promise<void> | null = null;
  private interacting = false;
  private codexBusy = false;
  private codexCollapsed = false;

  // Pinned to top when search is empty (order = display order)
  private static readonly PINNED_ORDER = ['openai', 'google', 'anthropic', 'alibaba-cn', 'deepseek', 'moonshotai-cn', 'xai', 'zhipuai'];
  private static readonly PINNED_SET = new Set(ModelDialogV2.PINNED_ORDER);

  private static readonly SELECT_ITEM_CLASS =
    'flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm text-zinc-700 transition-colors duration-300 hover:duration-150 ease-in hover:ease-out motion-reduce:duration-0 hover:bg-rose-400 hover:text-white dark:text-zinc-200';

  constructor(private readonly win: Window) {
    this.doc = win.document;
    this.root = this.doc.querySelector('#root');
    this.overlay = this.doc.querySelector('#add-provider-overlay');
    this.addProviderButton = this.doc.querySelector('#add-provider-button');
    this.searchInput = this.doc.querySelector('#provider-search-input');
    this.providerList = this.doc.querySelector('#add-provider-list');
    this.customButtonContainer = this.doc.querySelector('#add-provider-custom');
    this.modelOverlay = this.doc.querySelector('#model-select-overlay');
    this.modelSearchInput = this.doc.querySelector('#model-search-input');
    this.modelList = this.doc.querySelector('#model-select-list');
  }

  private setBodyScrollLock(lock: boolean) {
    this.doc.body.style.overflow = lock ? 'hidden' : '';
  }

  async init() {
    await ensureCommonProviders();

    if (!(this.root && this.addProviderButton && this.overlay && this.searchInput && this.providerList)) {
      return;
    }

    if (this.searchInput) {
      this.searchInput.placeholder = getString('model-dialog-search-providers');
    }
    if (this.modelSearchInput) {
      this.modelSearchInput.placeholder = getString('model-dialog-search-models');
    }

    const v2 = addon.data.userProviderConfigV2!;
    ztoolkit.log('[ModelDialogV2.init] v2 state:', {
      providers: Object.keys(v2.addedProviders),
      models: v2.addedModels.length,
      envKeys: Object.keys(v2.env),
    });

    // 先渲染 UI（使用本地数据）
    this.bindPopupShowHide();
    this.renderProviders();
    this.addCards();
    const connectButton = this.doc.getElementById('connect-chatgpt-button');
    const icon = this.doc.getElementById('connect-chatgpt-icon');
    if (icon) ztoolkit.UI.appendElement(IconView({ iconMarkup: getModelIconPath('gpt'), sizeRem: 1 }), icon);
    this.createCodexConnectionPanel();
    const loginStatus = this.doc.createElement('div');
    loginStatus.id = 'codex-login-wait';
    loginStatus.className = 'mb-4 flex items-center gap-3 text-sm text-zinc-500';
    const waiting = this.doc.createElement('span');
    waiting.textContent = getString('codex-login-waiting');
    const cancel = this.doc.createElement('button');
    cancel.textContent = getString('codex-login-cancel');
    cancel.addEventListener('click', () => codexRuntime.cancelLogin());
    loginStatus.append(waiting, cancel);
    this.doc.getElementById('provider-block')?.before(loginStatus);
    this.updateCodexConnectionControls();
    connectButton?.addEventListener('click', () => void this.runCodexConnection(() => codexRuntime.connectAccount()));
    const refreshCodex = () => {
      this.renderCodexCard();
      const status = this.doc.getElementById('codex-connection-status');
      if (status) status.textContent = [codexRuntime.status, ...codexRuntime.diagnostics].join('\n');
      void publishModels().catch(() => undefined);
    };
    codexSettingsListeners.add(refreshCodex);
    codexRuntime.listeners.add(refreshCodex);
    this.win.addEventListener('unload', () => {
      codexSettingsListeners.delete(refreshCodex);
      codexRuntime.listeners.delete(refreshCodex);
    });

    if (v2.addedProviders[CODEX_PROVIDER_ID]) void this.runCodexConnection(() => codexRuntime.connect(), false);

    // 后台获取在线数据，完成后刷新 provider 列表
    this.liveFetchPromise = fetchLiveProviders()
      .then((live) => {
        addon.data.liveProviders = live;
        ztoolkit.log('[ModelDialogV2] Live providers loaded:', Object.keys(live).length);
      })
      .catch((e) => {
        ztoolkit.log('[ModelDialogV2] Live fetch failed, using local:', e);
        addon.data.liveProviders = undefined;
      });

    this.win.addEventListener('unload', async () => {
      await this.saveSettings();
      this.win.arguments[0].onWindowClosed();
    });
  }

  /** 确保在线数据加载完成（用户交互前调用） */
  private async ensureLiveData(): Promise<void> {
    if (this.liveFetchPromise) {
      await this.liveFetchPromise;
      this.liveFetchPromise = null;
    }
  }

  // ---- Card rendering ----

  private addCards() {
    const container = this.root?.querySelector('#provider-block');
    if (!container) return;

    const v2 = addon.data.userProviderConfigV2!;
    for (const [providerId] of Object.entries(v2.addedProviders)) {
      if (providerId === CODEX_PROVIDER_ID) continue;
      this.createAndAppendCard(providerId, container as HTMLElement);
    }
    this.renderCodexCard();
  }

  private createCodexConnectionPanel() {
    const panel = this.doc.createElement('div');
    panel.id = 'codex-connection-panel';
    panel.hidden = true;
    panel.className = 'mb-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900';
    const status = this.doc.createElement('p');
    status.id = 'codex-connection-status';
    status.className = 'mb-3 whitespace-pre-wrap break-words text-sm';
    const path = this.doc.createElement('input');
    path.id = 'codex-runtime-path';
    path.placeholder = getString('codex-runtime-path-placeholder');
    path.setAttribute('aria-label', getString('codex-runtime-path-label'));
    path.className = 'mb-3 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-600';
    const controls = this.doc.createElement('div');
    controls.className = 'flex flex-wrap items-center gap-3 text-sm';
    const button = (label: string, action: () => void) => {
      const node = this.doc.createElement('button');
      node.textContent = label;
      node.className = 'rounded-lg border border-gray-300 px-3 py-1 dark:border-zinc-600';
      node.addEventListener('click', action);
      controls.append(node);
    };
    button(
      getString('codex-refresh-continue'),
      () =>
        void this.runCodexConnection(async () => {
          if (path.value.trim()) await codexRuntime.selectPath(path.value.trim());
          else if (!codexRuntime.info) await codexRuntime.detect();
          await codexRuntime.connectAccount();
        })
    );
    button(
      getString('codex-select-file'),
      () =>
        void this.runCodexConnection(async () => {
          const selected = await new ztoolkit.FilePicker(getString('codex-runtime-picker-title'), 'open', undefined, undefined, this.win).open();
          if (!selected) return;
          path.value = selected;
          await codexRuntime.selectPath(selected);
          await codexRuntime.connectAccount();
        })
    );
    for (const [label, url] of [
      [getString('codex-install-chatgpt'), 'https://learn.chatgpt.com/docs/app'],
      [getString('codex-install-cli'), 'https://learn.chatgpt.com/docs/cli'],
    ]) {
      const link = this.doc.createElement('a');
      link.textContent = label;
      link.href = url;
      link.className = CONNECTION_PANEL_LINK_CLASS;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        Zotero.launchURL(url);
      });
      controls.append(link);
    }
    panel.append(status, path, controls);
    this.doc.getElementById('provider-block')?.before(panel);
  }

  /** Keep setup controls hidden during connection; reveal them only after an actionable failure. */
  private updateCodexConnectionControls() {
    const connected = !!codexRuntime.accountKey;
    const button = this.doc.getElementById('connect-chatgpt-button') as HTMLButtonElement | null;
    const label = this.doc.getElementById('connect-chatgpt-label');
    const disconnectedLabel = label?.querySelector('[data-connect-label="disconnected"]');
    const connectedLabel = label?.querySelector('[data-connect-label="connected"]');
    label?.setAttribute('data-state', connected ? 'connected' : 'disconnected');
    disconnectedLabel?.setAttribute('aria-hidden', String(connected));
    connectedLabel?.setAttribute('aria-hidden', String(!connected));
    const activeLabel = connected ? connectedLabel : disconnectedLabel;
    if (label && activeLabel) {
      const labelWidth = activeLabel.getBoundingClientRect().width;
      if (labelWidth > 0) label.style.width = `${Math.ceil(labelWidth)}px`;
    }
    if (button) {
      button.dataset.connected = String(connected);
      button.setAttribute('aria-label', getString(connected ? 'model-dialog-chatgpt-connected' : 'model-dialog-connect-chatgpt'));
      button.disabled = this.codexBusy || codexRuntime.loginPending || connected;
      button.setAttribute('aria-busy', String(this.codexBusy || codexRuntime.loginPending));
      button.style.opacity = this.codexBusy || codexRuntime.loginPending ? '0.6' : '';
      button.style.cursor = button.disabled ? 'default' : '';
    }
    const waiting = this.doc.getElementById('codex-login-wait');
    if (waiting) {
      waiting.hidden = !codexRuntime.loginPending;
      waiting.style.display = codexRuntime.loginPending ? 'flex' : 'none';
    }
  }

  private async runCodexConnection(operation: () => Promise<unknown>, revealOnError = true) {
    if (this.codexBusy) return;
    this.codexBusy = true;
    this.updateCodexConnectionControls();
    const panel = this.doc.getElementById('codex-connection-panel')!;
    let failed = false;
    panel.hidden = true;
    try {
      await operation();
      await publishModels();
    } catch (error) {
      failed = true;
      const status = this.doc.getElementById('codex-connection-status');
      if (status) status.textContent = (error as Error).message;
    } finally {
      this.codexBusy = false;
      this.renderCodexCard();
      if (failed && revealOnError) panel.hidden = false;
    }
  }

  private renderCodexCard() {
    this.updateCodexConnectionControls();
    const v2 = addon.data.userProviderConfigV2;
    const container = this.root?.querySelector('#provider-block');
    const card = this.doc.getElementById('codex-provider-card') as HTMLElement | null;
    // Saved provider metadata alone is not evidence of a current login.
    if (!container || !codexRuntime.accountKey || !v2?.addedProviders[CODEX_PROVIDER_ID]) {
      card?.remove();
      return;
    }
    const panel = this.doc.getElementById('codex-connection-panel');
    if (panel) panel.hidden = true;
    const models = v2.addedModels.filter((model) => model.providerId === CODEX_PROVIDER_ID);
    // Update the mounted card in place: rebuilding it on every publish makes the list blink out.
    if (card) this.syncCodexCard(card, models, v2, codexRuntime.accountKey);
    else container.prepend(this.createCodexCard(models, v2, codexRuntime.accountKey));
  }

  private codexHeadDetails(accountKey: string) {
    return codexHeadDetailsBlock(accountKey, codexRuntime.account?.planType, codexRuntime.info?.version || 'Codex');
  }

  private createCodexCard(models: AddedModel[], v2: UserProviderConfigV2, accountKey: string): HTMLElement {
    const content = this.doc.createElement('div');
    content.id = CODEX_MODEL_LIST_ID;
    content.className = 'flex flex-col gap-2';
    for (const model of models) content.append(this.createCodexModelRow(model, v2));
    const refresh = ztoolkit.UI.createElement(
      this.doc,
      'button',
      InlineButton({
        label: getString('codex-refresh-models'),
        iconMarkup: Icons.Redo,
        onClicked: (event) => {
          // Show the busy state on the button itself; revealing the connection panel would shift the
          // whole card grid down by its height and read as the list jumping to another card.
          (event.currentTarget as HTMLButtonElement).disabled = true;
          void this.runCodexConnection(() => codexRuntime.refreshAccount());
        },
      })
    );
    refresh.id = 'codex-refresh-models';
    (refresh as HTMLButtonElement).disabled = this.codexBusy;
    content.append(refresh);
    const card = ProviderCard({
      providerId: CODEX_PROVIDER_ID,
      providerName: getString('codex-card-title'),
      titleClassList: ['text-sm', 'font-semibold', 'text-zinc-700', 'dark:text-zinc-200'],
      headerDetails: [this.codexHeadDetails(accountKey)],
      iconUrl: resolveProviderIcon(CODEX_PROVIDER_ID),
      envKeys: [],
      envValues: {},
      isCustom: false,
      models: [],
      doc: this.doc,
      modelListContent: content,
      onDelete: () => {
        this.codexCollapsed = false;
        void disconnectCodex().catch(() => this.renderCodexCard());
      },
    }) as HTMLElement;
    card.id = 'codex-provider-card';
    const collapse = card.querySelector('.provider-card-collapse') as HTMLButtonElement;
    if (this.codexCollapsed) collapse?.click();
    collapse?.addEventListener('click', () => {
      this.codexCollapsed = !this.codexCollapsed;
    });
    return card;
  }

  private createCodexModelRow(model: AddedModel, v2: UserProviderConfigV2) {
    return CardModelRow({
      doc: this.doc,
      data: model,
      iconMarkup: getModelIconPath('gpt'),
      removable: false,
      onEnabledChange: (enabled) => {
        // publishModels() replaces addedModels, so resolve the live entry instead of the captured object.
        const current = addon.data.userProviderConfigV2 ?? v2;
        const target = current.addedModels.find((item) => item.providerId === CODEX_PROVIDER_ID && item.id === model.id);
        if (target) target.enabled = enabled;
        else model.enabled = enabled;
        void saveV2Config(current);
      },
    });
  }

  /** Diff the mounted rows against the published models: only added, removed or renamed models touch the DOM. */
  private syncCodexCard(card: HTMLElement, models: AddedModel[], v2: UserProviderConfigV2, accountKey: string) {
    const refresh = card.querySelector('#codex-refresh-models') as HTMLButtonElement | null;
    if (refresh) refresh.disabled = this.codexBusy;
    const details = card.querySelector(`.${CODEX_HEAD_DETAILS_CLASS}`);
    if (details) {
      const next = ztoolkit.UI.createElement(this.doc, 'div', this.codexHeadDetails(accountKey));
      if (next.textContent !== details.textContent) details.parentElement?.replaceChild(next, details);
    }
    const list = card.querySelector(`#${CODEX_MODEL_LIST_ID}`);
    if (!list) return;
    const rows = new Map<string, HTMLElement>();
    list.querySelectorAll<HTMLElement>(':scope > [data-model-id]').forEach((row) => rows.set(row.dataset.modelId ?? '', row));
    const wanted = new Set(models.map((model) => model.id));
    for (const [id, row] of rows) {
      if (wanted.has(id)) continue;
      row.remove();
      rows.delete(id);
    }
    for (const model of models) {
      const row = rows.get(model.id);
      if (!row) {
        rows.set(model.id, this.createCodexModelRow(model, v2) as HTMLElement);
        continue;
      }
      // Keep the mounted row (and its checkbox state); only the displayed name can change.
      const input = row.querySelector('input[type="text"]') as HTMLInputElement | null;
      if (input && input.value !== model.name) input.value = model.name;
    }
    // Reapply the published order, moving only the rows that are actually out of place.
    let anchor: Node | null = refresh;
    for (let i = models.length - 1; i >= 0; i--) {
      const row = rows.get(models[i].id);
      if (!row) continue;
      if (row.parentElement !== list || row.nextElementSibling !== anchor) list.insertBefore(row, anchor);
      anchor = row;
    }
  }

  private createAndAppendCard(providerId: string, container?: HTMLElement) {
    const target = container ?? this.root?.querySelector('#provider-block');
    if (!target) return;

    const v2 = addon.data.userProviderConfigV2!;
    const cp = this.getActiveProviders();
    const commonProvider = cp?.[providerId];
    const addedProvider = v2.addedProviders[providerId];
    const envKeys = filterGoogleEnvKeys(providerId, addedProvider?.env ?? commonProvider?.env ?? []);
    const envValues = migrateGoogleEnvValues(providerId, v2.env[providerId] ?? {});
    const isCustom = !commonProvider;

    ztoolkit.log('[ModelDialogV2] createAndAppendCard:', {
      providerId,
      isCustom,
      envKeys,
      models: buildModelRows(v2, providerId).length,
    });

    const card = ProviderCard({
      providerId,
      providerName: addedProvider?.name ?? commonProvider?.name ?? providerId,
      iconUrl: resolveProviderIcon(providerId),
      baseUrl: addedProvider?.api ?? commonProvider?.api,
      envKeys,
      envValues,
      isCustom,
      models: buildModelRows(v2, providerId),
      doc: this.doc,
      onAddModel: (cb: (id: string, name: string) => void) => {
        this.openModelSelect(providerId, cb);
      },
      onDelete: () => this.renderProviders(),
    });

    target.appendChild(card);
  }

  // ---- Add Provider popup ----

  private getExistingProviderIds(): Set<string> {
    const ids = new Set<string>();
    this.root?.querySelectorAll('.provider-card').forEach((card) => ids.add(cardDataMap.get(card)!().providerId ?? ''));
    return ids;
  }

  private getActiveProviders(): CommonProviders {
    return addon.data.liveProviders ?? addon.data.commonProviders!;
  }

  private getAvailableProviders(): Array<[string, Provider]> {
    const providers = this.getActiveProviders();
    if (!providers) return [];
    const existingIds = this.getExistingProviderIds();
    return (Object.entries(providers) as [string, Provider][])
      .filter(([id]) => !existingIds.has(id))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }

  private refreshProviderList(query: string = '') {
    if (!this.providerList || !this.customButtonContainer) return;

    const available = this.getAvailableProviders();

    this.providerList.replaceChildren();

    const q = query.toLowerCase().trim();
    let filtered = available;
    if (q) {
      filtered = available.filter(([, p]) => p.name.toLowerCase().includes(q));
    }

    // Split into pinned and rest; pinned only when no search
    const pinned: typeof filtered = [];
    const rest: typeof filtered = [];
    if (!q) {
      for (const entry of filtered) {
        if (ModelDialogV2.PINNED_SET.has(entry[0])) {
          pinned.push(entry);
        } else {
          rest.push(entry);
        }
      }
      pinned.sort((a, b) => ModelDialogV2.PINNED_ORDER.indexOf(a[0]) - ModelDialogV2.PINNED_ORDER.indexOf(b[0]));
      ztoolkit.log(
        '[ModelDialogV2.refreshProviderList] pinned:',
        pinned.map(([id]) => id),
        'rest:',
        rest.map(([id]) => id)
      );
    } else {
      rest.push(...filtered);
    }

    const appendButton = (providerId: string, name: string) => {
      const btn = this.doc.createElement('button');
      btn.className = ModelDialogV2.SELECT_ITEM_CLASS;
      const img = this.doc.createElement('img');
      img.src = getModelsDevLogoUrl(providerId);
      img.onerror = () => {
        const fallback = resolveProviderIcon(providerId);
        img.src = fallback;
        if (fallback.startsWith('chrome://')) {
          img.classList.remove('provider-icon-img');
        }
      };
      img.className = 'w-4 h-4 shrink-0 provider-icon-img';
      btn.appendChild(img);
      const span = this.doc.createElement('span');
      span.textContent = name;
      btn.appendChild(span);
      btn.addEventListener('click', () => {
        this.hidePopup();
        this.addProviderCard(providerId as ProviderId);
        btn.remove();
      });
      this.providerList!.appendChild(btn);
    };

    for (const [id, p] of pinned) {
      appendButton(id, p.name);
    }
    if (pinned.length > 0 && rest.length > 0) {
      const sep = this.doc.createElement('div');
      sep.className = 'mx-3 my-1 border-t border-gray-100 dark:border-zinc-700';
      this.providerList.appendChild(sep);
    }
    for (const [id, p] of rest) {
      appendButton(id, p.name);
    }
    ztoolkit.log('[ModelDialogV2.refreshProviderList] DOM children:', this.providerList.children.length);

    // Custom provider button at bottom
    this.customButtonContainer.replaceChildren();
    ztoolkit.UI.appendElement(
      ProviderLogoButton({
        text: getString('model-dialog-custom-provider'),
        iconUrl: `chrome://${config.addonRef}/content/icons/favicon.svg`,
        onClick: () => {
          this.hidePopup();
          this.addCustomProviderCard();
        },
      }),
      this.customButtonContainer
    );
  }

  private renderProviders() {
    if (!this.searchInput) return;

    this.refreshProviderList();

    this.searchInput.addEventListener('input', () => {
      this.refreshProviderList(this.searchInput!.value);
    });
  }

  private async addProviderCard(providerId: string) {
    if (this.interacting) return;
    this.interacting = true;
    try {
      await this.ensureLiveData();
      ztoolkit.log('[ModelDialogV2] addProviderCard:', providerId);
      const v2 = addon.data.userProviderConfigV2!;
      const cp = this.getActiveProviders()?.[providerId];
      if (!v2.addedProviders[providerId] && cp) {
        const { models: _, ...rest } = cp;
        rest.env = filterGoogleEnvKeys(providerId, rest.env);
        v2.addedProviders[providerId] = rest as AddedProvider;
      }
      await cacheProviderIcon(providerId);
      this.createAndAppendCard(providerId);
    } finally {
      this.interacting = false;
    }
  }

  private async addCustomProviderCard() {
    if (this.interacting) return;
    this.interacting = true;
    try {
      await this.ensureLiveData();
      const customId = `custom-${crypto.randomUUID().slice(0, 8)}`;
      ztoolkit.log('[ModelDialogV2] addCustomProviderCard:', customId);
      const v2 = addon.data.userProviderConfigV2!;
      v2.addedProviders[customId] = {
        id: customId as ProviderId,
        name: 'Custom Provider',
        env: ['API_KEY'],
      };
      this.createAndAppendCard(customId);
    } finally {
      this.interacting = false;
    }
  }

  // ---- Save ----

  private async saveSettings() {
    const container = this.root?.querySelector('#provider-block');
    if (!container) return;

    const v2 = addon.data.userProviderConfigV2!;
    const newEnv: UserProviderConfigV2['env'] = {};
    const newAddedModels: AddedModel[] = [];
    const newAddedProviders: Record<string, AddedProvider> = {};

    const cards = container.querySelectorAll('.provider-card');
    cards.forEach((cardElement) => {
      if (cardElement.id === 'codex-provider-card') return;
      const getData = cardDataMap.get(cardElement);
      if (!getData) return;
      const cardData = getData();
      const { providerId, envValues: cardEnv, baseUrl, customName, models: cardModels } = cardData;

      // 过滤掉名为空的模型行（getData已做，此处兜底）
      const validModels = cardModels.filter((m) => m.id.trim() !== '');
      const hasNonEmptyEnv = Object.values(cardEnv).some((v) => v.trim() !== '');

      // 全空的 card 不保存
      if (!hasNonEmptyEnv && validModels.length === 0) {
        ztoolkit.log('[ModelDialogV2.saveSettings] Skipping empty card:', providerId);
        return;
      }

      ztoolkit.log('[ModelDialogV2.saveSettings] card:', {
        providerId,
        envKeys: Object.keys(cardEnv),
        models: validModels.map((m) => ({
          id: m.id,
          name: m.name,
          enabled: m.enabled,
        })),
      });

      // Env values
      if (hasNonEmptyEnv) {
        newEnv[providerId] = { ...cardEnv };
      }

      // Models (dedup by providerId + name)
      const seenModels = new Set<string>();
      for (const cm of validModels) {
        const dedupKey = `${providerId}::${cm.name.toLowerCase()}`;
        if (seenModels.has(dedupKey)) continue;
        seenModels.add(dedupKey);

        const existing = v2.addedModels.find((m) => m.providerId === providerId && m.id === cm.id);
        if (existing) {
          const refreshed = findModelMetadata(cm.name, undefined, providerId as ProviderId, this.getActiveProviders());
          const { id: _refreshedId, ...refreshedRest } = refreshed ?? {};
          newAddedModels.push({ ...existing, ...refreshedRest, enabled: cm.enabled });
        } else {
          // New model — search commonProviders for metadata
          const metadata = findModelMetadata(cm.name, undefined, providerId as ProviderId, this.getActiveProviders());
          newAddedModels.push({
            ...(metadata ?? {
              id: cm.name,
              name: cm.name,
              family: 'unknown' as import('../utils/providers').ModelFamily,
              reasoning: false,
              temperature: true,
              modalities: {
                input: ['text'],
                output: ['text'],
              } as import('../utils/providers').Modalities,
              open_weights: false,
              cost: { input: 0, output: 0 },
              limit: { context: 0, output: 0 },
            }),
            id: metadata?.id ?? cm.name,
            name: metadata?.name ?? cm.name,
            providerId: providerId as ProviderId,
            enabled: cm.enabled,
          });
        }
      }

      // Provider metadata
      const cp = this.getActiveProviders()?.[providerId];
      if (cp) {
        const { models: _, ...rest } = cp;
        rest.env = filterGoogleEnvKeys(providerId, rest.env);
        newAddedProviders[providerId] = rest as AddedProvider;
      } else {
        // Custom provider
        const fallbackName = v2.addedProviders[providerId]?.name ?? providerId;
        newAddedProviders[providerId] = {
          id: providerId as ProviderId,
          name: customName || fallbackName,
          env: ['API_KEY'],
          ...(baseUrl ? { api: baseUrl } : {}),
        };
      }
    });

    // Subscription metadata belongs to its dedicated runtime UI, not API-key cards.
    if (v2.addedProviders[CODEX_PROVIDER_ID]) {
      newAddedProviders[CODEX_PROVIDER_ID] = v2.addedProviders[CODEX_PROVIDER_ID];
      newAddedModels.push(...v2.addedModels.filter((model) => model.providerId === CODEX_PROVIDER_ID));
    }
    v2.env = newEnv;
    v2.addedModels = newAddedModels;
    v2.addedProviders = newAddedProviders;

    ztoolkit.log('[ModelDialogV2.saveSettings] new addon.data.userProviderConfigV2:', v2);
    await saveV2Config(v2);
  }

  // ---- Popup show/hide ----

  private bindPopupShowHide() {
    // Open on button click
    this.addProviderButton?.addEventListener('click', () => {
      this.showPopup();
    });

    // Close on overlay click (click outside the popup panel)
    this.overlay?.addEventListener('click', (event: Event) => {
      if (event.target === this.overlay) {
        this.hidePopup();
      }
    });

    // Close on Escape key
    this.doc.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (this.modelOverlay?.classList.contains('opacity-100')) {
          this.closeModelSelect();
        } else if (this.overlay?.classList.contains('opacity-100')) {
          this.hidePopup();
        }
      }
    });
  }

  private hidePopup() {
    if (this.searchInput) this.searchInput.value = '';
    this.overlay?.classList.remove('opacity-100');
    this.overlay?.classList.add('opacity-0', 'invisible', 'pointer-events-none');
    this.setBodyScrollLock(false);
  }

  private showPopup() {
    this.refreshProviderList();
    this.setBodyScrollLock(true);
    this.overlay?.classList.remove('opacity-0', 'invisible', 'pointer-events-none');
    this.overlay?.classList.add('opacity-100');
    this.searchInput?.focus();
  }

  // ---- Model selection popup ----

  async openModelSelect(providerId: string, onSelect: (modelId: string, modelName: string) => void) {
    if (!this.modelOverlay || !this.modelList || !this.modelSearchInput) return;
    if (this.interacting) return;
    this.interacting = true;
    await this.ensureLiveData();

    const models = this.getActiveProviders()?.[providerId]?.models ?? {};
    const entries = Object.entries(models).sort(([, a], [, b]) => a.name.localeCompare(b.name));

    const renderList = (query: string) => {
      this.modelList!.replaceChildren();
      const q = query.toLowerCase().trim();
      const filtered = q ? entries.filter(([, m]) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : entries;

      for (const [id, m] of filtered) {
        const btn = this.doc.createElement('button');
        btn.className = ModelDialogV2.SELECT_ITEM_CLASS;

        const iconSlot = this.doc.createElement('span');
        iconSlot.className = 'w-4 h-4 shrink-0 inline-flex items-center justify-center';
        const iconMarkup = getModelIconPath(m.family);
        if (iconMarkup !== ModelIcons.custom) {
          iconSlot.innerHTML = iconMarkup;
        }
        btn.appendChild(iconSlot);

        const span = this.doc.createElement('span');
        span.textContent = m.name;
        btn.appendChild(span);

        btn.addEventListener('click', () => {
          this.closeModelSelect();
          onSelect(id, m.name);
        });
        this.modelList!.appendChild(btn);
      }
    };

    // Replace old event listeners (previous handlers cleared)
    const prevKeyHandler = (this.modelSearchInput as any)._modelSelectKeyHandler;
    const prevInputHandler = (this.modelSearchInput as any)._modelSelectInputHandler;
    if (prevKeyHandler) this.modelSearchInput.removeEventListener('keydown', prevKeyHandler);
    if (prevInputHandler) this.modelSearchInput.removeEventListener('input', prevInputHandler);

    renderList('');

    const inputHandler = () => renderList(this.modelSearchInput!.value);

    const searchHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const val = this.modelSearchInput!.value.trim();
        if (val) {
          this.closeModelSelect();
          const foundById = models[val];
          if (foundById) {
            onSelect(val, foundById.name);
            return;
          }
          const foundByName = Object.entries(models).find(([, m]) => m.name.toLowerCase() === val.toLowerCase());
          if (foundByName) {
            onSelect(foundByName[0], foundByName[1].name);
            return;
          }
          onSelect(val, val);
        }
        return;
      }
      renderList(this.modelSearchInput!.value);
    };

    this.modelSearchInput.addEventListener('input', inputHandler);
    this.modelSearchInput.addEventListener('keydown', searchHandler);
    (this.modelSearchInput as any)._modelSelectInputHandler = inputHandler;
    (this.modelSearchInput as any)._modelSelectKeyHandler = searchHandler;

    this.modelSearchInput.value = '';

    // Close on overlay click
    this.modelOverlay.onclick = (e: Event) => {
      if (e.target === this.modelOverlay) this.closeModelSelect();
    };

    this.modelOverlay.classList.remove('opacity-0', 'invisible', 'pointer-events-none');
    this.modelOverlay.classList.add('opacity-100');
    this.setBodyScrollLock(true);
    this.modelSearchInput.focus();
  }

  closeModelSelect() {
    this.interacting = false;
    this.modelOverlay?.classList.remove('opacity-100');
    this.modelOverlay?.classList.add('opacity-0', 'invisible', 'pointer-events-none');
    this.setBodyScrollLock(false);
  }
}

export async function onModelDialogLoad(window: Window) {
  await new ModelDialogV2(window).init();
}
