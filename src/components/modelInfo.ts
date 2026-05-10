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
import { DropdownMenuGroup, toggleDropdownMenu } from './dropdownMenu';
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

export function ModelInfo(): TagElementProps {
  const children = buildCurrentModelInfoChildren();

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
          toggleModelDropdown(e.currentTarget as HTMLElement);
        },
      },
    ],
  };
}

function toggleModelDropdown(anchor: HTMLElement) {
  const container = anchor.closest('.ai-bar-container') as HTMLElement;
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

  toggleDropdownMenu({
    menuId: 'ai-bar-model-dropdown',
    anchor,
    container,
    groups,
    emptyText: getString('no-models-available' as any) || 'No models available',
  });
}
