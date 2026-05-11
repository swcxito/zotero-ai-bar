/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * inputArea.ts
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
import { ChatBox } from './chatBox';
import { ImagePreview } from './imagePreview';
import { getString } from '../utils/locale';
import { Session } from '../modules/chatManager';

import { startCaptureMode } from '../modules/capture';
import { getReaderByTabId } from '../modules/tabObserver';
import { checkModelSupportsImage } from '../utils/providers';

/**
 * Build the InputArea widget and wire up all interactive logic.
 * @param doc   The owner Document (from the Zotero item-pane body).
 * @param sectionId  The Zotero item ID that identifies this sidebar section.
 */
export function InputArea(doc: Document, sectionId: string): HTMLElement {
  // ── outer wrapper (contains input-row + disclaimer) ──────────────────────
  const wrapper = doc.createElement('div');
  wrapper.classList.add('input-area-wrapper', 'max-w-3xl', 'w-full', 'mx-auto', 'my-2', 'flex', 'flex-col', 'gap-1');

  // ── image preview strip ─────────────────────────────────────────────────
  const preview = ImagePreview(doc, sectionId, () => {
    updateScreenshotBtnState();
    updateSendBtnState();
  });

  // ── input row ─────────────────────────────────────────────────────────────
  const container = doc.createElement('div');
  container.classList.add(
    'input-area',
    'w-full',
    'flex',
    'flex-col',
    'bg-slate-50',
    'dark:bg-neutral-900',
    'p-2',
    'rounded-2xl',
    'border-2',
    'border-slate-200',
    'dark:border-neutral-800',
    'focus-within:border-rose-300',
    'dark:focus-within:border-rose-900',
    'transition-all',
    'duration-300'
  );

  // ── full-text toggle button (left) ────────────────────────────────────────
  const fullTextBtn = doc.createElement('button');
  fullTextBtn.title = getString('input-full-text-tooltip');
  fullTextBtn.classList.add(
    'input-fulltext-btn',
    'flex',
    'justify-center',
    'p-2.5',
    'rounded-xl',
    'text-slate-400',
    'dark:text-neutral-500',
    'hover:text-rose-500',
    'transition-colors',
    'flex-shrink-0'
  );
  fullTextBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.FileText, sizeRem: 1 })));
  if (addon.chatManager.sessionsMap.get(sectionId)?.fullTextEnabled) {
    fullTextBtn.classList.remove('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
    fullTextBtn.classList.add('text-rose-500', 'dark:text-rose-400');
    fullTextBtn.title = getString('input-full-text-tooltip');
  }

  // ── screenshot button (left) ──────────────────────────────────────────
  const screenshotBtn = doc.createElement('button');
  screenshotBtn.title = 'Screenshot';
  screenshotBtn.classList.add(
    'input-screenshot-btn',
    'flex',
    'justify-center',
    'p-2.5',
    'rounded-xl',
    'text-slate-400',
    'dark:text-neutral-500',
    'hover:text-rose-500',
    'transition-colors',
    'flex-shrink-0'
  );
  screenshotBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Screenshot, sizeRem: 1 })));

  // ── textarea ──────────────────────────────────────────────────────────────
  const textarea = doc.createElement('textarea') as HTMLTextAreaElement;
  textarea.rows = 1;
  textarea.placeholder = getString('reader-bar-ask-placeholder');
  textarea.classList.add(
    'flex-1',
    'bg-transparent',
    'border-none',
    'outline-none',
    'text-slate-900',
    'dark:text-white',
    'placeholder-slate-400',
    'dark:placeholder-neutral-600',
    'resize-none',
    'text-sm',
    'font-medium',
    'overflow-y-auto'
  );
  // max-height approximately 5 lines, overflow scrolls
  textarea.style.maxHeight = '7rem';

  // ── send / stop button (right) ────────────────────────────────────────────
  const sendBtn = doc.createElement('button') as HTMLButtonElement;
  sendBtn.disabled = true;
  sendBtn.dataset.mode = 'send';
  sendBtn.classList.add(
    'input-send-btn',
    'flex',
    'justify-center',
    'p-2.5',
    'rounded-xl',
    'transition-all',
    'bg-slate-200',
    'dark:bg-neutral-800',
    'text-slate-400',
    'dark:text-neutral-600',
    'flex-shrink-0'
  );
  sendBtn.appendChild(
    ztoolkit.UI.createElement(
      doc,
      'span',
      IconView({
        iconMarkup: Icons.Send,
        sizeRem: 1.5,
        extraClasses: ['text-white'],
      })
    )
  );

  container.appendChild(preview.container);

  const inputRow = doc.createElement('div');
  inputRow.classList.add('flex', 'items-center', 'justify-center', 'gap-2');
  inputRow.appendChild(fullTextBtn);
  inputRow.appendChild(screenshotBtn);
  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);

  container.appendChild(inputRow);

  // ── disclaimer label ──────────────────────────────────────────────────────
  const disclaimer = doc.createElement('div');
  disclaimer.classList.add('text-xs', 'text-center', 'text-slate-400', 'dark:text-neutral-500', 'px-2', 'pb-1');
  disclaimer.textContent = getString('input-ai-disclaimer');

  wrapper.appendChild(container);
  wrapper.appendChild(disclaimer);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: auto-resize textarea height
  // ─────────────────────────────────────────────────────────────────────────
  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 112) + 'px'; // 112 ≈ 7rem
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: update send button appearance based on textarea content
  // ─────────────────────────────────────────────────────────────────────────
  function updateSendBtnState() {
    const isStreaming = addon.chatManager.sessionsMap.get(sectionId)?.pending.userMessage ?? false;
    if (isStreaming) return; // streaming state is controlled by ChatManager.updateSectionInputArea
    const hasText = textarea.value.trim().length > 0;
    const hasImages = preview.getCount() > 0;
    const canSend = hasText || hasImages;
    if (canSend) {
      sendBtn.disabled = false;
      sendBtn.classList.remove('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
      sendBtn.classList.add('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
    } else {
      sendBtn.disabled = true;
      sendBtn.classList.remove('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
      sendBtn.classList.add('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
    }
  }

  function updateScreenshotBtnState() {
    if (preview.isFull()) {
      screenshotBtn.classList.add('opacity-40', 'cursor-not-allowed');
      screenshotBtn.style.pointerEvents = 'none';
      screenshotBtn.title = '已达到 9 张图片上限';
    } else {
      screenshotBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      screenshotBtn.style.pointerEvents = '';
      screenshotBtn.title = 'Screenshot';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: scroll message container to bottom
  // ─────────────────────────────────────────────────────────────────────────
  function scrollToBottom() {
    const body = addon.data.sidePaneBodyMap?.get(sectionId);
    if (!body) return;
    const root = body.querySelector('#ai-bar-chat-root');
    const container = root?.shadowRoot?.querySelector('.message-container');
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: open image viewer for bubble thumbnails
  // ─────────────────────────────────────────────────────────────────────────
  function openBubbleImageViewer(dataUrl: string) {
    const root = wrapper.getRootNode() as any;
    let parent: HTMLElement;
    let ownerDoc: Document;

    // Sidebar mode (inside shadow DOM): mount on reader's iframe body
    if (root.host) {
      const reader = getReaderByTabId(addon.chatManager.currentTabID);
      if (reader) {
        const iframeWindow = (reader as any)._iframeWindow;
        const readerDoc = iframeWindow?.[0]?.document;
        if (readerDoc?.body) {
          parent = readerDoc.body;
          ownerDoc = readerDoc;
        } else {
          parent = root as unknown as HTMLElement;
          ownerDoc = doc;
        }
      } else {
        parent = root as unknown as HTMLElement;
        ownerDoc = doc;
      }
    } else {
      parent = doc.body;
      ownerDoc = doc;
    }

    const overlay = ownerDoc.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);cursor:pointer;';
    overlay.tabIndex = -1;

    const img = ownerDoc.createElement('img');
    img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);';
    img.src = dataUrl;
    overlay.appendChild(img);

    const close = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    });

    parent.appendChild(overlay);
    overlay.focus();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: send a user message
  // ─────────────────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = textarea.value.trim();
    const imageCount = preview.getCount();
    if (!text && imageCount === 0) return;

    //todo enhance streaming state handling:
    // const sectionState = addon.chatManager.sidebarStates.get(sectionId);
    // if (sectionState?.isStreaming) return;

    // Get message container from shadow DOM
    const body = addon.data.sidePaneBodyMap?.get(sectionId);
    if (!body) return;
    const root = body.querySelector('#ai-bar-chat-root');
    if (!root?.shadowRoot) return;
    const messageContainer = root.shadowRoot.querySelector('.message-container') as HTMLElement | null;
    if (!messageContainer) return;

    // Read images — check model support before clearing preview
    const imageUrls = addon.data.inputImages.get(sectionId) || [];
    if (imageUrls.length > 0 && !checkModelSupportsImage()) {
      const services = Zotero.getMainWindow().Services as any;
      const flags =
        services.prompt.BUTTON_POS_0 * services.prompt.BUTTON_TITLE_IS_STRING + services.prompt.BUTTON_POS_1 * services.prompt.BUTTON_TITLE_CANCEL;
      const result = services.prompt.confirmEx(
        Zotero.getMainWindow(),
        getString('image-unsupported-title'),
        getString('image-unsupported-message'),
        flags,
        getString('image-unsupported-send-text'),
        '',
        '',
        '',
        {}
      );
      if (result === 1) return; // user cancelled — keep images in preview
      // user chose "send text only" — clear images and proceed
      addon.data.inputImages.delete(sectionId);
      preview.render();
      updateScreenshotBtnState();
      imageUrls.length = 0;
    } else if (imageUrls.length > 0) {
      addon.data.inputImages.delete(sectionId);
      preview.render();
      updateScreenshotBtnState();
    }

    // Wrapper for right-alignment (matching ChatBox user bubble alignment)
    const wrapper = doc.createElement('div');
    wrapper.classList.add(
      'flex',
      'flex-col',
      'items-end',
      'max-w-[85%]',
      'sm:max-w-[75%]',
      'self-end',
      'animate-in',
      'fade-in',
      'slide-in-from-bottom-3',
      'duration-300'
    );

    // Image row above pink bubble
    if (imageUrls.length > 0) {
      const imgsRow = doc.createElement('div');
      imgsRow.classList.add('flex', 'flex-wrap', 'gap-1.5', 'justify-end', 'mb-2');
      imageUrls.forEach((dataUrl) => {
        const thumb = doc.createElement('img');
        thumb.src = dataUrl;
        thumb.classList.add(
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
          'hover:shadow-md'
        );
        thumb.addEventListener('click', () => {
          openBubbleImageViewer(dataUrl);
        });
        imgsRow.appendChild(thumb);
      });
      wrapper.appendChild(imgsRow);
    }

    // Pink bubble (text only) or pink underline (no text)
    if (text) {
      const userBubble = ChatBox({ doc, isUser: true }) as HTMLElement;
      const msgEl = userBubble.querySelector('.chat-message') as HTMLElement | null;
      if (msgEl) msgEl.textContent = text;
      wrapper.appendChild(userBubble);
    } else if (imageUrls.length > 0) {
      const underline = doc.createElement('div');
      underline.classList.add('w-8', 'h-1', 'bg-rose-500', 'dark:bg-rose-600', 'rounded-full');
      wrapper.appendChild(underline);
    }

    messageContainer.appendChild(wrapper);
    scrollToBottom();

    // Clear textarea and reset height
    textarea.value = '';
    textarea.style.height = 'auto';
    updateSendBtnState();

    // Kick off the request
    try {
      await addon.chatManager.sendChatRequest({
        userPrompt: text,
        tabId: sectionId,
        images: imageUrls.length > 0 ? imageUrls : undefined,
      });
    } catch (e) {
      ztoolkit.log('sendChatRequest error:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event wiring
  // ─────────────────────────────────────────────────────────────────────────

  // textarea: auto-resize + button state sync
  textarea.addEventListener('input', () => {
    autoResize();
    updateSendBtnState();
  });

  // paste: handle image data from clipboard
  textarea.addEventListener('paste', (e: ClipboardEvent) => {
    if (preview.isFull()) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          if (dataUrl) {
            preview.addImage(dataUrl);
            updateScreenshotBtnState();
          }
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  });

  // Enter to send, Shift+Enter for newline
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled && sendBtn.dataset.mode === 'send') {
        handleSend();
      }
    }
  });

  // Send / Stop button click
  sendBtn.addEventListener('click', () => {
    if (sendBtn.dataset.mode === 'stop') {
      // Abort the ongoing stream for this section
      const session = addon.chatManager.sessionsMap.get(sectionId);
      if (session?.pending.abortController) {
        session.pending.abortController.abort();
      }
    } else {
      handleSend();
    }
  });

  // Full-text toggle button
  fullTextBtn.addEventListener('click', () => {
    const session = addon.chatManager.sessionsMap.get(sectionId) ?? new Session(sectionId);
    addon.chatManager.sessionsMap.set(sectionId, session);
    session.fullTextEnabled = !session.fullTextEnabled;
    if (session.fullTextEnabled) {
      fullTextBtn.classList.remove('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
      fullTextBtn.classList.add('text-rose-500', 'dark:text-rose-400');
      fullTextBtn.title = getString('input-full-text-tooltip');
    } else {
      fullTextBtn.classList.remove('text-rose-500', 'dark:text-rose-400');
      fullTextBtn.classList.add('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
      fullTextBtn.title = getString('input-full-text-tooltip');
    }
  });

  screenshotBtn.addEventListener('click', () => {
    if (preview.isFull()) return;
    if (addon.chatManager.currentTabID) {
      const reader = getReaderByTabId(addon.chatManager.currentTabID);
      if (!reader) {
        ztoolkit.log('[InputArea] No reader available for capture');
        return;
      }
      if (reader?._type === 'pdf') {
        startCaptureMode(reader as _ZoteroTypes.ReaderInstance<'pdf'>, (imageData: string) => {
          preview.addImage(imageData);
          updateScreenshotBtnState();
        });
      }
    }
  });

  preview.render();
  updateScreenshotBtnState();

  (wrapper as any)._imagePreviewAPI = preview;

  return wrapper;
}
