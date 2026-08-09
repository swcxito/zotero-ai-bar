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

  // A reader whose tab is not selected has an inactive docShell: pdf.js sees
  // document.visibilityState 'hidden' and never paints page canvases.
  const selectedTabID = (Zotero.getMainWindow() as any)?.Zotero_Tabs?.selectedID;
  const isHiddenTab = !!reader.tabID && selectedTabID !== reader.tabID;

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

  // Path 2: render the page offscreen via pdf.js, executed entirely inside
  // the reader's own realm (calling page.render() from the plugin realm
  // doesn't work — Firefox Xray wrappers break pdf.js's parameter
  // destructuring). This also covers background tabs, whose on-screen
  // canvases are never painted (inactive docShell).
  try {
    return await renderPageOffscreen(reader, iframeWindow, pdfWindow, pageNumber);
  } catch (e) {
    ztoolkit.log('[capture] offscreen render failed:', e);
    if (isHiddenTab) {
      // The scroll-and-wait path below can never succeed on a hidden tab.
      throw e;
    }
  }

  // Path 3: scroll the target page into view so pdf.js renders it, wait for
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
 * Render a PDF page to an image with pdf.js, without relying on any
 * on-screen canvas. The code runs entirely inside the reader's realm via
 * `eval` on the (waived) window: only the numeric page number crosses the
 * realm boundary, so Xray wrappers can't break pdf.js's parameter
 * destructuring. Works for hidden/background tabs too.
 */
async function renderPageOffscreen(
  reader: _ZoteroTypes.ReaderInstance<'pdf'>,
  iframeWindow: any,
  pdfWindow: any,
  pageNumber: number
): Promise<{ dataUrl: string; width: number; height: number; pageNumber: number }> {
  const appWindow = await waitForPdfJsDocument(reader, iframeWindow, pdfWindow, 15000);
  if (!appWindow) {
    throw new Error('Timed out waiting for the PDF to finish loading. Please try again.');
  }

  const totalPages = appWindow.PDFViewerApplication?.pdfDocument?.numPages ?? 0;
  if (totalPages > 0 && (pageNumber < 1 || pageNumber > totalPages)) {
    throw new Error(`Page ${pageNumber} is out of range (1-${totalPages})`);
  }

  const code = `
    (async () => {
      const app = window.PDFViewerApplication;
      const doc = app && app.pdfDocument;
      if (!doc) throw new Error('PDF document not loaded');
      const page = await doc.getPage(${pageNumber});
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.max(0.5, 1600 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context not available');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    })()
  `;
  const realm = appWindow.wrappedJSObject ?? appWindow;
  const result = await realm.eval(code);
  return { dataUrl: result.dataUrl, width: result.width, height: result.height, pageNumber };
}

/**
 * Wait until pdf.js inside the reader has loaded the document
 * (`PDFViewerApplication.pdfDocument`). Resolves the window hosting pdf.js,
 * or null on timeout.
 */
function waitForPdfJsDocument(reader: _ZoteroTypes.ReaderInstance<'pdf'>, iframeWindow: any, pdfWindow: any, timeoutMs: number): Promise<any | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const candidates = [pdfWindow, iframeWindow, (reader as any)?._primaryView?._iframeWindow];
      for (const win of candidates) {
        try {
          if (win?.PDFViewerApplication?.pdfDocument) {
            resolve(win);
            return;
          }
        } catch {
          // Window not accessible yet — keep waiting
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
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

async function resolvePDFAttachmentId(itemId: number): Promise<number | null> {
  const item = Zotero.Items.get(itemId);
  if (!item) {
    return null;
  }

  if (item.isAttachment()) {
    return itemId;
  }
  const bestAttachment = await item.getBestAttachment();
  return bestAttachment ? bestAttachment.id : null;
}

function findOpenPDFReader(attachmentId: number): _ZoteroTypes.ReaderInstance<'pdf'> | null {
  const readers = Zotero.Reader._readers;
  for (const reader of readers) {
    if (reader.itemID === attachmentId && (reader as any)._type === 'pdf') {
      return reader as _ZoteroTypes.ReaderInstance<'pdf'>;
    }
  }
  return null;
}

export async function getPDFReaderForItem(itemId: number): Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null> {
  const attachmentId = await resolvePDFAttachmentId(itemId);
  if (attachmentId == null) {
    return null;
  }
  return findOpenPDFReader(attachmentId);
}

// Guards against duplicate background tabs when several capture calls for the
// same unopened item run in parallel (agent mode can batch tool calls).
const readerOpenPromises = new Map<number, Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null>>();

/**
 * Like getPDFReaderForItem, but when no reader is open for the item, the PDF
 * is opened in a background tab first — the user keeps reading the current
 * document while its pages become available for capture. The opened tab is
 * left in place (in the background) so subsequent captures are instant.
 */
export async function getOrOpenPDFReaderForItem(itemId: number): Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null> {
  const existing = await getPDFReaderForItem(itemId);
  if (existing) {
    return existing;
  }

  let promise = readerOpenPromises.get(itemId);
  if (!promise) {
    promise = openPDFReaderInBackground(itemId).finally(() => {
      readerOpenPromises.delete(itemId);
    });
    readerOpenPromises.set(itemId, promise);
  }
  return promise;
}

async function openPDFReaderInBackground(itemId: number): Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null> {
  const attachmentId = await resolvePDFAttachmentId(itemId);
  if (attachmentId == null) {
    return null;
  }

  const attachment = Zotero.Items.get(attachmentId);
  if (!attachment || attachment.attachmentReaderType !== 'pdf') {
    return null;
  }

  // A reader may have appeared (e.g. user opened the tab) while we awaited
  // above — everything below this point runs without further awaits until
  // Zotero.Reader.open(), so this check closes the race.
  const alreadyOpen = findOpenPDFReader(attachmentId);
  if (alreadyOpen) {
    return alreadyOpen;
  }

  // A session-restored tab for this attachment may exist without a loaded
  // reader. Passing its tabID loads the reader into that tab; note that
  // allowDuplicate must be true here, otherwise Zotero.Reader.open() selects
  // the existing tab and steals focus from the document being read.
  const win = Zotero.getMainWindow() as any;
  const unloadedTabID: string | undefined = win?.Zotero_Tabs?.getTabIDByItemID?.(attachmentId);

  let reader = (await Zotero.Reader.open(
    attachmentId,
    undefined,
    unloadedTabID ? { openInBackground: true, allowDuplicate: true, tabID: unloadedTabID } : { openInBackground: true, allowDuplicate: false }
  )) as _ZoteroTypes.ReaderInstance<'pdf'> | null | undefined;

  if (!reader) {
    // open() returns undefined when it selected an existing unloaded tab —
    // wait for its reader instance to appear.
    reader = await waitForPDFReader(attachmentId, 10000);
  }
  if (!reader) {
    return null;
  }

  try {
    // _initPromise never rejects (Zotero doesn't call _rejectInitPromise),
    // so it would hang forever on init failure — bound it with a timeout.
    await Promise.race([reader._initPromise, new Promise((resolve) => setTimeout(resolve, 15000))]);
  } catch (e) {
    ztoolkit.log('[capture] waiting for reader init failed:', e);
  }
  return reader;
}

function waitForPDFReader(attachmentId: number, timeoutMs: number): Promise<_ZoteroTypes.ReaderInstance<'pdf'> | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const reader = findOpenPDFReader(attachmentId);
      if (reader) {
        resolve(reader);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
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
