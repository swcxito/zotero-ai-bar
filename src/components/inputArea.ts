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
import { ModelInfo, registerModelInfoAnchor } from './modelInfo';
import { getString } from '../utils/locale';
import { getPref } from '../utils/prefs';
import type { ChatSessionKind } from '../modules/chatWorkspace';

import { startCaptureMode } from '../modules/capture';
import { getReaderByTabId } from '../modules/tabObserver';
import { scrollToBottom as doScrollToBottom, setSendBtnEnabled } from '../modules/mainWindowSidePane';
import { checkModelSupportsImage, promptModelImageUnsupported } from '../utils/providers';
import { createUserMessageBubble } from './userBubble';

export interface InputAreaContext {
  sessionId: string;
  sessionKind: ChatSessionKind;
  sourceTabId?: string;
  /** Reader used only by the manual screenshot action. */
  captureSourceTabId?: string;
  sourceLabel?: string;
  chatModeAdjustable?: boolean;
  allowScreenshot?: boolean;
  allowSelectionHint?: boolean;
}

export interface InputAreaAPI {
  setContext: (context: InputAreaContext) => void;
  setStreaming: (sessionId: string, isStreaming: boolean) => void;
  setContextTokens: (sessionId: string, text: string, title: string) => void;
}

/**
 * Build the InputArea widget and wire up all interactive logic.
 * @param doc   The owner Document (main window document for the side pane, or the chat window document).
 * @param sectionId  The Zotero tab ID that identifies this chat session (also used as the side pane page key).
 * @param opts
 */
export function InputArea(
  doc: Document,
  sectionId: string,
  opts?: {
    onRenderUserBubble?: (bubble: HTMLElement, text: string, sessionId: string) => Promise<void> | void;
    sourceLabel?: string;
    sourceTabId?: string;
    sessionKind?: ChatSessionKind;
    chatModeAdjustable?: boolean;
    allowScreenshot?: boolean;
    allowSelectionHint?: boolean;
    captureSourceTabId?: string;
    /** Stable image-draft key used by a shared host-level input. */
    draftId?: string;
    resolveMessageContainer?: (sessionId: string) => HTMLElement | null;
  }
): HTMLElement {
  let activeSectionId = sectionId;
  let sessionKind = opts?.sessionKind ?? 'article';
  let sourceTabId = opts?.sourceTabId;
  let captureSourceTabId = opts?.captureSourceTabId ?? sourceTabId;
  let sourceLabel = opts?.sourceLabel;
  let chatModeAdjustable = opts?.chatModeAdjustable ?? sessionKind === 'article';
  let allowScreenshot = opts?.allowScreenshot ?? true;
  let allowSelectionHint = opts?.allowSelectionHint ?? sessionKind !== 'global-agent';
  const draftId = opts?.draftId ?? sectionId;
  // ── outer wrapper (contains hint bar + input-row + disclaimer) ───────────
  const wrapper = doc.createElement('div');
  wrapper.classList.add('input-area-wrapper', 'max-w-3xl', 'w-full', 'mx-auto', 'mt-2', 'flex', 'flex-col', 'relative');
  wrapper.dataset.modelDropdownContainer = 'true';
  wrapper.dataset.sessionId = activeSectionId;

  // ── image preview strip ─────────────────────────────────────────────────
  const preview = ImagePreview(
    doc,
    draftId,
    () => {
      updateScreenshotBtnState();
      updateSendBtnState();
    },
    () => captureSourceTabId
  );

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

  // ── selection hint bar ────────────────────────────────────────────────────
  // A light strip that merges with the top of the input box into one rounded
  // shape: it expands when text is selected in the reader (driven by
  // refreshSelectionHints) and collapses when the selection is cleared.
  // While expanded, the strip provides the shape's top rounded corners and
  // the input box drops its own top edge/corners (restored on collapse).
  const hintBar = doc.createElement('div');
  hintBar.classList.add(
    'selection-hint-bar',
    'w-full',
    'flex',
    'items-center',
    'gap-1.5',
    'flex-shrink-0',
    'px-2.5',
    'rounded-t-2xl',
    'bg-slate-100',
    'dark:bg-neutral-800',
    'border-2',
    'border-slate-200',
    'dark:border-neutral-800',
    'text-xs',
    'text-slate-500',
    'dark:text-neutral-400',
    'select-none',
    'transition-all',
    'duration-300',
    'ease-in-out'
  );
  // Keep the hint out of normal flow so selection changes never resize the
  // shared input host (and therefore never push or pull the message viewport).
  hintBar.style.position = 'absolute';
  hintBar.style.left = '0';
  hintBar.style.top = '0';
  hintBar.style.zIndex = '2';
  hintBar.style.height = '28px';
  hintBar.style.minHeight = '28px';
  hintBar.style.opacity = '0';
  hintBar.style.overflow = 'hidden';
  hintBar.style.borderWidth = '2px 2px 0 2px';
  hintBar.style.pointerEvents = 'none';
  hintBar.style.transform = 'translateY(0)';

  const hintIcon = ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Quote, sizeRem: 0.75 })) as HTMLElement;
  hintIcon.classList.add('flex-shrink-0', 'opacity-70');
  hintBar.appendChild(hintIcon);

  const hintText = doc.createElement('span');
  hintText.classList.add('selection-hint-text', 'flex-1', 'min-w-0', 'truncate');
  hintBar.appendChild(hintText);

  function showSelectionHint(text: string) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (!oneLine) return;
    hintText.textContent = `“${oneLine}”`;
    hintBar.title = oneLine;
    hintBar.style.opacity = '1';
    hintBar.style.transform = 'translateY(-100%)';
    container.style.borderTopLeftRadius = '0';
    container.style.borderTopRightRadius = '0';
  }

  function hideSelectionHint() {
    hintBar.style.opacity = '0';
    hintBar.style.transform = 'translateY(0)';
    // Border width and element height stay constant; only non-layout visual
    // properties change while the floating bar is hidden.
    container.style.borderTopLeftRadius = '';
    container.style.borderTopRightRadius = '';
  }

  function updateSelectionHint(text?: string, selectedTabId?: string) {
    if (allowSelectionHint && text && selectedTabId === sourceTabId) {
      showSelectionHint(text);
    } else {
      hideSelectionHint();
    }
  }

  // ── chat mode selector button (left) ──────────────────────────────────────
  // Replaces the old full-text toggle. Three modes: normal / full-text / agent.
  // UI mirrors the thinking-effort button (hover-open dropdown) but the popup
  // is left-aligned and each item shows an icon + label.
  let session = addon.chatManager.getOrCreateSession({
    sessionId: activeSectionId,
    kind: sessionKind,
    sourceTabId,
    itemId: sourceTabId ? getReaderByTabId(sourceTabId)?.itemID : undefined,
  });

  const chatModeOrder: Array<'normal' | 'full-text' | 'agent'> = ['normal', 'full-text', 'agent'];
  const chatModeIconMap: Record<string, string> = {
    normal: Icons.MessageSquare,
    'full-text': Icons.FileText,
    agent: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6V2H8"/><path d="M15 11v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 11v2"/></svg>`,
  };
  const chatModeLabel = (mode: string) => getString(`chat-mode-${mode}` as any);

  const chatModeBtn = doc.createElement('button');
  chatModeBtn.title = getString('input-chat-mode-tooltip');
  chatModeBtn.classList.add(
    'input-chat-mode-btn',
    'flex',
    'items-center',
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
  chatModeBtn.style.position = 'relative';

  function updateChatModeBtnAppearance() {
    const mode = session.effectiveChatMode;
    chatModeBtn.innerHTML = '';
    chatModeBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: chatModeIconMap[mode], sizeRem: 1 })));
    chatModeBtn.title = chatModeAdjustable ? getString('input-chat-mode-tooltip') : chatModeLabel(mode);
    chatModeBtn.setAttribute('aria-disabled', String(!chatModeAdjustable));
    chatModeBtn.tabIndex = chatModeAdjustable ? 0 : -1;
    chatModeBtn.classList.toggle('cursor-default', !chatModeAdjustable);

    if (mode !== 'normal') {
      chatModeBtn.classList.remove('text-slate-400', 'dark:text-neutral-600');
      chatModeBtn.classList.add('text-rose-500', 'dark:text-rose-400');
    } else {
      chatModeBtn.classList.remove('text-rose-500', 'dark:text-rose-400');
      chatModeBtn.classList.add('text-slate-400', 'dark:text-neutral-600');
    }
  }
  updateChatModeBtnAppearance();

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

  // ── model selector button (right of thinking effort) ──────────────────────
  // Reuses the same ModelInfo component as the reader popup. The dropdown
  // anchors to `wrapper` via the [data-model-dropdown-container] attribute and
  // pops upward (away from the input area).
  const modelInfoSpec = ModelInfo({ dropUp: true });
  const modelInfoBtn = ztoolkit.UI.createElement(doc, modelInfoSpec.tag, modelInfoSpec) as HTMLElement;
  registerModelInfoAnchor(modelInfoBtn);

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
  thinkingBtn.style.position = 'relative';

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
  sendBtn.style.marginLeft = '1px';
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
  inputRow.classList.add('flex', 'items-center', 'justify-center', 'gap-1');
  inputRow.appendChild(chatModeBtn);
  inputRow.appendChild(screenshotBtn);
  inputRow.appendChild(textarea);
  inputRow.appendChild(thinkingBtn);
  inputRow.appendChild(modelInfoBtn);
  inputRow.appendChild(sendBtn);

  container.appendChild(inputRow);

  // ── disclaimer + context token usage row ──────────────────────────────────
  const footerRow = doc.createElement('div');
  footerRow.classList.add('flex', 'items-center', 'justify-center', 'gap-2', 'mt-1', 'px-2', 'flex-wrap');

  const disclaimer = doc.createElement('div');
  disclaimer.classList.add('text-xs', 'text-center', 'text-slate-400', 'dark:text-neutral-500');
  disclaimer.textContent = getString('input-ai-disclaimer');
  footerRow.appendChild(disclaimer);

  const contextTokens = doc.createElement('span');
  contextTokens.classList.add('input-context-tokens', 'text-xs', 'text-slate-400', 'dark:text-neutral-500', 'whitespace-nowrap', 'select-none');
  contextTokens.textContent = '';
  footerRow.appendChild(contextTokens);

  wrapper.appendChild(hintBar);
  wrapper.appendChild(container);
  wrapper.appendChild(footerRow);

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
    const isStreaming = addon.chatManager.sessionsMap.get(activeSectionId)?.pending.userMessage ?? false;
    if (isStreaming) return; // streaming state is controlled by ChatManager.updateSectionInputArea
    const hasText = textarea.value.trim().length > 0;
    const hasImages = preview.getCount() > 0;
    const canSend = hasText || hasImages;
    setSendBtnEnabled(sendBtn, canSend);
  }

  function updateScreenshotBtnState() {
    if (!allowScreenshot || preview.isFull() || !captureSourceTabId) {
      screenshotBtn.classList.add('opacity-40', 'cursor-not-allowed');
      screenshotBtn.style.pointerEvents = 'none';
      screenshotBtn.title = preview.isFull() ? getString('input-screenshot-full-tooltip') : getString('input-screenshot-tooltip');
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
    const resolved = opts?.resolveMessageContainer?.(activeSectionId);
    if (resolved) {
      doScrollToBottom(resolved);
      return;
    }
    const rootNode = textarea.getRootNode() as any;
    const container: HTMLElement | null = rootNode.host
      ? ((rootNode as ShadowRoot).querySelector('.message-container') as HTMLElement | null)
      : ((wrapper.parentElement?.querySelector('.message-container') as HTMLElement | null) ?? null);
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
      const reader = sourceTabId ? getReaderByTabId(sourceTabId) : null;
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

    const selectionReaderTabId = (addon.data.selection.currentReader as any)?.tabID as string | undefined;
    const selectionText =
      sessionKind !== 'global-agent' && sourceTabId && selectionReaderTabId === sourceTabId ? addon.data.selection.text : undefined;
    const selectionSnapshot = {
      text: selectionText?.trim() ? selectionText : undefined,
      contextPromise: selectionText?.trim() ? addon.data.selection.contextPromise : undefined,
    };

    // Snapshot the route before any async rendering. A tab switch while the
    // Markdown bubble is being prepared must not redirect this turn.
    const requestContext = {
      sessionId: activeSectionId,
      sessionKind,
      sourceTabId,
      sourceLabel,
    };

    //todo enhance streaming state handling:
    // const sectionState = addon.chatManager.sidebarStates.get(sectionId);
    // if (sectionState?.isStreaming) return;

    // Get message container — sidebar (shadow DOM) or window (regular DOM)
    const rootNode = textarea.getRootNode() as any;
    const messageContainer: HTMLElement | null =
      opts?.resolveMessageContainer?.(requestContext.sessionId) ??
      (rootNode.host
        ? ((rootNode as ShadowRoot).querySelector('.message-container') as HTMLElement | null)
        : ((wrapper.parentElement?.querySelector('.message-container') as HTMLElement | null) ?? null));
    if (!messageContainer) return;

    // Read images — check model support before clearing preview
    const imageUrls = addon.data.inputImages.get(draftId) || [];
    if (imageUrls.length > 0 && !checkModelSupportsImage()) {
      if (!promptModelImageUnsupported()) return; // user cancelled — keep images in preview
      // user chose "send text only" — clear images and proceed
      addon.data.inputImages.delete(draftId);
      preview.render();
      updateScreenshotBtnState();
      imageUrls.length = 0;
    } else if (imageUrls.length > 0) {
      addon.data.inputImages.delete(draftId);
      preview.render();
      updateScreenshotBtnState();
    }

    const userBubble = createUserMessageBubble(doc, text, imageUrls, openBubbleImageViewer, selectionSnapshot.text);
    await opts?.onRenderUserBubble?.(userBubble, text, requestContext.sessionId);
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
        sourceLabel: requestContext.sourceLabel,
        sessionId: requestContext.sessionId,
        sessionKind: requestContext.sessionKind,
        sourceTabId: requestContext.sourceTabId,
        itemId: requestContext.sourceTabId ? getReaderByTabId(requestContext.sourceTabId)?.itemID : undefined,
        images: imageUrls.length > 0 ? imageUrls : undefined,
        selectionSnapshot,
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
      const activeSession = addon.chatManager.sessionsMap.get(activeSectionId);
      if (activeSession?.pending.abortController) {
        activeSession.pending.abortController.abort();
      }
    } else {
      handleSend();
    }
  });

  // Thinking effort button — simple inline dropdown anchored above the button.
  function removeThinkingDropdown() {
    const existing = thinkingBtn.querySelector('.thinking-effort-dropdown') as HTMLElement | null;
    if (!existing) return;
    existing.style.opacity = '0';
    existing.style.transform = 'translateX(-50%) scale(0.95)';
    const view = doc.defaultView;
    if (!view) {
      existing.remove();
      return;
    }
    existing.addEventListener('transitionend', () => existing.remove(), { once: true });
    view.setTimeout(() => existing.remove(), 160);
  }

  function buildThinkingDropdown(): HTMLElement {
    removeThinkingDropdown();
    const dropdown = doc.createElement('div');
    dropdown.classList.add(
      'thinking-effort-dropdown',
      'absolute',
      'bottom-full',
      'left-1/2',
      'mb-1',
      'min-w-[104px]',
      'rounded-lg',
      'pb-[3px]',
      'text-xs',
      'z-[100]'
    );
    dropdown.style.opacity = '0';
    dropdown.style.transform = 'translateX(-50%) scale(0.95)';
    dropdown.style.transformOrigin = 'bottom center';
    // Defer the transition + final state to the next frame so the browser
    // commits the initial (opacity:0) state first — without this, the two
    // style writes may be batched into one frame and skip the animation.
    const view = doc.defaultView;
    if (view) {
      view.requestAnimationFrame(() => {
        dropdown.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
        dropdown.style.opacity = '1';
        dropdown.style.transform = 'translateX(-50%) scale(1)';
      });
    } else {
      dropdown.style.opacity = '1';
      dropdown.style.transform = 'translateX(-50%) scale(1)';
    }

    // Title row
    const title = doc.createElement('div');
    title.textContent = getString('thinking-effort-title');
    title.classList.add(
      'thinking-effort-dropdown-title',
      'pt-[2px]',
      'px-2.5',
      'pb-[3px]',
      'text-[10px]',
      'leading-[1.2]',
      'font-semibold',
      'tracking-[0.04em]',
      'uppercase',
      'select-none'
    );
    dropdown.appendChild(title);

    for (const effort of effortOrder) {
      const item = doc.createElement('div');
      item.textContent = effortLabelMap[effort];
      item.classList.add('thinking-effort-dropdown-item', 'py-[3px]', 'px-2.5', 'cursor-pointer', 'whitespace-nowrap', 'leading-[1.4]', 'text-left');
      const isSelected = session.thinkingEffort === effort;
      if (isSelected) {
        item.classList.add('is-selected', 'font-semibold');
      } else {
        item.classList.add('font-normal');
      }
      item.addEventListener('click', () => {
        session.thinkingEffort = effort;
        updateThinkingBtnAppearance();
        removeThinkingDropdown();
      });
      item.addEventListener('mouseenter', () => {
        item.classList.add('is-hover');
      });
      item.addEventListener('mouseleave', () => {
        item.classList.remove('is-hover');
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
      doc.defaultView?.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = undefined;
    }
  }
  function scheduleHoverClose() {
    cancelHoverClose();
    hoverCloseTimer = doc.defaultView?.setTimeout(() => {
      removeThinkingDropdown();
      hoverCloseTimer = undefined;
    }, 250);
  }

  function openThinkingDropdown() {
    cancelHoverClose();
    if (!thinkingBtn.querySelector('.thinking-effort-dropdown')) {
      const dropdown = buildThinkingDropdown();
      thinkingBtn.appendChild(dropdown);
    }
  }

  // Hover-only: open on mouseenter, close when the pointer leaves the
  // button/dropdown region.  We use composedPath() so the check works even
  // though this listener sits at document level and the dropdown lives inside
  // a shadow DOM (where event.target is retargeted to the shadow host).
  function isOverThinkingRegion(e: MouseEvent): boolean {
    const dd = thinkingBtn.querySelector('.thinking-effort-dropdown');
    const path = e.composedPath();
    return path.includes(thinkingBtn) || (!!dd && path.includes(dd as EventTarget));
  }

  thinkingBtn.addEventListener('mouseenter', openThinkingDropdown);
  thinkingBtn.addEventListener('mouseleave', scheduleHoverClose);

  // Track pointer position globally while the dropdown is open.  Only start
  // the close countdown once the pointer is genuinely outside both the button
  // and the dropdown — moving between them (across the small gap) keeps it
  // open because we cancel whenever the pointer re-enters either region.
  doc.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      const dd = thinkingBtn.querySelector('.thinking-effort-dropdown');
      if (!dd) return;
      if (isOverThinkingRegion(e)) {
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
    const dd = thinkingBtn.querySelector('.thinking-effort-dropdown');
    if (dd && !dd.contains(e.target as Node)) {
      removeThinkingDropdown();
    }
  };
  doc.addEventListener('click', outsideClickHandler, true);

  // Chat mode dropdown — hover-open, left-aligned, mirrors thinking-effort
  // dropdown pattern but with icon+label items and left-anchored positioning.
  function removeChatModeDropdown() {
    const existing = chatModeBtn.querySelector('.chat-mode-dropdown') as HTMLElement | null;
    if (!existing) return;
    existing.style.opacity = '0';
    existing.style.transform = 'scale(0.95)';
    const view = doc.defaultView;
    if (!view) {
      existing.remove();
      return;
    }
    existing.addEventListener('transitionend', () => existing.remove(), { once: true });
    view.setTimeout(() => existing.remove(), 160);
  }

  function buildChatModeDropdown(): HTMLElement {
    removeChatModeDropdown();
    const dropdown = doc.createElement('div');
    dropdown.classList.add(
      'chat-mode-dropdown',
      'absolute',
      'bottom-full',
      'left-0',
      'mb-1',
      'min-w-[96px]',
      'rounded-lg',
      'pb-[3px]',
      'text-xs',
      'z-[100]'
    );
    dropdown.style.opacity = '0';
    dropdown.style.transform = 'scale(0.95)';
    dropdown.style.transformOrigin = 'bottom left';
    const view = doc.defaultView;
    if (view) {
      view.requestAnimationFrame(() => {
        dropdown.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out';
        dropdown.style.opacity = '1';
        dropdown.style.transform = 'scale(1)';
      });
    } else {
      dropdown.style.opacity = '1';
      dropdown.style.transform = 'scale(1)';
    }

    const title = doc.createElement('div');
    title.textContent = getString('chat-mode-title');
    title.classList.add(
      'chat-mode-dropdown-title',
      'pt-2',
      'px-2.5',
      'pb-2',
      'text-[10px]',
      'leading-[1.2]',
      'font-semibold',
      'tracking-[0.04em]',
      'uppercase',
      'select-none'
    );
    dropdown.appendChild(title);

    for (const mode of chatModeOrder) {
      const item = doc.createElement('div');
      item.classList.add(
        'chat-mode-dropdown-item',
        'flex',
        'items-center',
        'gap-2',
        'py-2',
        'px-2.5',
        'cursor-pointer',
        'whitespace-nowrap',
        'leading-relaxed'
      );
      const iconHolder = doc.createElement('span');
      iconHolder.classList.add('inline-flex', 'items-center');
      iconHolder.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: chatModeIconMap[mode], sizeRem: 0.875 })));
      item.appendChild(iconHolder);
      const labelEl = doc.createElement('span');
      labelEl.textContent = chatModeLabel(mode);
      item.appendChild(labelEl);
      const isSelected = session.chatMode === mode;
      if (isSelected) {
        item.classList.add('is-selected', 'font-semibold');
      } else {
        item.classList.add('font-normal');
      }
      item.addEventListener('click', () => {
        session.chatMode = mode;
        updateChatModeBtnAppearance();
        removeChatModeDropdown();
      });
      item.addEventListener('mouseenter', () => {
        item.classList.add('is-hover');
      });
      item.addEventListener('mouseleave', () => {
        item.classList.remove('is-hover');
      });
      dropdown.appendChild(item);
    }
    dropdown.addEventListener('mouseenter', cancelChatModeHoverClose);
    dropdown.addEventListener('mouseleave', scheduleChatModeHoverClose);
    return dropdown;
  }

  let chatModeHoverCloseTimer: number | undefined;

  function cancelChatModeHoverClose() {
    if (chatModeHoverCloseTimer !== undefined) {
      doc.defaultView?.clearTimeout(chatModeHoverCloseTimer);
      chatModeHoverCloseTimer = undefined;
    }
  }
  function scheduleChatModeHoverClose() {
    cancelChatModeHoverClose();
    chatModeHoverCloseTimer = doc.defaultView?.setTimeout(() => {
      removeChatModeDropdown();
      chatModeHoverCloseTimer = undefined;
    }, 250);
  }

  function openChatModeDropdown() {
    if (!chatModeAdjustable) return;
    cancelChatModeHoverClose();
    if (!chatModeBtn.querySelector('.chat-mode-dropdown')) {
      const dropdown = buildChatModeDropdown();
      chatModeBtn.appendChild(dropdown);
    }
  }

  function isOverChatModeRegion(e: MouseEvent): boolean {
    const dd = chatModeBtn.querySelector('.chat-mode-dropdown');
    const path = e.composedPath();
    return path.includes(chatModeBtn) || (!!dd && path.includes(dd as EventTarget));
  }

  chatModeBtn.addEventListener('mouseenter', openChatModeDropdown);
  chatModeBtn.addEventListener('mouseleave', scheduleChatModeHoverClose);

  doc.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      const dd = chatModeBtn.querySelector('.chat-mode-dropdown');
      if (!dd) return;
      if (isOverChatModeRegion(e)) {
        cancelChatModeHoverClose();
      } else {
        scheduleChatModeHoverClose();
      }
    },
    true
  );

  const chatModeOutsideClickHandler = (e: Event) => {
    if (chatModeBtn.contains(e.target as Node)) return;
    const dd = chatModeBtn.querySelector('.chat-mode-dropdown');
    if (dd && !dd.contains(e.target as Node)) {
      removeChatModeDropdown();
    }
  };
  doc.addEventListener('click', chatModeOutsideClickHandler, true);

  screenshotBtn.addEventListener('click', () => {
    if (preview.isFull()) return;
    const reader = captureSourceTabId ? getReaderByTabId(captureSourceTabId) : null;
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
  });

  const streamingBySession = new Map<string, boolean>();
  const tokenInfoBySession = new Map<string, { text: string; title: string }>();

  function setCapabilityVisible(button: HTMLElement, visible: boolean, animate: boolean = true) {
    button.style.overflow = 'hidden';
    button.style.transition = animate
      ? 'opacity 180ms ease, transform 180ms ease, max-width 220ms ease, padding 220ms ease, margin 220ms ease'
      : 'none';
    button.style.opacity = visible ? '1' : '0';
    button.style.transform = visible ? 'scale(1)' : 'scale(0.82)';
    button.style.maxWidth = visible ? '52px' : '0';
    button.style.paddingInline = visible ? '' : '0';
    button.style.marginInline = visible ? '' : '-2px';
    button.style.pointerEvents = visible && !button.classList.contains('cursor-not-allowed') ? '' : 'none';
    button.setAttribute('aria-hidden', String(!visible));
  }

  function renderSendState(isStreaming: boolean) {
    if (isStreaming) {
      sendBtn.dataset.mode = 'stop';
      setSendBtnEnabled(sendBtn, true);
      sendBtn.innerHTML = '';
      sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Stop, sizeRem: 1.5, extraClasses: ['text-white'] })));
      return;
    }
    sendBtn.dataset.mode = 'send';
    sendBtn.innerHTML = '';
    sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Send, sizeRem: 1.5, extraClasses: ['text-white'] })));
    updateSendBtnState();
  }

  const inputAreaAPI: InputAreaAPI = {
    setContext(context) {
      activeSectionId = context.sessionId;
      sessionKind = context.sessionKind;
      sourceTabId = context.sourceTabId;
      captureSourceTabId = context.captureSourceTabId ?? context.sourceTabId;
      sourceLabel = context.sourceLabel;
      chatModeAdjustable = context.chatModeAdjustable ?? sessionKind === 'article';
      allowScreenshot = context.allowScreenshot ?? true;
      allowSelectionHint = context.allowSelectionHint ?? sessionKind !== 'global-agent';
      wrapper.dataset.sessionId = activeSectionId;
      session = addon.chatManager.getOrCreateSession({
        sessionId: activeSectionId,
        kind: sessionKind,
        sourceTabId,
        itemId: sourceTabId ? getReaderByTabId(sourceTabId)?.itemID : undefined,
      });
      removeThinkingDropdown();
      removeChatModeDropdown();
      updateChatModeBtnAppearance();
      updateThinkingBtnAppearance();
      updateScreenshotBtnState();
      setCapabilityVisible(chatModeBtn, true);
      // The mode dropdown is positioned outside the button. The generic
      // capability animation clips children, so restore visible overflow now
      // that the mode button is permanently present in every workspace.
      chatModeBtn.style.overflow = 'visible';
      setCapabilityVisible(screenshotBtn, allowScreenshot);
      updateSelectionHint(addon.data.selection.text, (addon.data.selection.currentReader as any)?.tabID);
      const tokenInfo = tokenInfoBySession.get(activeSectionId);
      contextTokens.textContent = tokenInfo?.text ?? '';
      contextTokens.title = tokenInfo?.title ?? '';
      renderSendState(streamingBySession.get(activeSectionId) ?? !!session.pending.userMessage);
    },
    setStreaming(sessionId, isStreaming) {
      streamingBySession.set(sessionId, isStreaming);
      if (sessionId === activeSectionId) renderSendState(isStreaming);
    },
    setContextTokens(sessionId, text, title) {
      tokenInfoBySession.set(sessionId, { text, title });
      if (sessionId === activeSectionId) {
        contextTokens.textContent = text;
        contextTokens.title = title;
      }
    },
  };

  preview.render();

  (wrapper as any)._imagePreviewAPI = preview;
  (wrapper as any)._selectionHintAPI = { update: updateSelectionHint };
  (wrapper as any)._inputAreaAPI = inputAreaAPI;

  // Sync with a selection that already exists for this tab (e.g. the user
  // selected text before this sidebar section was rendered).
  inputAreaAPI.setContext({
    sessionId: activeSectionId,
    sessionKind,
    sourceTabId,
    captureSourceTabId,
    sourceLabel,
    chatModeAdjustable,
    allowScreenshot,
    allowSelectionHint,
  });

  return wrapper;
}
