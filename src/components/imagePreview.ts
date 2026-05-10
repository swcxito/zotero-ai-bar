/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * imagePreview.ts
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

import { Icons } from './common';
import { IconView } from './iconView';
import { getReaderByTabId } from '../modules/tabObserver';
import { getPref } from '../utils/prefs';
import { openCapturePreview } from '../modules/capture';

const MAX_IMAGES = 9;

export interface ImagePreviewAPI {
  container: HTMLElement;
  render: () => void;
  addImage: (dataUrl: string) => void;
  getCount: () => number;
  isFull: () => boolean;
  destroy: () => void;
}

export function ImagePreview(doc: Document, sectionId: string, onChange?: () => void): ImagePreviewAPI {
  if (!addon.data.inputImages.has(sectionId)) {
    addon.data.inputImages.set(sectionId, []);
  }

  // ── preview strip container ──────────────────────────────────────────────
  const strip = doc.createElement('div');
  strip.classList.add(
    'image-preview-strip',
    'w-full',
    'flex',
    'items-center',
    'gap-2',
    'overflow-x-auto',
    'overflow-y-hidden',
    'transition-all',
    'duration-300',
    'ease-in-out'
  );
  strip.style.height = '0';
  strip.style.minHeight = '0';
  strip.style.padding = '0';
  strip.style.overflow = 'hidden';

  // ── image viewer overlay (lazily created) ────────────────────────────────
  let viewerOverlay: HTMLElement | null = null;

  function getMountPoint(): { parent: HTMLElement; ownerDoc: Document } {
    const root = strip.getRootNode() as any;

    // Sidebar mode (inside shadow DOM): try to mount on reader's body
    if (root.host) {
      const reader = getReaderByTabId(addon.chatManager.currentTabID);
      if (reader) {
        const iframeWindow = (reader as any)._iframeWindow;
        const readerDoc = iframeWindow?.[0]?.document;
        if (readerDoc?.body) {
          return { parent: readerDoc.body, ownerDoc: readerDoc };
        }
      }
      return { parent: root as unknown as HTMLElement, ownerDoc: doc };
    }

    // Window mode: mount on document body
    const body = (root as Document).body || (root as Document).documentElement;
    return { parent: body, ownerDoc: root as Document };
  }

  function openViewer(dataUrl: string) {
    // Sidebar mode: check preference for viewer location
    if ((strip.getRootNode() as any).host && getPref('imagePreview.location') === 'window') {
      openCapturePreview(dataUrl);
      return;
    }

    closeViewer();

    const { parent, ownerDoc } = getMountPoint();

    viewerOverlay = ownerDoc.createElement('div');
    viewerOverlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);cursor:pointer;';
    viewerOverlay.tabIndex = -1;

    const viewerImg = ownerDoc.createElement('img');
    viewerImg.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);';
    viewerImg.alt = '图片预览';
    viewerImg.src = dataUrl;
    viewerOverlay.appendChild(viewerImg);

    viewerOverlay.addEventListener('click', (e) => {
      if (e.target === viewerOverlay) closeViewer();
    });

    viewerOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeViewer();
    });

    parent.appendChild(viewerOverlay);
    viewerOverlay.focus();
  }

  function closeViewer() {
    if (viewerOverlay?.parentNode) {
      viewerOverlay.parentNode.removeChild(viewerOverlay);
    }
  }

  // ── remove button factory ────────────────────────────────────────────────
  function createRemoveButton(index: number): HTMLButtonElement {
    const btn = doc.createElement('button');
    btn.classList.add(
      'absolute',
      'top-0.5',
      'right-0.5',
      'w-6',
      'h-6',
      'flex',
      'items-center',
      'justify-center',
      'rounded-full',
      'bg-black/60',
      'text-white',
      'opacity-0',
      'group-hover:opacity-100',
      'transition-opacity',
      'duration-200',
      'hover:bg-black/80',
      'z-10',
      'border-0',
      'p-0',
      'cursor-pointer'
    );
    btn.title = '移除图片';

    const iconSpan = ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.CloseCircle, sizeRem: 0.875 }));
    btn.appendChild(iconSpan);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const images = addon.data.inputImages.get(sectionId);
      if (images) {
        images.splice(index, 1);
        if (images.length === 0) {
          addon.data.inputImages.delete(sectionId);
        }
      }
      render();
    });

    return btn;
  }

  // ── render thumbnails from addon.data ────────────────────────────────────
  function render() {
    const images = addon.data.inputImages.get(sectionId) || [];
    strip.innerHTML = '';

    if (images.length === 0) {
      strip.style.height = '0';
      strip.style.minHeight = '0';
      strip.style.padding = '0';
      strip.style.overflow = 'hidden';
      onChange?.();
      return;
    }

    strip.style.overflow = '';
    strip.style.height = '80px';
    strip.style.minHeight = '80px';
    strip.style.padding = '4px 4px 8px 4px';

    images.forEach((dataUrl, index) => {
      const thumbWrapper = doc.createElement('div');
      thumbWrapper.classList.add('relative', 'flex-shrink-0', 'group', 'rounded-lg', 'overflow-hidden', 'cursor-pointer');
      thumbWrapper.style.width = '64px';
      thumbWrapper.style.height = '64px';

      const img = doc.createElement('img');
      img.src = dataUrl;
      img.classList.add('w-full', 'h-full', 'object-cover', 'rounded-lg', 'pointer-events-none');
      img.alt = `截图 ${index + 1}`;

      const removeBtn = createRemoveButton(index);

      thumbWrapper.addEventListener('click', () => openViewer(dataUrl));

      thumbWrapper.appendChild(img);
      thumbWrapper.appendChild(removeBtn);
      strip.appendChild(thumbWrapper);
    });

    onChange?.();
  }

  // ── add a single image ──────────────────────────────────────────────────
  function addImage(dataUrl: string) {
    if (!addon.data.inputImages.has(sectionId)) {
      addon.data.inputImages.set(sectionId, []);
    }
    const images = addon.data.inputImages.get(sectionId)!;
    if (images.length >= MAX_IMAGES) return;
    images.push(dataUrl);
    render();
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  function getCount(): number {
    return (addon.data.inputImages.get(sectionId) || []).length;
  }

  function isFull(): boolean {
    return getCount() >= MAX_IMAGES;
  }

  function destroy() {
    closeViewer();
  }

  return { container: strip, render, addImage, getCount, isFull, destroy };
}
