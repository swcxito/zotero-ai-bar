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

import { TagElementProps } from "zotero-plugin-toolkit";
import { setPref } from "../utils/prefs";
import { analyzeModelName, getModelIconPath } from "../utils/modelAnalyzer";
import { getString } from "../utils/locale";
import { IconView } from "./iconView";
import { DropdownMenuGroup, toggleDropdownMenu } from "./dropdownMenu";
import type { ProviderId } from "../utils/providers";

function resolveModelDisplayName(): string {
  const active = addon.data.userProviderConfigV2?.active;
  if (!active) return "";

  const cp = addon.data.commonProviders;
  const v2Model = cp?.[active.providerId]?.models?.[active.modelId];
  if (v2Model?.name) return v2Model.name;

  for (const conf of addon.data.legacyCustomProviderConfigs ?? []) {
    const m = conf.models?.find(
      (m) => m.id === active.modelId || m.name === active.modelId,
    );
    if (m?.name) return m.name;
  }

  return active.modelId;
}

function buildCurrentModelInfoChildren(): TagElementProps[] {
  const modelName = resolveModelDisplayName();
  const modelAnalysis = analyzeModelName(modelName);
  const iconPath = getModelIconPath(modelAnalysis.family);

  const children: TagElementProps[] = [
    IconView({
      iconMarkup: iconPath,
      extraClasses: ["model-info-icon"],
      sizeRem: 1.5,
    }),
  ];

  if (modelAnalysis.version) {
    children.push({
      tag: "span",
      classList: ["model-info-version"],
      properties: { textContent: modelAnalysis.version },
    });
  }

  if (modelAnalysis.type) {
    children.push({
      tag: "span",
      classList: ["model-info-type"],
      properties: { textContent: modelAnalysis.type },
    });
  }

  return children;
}

function updateModelInfoDisplay(container: HTMLElement) {
  const children = buildCurrentModelInfoChildren();
  container.innerHTML = "";
  for (const child of children) {
    ztoolkit.UI.appendElement(child, container);
  }
}

export function ModelInfo(): TagElementProps {
  const children = buildCurrentModelInfoChildren();

  return {
    tag: "div",
    id: "ai-bar-model-info",
    classList: ["model-info-container"],
    children: children,
    listeners: [
      {
        type: "click",
        listener: (e: Event) => {
          e.stopPropagation();
          toggleModelDropdown(e.currentTarget as HTMLElement);
        },
      },
    ],
  };
}

function toggleModelDropdown(anchor: HTMLElement) {
  const container = anchor.closest(".ai-bar-container") as HTMLElement;
  if (!container) return;

  const active = addon.data.userProviderConfigV2?.active;
  const groups: DropdownMenuGroup[] = [];

  // v2 models: only show what's in addedModels, grouped by provider
  const cp = addon.data.commonProviders;
  const addedModels = addon.data.userProviderConfigV2?.addedModels ?? [];
  if (cp) {
    const grouped = new Map<string, typeof addedModels>();
    for (const m of addedModels) {
      if (!cp[m.providerId]?.models?.[m.modelId]) continue;
      const list = grouped.get(m.providerId) || [];
      list.push(m);
      grouped.set(m.providerId, list);
    }
    for (const [providerId, models] of grouped) {
      const provider = cp[providerId];
      const items = models.map((m) => {
        const model = provider.models[m.modelId];
        return {
          id: `${providerId}::${m.modelId}`,
          label: model.name,
          selected:
            active?.providerId === providerId && active?.modelId === m.modelId,
          renderLeading: (doc: Document) => {
            const holder = doc.createElement("span");
            ztoolkit.UI.appendElement(
              IconView({
                iconMarkup: getModelIconPath(
                  analyzeModelName(model.name).family,
                ),
                extraClasses: ["model-dropdown-icon"],
                sizeRem: 1.2,
              }),
              holder,
            );
            return holder;
          },
          onClick: () => {
            addon.data.userProviderConfigV2!.active = {
              providerId: providerId as ProviderId,
              modelId: m.modelId,
            };
            setPref("llm.modelId", `${providerId}::${m.modelId}`);
            updateModelInfoDisplay(anchor);
          },
        };
      });
      groups.push({ title: provider.name, items });
    }
  }

  // Legacy custom providers
  for (const conf of addon.data.legacyCustomProviderConfigs ?? []) {
    const items = (conf.models ?? []).map((model) => {
      const itemId = `${conf.id}::${model.name}`;
      return {
        id: itemId,
        label: model.name,
        selected: active?.providerId === conf.id && active?.modelId === model.name,
        renderLeading: (doc: Document) => {
          const holder = doc.createElement("span");
          ztoolkit.UI.appendElement(
            IconView({
              iconMarkup: getModelIconPath(analyzeModelName(model.name).family),
              extraClasses: ["model-dropdown-icon"],
              sizeRem: 1.2,
            }),
            holder,
          );
          return holder;
        },
        onClick: () => {
          addon.data.userProviderConfigV2!.active = {
            providerId: conf.id as ProviderId,
            modelId: model.name,
          };
          setPref("llm.modelId", itemId);
          updateModelInfoDisplay(anchor);
        },
      };
    });
    if (items.length > 0) {
      groups.push({ title: conf.name, items });
    }
  }

  toggleDropdownMenu({
    menuId: "ai-bar-model-dropdown",
    anchor,
    container,
    groups,
    emptyText: getString("no-models-available" as any) || "No models available",
  });
}
