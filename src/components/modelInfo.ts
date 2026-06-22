/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelInfo.ts
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

import { TagElementProps } from 'zotero-plugin-toolkit';
import { setPref } from '../utils/prefs';
import { saveV2Config } from '../utils/providers';
import { analyzeModelName, getModelIconPath } from '../utils/modelAnalyzer';
import { getString } from '../utils/locale';
import { IconView } from './iconView';
import { DropdownMenuGroup, fadeCloseDropdownMenu, toggleDropdownMenu } from './dropdownMenu';
import type { AddedModel, ProviderId } from '../utils/providers';

function resolveModelDisplayName(): string {
  const active = addon.data.userProviderConfigV2?.active;
  if (!active) return '';

  const addedModels = addon.data.userProviderConfigV2?.addedModels ?? [];
  const m = addedModels.find((m) => m.providerId === active.providerId && m.id === active.modelId);
  if (m?.name) return m.name;

  return active.modelId;
}

function buildCurrentModelInfoChildren(): TagElementProps[] {
  const modelName = resolveModelDisplayName();
  const modelAnalysis = analyzeModelName(modelName);
  const iconPath = getModelIconPath(modelAnalysis.family);

  const children: TagElementProps[] = [
    IconView({
      iconMarkup: iconPath,
      extraClasses: ['model-info-icon'],
      sizeRem: 1.5,
    }),
  ];

  if (modelAnalysis.version) {
    children.push({
      tag: 'span',
      classList: ['model-info-version'],
      properties: { textContent: modelAnalysis.version },
    });
  }

  if (modelAnalysis.type) {
    children.push({
      tag: 'span',
      classList: ['model-info-type'],
      properties: { textContent: modelAnalysis.type },
    });
  }

  return children;
}

function updateModelInfoDisplay(container: HTMLElement) {
  const children = buildCurrentModelInfoChildren();
  container.innerHTML = '';
  for (const child of children) {
    ztoolkit.UI.appendElement(child, container);
  }
}

/**
 * Track every ModelInfo anchor across windows (sidebar, reader popup) so we
 * can refresh them all when the active model changes elsewhere (settings
 * dialog, model dialog, reader popup, etc.).
 */
export function registerModelInfoAnchor(el: HTMLElement) {
  ensureRefreshHookWired();
  addon.data.modelInfoAnchors.add(el);
}

export function refreshAllModelInfoAnchors() {
  const set = addon.data.modelInfoAnchors;
  for (const el of set) {
    if (el.isConnected) {
      updateModelInfoDisplay(el);
    } else {
      set.delete(el);
    }
  }
}

/**
 * Wire the global refresh hook. Called lazily from registerModelInfoAnchor
 * (which only runs after `addon` exists) rather than at module load —
 * referencing `addon` at import time fails because the bundle is loaded
 * before `addon` is assigned in src/index.ts.
 */
let _refreshHookWired = false;
function ensureRefreshHookWired() {
  if (_refreshHookWired) return;
  _refreshHookWired = true;
  if (addon?.data && !addon.data.refreshModelInfoAnchors) {
    addon.data.refreshModelInfoAnchors = refreshAllModelInfoAnchors;
  }
}

export function ModelInfo(opts?: { dropUp?: boolean }): TagElementProps {
  const children = buildCurrentModelInfoChildren();
  const dropUp = opts?.dropUp ?? false;

  return {
    tag: 'div',
    id: 'ai-bar-model-info',
    classList: ['model-info-container'],
    children: children,
    listeners: [
      {
        type: 'click',
        listener: (e: Event) => {
          e.stopPropagation();
          toggleModelDropdown(e.currentTarget as HTMLElement, dropUp);
        },
      },
    ],
  };
}

function toggleModelDropdown(anchor: HTMLElement, dropUp = false) {
  const container = (anchor.closest('.ai-bar-container') || anchor.closest('[data-model-dropdown-container]')) as HTMLElement | null;
  if (!container) return;

  const active = addon.data.userProviderConfigV2?.active;
  const groups: DropdownMenuGroup[] = [];

  // v2 models: grouped by provider, only enabled
  const addedModels = addon.data.userProviderConfigV2?.addedModels ?? [];
  const addedProviders = addon.data.userProviderConfigV2?.addedProviders ?? {};
  const grouped = new Map<ProviderId, AddedModel[]>();
  for (const m of addedModels) {
    if (m.enabled === false) continue;
    const list = grouped.get(m.providerId) || [];
    list.push(m);
    grouped.set(m.providerId, list);
  }
  for (const [providerId, models] of grouped) {
    const provider = addedProviders[providerId];
    const items = models.map((m) => ({
      id: `${providerId}::${m.id}`,
      label: m.name,
      selected: active?.providerId === providerId && active?.modelId === m.id,
      renderLeading: (doc: Document) => {
        const holder = doc.createElement('span');
        holder.className = 'model-dropdown-icon-holder';
        ztoolkit.UI.appendElement(
          IconView({
            iconMarkup: getModelIconPath(m.family),
            extraClasses: ['model-dropdown-icon'],
            sizeRem: 1.2,
          }),
          holder
        );
        return holder;
      },
      onClick: () => {
        addon.data.userProviderConfigV2!.active = {
          providerId,
          modelId: m.id,
        };
        setPref('llm.modelId', `${providerId}::${m.id}`);
        saveV2Config(addon.data.userProviderConfigV2!);
        updateModelInfoDisplay(anchor);
      },
    }));
    groups.push({ title: provider?.name ?? providerId, items });
  }

  const dropdown = toggleDropdownMenu({
    menuId: 'ai-bar-model-dropdown',
    anchor,
    container,
    groups,
    emptyText: getString('no-models-available' as any) || 'No models available',
    dropUp,
  });

  // Hover-to-close with fade-out for both sidebar (dropUp) and reader popup.
  // Opening stays click-only.
  if (dropdown) {
    wireHoverFadeClose(anchor, dropdown);
  }
}

interface HoverCloseState {
  timer: number | undefined;
  dropdown: HTMLElement | undefined;
  wired: boolean;
}

function wireHoverFadeClose(anchor: HTMLElement, dropdown: HTMLElement) {
  const view = anchor.ownerDocument.defaultView;
  if (!view) return;
  const win: Window = view;
  const state =
    ((anchor as any)._modelHover as HoverCloseState | undefined) ??
    ((anchor as any)._modelHover = { timer: undefined, dropdown: undefined, wired: false });
  state.dropdown = dropdown;

  function schedule() {
    const dd = state.dropdown;
    if (!dd || !dd.isConnected) return;
    if (state.timer !== undefined) win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => {
      const root = dd.getRootNode() as Document | ShadowRoot;
      fadeCloseDropdownMenu(root, 'ai-bar-model-dropdown');
      state.timer = undefined;
    }, 250);
  }
  function cancel() {
    if (state.timer !== undefined) {
      win.clearTimeout(state.timer);
      state.timer = undefined;
    }
  }

  // Attach to the dropdown each open (it is recreated every time).
  dropdown.addEventListener('mouseleave', schedule);
  dropdown.addEventListener('mouseenter', cancel);

  // Attach to the anchor once — handlers read state.dropdown dynamically.
  if (!state.wired) {
    state.wired = true;
    anchor.addEventListener('mouseleave', schedule);
    anchor.addEventListener('mouseenter', cancel);
  }
}
