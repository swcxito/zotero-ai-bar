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
import { ImagePreview, createImageViewer } from './imagePreview';
import { getString } from '../utils/locale';
import { getPref } from '../utils/prefs';
import { Session } from '../modules/chatManager';

import { startCaptureMode } from '../modules/capture';
import { getReaderByTabId } from '../modules/tabObserver';
import { scrollToBottom as doScrollToBottom, setSendBtnEnabled } from '../modules/readerItemPane';
import { checkModelSupportsImage, promptModelImageUnsupported } from '../utils/providers';
import { createUserMessageBubble } from './userBubble';

/**
 * Build the InputArea widget and wire up all interactive logic.
 * @param doc   The owner Document (from the Zotero item-pane body).
 * @param sectionId  The Zotero item ID that identifies this sidebar section.
 * @param opts
 */
export function InputArea(
  doc: Document,
  sectionId: string,
  opts?: { onRenderUserBubble?: (bubble: HTMLElement, text: string) => Promise<void> | void; sourceLabel?: string }
): HTMLElement {
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
  const fullTextEnabled = addon.chatManager.sessionsMap.get(sectionId)?.fullTextEnabled ?? getPref('chat.autoAttachFullText');
  if (fullTextEnabled) {
    fullTextBtn.classList.remove('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
    fullTextBtn.classList.add('text-rose-500', 'dark:text-rose-400');
    fullTextBtn.title = getString('input-full-text-tooltip');
  }

  // ── screenshot button (left) ──────────────────────────────────────────
  const screenshotBtn = doc.createElement('button');
  screenshotBtn.title = getString('input-screenshot-tooltip');
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

  // ── thinking effort button (right of textarea) ────────────────────────────
  const session = addon.chatManager.sessionsMap.get(sectionId) ?? new Session(sectionId);
  addon.chatManager.sessionsMap.set(sectionId, session);

  const effortOrder: Array<'none' | 'low' | 'medium' | 'high' | 'xhigh'> = ['none', 'low', 'medium', 'high', 'xhigh'];
  const effortLabelMap: Record<string, string> = {
    none: getString('thinking-effort-none'),
    low: getString('thinking-effort-low'),
    medium: getString('thinking-effort-medium'),
    high: getString('thinking-effort-high'),
    xhigh: getString('thinking-effort-xhigh'),
  };

  const thinkingBtn = doc.createElement('button');
  thinkingBtn.title = getString('input-thinking-tooltip');
  thinkingBtn.classList.add(
    'input-thinking-btn',
    'flex',
    'items-center',
    'justify-center',
    'gap-1',
    'p-2',
    'rounded-xl',
    'text-xs',
    'font-semibold',
    'transition-colors',
    'flex-shrink-0'
  );

  function updateThinkingBtnAppearance() {
    const effort = session.thinkingEffort;
    thinkingBtn.innerHTML = '';
    thinkingBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Brain, sizeRem: 0.875 })));
    const labelSpan = doc.createElement('span');
    labelSpan.textContent = effortLabelMap[effort];
    thinkingBtn.appendChild(labelSpan);

    if (effort !== 'none') {
      thinkingBtn.classList.remove('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
      thinkingBtn.classList.add('text-rose-500', 'dark:text-rose-400');
    } else {
      thinkingBtn.classList.remove('text-rose-500', 'dark:text-rose-400');
      thinkingBtn.classList.add('text-slate-400', 'dark:text-neutral-500', 'hover:text-rose-500');
    }
  }
  updateThinkingBtnAppearance();

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
  inputRow.appendChild(thinkingBtn);
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
    setSendBtnEnabled(sendBtn, canSend);
  }

  function updateScreenshotBtnState() {
    if (preview.isFull()) {
      screenshotBtn.classList.add('opacity-40', 'cursor-not-allowed');
      screenshotBtn.style.pointerEvents = 'none';
      screenshotBtn.title = getString('input-screenshot-full-tooltip');
    } else {
      screenshotBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      screenshotBtn.style.pointerEvents = '';
      screenshotBtn.title = getString('input-screenshot-tooltip');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: scroll message container to bottom
  // ─────────────────────────────────────────────────────────────────────────
  function scrollToBottom() {
    const rootNode = textarea.getRootNode() as any;
    const container: HTMLElement | null = rootNode.host
      ? ((rootNode as ShadowRoot).querySelector('.message-container') as HTMLElement | null)
      : ((doc as Document).querySelector('#ai-bar-window-message-container') as HTMLElement | null);
    if (container) {
      doScrollToBottom(container);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: open image viewer for bubble thumbnails
  // ─────────────────────────────────────────────────────────────────────────
  function openBubbleImageViewer(images: string[], index: number) {
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

    createImageViewer(images, index, parent, ownerDoc);
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

    // Get message container — sidebar (shadow DOM) or window (regular DOM)
    const rootNode = textarea.getRootNode() as any;
    const messageContainer: HTMLElement | null = rootNode.host
      ? ((rootNode as ShadowRoot).querySelector('.message-container') as HTMLElement | null)
      : ((doc as Document).querySelector('#ai-bar-window-message-container') as HTMLElement | null);
    if (!messageContainer) return;

    // Read images — check model support before clearing preview
    const imageUrls = addon.data.inputImages.get(sectionId) || [];
    if (imageUrls.length > 0 && !checkModelSupportsImage()) {
      if (!promptModelImageUnsupported()) return; // user cancelled — keep images in preview
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

    const userBubble = createUserMessageBubble(doc, text, imageUrls, openBubbleImageViewer);
    await opts?.onRenderUserBubble?.(userBubble, text);
    messageContainer.appendChild(userBubble);
    scrollToBottom();

    // Clear textarea and reset height
    textarea.value = '';
    textarea.style.height = 'auto';
    updateSendBtnState();

    // Kick off the request
    try {
      await addon.chatManager.sendChatRequest({
        userPrompt: text,
        sourceLabel: opts?.sourceLabel,
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

  // Thinking effort button — simple inline dropdown
  wrapper.style.position = 'relative';

  function removeThinkingDropdown() {
    const existing = wrapper.querySelector('.thinking-effort-dropdown') as HTMLElement | null;
    if (existing) existing.remove();
  }

  function buildThinkingDropdown(): HTMLElement {
    removeThinkingDropdown();
    const dropdown = doc.createElement('div');
    dropdown.classList.add('thinking-effort-dropdown');
    dropdown.style.position = 'absolute';
    dropdown.style.bottom = '100%';
    dropdown.style.right = '0';
    dropdown.style.marginBottom = '6px';
    dropdown.style.minWidth = '120px';
    dropdown.style.borderRadius = '8px';
    dropdown.style.padding = '4px 0';
    dropdown.style.fontSize = '13px';
    dropdown.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    dropdown.style.zIndex = '100';
    dropdown.style.backgroundColor = '#fff';
    dropdown.style.border = '1px solid #e5e7eb';

    for (const effort of effortOrder) {
      const item = doc.createElement('div');
      item.textContent = effortLabelMap[effort];
      item.style.padding = '6px 12px';
      item.style.cursor = 'pointer';
      item.style.whiteSpace = 'nowrap';
      const isSelected = session.thinkingEffort === effort;
      item.style.color = isSelected ? '#f43f5e' : '#374151';
      item.style.fontWeight = isSelected ? '600' : '400';
      item.addEventListener('click', () => {
        session.thinkingEffort = effort;
        updateThinkingBtnAppearance();
        removeThinkingDropdown();
      });
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f3f4f6';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
      dropdown.appendChild(item);
    }
    dropdown.addEventListener('mouseenter', cancelHoverClose);
    dropdown.addEventListener('mouseleave', scheduleHoverClose);
    return dropdown;
  }

  let hoverCloseTimer: number | undefined;

  function cancelHoverClose() {
    if (hoverCloseTimer !== undefined) {
      window.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = undefined;
    }
  }
  function scheduleHoverClose() {
    cancelHoverClose();
    hoverCloseTimer = window.setTimeout(() => {
      removeThinkingDropdown();
      hoverCloseTimer = undefined;
    }, 250);
  }

  function openThinkingDropdown() {
    cancelHoverClose();
    if (!wrapper.querySelector('.thinking-effort-dropdown')) {
      const dropdown = buildThinkingDropdown();
      wrapper.appendChild(dropdown);
    }
  }

  // Hover-only: open on mouseenter, close when the pointer leaves the
  // button/dropdown region.  We track the region with mousemove + a short
  // close timer so that moving between the button and the dropdown (which
  // are separated by a small gap) does not close it.
  function isOverThinkingRegion(target: Node | null): boolean {
    if (!target) return false;
    if (thinkingBtn.contains(target)) return true;
    const dd = wrapper.querySelector('.thinking-effort-dropdown');
    return !!dd && dd.contains(target);
  }

  thinkingBtn.addEventListener('mouseenter', openThinkingDropdown);
  thinkingBtn.addEventListener('mouseleave', scheduleHoverClose);

  // Document-level mousemove: if the pointer is not over the button or the
  // dropdown, schedule a close.  This is more reliable than mouseleave on
  // individual elements when moving across the gap between them.
  doc.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      const dd = wrapper.querySelector('.thinking-effort-dropdown');
      if (!dd) return;
      const target = e.target as Node | null;
      if (isOverThinkingRegion(target)) {
        cancelHoverClose();
      } else {
        scheduleHoverClose();
      }
    },
    true
  );

  // Close dropdown when clicking outside
  const outsideClickHandler = (e: Event) => {
    if (thinkingBtn.contains(e.target as Node)) return;
    const dd = wrapper.querySelector('.thinking-effort-dropdown');
    if (dd && !dd.contains(e.target as Node)) {
      removeThinkingDropdown();
    }
  };
  doc.addEventListener('click', outsideClickHandler, true);

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
