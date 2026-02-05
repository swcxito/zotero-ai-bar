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
import { getPref } from "../utils/prefs";
import { openDialog } from "./modelDialog";

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
