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

const ARROW_LEFT_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
const ARROW_RIGHT_SVG =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

function createNavButton(innerHTML: string, extraStyles: string, ownerDoc: Document): HTMLButtonElement {
  const btn = ownerDoc.createElement('button');
  btn.innerHTML = innerHTML;
  btn.style.cssText = `position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:rgba(0,0,0,0.5);color:white;cursor:pointer;z-index:1;transition:background 0.2s;${extraStyles}`;
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(0,0,0,0.75)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(0,0,0,0.5)';
  });
  return btn;
}

export function createImageViewer(
  images: string[],
  startIndex: number,
  parent: HTMLElement,
  ownerDoc: Document
): { overlay: HTMLElement; close: () => void } {
  let currentIndex = startIndex;

  const overlay = ownerDoc.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);cursor:pointer;user-select:none;';
  overlay.tabIndex = -1;

  const img = ownerDoc.createElement('img');
  img.style.cssText =
    'max-width:85vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);cursor:default;';
  overlay.appendChild(img);

  const counter = ownerDoc.createElement('div');
  counter.style.cssText =
    'position:absolute;top:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:13px;font-family:sans-serif;pointer-events:none;';

  let prevBtn: HTMLButtonElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;

  function showImage(index: number) {
    currentIndex = index;
    img.src = images[currentIndex];
    counter.textContent = `${currentIndex + 1} / ${images.length}`;

    if (prevBtn) prevBtn.style.display = currentIndex > 0 ? '' : 'none';
    if (nextBtn) nextBtn.style.display = currentIndex < images.length - 1 ? '' : 'none';
  }

  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  if (images.length > 1) {
    prevBtn = createNavButton(ARROW_LEFT_SVG, 'left:12px;', ownerDoc);
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentIndex > 0) showImage(currentIndex - 1);
    });
    overlay.appendChild(prevBtn);

    nextBtn = createNavButton(ARROW_RIGHT_SVG, 'right:12px;', ownerDoc);
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentIndex < images.length - 1) showImage(currentIndex + 1);
    });
    overlay.appendChild(nextBtn);

    overlay.appendChild(counter);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (images.length > 1) {
      if (e.key === 'ArrowLeft' && currentIndex > 0) showImage(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) showImage(currentIndex + 1);
    }
  });

  showImage(startIndex);
  parent.appendChild(overlay);
  overlay.focus();

  return { overlay, close };
}

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

  function openViewer(index: number) {
    const images = addon.data.inputImages.get(sectionId) || [];
    if (images.length === 0) return;

    const dataUrl = images[index];
    if (!dataUrl) return;

    // Sidebar mode: check preference for viewer location
    if ((strip.getRootNode() as any).host && getPref('imagePreview.location') === 'window') {
      openCapturePreview(dataUrl);
      return;
    }

    closeViewer();

    const { parent, ownerDoc } = getMountPoint();
    const viewer = createImageViewer(images, index, parent, ownerDoc);
    viewerOverlay = viewer.overlay;

    const origClose = viewer.close;
    viewer.close = () => {
      origClose();
      viewerOverlay = null;
    };
  }

  function closeViewer() {
    if (viewerOverlay?.parentNode) {
      viewerOverlay.parentNode.removeChild(viewerOverlay);
      viewerOverlay = null;
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

      thumbWrapper.addEventListener('click', () => openViewer(index));

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
