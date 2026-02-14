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
    styles: {
      position: "relative",
    },
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
  const doc = anchor.ownerDocument;
  const container = anchor.closest(".ai-bar-container") as HTMLElement;
  if (!container) return;

  // Close function
  const closeDropdown = (e?: Event) => {
    // If click is inside dropdown, don't close
    if (e && (e.target as HTMLElement).closest("#ai-bar-model-dropdown")) {
      return;
    }

    const dropdown = doc.getElementById("ai-bar-model-dropdown");
    if (dropdown) {
      dropdown.remove();
    }
    doc.removeEventListener("click", closeDropdown, true);
    anchor.removeEventListener("blur", closeDropdown, true);
  };

  const existing = doc.getElementById("ai-bar-model-dropdown");
  if (existing) {
    // If existing, remove it and return (toggle off)
    existing.remove();
    doc.removeEventListener("click", closeDropdown, true);
    anchor.removeEventListener("blur", closeDropdown, true);
    return;
  }

  const dropdown = doc.createElement("div");
  dropdown.id = "ai-bar-model-dropdown";
  dropdown.className = "model-dropdown-menu";

  // Populate with providers and models
  const currentModelId = getPref("llm.modelId");
  const providers = addon.data.userProviderConfigs || [];

  if (providers.length === 0) {
    const emptyItem = doc.createElement("div");
    emptyItem.className = "model-dropdown-empty";
    emptyItem.textContent =
      getString("no-models-available" as any) || "No models available";
    dropdown.appendChild(emptyItem);
  } else {
    providers.forEach((provider) => {
      if (!provider.models || provider.models.length === 0) return;

      const groupTitle = doc.createElement("div");
      groupTitle.className = "model-dropdown-group-title";
      groupTitle.textContent = provider.name;
      dropdown.appendChild(groupTitle);

      const modelList = doc.createElement("div");
      modelList.className = "model-dropdown-group-list";

      provider.models.forEach((model) => {
        const item = doc.createElement("div");
        item.className = "model-dropdown-item";
        if (model.id === currentModelId) {
          item.classList.add("selected");
        }

        const modelAnalysis = analyzeModelName(model.name);
        const iconPath = getModelIconPath(modelAnalysis.family);

        ztoolkit.UI.appendElement(
          IconView({
            iconMarkup: iconPath,
            extraClasses: ["model-dropdown-icon"],
            sizeRem: 1.2,
          }),
          item,
        );

        const text = doc.createElement("span");
        text.textContent = model.name;
        item.appendChild(text);

        item.onclick = (e) => {
          e.stopPropagation();
          if (model.id) {
            setPref("llm.modelId", model.id);
            updateModelInfoDisplay(anchor);
          }
          // Force close
          const d = doc.getElementById("ai-bar-model-dropdown");
          if (d) d.remove();
          doc.removeEventListener("click", closeDropdown, true);
        };

        modelList.appendChild(item);
      });
      dropdown.appendChild(modelList);
    });
  }

  // Append to container to follow popup positioning
  container.appendChild(dropdown);

  // Position the dropdown relative to anchor
  dropdown.style.position = "absolute";
  dropdown.style.top = "calc(100% + 2px)";
  dropdown.style.left = "0";
  dropdown.style.zIndex = "10001";

  // Add click outside listener and blur
  // Use capture phase to ensure we catch clicks before they might be stopped
  setTimeout(() => {
    doc.addEventListener("click", closeDropdown, true);
    // Make anchor focusable temporarily to enable blur event
    if (!anchor.hasAttribute("tabindex")) {
      anchor.setAttribute("tabindex", "-1");
    }
  }, 10);
}
