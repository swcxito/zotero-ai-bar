/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * preferenceScript.ts
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

import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { openDialog } from "./modelDialog";
import { openPromptEditor } from "./promptEditor";
import { getLocaleID, getString } from "../utils/locale";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [],
      rows: [],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  updatePrefsUI();
  bindPrefEvents();
}

function makeId(id: string): string {
  return `#${config.addonRef}-${id}`;
}

function updateModelSelector(modelSelector: HTMLSelectElement, doc: Document) {
  const currentValue = modelSelector.value;
  modelSelector.innerHTML = "";
  const providers = addon.data.userProviderConfigs;
  for (const provider of providers ?? []) {
    for (const model of provider.models ?? []) {
      if (!model.id) continue;
      const option = doc.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name} (${provider.name})`;
      modelSelector.appendChild(option);
    }
    modelSelector.value = currentValue;
  }
}

function updatePrefsUI() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;
  //? model settings
  const modelSelector = doc.querySelector(
    makeId("model-selector"),
  ) as HTMLSelectElement;
  updateModelSelector(modelSelector, doc);
  const modelEditButton = doc.querySelector(
    makeId("model-edit-button"),
  ) as HTMLButtonElement;
  if (modelEditButton) {
    modelEditButton.addEventListener("click", () => {
      openDialog(() => updateModelSelector(modelSelector, doc));
    });
  }

  const temperatureInput = doc.querySelector(
    makeId("temperature-input"),
  ) as HTMLInputElement;
  const temperatureLabel = doc.querySelector(
    makeId("temperature-value"),
  ) as HTMLElement;
  if (temperatureInput && temperatureLabel) {
    bindInputToLabel(
      temperatureInput,
      temperatureLabel,
      getPref("llm.temperature100"),
      0.01,
    );
  }

  renderPromptPreview();
  const promptEditButton = doc.querySelector(makeId("prompt-edit-button"));
  if (promptEditButton) {
    promptEditButton.addEventListener("click", () => {
      openPromptEditor(() => renderPromptPreview());
    });
  }
}

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;
}

function bindInputToLabel(
  input: HTMLInputElement,
  label: HTMLElement,
  initValue: number,
  scale: number = 1,
) {
  input.addEventListener("input", () => {
    label.textContent = (Number(input.value) * scale).toFixed(2);
  });
  label.textContent = (initValue * scale).toFixed(2);
}

async function renderPromptPreview() {
  const renderLock = ztoolkit.getGlobal("Zotero").Promise.defer();
  const prefsWindow = addon.data.prefs?.window;
  if (!prefsWindow) return;
  const doc = prefsWindow.document;
  ztoolkit.log("Rendering prompt preview...");

  const orderLabel =
    (await (doc as any).l10n?.formatValue?.(getLocaleID("pref-order"))) ||
    getString("pref-order");
  const nameLabel =
    (await (doc as any).l10n?.formatValue?.(
      getLocaleID("pref-prompteditor-name-label"),
    )) || getString("pref-prompteditor-name-label");
  const descriptionLabel =
    (await (doc as any).l10n?.formatValue?.(
      getLocaleID("pref-prompteditor-description-label"),
    )) || getString("pref-prompteditor-description-label");

  const columns = [
    {
      dataKey: "name",
      label: nameLabel,
    },
    {
      dataKey: "description",
      label: descriptionLabel,
    },
  ];
  const tableHelper = new ztoolkit.VirtualizedTable(prefsWindow)
    .setContainerId(`${config.addonRef}-prompt-table-container`)
    .setProp({
      id: `${config.addonRef}-prompt-table`,
      columns: columns,
      showHeader: true,
      multiSelect: true,
      staticColumns: true,
      disableFontSizeScaling: true,
    })
    .setProp("getRowCount", () => addon.data.userPrompts?.length || 0)
    .setProp("getRowData", (index) => {
      const prompt = addon.data.userPrompts?.at(index);
      return prompt
        ? {
            name: prompt.name,
            description: prompt.description || "",
          }
        : {
            name: "no data",
            description: "no data",
          };
    })
    // Render the table.
    .render(-1, () => {
      renderLock.resolve();
    });
  await renderLock.promise;
}

function renderPromptPreviewOld() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  const container = doc.querySelector(
    makeId("prompt-preview-table"),
  ) as HTMLElement;
  if (!container) return;

  container.innerHTML = "";

  const userPrompts = addon.data.userPrompts ?? [];

  if (userPrompts.length === 0) {
    const noPromptsRow = doc.createElement("hbox");
    const noPromptsLabel = doc.createElement("label");
    noPromptsLabel.setAttribute("data-l10n-id", "pref-no-custom-prompts");
    noPromptsRow.appendChild(noPromptsLabel);
    container.appendChild(noPromptsRow);
    return;
  }

  container.style.border = "1px solid #ccc";
  container.style.borderRadius = "4px";

  const headerRow = doc.createElement("hbox");
  headerRow.setAttribute("align", "center");
  headerRow.style.fontWeight = "bold";
  headerRow.style.gap = "12px";
  headerRow.style.padding = "8px 12px";
  headerRow.style.backgroundColor = "#f5f5f5";
  headerRow.style.borderBottom = "1px solid #ccc";

  const orderHeader = doc.createElement("label");
  orderHeader.textContent = "Order";
  orderHeader.style.width = "64px";
  orderHeader.style.textAlign = "center";

  const nameHeader = doc.createElement("label");
  nameHeader.textContent = "Name";
  nameHeader.style.minWidth = "120px";

  const descHeader = doc.createElement("label");
  descHeader.textContent = "Description";
  descHeader.setAttribute("flex", "1");

  headerRow.appendChild(orderHeader);
  headerRow.appendChild(nameHeader);
  headerRow.appendChild(descHeader);
  container.appendChild(headerRow);

  userPrompts.forEach((prompt, index) => {
    const row = doc.createElement("hbox");
    row.setAttribute("align", "center");
    row.style.gap = "12px";
    row.style.padding = "8px 12px";
    row.style.backgroundColor = index % 2 === 0 ? "#ffffff" : "#fafafa";
    row.style.borderBottom =
      index === userPrompts.length - 1 ? "none" : "1px solid #e0e0e0";

    const buttonsContainer = doc.createElement("hbox");
    buttonsContainer.setAttribute("align", "center");
    buttonsContainer.style.gap = "4px";
    buttonsContainer.style.width = "64px";
    buttonsContainer.style.justifyContent = "center";

    const upButton = doc.createElement("button");
    upButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => {
      if (index === 0) return;
      const newPrompts = [...userPrompts];
      [newPrompts[index - 1], newPrompts[index]] = [
        newPrompts[index],
        newPrompts[index - 1],
      ];
      addon.data.userPrompts = newPrompts;
      setPref("prompt.userPrompts", JSON.stringify(newPrompts));
      renderPromptPreview();
    });

    const downButton = doc.createElement("button");
    downButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    downButton.disabled = index === userPrompts.length - 1;
    downButton.addEventListener("click", () => {
      if (index === userPrompts.length - 1) return;
      const newPrompts = [...userPrompts];
      [newPrompts[index], newPrompts[index + 1]] = [
        newPrompts[index + 1],
        newPrompts[index],
      ];
      addon.data.userPrompts = newPrompts;
      setPref("prompt.userPrompts", JSON.stringify(newPrompts));
      renderPromptPreview();
    });

    buttonsContainer.appendChild(upButton);
    buttonsContainer.appendChild(downButton);

    const nameLabel = doc.createElement("label");
    nameLabel.textContent = prompt.name;
    nameLabel.style.fontWeight = "bold";
    nameLabel.style.minWidth = "120px";

    const descLabel = doc.createElement("label");
    descLabel.textContent = prompt.description || "";
    descLabel.setAttribute("flex", "1");
    descLabel.style.overflow = "hidden";
    descLabel.style.textOverflow = "ellipsis";
    descLabel.style.whiteSpace = "nowrap";

    row.appendChild(buttonsContainer);
    row.appendChild(nameLabel);
    row.appendChild(descLabel);
    container.appendChild(row);
  });
}
