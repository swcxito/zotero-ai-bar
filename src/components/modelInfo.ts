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
import { getPref, setPref } from "../utils/prefs";
import { analyzeModelName, getModelIconPath } from "../utils/modelAnalyzer";
import { UserProviderConfig, UserProviderModel } from "../types";
import { getString } from "../utils/locale";
import { IconView } from "./iconView";
import { DropdownMenuGroup, toggleDropdownMenu } from "./dropdownMenu";

/**
 * Update the model info display
 */
function updateModelInfoDisplay(container: HTMLElement) {
  const modelId = getPref("llm.modelId") || "";

  // Find model name from userProviderConfigs
  let modelName = "";
  if (modelId && addon.data.userProviderConfigs) {
    for (const provider of addon.data.userProviderConfigs) {
      const model = provider.models?.find((m) => m.id === modelId);
      if (model?.name) {
        modelName = model.name;
        break;
      }
    }
  }

  const modelAnalysis = analyzeModelName(modelName);
  const iconPath = getModelIconPath(modelAnalysis.family);

  container.innerHTML = "";

  // Add model icon
  ztoolkit.UI.appendElement(
    IconView({
      iconMarkup: iconPath,
      extraClasses: ["model-info-icon"],
      sizeRem: 1.5,
    }),
    container,
  );

  // Add version text if available
  if (modelAnalysis.version) {
    ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["model-info-version"],
        properties: {
          textContent: modelAnalysis.version,
        },
      },
      container,
    );
  }

  // Add type text if available
  if (modelAnalysis.type) {
    ztoolkit.UI.appendElement(
      {
        tag: "span",
        classList: ["model-info-type"],
        properties: {
          textContent: modelAnalysis.type,
        },
      },
      container,
    );
  }
}

/**
 * Create a model info display component
 * Shows model icon, type, and version based on user configuration
 */
export function ModelInfo(): TagElementProps {
  const modelId = getPref("llm.modelId") || "";

  // Find model name from userProviderConfigs
  let modelName = "";
  if (modelId && addon.data.userProviderConfigs) {
    for (const provider of addon.data.userProviderConfigs) {
      const model = provider.models?.find((m) => m.id === modelId);
      if (model?.name) {
        modelName = model.name;
        break;
      }
    }
  }

  const modelAnalysis = analyzeModelName(modelName);
  const iconPath = getModelIconPath(modelAnalysis.family);

  const children: TagElementProps[] = [];

  // Add model icon
  children.push(
    IconView({
      iconMarkup: iconPath,
      extraClasses: ["model-info-icon"],
      sizeRem: 1.5,
    }),
  );

  // Add version text if available (top-right corner)
  if (modelAnalysis.version) {
    children.push({
      tag: "span",
      classList: ["model-info-version"],
      properties: {
        textContent: modelAnalysis.version,
      },
    });
  }

  // Add type text if available (bottom-right corner)
  if (modelAnalysis.type) {
    children.push({
      tag: "span",
      classList: ["model-info-type"],
      properties: {
        textContent: modelAnalysis.type,
      },
    });
  }

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
          const target = e.currentTarget as HTMLElement;
          toggleModelDropdown(target);
        },
      },
    ],
  };
}

function toggleModelDropdown(anchor: HTMLElement) {
  const container = anchor.closest(".ai-bar-container") as HTMLElement;
  if (!container) return;

  // Populate with providers and models
  const currentModelId = getPref("llm.modelId");
  const providers = addon.data.userProviderConfigs || [];

  const groups: DropdownMenuGroup[] = providers
    .filter((provider) => (provider.models || []).length > 0)
    .map((provider) => ({
      title: provider.name,
      items: (provider.models || []).map((model) => ({
        id: model.id || model.name,
        label: model.name,
        selected: model.id === currentModelId,
        renderLeading: (doc: Document) => {
          const holder = doc.createElement("span");
          const modelAnalysis = analyzeModelName(model.name);
          const iconPath = getModelIconPath(modelAnalysis.family);
          ztoolkit.UI.appendElement(
            IconView({
              iconMarkup: iconPath,
              extraClasses: ["model-dropdown-icon"],
              sizeRem: 1.2,
            }),
            holder,
          );
          return holder;
        },
        onClick: () => {
          if (model.id) {
            setPref("llm.modelId", model.id);
            updateModelInfoDisplay(anchor);
          }
        },
      })),
    }));

  toggleDropdownMenu({
    menuId: "ai-bar-model-dropdown",
    anchor,
    container,
    groups,
    emptyText: getString("no-models-available" as any) || "No models available",
  });
}
