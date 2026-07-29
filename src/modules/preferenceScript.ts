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

import { config } from '../../package.json';
import { getPref, setPref } from '../utils/prefs';
import type { ProviderId } from '../utils/providers';
import { saveV2Config } from '../utils/providers';
import { openDialog } from './modelDialog';
import { openPromptEditor } from './promptEditor';
import { getLocaleID, getString } from '../utils/locale';
import { setSeparateTranslationEnabled } from './chatWorkspace';

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
  await updatePrefsUI();
  bindPrefEvents();
}

function makeId(id: string): string {
  return `#${config.addonRef}-${id}`;
}

function populateSelectorFromV2(selector: HTMLSelectElement, doc: Document, includeEmptyOption: boolean = false) {
  const currentValue = selector.value;
  selector.innerHTML = '';
  if (includeEmptyOption) {
    const opt = doc.createElement('option');
    opt.value = '';
    selector.appendChild(opt);
  }

  // v2 models: use AddedModel data directly, only enabled
  const addedModels = addon.data.userProviderConfigV2?.addedModels ?? [];
  const addedProviders = addon.data.userProviderConfigV2?.addedProviders ?? {};
  for (const m of addedModels) {
    if (m.enabled === false) continue;
    const provider = addedProviders[m.providerId];
    const providerName = provider?.name ?? m.providerId;
    const opt = doc.createElement('option');
    opt.value = `${m.providerId}::${m.id}`;
    opt.textContent = `${m.name} (${providerName})`;
    selector.appendChild(opt);
  }

  selector.value = currentValue;
}

function setActiveFromCompositeKey(value: string) {
  if (!value) return;
  const sepIdx = value.indexOf('::');
  if (sepIdx < 0) return;
  const providerId = value.slice(0, sepIdx);
  const modelId = value.slice(sepIdx + 2);
  if (addon.data.userProviderConfigV2) {
    addon.data.userProviderConfigV2.active = {
      providerId: providerId as ProviderId,
      modelId,
    };
    saveV2Config(addon.data.userProviderConfigV2);
  }
}

function setInitialSelectorValue(selector: HTMLSelectElement, doc: Document) {
  const active = addon.data.userProviderConfigV2?.active;
  if (active) {
    selector.value = `${active.providerId}::${active.modelId}`;
  }
}

async function updatePrefsUI() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;

  // Model selector
  const modelSelector = doc.querySelector(makeId('model-selector')) as HTMLSelectElement;
  populateSelectorFromV2(modelSelector, doc);
  setInitialSelectorValue(modelSelector, doc);
  modelSelector.addEventListener('change', () => {
    setActiveFromCompositeKey(modelSelector.value);
  });

  const modelEditButton = doc.querySelector(makeId('model-edit-button')) as HTMLButtonElement;
  if (modelEditButton) {
    modelEditButton.addEventListener('click', () => {
      openDialog(() => {
        // Dialog has already updated addon.data.userProviderConfigV2 in memory
        populateSelectorFromV2(modelSelector, doc);
        setInitialSelectorValue(modelSelector, doc);
      });
    });
  }

  const temperatureInput = doc.querySelector(makeId('temperature-input')) as HTMLInputElement;
  const temperatureLabel = doc.querySelector(makeId('temperature-value')) as HTMLElement;
  if (temperatureInput && temperatureLabel) {
    bindInputToLabel(temperatureInput, temperatureLabel, getPref('llm.temperature100'), 0.01);
  }

  const temperatureCheckbox = doc.querySelector(makeId('temperature-enabled')) as HTMLInputElement;
  if (temperatureCheckbox && temperatureInput) {
    const syncTemperatureDisabled = () => {
      temperatureInput.disabled = !temperatureCheckbox.checked;
      if (temperatureLabel) {
        temperatureLabel.style.opacity = temperatureCheckbox.checked ? '1' : '0.5';
      }
    };
    temperatureCheckbox.addEventListener('change', syncTemperatureDisabled);
    syncTemperatureDisabled();
  }

  const translateModelSelector = doc.querySelector(makeId('translate-model-selector')) as HTMLSelectElement;
  if (translateModelSelector) {
    populateSelectorFromV2(translateModelSelector, doc, true);
  }

  // Populate target language selector from Zotero.Styles.locales
  const targetLangSelector = doc.querySelector(makeId('translate-target-language')) as HTMLSelectElement;
  if (targetLangSelector) {
    const currentValue = targetLangSelector.value;
    // Remove all dynamically-added options except the first ("Follow Zotero Language")
    while (targetLangSelector.options.length > 1) {
      targetLangSelector.remove(1);
    }
    try {
      ztoolkit.log('[updatePrefsUI] Zotero.Styles.initialized():', Zotero.Styles.initialized());
      if (!Zotero.Styles.initialized()) {
        ztoolkit.log('[updatePrefsUI] Calling Zotero.Styles.init()...');
        await Zotero.Styles.init();
        ztoolkit.log('[updatePrefsUI] Zotero.Styles.init() completed');
      }
      const locales = Zotero.Styles.locales as Record<string, string>;
      ztoolkit.log('[updatePrefsUI] Zotero.Styles.locales keys count:', Object.keys(locales).length);
      const zoteroLocale = Zotero.locale || 'en-US';
      const sortedCodes = Object.keys(locales).sort();
      for (const code of sortedCodes) {
        const opt = doc.createElement('option');
        opt.value = code;
        opt.textContent = locales[code];
        targetLangSelector.appendChild(opt);
      }
      // Move current Zotero locale to second position (right after "Follow Zotero Language")
      const zoteroOpt =
        Array.from(targetLangSelector.options).find((opt) => opt.value === zoteroLocale) ??
        Array.from(targetLangSelector.options).find((opt) => opt.value === zoteroLocale.split('-')[0]);
      if (zoteroOpt && zoteroOpt.index > 1) {
        targetLangSelector.insertBefore(zoteroOpt, targetLangSelector.options[1]);
      }
    } catch (e) {
      ztoolkit.log('[updatePrefsUI] Failed to populate target languages:', e);
    }
    targetLangSelector.value = currentValue;
  }

  renderPromptPreview();
  const promptEditButton = doc.querySelector(makeId('prompt-edit-button'));
  if (promptEditButton) {
    promptEditButton.addEventListener('click', () => {
      openPromptEditor(() => renderPromptPreview());
    });
  }
}

function bindPrefEvents() {
  const doc = addon.data.prefs?.window.document;
  if (!doc) return;
  const separateTranslation = doc.querySelector(makeId('separate-translation-tab')) as HTMLInputElement | null;
  if (!separateTranslation) return;
  const syncSeparateTranslation = () => {
    setSeparateTranslationEnabled(!!separateTranslation.checked);
  };
  separateTranslation.addEventListener('change', syncSeparateTranslation);
  separateTranslation.addEventListener('command', syncSeparateTranslation);
}

function bindInputToLabel(input: HTMLInputElement, label: HTMLElement, initValue: number, scale: number = 1) {
  input.addEventListener('input', () => {
    label.textContent = (Number(input.value) * scale).toFixed(2);
  });
  label.textContent = (initValue * scale).toFixed(2);
}

async function renderPromptPreview() {
  const renderLock = ztoolkit.getGlobal('Zotero').Promise.defer();
  const prefsWindow = addon.data.prefs?.window;
  if (!prefsWindow) return;
  const doc = prefsWindow.document;
  ztoolkit.log('Rendering prompt preview...');

  const orderLabel = (await (doc as any).l10n?.formatValue?.(getLocaleID('pref-order'))) || getString('pref-order');
  const nameLabel =
    (await (doc as any).l10n?.formatValue?.(getLocaleID('pref-prompteditor-name-label'))) || getString('pref-prompteditor-name-label');
  const descriptionLabel =
    (await (doc as any).l10n?.formatValue?.(getLocaleID('pref-prompteditor-description-label'))) || getString('pref-prompteditor-description-label');

  const columns = [
    {
      dataKey: 'name',
      label: nameLabel,
    },
    {
      dataKey: 'description',
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
    .setProp('getRowCount', () => addon.data.userPrompts?.length || 0)
    .setProp('getRowData', (index) => {
      const prompt = addon.data.userPrompts?.at(index);
      return prompt
        ? {
            name: prompt.name,
            description: prompt.description || '',
          }
        : {
            name: 'no data',
            description: 'no data',
          };
    })
    // Render the table.
    .render(-1, () => {
      renderLock.resolve();
    });
  await renderLock.promise;
}
