/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * toolCallBox.ts
 *
 * This file is part of Zotero AI Bar.
 */

import { Icons } from './common';
import { IconView } from './iconView';

export interface ToolCallBoxProps {
  doc: Document;
  toolName: string;
  icon?: string;
  summary: string;
  details: string | HTMLElement;
  isExpanded?: boolean;
}

const ICON_MAP: Record<string, string> = {
  grep: Icons.Search,
  read: Icons.Book,
  glob: Icons.FolderOpen,
  tree: Icons.Tree,
  ask_user: Icons.CircleQuestion,
  translate: Icons.Translate,
  capture_page: Icons.Screenshot,
  thinking: Icons.Brain,
};

export function ToolCallBox({ doc, toolName, icon, summary, details, isExpanded = false }: ToolCallBoxProps): HTMLElement {
  const container = ztoolkit.UI.createElement(doc, 'div', {
    classList: [
      'tool-call-box',
      'w-full',
      'rounded-xl',
      'border',
      'border-slate-200',
      'dark:border-zinc-700',
      'bg-slate-50',
      'dark:bg-zinc-800',
      'my-2',
      'overflow-hidden',
    ],
    children: [
      {
        tag: 'div',
        classList: ['tool-call-header', 'flex', 'items-center', 'gap-2', 'p-2', 'cursor-pointer', 'select-none'],
        children: [
          {
            tag: 'span',
            classList: ['tool-call-icon', 'flex', 'items-center', 'justify-center', 'flex-shrink-0'],
            children: [IconView({ iconMarkup: icon || ICON_MAP[toolName] || Icons.Wrench, sizeRem: 1 })],
          },
          {
            tag: 'span',
            classList: ['tool-call-name', 'text-xs', 'font-semibold', 'leading-none', 'text-slate-600', 'dark:text-zinc-300', 'flex-shrink-0'],
            properties: { textContent: toolName },
          },
          {
            tag: 'span',
            classList: ['tool-call-summary', 'text-xs', 'leading-none', 'text-slate-500', 'dark:text-zinc-400', 'truncate'],
            properties: { textContent: summary },
          },
          {
            tag: 'span',
            classList: [
              'tool-call-chevron',
              'ml-auto',
              'flex',
              'items-center',
              'justify-center',
              'flex-shrink-0',
              'transition-transform',
              'duration-300',
            ],
            children: [IconView({ iconMarkup: Icons.Chevron, sizeRem: 0.8 })],
          },
        ],
      },
      {
        tag: 'div',
        classList: ['tool-call-details', 'transition-all', 'duration-300', 'max-h-0', 'overflow-hidden'],
        children: [
          {
            tag: 'div',
            classList: ['tool-call-details-inner', 'p-2', 'text-xs', 'font-mono', 'text-slate-700', 'dark:text-zinc-200'],
          },
        ],
      },
    ],
  });

  const detailsInner = container.querySelector('.tool-call-details-inner') as HTMLElement;
  if (details && typeof details === 'object' && details.nodeType === 1) {
    detailsInner.appendChild(details as HTMLElement);
  } else {
    detailsInner.textContent = details as string;
    detailsInner.classList.add('whitespace-pre-wrap');
  }

  const header = container.querySelector('.tool-call-header') as HTMLElement;
  const detailsPanel = container.querySelector('.tool-call-details') as HTMLElement;
  const chevron = container.querySelector('.tool-call-chevron') as HTMLElement;

  let expanded = isExpanded;
  function applyState() {
    if (expanded) {
      detailsPanel.classList.remove('max-h-0', 'overflow-hidden');
      detailsPanel.classList.add('max-h-[32rem]', 'overflow-y-auto');
      chevron?.classList.add('rotate-180');
    } else {
      detailsPanel.classList.remove('max-h-[32rem]', 'overflow-y-auto');
      detailsPanel.classList.add('max-h-0', 'overflow-hidden');
      chevron?.classList.remove('rotate-180');
    }
  }
  function toggle() {
    expanded = !expanded;
    applyState();
  }

  header.addEventListener('click', toggle);
  applyState();
  return container;
}

export function updateToolCallBox(box: HTMLElement, summary: string, details: string | HTMLElement) {
  const summaryEl = box.querySelector('.tool-call-summary') as HTMLElement | null;
  if (summaryEl) summaryEl.textContent = summary;
  const detailsInner = box.querySelector('.tool-call-details-inner') as HTMLElement | null;
  if (!detailsInner) return;
  detailsInner.innerHTML = '';
  if (details && typeof details === 'object' && (details as HTMLElement).nodeType === 1) {
    detailsInner.appendChild(details as HTMLElement);
    detailsInner.classList.remove('whitespace-pre-wrap');
  } else {
    detailsInner.textContent = details as string;
    detailsInner.classList.add('whitespace-pre-wrap');
  }
}
