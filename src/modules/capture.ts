/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * capture.ts
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
import { getString } from '../utils/locale';

interface Point {
  x: number;
  y: number;
}

interface Selection {
  start: Point;
  end: Point;
  element: HTMLElement;
}

interface CaptureSession {
  isActive: boolean;
  overlay: HTMLElement | null;
  tooltip: HTMLElement | null;
  selection: Selection | null;
  reader: _ZoteroTypes.ReaderInstance<'pdf'> | null;
  container: HTMLElement | null;
  onCaptureCallback: ((imageData: string) => void) | null;
}

const session: CaptureSession = {
  isActive: false,
  overlay: null,
  tooltip: null,
  selection: null,
  reader: null,
  container: null,
  onCaptureCallback: null,
};

export function startCaptureMode(reader: _ZoteroTypes.ReaderInstance<'pdf'>, onCapture?: (imageData: string) => void): void {
  if (session.isActive) {
    cancelCaptureMode();
    return;
  }
  session.onCaptureCallback = onCapture ?? null;
  ztoolkit.log('reader to capture', reader);
  const viewerContainer = getViewerContainer(reader);
  if (!viewerContainer) {
    ztoolkit.log('[Capture] Cannot find PDF viewer container');
    return;
  }

  session.isActive = true;
  session.reader = reader;
  session.container = viewerContainer;

  createOverlay(viewerContainer);
  bindCaptureEvents();

  ztoolkit.log('[Capture] Capture mode started');
}

export function cancelCaptureMode(): void {
  if (!session.isActive) return;

  if (session.container) {
    unbindCaptureEvents();
  }

  session.overlay?.remove();
  session.tooltip?.remove();
  session.selection?.element.remove();

  session.isActive = false;
  session.overlay = null;
  session.tooltip = null;
  session.selection = null;
  session.reader = null;
  session.container = null;
  session.onCaptureCallback = null;

  ztoolkit.log('[Capture] Capture mode cancelled');
}

function completeCapture(): void {
  if (!session.isActive || !session.selection || !session.reader) {
    cancelCaptureMode();
    return;
  }

  try {
    const imageData = captureSelectionArea();
    if (imageData) {
      if (session.onCaptureCallback) {
        session.onCaptureCallback(imageData);
      } else {
        openCapturePreview([imageData], 0);
      }
    }
  } catch (error) {
    ztoolkit.log('[Capture] Failed to capture:', error);
  } finally {
    cancelCaptureMode();
  }
}

function getViewerContainer(reader: _ZoteroTypes.ReaderInstance<'pdf'>): HTMLElement | null {
  const iframeWindow = (reader as any)._iframeWindow;
  if (!iframeWindow) return null;

  const pdfWindow = iframeWindow[0];
  if (!pdfWindow?.document) return null;

  return pdfWindow.document.querySelector('#viewer') as HTMLElement | null;
}

function findScrollContainer(viewer: HTMLElement): HTMLElement {
  const container = viewer.parentElement;
  if (container && container.scrollHeight > container.clientHeight) {
    return container;
  }
  return viewer.ownerDocument.body;
}

function createOverlay(viewer: HTMLElement): void {
  const doc = viewer.ownerDocument;

  const overlay = doc.createElement('div');
  overlay.className = 'capture-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    cursor: crosshair;
    z-index: 999999;
    user-select: none;
  `;

  const tooltip = doc.createElement('div');
  tooltip.className = 'capture-tooltip';
  tooltip.textContent = getString('capture-drag-hint');
  tooltip.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    pointer-events: none;
    z-index: 1000000;
  `;

  doc.body.appendChild(overlay);
  doc.body.appendChild(tooltip);

  session.overlay = overlay;
  session.tooltip = tooltip;
}

function bindCaptureEvents(): void {
  const doc = session.container!.ownerDocument;

  doc.addEventListener('mousedown', handleMouseDown, true);
  doc.addEventListener('mousemove', handleMouseMove, true);
  doc.addEventListener('mouseup', handleMouseUp, true);
  doc.addEventListener('keydown', handleKeyDown, true);
  doc.addEventListener('wheel', handleWheel, true);
}

function unbindCaptureEvents(): void {
  const doc = session.container!.ownerDocument;

  doc.removeEventListener('mousedown', handleMouseDown, true);
  doc.removeEventListener('mousemove', handleMouseMove, true);
  doc.removeEventListener('mouseup', handleMouseUp, true);
  doc.removeEventListener('keydown', handleKeyDown, true);
  doc.removeEventListener('wheel', handleWheel, true);
}

function handleMouseDown(e: MouseEvent): void {
  if (!session.isActive) return;
  if (e.button !== 0) return;

  const doc = (e.target as Node | null)?.ownerDocument || document;
  const selectionEl = doc.createElement('div');
  selectionEl.className = 'capture-selection';
  selectionEl.style.cssText = `
    position: fixed;
    border: 2px solid #3b82f6;
    background: transparent;
    pointer-events: none;
    z-index: 1000001;
  `;

  doc.body.appendChild(selectionEl);

  session.selection = {
    start: { x: e.clientX, y: e.clientY },
    end: { x: e.clientX, y: e.clientY },
    element: selectionEl,
  };

  e.preventDefault();
  e.stopPropagation();
}

function handleMouseMove(e: MouseEvent): void {
  if (!session.isActive || !session.selection) return;

  session.selection.end = { x: e.clientX, y: e.clientY };
  updateSelectionBox();

  e.preventDefault();
  e.stopPropagation();
}

function handleMouseUp(e: MouseEvent): void {
  if (!session.isActive || !session.selection) return;

  const minSize = 10;
  const width = Math.abs(session.selection.end.x - session.selection.start.x);
  const height = Math.abs(session.selection.end.y - session.selection.start.y);

  if (width < minSize || height < minSize) {
    session.selection.element.remove();
    session.selection = null;
    cancelCaptureMode();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  session.selection.element.remove();

  setTimeout(() => {
    completeCapture();
  }, 0);
}

function handleKeyDown(e: KeyboardEvent): void {
  if (!session.isActive) return;

  if (e.key === 'Escape') {
    cancelCaptureMode();
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleWheel(e: WheelEvent): void {
  if (!session.isActive) return;
  if (session.selection) return;

  const scroller = findScrollContainer(session.container!);
  if (scroller && scroller.scrollHeight > scroller.clientHeight) {
    scroller.scrollTop += e.deltaY * 20;
    scroller.scrollLeft += e.deltaX * 20;
    e.preventDefault();
    e.stopPropagation();
  }
}

function updateSelectionBox(): void {
  if (!session.selection) return;

  const { start, end, element } = session.selection;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function captureSelectionArea(): string | null {
  if (!session.selection || !session.reader) return null;

  const { start, end } = session.selection;
  const reader = session.reader;

  try {
    const iframeWindow = (reader as any)._iframeWindow;
    if (!iframeWindow) return null;

    const pdfWindow = iframeWindow[0];
    if (!pdfWindow?.document) return null;

    const selectionRect = {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    };

    const visiblePages: Array<{
      canvas: HTMLCanvasElement;
      pageRect: DOMRect;
      pageIndex: number;
    }> = [];

    const canvases = pdfWindow.document.querySelectorAll('canvas');

    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i] as HTMLCanvasElement;
      const pageRect = canvas.getBoundingClientRect();

      if (
        pageRect.left < selectionRect.right &&
        pageRect.right > selectionRect.left &&
        pageRect.top < selectionRect.bottom &&
        pageRect.bottom > selectionRect.top
      ) {
        visiblePages.push({ canvas, pageRect, pageIndex: i });
      }
    }

    if (visiblePages.length === 0) return null;

    const scale = pdfWindow.devicePixelRatio || 1;
    const captureWidth = selectionRect.right - selectionRect.left;
    const captureHeight = selectionRect.bottom - selectionRect.top;

    const outputCanvas = pdfWindow.document.createElement('canvas');
    outputCanvas.width = captureWidth * scale;
    outputCanvas.height = captureHeight * scale;

    const ctx = outputCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.scale(scale, scale);

    for (const { canvas, pageRect } of visiblePages) {
      const intersectLeft = Math.max(selectionRect.left, pageRect.left);
      const intersectTop = Math.max(selectionRect.top, pageRect.top);
      const intersectRight = Math.min(selectionRect.right, pageRect.right);
      const intersectBottom = Math.min(selectionRect.bottom, pageRect.bottom);

      const intersectWidth = intersectRight - intersectLeft;
      const intersectHeight = intersectBottom - intersectTop;

      if (intersectWidth <= 0 || intersectHeight <= 0) continue;

      const sourceX = intersectLeft - pageRect.left;
      const sourceY = intersectTop - pageRect.top;
      const destX = intersectLeft - selectionRect.left;
      const destY = intersectTop - selectionRect.top;

      ctx.drawImage(
        canvas,
        sourceX * scale,
        sourceY * scale,
        intersectWidth * scale,
        intersectHeight * scale,
        destX,
        destY,
        intersectWidth,
        intersectHeight
      );
    }

    return outputCanvas.toDataURL('image/png');
  } catch (error) {
    ztoolkit.log('[Capture] Error capturing selection:', error);
    return null;
  }
}

export async function capturePageByNumber(
  reader: _ZoteroTypes.ReaderInstance<'pdf'>,
  pageNumber: number,
  scale: number = 0.3
): Promise<{ dataUrl: string; width: number; height: number; pageNumber: number }> {
  const iframeWindow = (reader as any)._iframeWindow;
  if (!iframeWindow) {
    throw new Error('PDF iframe not available');
  }

  const pdfWindow = iframeWindow[0] ?? iframeWindow;
  if (!pdfWindow?.document) {
    throw new Error('PDF viewer document not accessible');
  }

  // Determine the actual total page count from PDFViewerApplication when available
  const pdfApp =
    pdfWindow.PDFViewerApplication ?? iframeWindow.PDFViewerApplication ?? (reader as any)._primaryView?._iframeWindow?.PDFViewerApplication;
  const totalPages = pdfApp?.pdfDocument?.numPages ?? 0;

  // Validate against the real total page count if known
  if (totalPages > 0 && (pageNumber < 1 || pageNumber > totalPages)) {
    throw new Error(`Page ${pageNumber} is out of range (1-${totalPages})`);
  }

  // pdf.js creates a <div class="page" data-page-number="N"> for every page
  // up front (for scroll sizing), but only renders the canvas for pages near
  // the viewport — off-screen canvases are destroyed to save memory. So we
  // must locate the canvas by data-page-number, never by DOM index.
  const findPageCanvas = (): HTMLCanvasElement | null => {
    const pageDiv = pdfWindow.document.querySelector(`.page[data-page-number="${pageNumber}"]`) as HTMLElement | null;
    if (!pageDiv) return null;
    return pageDiv.querySelector('canvas') as HTMLCanvasElement | null;
  };

  // Copy a source canvas into a new output canvas at the requested scale.
  const copyCanvas = (source: HTMLCanvasElement) => {
    const outputCanvas = pdfWindow.document.createElement('canvas');
    const outW = Math.round(source.width * scale);
    const outH = Math.round(source.height * scale);
    outputCanvas.width = outW;
    outputCanvas.height = outH;
    const ctx = outputCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    ctx.drawImage(source, 0, 0, outW, outH);
    return {
      dataUrl: outputCanvas.toDataURL('image/png'),
      width: outW,
      height: outH,
      pageNumber,
    };
  };

  // Path 1: reuse an already-rendered canvas (page currently in/near viewport)
  const sourceCanvas = findPageCanvas();
  if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
    return copyCanvas(sourceCanvas);
  }

  // Path 2: scroll the target page into view so pdf.js renders it, wait for
  // the canvas to appear, then copy it. We do NOT call page.render() directly
  // — Firefox Xray wrappers between the plugin realm and the pdf.js iframe
  // realm break pdf.js's parameter destructuring.
  try {
    pdfApp?.pdfViewer?.scrollPageIntoView?.({ pageNumber });
  } catch (e) {
    ztoolkit.log('[capture] scrollPageIntoView failed:', e);
  }
  try {
    if (pdfApp?.pdfViewer) pdfApp.pdfViewer.currentPageNumber = pageNumber;
  } catch (e) {
    ztoolkit.log('[capture] set currentPageNumber failed:', e);
  }
  // Direct DOM scroll — most reliable across realms
  try {
    pdfWindow.document.querySelector(`.page[data-page-number="${pageNumber}"]`)?.scrollIntoView();
  } catch (e) {
    ztoolkit.log('[capture] DOM scrollIntoView failed:', e);
  }

  const rendered = await waitForCanvasRendered(pdfWindow, pageNumber, 10000);
  if (!rendered) {
    throw new Error(
      `Failed to capture page ${pageNumber}: it did not render in time. ` + 'Please scroll to that page in the PDF viewer first, then retry.'
    );
  }

  const freshCanvas = findPageCanvas();
  if (!freshCanvas || freshCanvas.width === 0 || freshCanvas.height === 0) {
    throw new Error(
      `Failed to capture page ${pageNumber}: the page canvas is not available. ` + 'Please scroll to that page in the PDF viewer first, then retry.'
    );
  }

  return copyCanvas(freshCanvas);
}

/**
 * Wait until a specific PDF page canvas is rendered (non-zero size).
 * Resolves true on success, false on timeout.
 */
function waitForCanvasRendered(pdfWindow: any, pageNumber: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const pageDiv = pdfWindow.document.querySelector(`.page[data-page-number="${pageNumber}"]`) as HTMLElement | null;
      const canvas = pageDiv?.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        // Give pdf.js a tick to finish painting
        setTimeout(() => resolve(true), 200);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

export async function getPDFReaderForItem(itemId: number): Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null> {
  const item = Zotero.Items.get(itemId);
  if (!item) {
    return null;
  }

  let attachmentId: number;
  if (item.isAttachment()) {
    attachmentId = itemId;
  } else {
    const bestAttachment = await item.getBestAttachment();
    if (!bestAttachment) {
      return null;
    }
    attachmentId = bestAttachment.id;
  }

  const readers = Zotero.Reader._readers;
  for (const reader of readers) {
    if (reader.itemID === attachmentId && (reader as any)._type === 'pdf') {
      return reader as _ZoteroTypes.ReaderInstance<'pdf'>;
    }
  }

  return null;
}

export function openCapturePreview(images: string[], startIndex: number): void {
  const windowArgs = { images, startIndex };

  const dialogWindow = Zotero.getMainWindow().openDialog(
    `chrome://${config.addonRef}/content/captureWindow.html`,
    `${config.addonRef}-capture-preview`,
    ['chrome', 'centerscreen', 'resizable', 'width=800', 'height=600', 'dialog=no'].join(','),
    windowArgs
  );

  if (!dialogWindow) {
    ztoolkit.log('[Capture] Failed to open preview window');
  }
}
