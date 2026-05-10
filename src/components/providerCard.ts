/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * providerCard.ts
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

import { CardHead } from './cardHead';
import { CardModelRow } from './modelRow';
import { InlineButton } from './buttons/inlineButton';

export interface ProviderCardV2Props {
  providerId: string;
  providerName: string;
  iconUrl: string;
  baseUrl?: string;
  envKeys: string[];
  envValues: Record<string, string>;
  isCustom: boolean;
  models: { id: string; name: string; enabled: boolean }[];
  doc: Document;
  onAddModel?: (cb: (id: string, name: string) => void) => void;
  onDelete?: () => void;
}

export function ProviderCard({
  providerId,
  providerName,
  iconUrl,
  baseUrl,
  envKeys,
  envValues,
  isCustom,
  models,
  doc,
  onAddModel,
  onDelete = () => {},
}: ProviderCardV2Props): Node {
  const card = ztoolkit.UI.createElement(doc, 'div', {
    classList: [
      'overflow-clip',
      'bg-white',
      'dark:bg-zinc-900',
      'rounded-3xl',
      'shadow-sm',
      'border',
      'border-gray-200',
      'dark:border-zinc-800',
      'transition-all',
      'duration-300',
      'relative',
      'h-fit',
      'break-inside-avoid',
      'provider-card',
    ],
  });

  function onDeleteClicked() {
    card.remove();
    onDelete();
  }

  const cardBody = ztoolkit.UI.createElement(doc, 'div', {
    classList: ['grid', 'transition-all', 'duration-300', 'ease-in-out', 'grid-rows-[1fr]', 'opacity-100'],
    children: [
      {
        tag: 'div',
        classList: ['overflow-hidden'],
        children: [
          {
            tag: 'div',
            classList: ['text-[10px]', 'font-bold', 'text-zinc-400', 'uppercase', 'tracking-widest', 'px-1', 'm-4'],
            properties: { innerText: 'Models' },
          },
          {
            tag: 'div',
            classList: ['flex', 'flex-col', 'gap-2', 'px-4', 'model-card-list'],
          },
        ],
      },
    ],
  });

  const modelCardList = cardBody.querySelector('.model-card-list');

  const getExistingModelNames = (skipRow?: HTMLElement): Set<string> => {
    const names = new Set<string>();
    modelCardList?.querySelectorAll(':scope > div').forEach((rowEl) => {
      if (skipRow && rowEl === skipRow) return;
      const data = (rowEl as RowWithGetData).getData();
      if (data.name) names.add(data.name.toLowerCase());
    });
    return names;
  };

  const openSelectForRow = (row: HTMLElement, existingName?: string) => {
    onAddModel?.((id: string, name: string) => {
      const existing = getExistingModelNames(row as HTMLElement);
      if (existing.has(name.toLowerCase())) return;
      (row as HTMLElement).dataset.modelId = id;
      const textInput = row.querySelector('input[type="text"]') as HTMLInputElement;
      if (textInput) textInput.value = name;
    });
  };

  models.forEach((model) => {
    if (model.id) {
      const row = CardModelRow({
        doc,
        data: { id: model.id, name: model.name, enabled: model.enabled },
        onSelectModel: () => openSelectForRow(row as HTMLElement, model.name),
      });
      modelCardList?.appendChild(row);
    }
  });

  const addModelButton = ztoolkit.UI.createElement(
    doc,
    'button',
    InlineButton({
      onClicked: () => {
        onAddModel?.((id: string, name: string) => {
          if (!modelCardList) return;
          const existing = getExistingModelNames();
          if (existing.has(name.toLowerCase())) return;
          const row = CardModelRow({
            doc,
            data: { id, name, enabled: true },
            onSelectModel: () => openSelectForRow(row as HTMLElement, name),
          });
          modelCardList.insertBefore(row, addModelButton);
        });
      },
    })
  );

  let isCollapsed = false;

  function onToggleCollapse(e: Event) {
    const collapseBtn = e.currentTarget as HTMLElement;
    if (cardBody && collapseBtn) {
      if (isCollapsed) {
        cardBody.classList.remove('grid-rows-[0fr]', 'opacity-0');
        cardBody.classList.add('grid-rows-[1fr]', 'opacity-100');
        collapseBtn.firstElementChild?.classList.remove('rotate-90');
      } else {
        cardBody.classList.remove('grid-rows-[1fr]', 'opacity-100');
        cardBody.classList.add('grid-rows-[0fr]', 'opacity-0');
        collapseBtn.firstElementChild?.classList.add('rotate-90');
      }
    }
    isCollapsed = !isCollapsed;
  }

  interface RowWithGetData extends HTMLDivElement {
    getData: () => { id: string; name: string; enabled: boolean };
  }

  (card as any).getData = () => {
    const modelRows = modelCardList?.querySelectorAll(':scope > div');
    const collected: { id: string; name: string; enabled: boolean }[] = [];
    modelRows?.forEach((row: Element) => {
      const data = (row as RowWithGetData).getData();
      if (data.id && data.name !== '') {
        collected.push(data);
      }
    });
    const envValuesOut: Record<string, string> = {};
    card.querySelectorAll('.env-input').forEach((input) => {
      const el = input as HTMLInputElement;
      envValuesOut[el.placeholder] = el.value;
    });
    const result = {
      providerId,
      envValues: envValuesOut,
      baseUrl: isCustom ? (card.querySelector('.url-input') as HTMLInputElement).value : undefined,
      models: collected,
    };
    ztoolkit.log('[ProviderCard.getData]', {
      providerId,
      envKeys: Object.keys(envValuesOut),
      models: collected.map((m) => ({
        id: m.id,
        name: m.name,
        enabled: m.enabled,
      })),
    });
    return result;
  };

  const header = ztoolkit.UI.createElement(
    doc,
    'div',
    CardHead({
      iconUrl,
      providerName,
      baseUrl,
      envKeys,
      envValues,
      isCustom,
      onDeleteClicked,
      onToggleCollapse,
    })
  );

  modelCardList?.appendChild(addModelButton);
  card.append(header, cardBody);

  return card;
}
