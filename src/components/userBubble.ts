/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * userBubble.ts
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

import { ChatBox } from './chatBox';
import { getString } from '../utils/locale';
import { Icons } from './common';
import { IconView } from './iconView';

const BUBBLE_ANIMATION_CLASSES = [
  'flex',
  'flex-col',
  'items-end',
  'min-w-[160px]',
  'max-w-[95%]',
  'sm:max-w-[85%]',
  'self-end',
  'animate-in',
  'fade-in',
  'slide-in-from-bottom-3',
  'duration-300',
];

const THUMB_CLASSES = [
  'w-14',
  'h-14',
  'object-cover',
  'rounded-lg',
  'cursor-pointer',
  'hover:ring-2',
  'hover:ring-rose-400',
  'dark:hover:ring-rose-600',
  'transition-shadow',
  'flex-shrink-0',
  'shadow-sm',
  'hover:shadow-md',
];

const REFERENCE_COLLAPSED_HEIGHT = '2.5rem';

function createReferenceCard(doc: Document, referenceText: string): HTMLElement {
  const card = doc.createElement('div');
  card.classList.add('chat-reference-card', 'w-full', 'px-2.5', 'text-left', 'text-xs', 'text-slate-500', 'dark:text-neutral-400');

  const contentRow = doc.createElement('div');
  contentRow.classList.add('flex', 'items-start', 'gap-1.5');

  const icon = ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Quote, sizeRem: 0.75 })) as HTMLElement;
  icon.classList.add('mt-1', 'flex-shrink-0', 'opacity-70', 'select-none');

  const content = doc.createElement('div');
  content.classList.add('min-w-0', 'flex-1');

  const body = doc.createElement('div');
  body.classList.add('chat-reference-text', 'whitespace-pre-wrap', 'break-words', 'leading-5');
  body.textContent = `“${referenceText}”`;
  body.style.maxHeight = REFERENCE_COLLAPSED_HEIGHT;
  body.style.overflow = 'hidden';

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.classList.add(
    'chat-reference-toggle',
    'mt-1',
    'text-xs',
    'font-medium',
    'text-slate-400',
    'dark:text-neutral-500',
    'hover:text-rose-600',
    'dark:hover:text-rose-300',
    'select-none'
  );
  toggle.textContent = getString('chat-reference-expand' as any);
  toggle.style.display = 'none';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.textContent = getString((expanded ? 'chat-reference-expand' : 'chat-reference-collapse') as any);
    body.style.maxHeight = expanded ? REFERENCE_COLLAPSED_HEIGHT : 'none';
  });

  content.append(body, toggle);
  contentRow.append(icon, content);
  card.appendChild(contentRow);

  let measurementAttempts = 0;
  const revealToggleIfNeeded = () => {
    if (!card.isConnected) {
      if (measurementAttempts++ < 60) scheduleMeasurement();
      return;
    }
    toggle.style.display = body.scrollHeight > body.clientHeight + 1 ? '' : 'none';
  };
  const view = doc.defaultView;
  function scheduleMeasurement() {
    if (view?.requestAnimationFrame) {
      view.requestAnimationFrame(revealToggleIfNeeded);
    } else {
      view?.setTimeout(revealToggleIfNeeded, 0);
    }
  }
  scheduleMeasurement();

  return card;
}

export function createUserMessageBubble(
  doc: Document,
  text: string,
  imageUrls: string[],
  openImageViewer: (images: string[], index: number) => void,
  referenceText?: string
): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.classList.add(...BUBBLE_ANIMATION_CLASSES);

  if (referenceText?.trim()) {
    wrapper.appendChild(createReferenceCard(doc, referenceText));
  }

  if (imageUrls.length > 0) {
    const imgsRow = doc.createElement('div');
    imgsRow.classList.add('flex', 'flex-wrap', 'gap-1.5', 'justify-end', 'pt-1', 'pr-1', 'pb-2');
    if (!text) {
      imgsRow.classList.add('mb-1', 'border-b-2', 'border-rose-500', 'dark:border-rose-600');
    } else {
      imgsRow.classList.add('mb-2');
    }

    imageUrls.forEach((dataUrl, idx) => {
      const thumb = doc.createElement('img');
      thumb.src = dataUrl;
      thumb.classList.add(...THUMB_CLASSES);
      thumb.addEventListener('click', () => {
        openImageViewer(imageUrls, idx);
      });
      imgsRow.appendChild(thumb);
    });
    wrapper.appendChild(imgsRow);
  }

  if (text) {
    const bubble = ChatBox({ doc, isUser: true }) as HTMLElement;
    const msgEl = bubble.querySelector('.chat-message') as HTMLElement | null;
    if (msgEl) {
      msgEl.textContent = text;
    }
    wrapper.appendChild(bubble);
  }

  return wrapper;
}
