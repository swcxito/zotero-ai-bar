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

const BUBBLE_ANIMATION_CLASSES = [
  'flex',
  'flex-col',
  'items-end',
  'min-w-[160px]',
  'max-w-[85%]',
  'sm:max-w-[75%]',
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

export function createUserMessageBubble(
  doc: Document,
  text: string,
  imageUrls: string[],
  openImageViewer: (images: string[], index: number) => void
): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.classList.add(...BUBBLE_ANIMATION_CLASSES);

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
