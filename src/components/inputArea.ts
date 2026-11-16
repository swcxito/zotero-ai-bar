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

import { bindMenu, disposeMenusWithin } from './menuController';
import { openDropdownMenu } from './dropdownMenu';
import { Icons } from './common';
import { IconView } from './iconView';
import { ImagePreview, createImageViewer } from './imagePreview';
import { MODEL_CHANGE_EVENT, ModelInfo, registerModelInfoAnchor, unregisterModelInfoAnchors } from './modelInfo';
import { getString } from '../utils/locale';
import { codexEfforts } from '../modules/codex/settings';
import { claudeCodeEfforts } from '../modules/claudeCode/settings';
import { CLAUDE_CODE_PROVIDER_ID, claudeEffort } from '../modules/claudeCode/protocol';
import type { ChatSessionKind } from '../modules/chatWorkspace';

import { startCaptureMode } from '../modules/capture';
import { getReaderByTabId } from '../modules/tabObserver';
import { setSendBtnEnabled, setSendButtonMode } from './buttons/sendButton';
import { checkModelSupportsImage, getActiveModelContextLimit, promptModelImageUnsupported } from '../utils/providers';
import { contextTokenInfo } from '../utils/tokenUsage';
import { createUserMessageBubble } from './userBubble';
import { readChatTextDraft, writeChatTextDraft } from '../utils/chatDraft';
import { applyChatInputFontSize } from '../utils/chatFontSize';
import { getCurrentSelectionSnapshot } from '../modules/selectionHint';

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
  dispose: () => void;
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
  let disposed = false;
  let resizeFrame: number | undefined;
  const clipboardReaders = new Set<FileReader>();
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
    'bg-white',
    'dark:bg-neutral-900',
    'px-1.5',
    'py-1.5',
    'rounded-2xl',
    'border',
    'border-slate-200',
    'dark:border-neutral-700',
    'shadow-sm',
    'focus-within:border-rose-300',
    'dark:focus-within:border-rose-900',
    'transition-all',
    'duration-300'
  );
  // The input surface forms an opaque foreground layer. The selection hint
  // slides underneath this layer when dismissed instead of fading in front
  // of the input controls.
  container.style.position = 'relative';
  container.style.zIndex = '2';

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
    'border',
    'border-slate-200',
    'dark:border-neutral-700',
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
  hintBar.style.zIndex = '1';
  hintBar.style.height = '28px';
  hintBar.style.minHeight = '28px';
  hintBar.style.opacity = '0';
  hintBar.style.visibility = 'hidden';
  hintBar.style.overflow = 'hidden';
  hintBar.style.borderWidth = '1px 1px 0 1px';
  hintBar.style.pointerEvents = 'none';
  hintBar.style.transform = 'translateY(0)';
  hintBar.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';

  const hintIcon = ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Quote, sizeRem: 0.75 })) as HTMLElement;
  hintIcon.classList.add('flex-shrink-0', 'opacity-70');
  hintBar.appendChild(hintIcon);

  const hintText = doc.createElement('span');
  hintText.classList.add('selection-hint-text', 'flex-1', 'min-w-0', 'truncate');
  hintBar.appendChild(hintText);

  let hintAnimationSequence = 0;
  let hintTimer: number | undefined;
  let finishHintHide: (() => void) | undefined;

  function cancelHintHide() {
    if (hintTimer !== undefined) doc.defaultView?.clearTimeout(hintTimer);
    hintTimer = undefined;
    if (finishHintHide) hintBar.removeEventListener('transitionend', finishHintHide);
    finishHintHide = undefined;
  }

  function showSelectionHint(text: string) {
    if (disposed) return;
    cancelHintHide();
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (!oneLine) return;
    hintText.textContent = `“${oneLine}”`;
    hintBar.title = oneLine;
    hintAnimationSequence += 1;
    hintBar.style.visibility = 'visible';
    hintBar.style.opacity = '1';
    hintBar.style.transform = 'translateY(-100%)';
    wrapper.dataset.selectionHintVisible = 'true';
    // The floating hint owns the merged shape's top outline. Keep the input
    // height stable by replacing the top border with padding. A transparent
    // border leaves diagonal gaps where it joins the two side borders.
    container.style.borderTopWidth = '0';
    container.style.paddingTop = 'calc(0.375rem + 1px)';
    container.style.borderTopLeftRadius = '0';
    container.style.borderTopRightRadius = '0';
  }

  function hideSelectionHint() {
    if (disposed) return;
    cancelHintHide();
    const sequence = ++hintAnimationSequence;
    hintBar.style.transform = 'translateY(0)';
    wrapper.dataset.selectionHintVisible = 'false';
    // Restore the top border and its matching padding together so the input
    // height stays constant while the floating bar slides underneath.
    container.style.borderTopWidth = '';
    container.style.paddingTop = '';
    container.style.borderTopLeftRadius = '';
    container.style.borderTopRightRadius = '';

    const finishHide = () => {
      if (sequence !== hintAnimationSequence || hintBar.style.transform !== 'translateY(0)') return;
      cancelHintHide();
      hintBar.style.opacity = '0';
      hintBar.style.visibility = 'hidden';
    };
    finishHintHide = finishHide;
    hintBar.addEventListener('transitionend', finishHide, { once: true });
    hintTimer = doc.defaultView?.setTimeout(finishHide, 260);
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
  // UI mirrors the thinking-effort button (click-open dropdown) but the popup
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

  // Lives in the status row below the input card, shown as icon + label text.
  // Status row controls share `.input-status-btn` (hover/open highlight in
  // zoteroAIBar.css and skins.css), matching the model selector.
  const chatModeBtn = doc.createElement('button');
  chatModeBtn.title = getString('input-chat-mode-tooltip');
  chatModeBtn.classList.add(
    'input-chat-mode-btn',
    'input-status-btn',
    'flex',
    'items-center',
    'gap-1',
    'px-1.5',
    'py-0.5',
    'rounded-md',
    'text-xs',
    'transition-colors',
    'text-slate-500',
    'dark:text-neutral-400',
    'flex-shrink-0'
  );
  chatModeBtn.style.position = 'relative';

  function updateChatModeBtnAppearance() {
    const mode = session.effectiveChatMode;
    chatModeBtn.innerHTML = '';
    chatModeBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: chatModeIconMap[mode], sizeRem: 0.875 })));
    const label = doc.createElement('span');
    label.textContent = chatModeLabel(mode);
    chatModeBtn.appendChild(label);
    chatModeBtn.title = chatModeAdjustable ? getString('input-chat-mode-tooltip') : getString('chat-mode-fixed');
    chatModeBtn.removeAttribute('aria-disabled');
    chatModeBtn.setAttribute('aria-haspopup', 'menu');
    chatModeBtn.tabIndex = 0;
    chatModeBtn.classList.remove('cursor-default');

    if (mode !== 'normal') {
      chatModeBtn.classList.remove('text-slate-500', 'dark:text-neutral-400');
      chatModeBtn.classList.add('text-rose-500', 'dark:text-rose-400');
    } else {
      chatModeBtn.classList.remove('text-rose-500', 'dark:text-rose-400');
      chatModeBtn.classList.add('text-slate-500', 'dark:text-neutral-400');
    }
  }
  updateChatModeBtnAppearance();

  // ── screenshot button (left) ──────────────────────────────────────────
  const screenshotBtn = doc.createElement('button');
  screenshotBtn.title = getString('input-screenshot-tooltip');
  screenshotBtn.classList.add(
    'input-screenshot-btn',
    'flex',
    'items-center',
    'justify-center',
    'w-8',
    'h-8',
    'rounded-lg',
    'hover:bg-slate-100',
    'dark:hover:bg-neutral-800',
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
    'min-w-0',
    'bg-transparent',
    'border-none',
    'outline-none',
    'text-slate-900',
    'dark:text-white',
    'placeholder-slate-400',
    'dark:placeholder-neutral-600',
    'resize-none',
    'text-sm',
    // Whole-pixel line height: a fractional one leaves a sub-pixel overflow
    // after autoResize and shows a scrollbar. One line + py-1 = 32px, the
    // height of the screenshot and send buttons.
    'leading-6',
    'py-1',
    'px-1',
    'overflow-y-auto'
  );
  // Zotero 8's global key handler only recognises text inputs and
  // [contenteditable="true"] as editable targets. Keep the native textarea,
  // but add the marker so reader shortcuts never consume typed characters.
  textarea.setAttribute('contenteditable', 'true');
  // max-height approximately 5 lines, overflow scrolls
  textarea.style.maxHeight = '7rem';
  applyChatInputFontSize(wrapper);

  // ── model selector (status row, right) ────────────────────────────────────
  // Reuses the ModelInfo component from the reader popup in its inline label
  // form. The dropdown anchors to `wrapper` via the
  // [data-model-dropdown-container] attribute and pops upward.
  const modelInfoSpec = ModelInfo({ dropUp: true, variant: 'label' });
  const modelInfoBtn = ztoolkit.UI.createElement(doc, modelInfoSpec.tag, modelInfoSpec) as HTMLElement;
  registerModelInfoAnchor(modelInfoBtn);

  const effortOrder: Array<'none' | 'low' | 'medium' | 'high' | 'xhigh'> = ['none', 'low', 'medium', 'high', 'xhigh'];
  const effortLabelMap: Record<string, string> = {
    none: getString('thinking-effort-none'),
    low: getString('thinking-effort-low'),
    medium: getString('thinking-effort-medium'),
    high: getString('thinking-effort-high'),
    xhigh: getString('thinking-effort-xhigh'),
    max: getString('thinking-effort-max'),
  };

  // Subscription runtimes report their own levels per model (Codex, Claude Code);
  // API models use the generic list. Claude Code mirrors its backend exactly: a
  // level the model does not report is not sent, so the CLI default applies.
  type EffortState = { efforts: string[]; current: string | undefined; set: (effort: string) => void };
  function effortState(): EffortState {
    const codex = codexEfforts();
    if (codex.length) {
      return { efforts: codex, current: session.codexThinkingEffort || session.thinkingEffort, set: (e) => (session.codexThinkingEffort = e) };
    }
    if (addon.data.userProviderConfigV2?.active?.providerId === CLAUDE_CODE_PROVIDER_ID) {
      const efforts = claudeCodeEfforts();
      return {
        efforts,
        current: claudeEffort(efforts, session.claudeThinkingEffort ?? session.thinkingEffort),
        set: (e) => (session.claudeThinkingEffort = e),
      };
    }
    return { efforts: effortOrder, current: session.thinkingEffort, set: (e) => (session.thinkingEffort = e as typeof session.thinkingEffort) };
  }

  // ── thinking effort (status row, right of the model) ──────────────────────
  // Plain text label, like the effort shown next to the model in Claude.
  const thinkingBtn = doc.createElement('button');
  thinkingBtn.title = getString('input-thinking-tooltip');
  thinkingBtn.classList.add(
    'input-thinking-btn',
    'input-status-btn',
    'flex',
    'items-center',
    'px-1.5',
    'py-0.5',
    'rounded-md',
    'text-xs',
    'text-slate-500',
    'dark:text-neutral-400',
    'transition-colors',
    'flex-shrink-0'
  );
  thinkingBtn.style.position = 'relative';

  function updateThinkingBtnAppearance() {
    const { efforts, current } = effortState();
    // A model without adjustable effort (e.g. Claude Haiku) shows no control.
    thinkingBtn.style.display = efforts.length ? '' : 'none';
    thinkingBtn.innerHTML = '';
    const labelSpan = doc.createElement('span');
    labelSpan.textContent = current ? effortLabelMap[current] || current : getString('thinking-effort-default');
    thinkingBtn.appendChild(labelSpan);
    thinkingBtn.title = `${getString('input-thinking-tooltip')}: ${labelSpan.textContent}`;
  }
  updateThinkingBtnAppearance();

  // ── send / stop button (right) ────────────────────────────────────────────
  const sendBtn = doc.createElement('button') as HTMLButtonElement;
  sendBtn.disabled = true;
  sendBtn.dataset.mode = 'send';
  sendBtn.style.marginLeft = '2px';
  sendBtn.classList.add(
    'input-send-btn',
    'flex',
    'items-center',
    'justify-center',
    'w-8',
    'h-8',
    'rounded-full',
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
        sizeRem: 1.25,
        extraClasses: ['text-white'],
      })
    )
  );

  // Layout modeled on the Claude composer: the card holds only attachments,
  // the text and its two direct actions; mode, model and effort sit below it.
  container.appendChild(preview.container);

  const inputRow = doc.createElement('div');
  inputRow.classList.add('flex', 'items-end', 'gap-1');
  inputRow.appendChild(screenshotBtn);
  inputRow.appendChild(textarea);
  inputRow.appendChild(sendBtn);

  container.appendChild(inputRow);

  // ── status row: chat mode (left) · context tokens, model, effort (right) ──
  const statusRow = doc.createElement('div');
  statusRow.classList.add('input-status-row', 'flex', 'items-center', 'gap-0.5', 'mt-1', 'px-1', 'min-w-0', 'select-none');

  const statusSpacer = doc.createElement('div');
  statusSpacer.classList.add('flex-1', 'min-w-0');

  const contextTokens = doc.createElement('span');
  contextTokens.classList.add('input-context-tokens', 'text-xs', 'text-slate-400', 'dark:text-neutral-500', 'whitespace-nowrap', 'px-1.5');
  contextTokens.textContent = '';

  statusRow.append(chatModeBtn, statusSpacer, contextTokens, modelInfoBtn, thinkingBtn);

  const disclaimer = doc.createElement('div');
  disclaimer.classList.add('input-disclaimer', 'text-[11px]', 'leading-4', 'text-center', 'text-slate-400', 'dark:text-neutral-500', 'select-none');
  disclaimer.textContent = getString('input-ai-disclaimer');

  wrapper.appendChild(hintBar);
  wrapper.appendChild(container);
  wrapper.appendChild(statusRow);
  wrapper.appendChild(disclaimer);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: auto-resize textarea height
  // ─────────────────────────────────────────────────────────────────────────
  function autoResize() {
    textarea.style.height = 'auto';
    // InputArea is assembled before it is attached to the shadow root. An
    // unattached textarea reports a zero scrollHeight; persisting that as an
    // inline height leaves an almost unclickable input with a displaced
    // placeholder. Leave the row-sized native height in place until layout is
    // available.
    if (!textarea.isConnected || textarea.scrollHeight <= 0) return;
    textarea.style.height = Math.min(textarea.scrollHeight, 112) + 'px'; // 112 ≈ 7rem
  }

  function resizeAfterMount() {
    const view = doc.defaultView;
    if (!view) return;
    resizeFrame = view.requestAnimationFrame(() => {
      resizeFrame = undefined;
      if (!disposed) autoResize();
    });
  }

  function persistTextDraft() {
    writeChatTextDraft(addon.data.inputDraftTexts, draftId, textarea.value);
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
      resolved.scrollTo({ top: resolved.scrollHeight, behavior: 'smooth' });
      return;
    }
    const rootNode = textarea.getRootNode() as any;
    const container: HTMLElement | null = rootNode.host
      ? ((rootNode as ShadowRoot).querySelector('.message-container') as HTMLElement | null)
      : ((wrapper.parentElement?.querySelector('.message-container') as HTMLElement | null) ?? null);
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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

    const selectionSnapshot = sessionKind === 'global-agent' ? {} : getCurrentSelectionSnapshot(sourceTabId);

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
    persistTextDraft();
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
    persistTextDraft();
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
        clipboardReaders.add(reader);
        reader.onloadend = () => clipboardReaders.delete(reader);
        reader.onload = () => {
          if (disposed) return;
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

  function buildChoiceMenu(
    button: HTMLElement,
    className: string,
    titleText: string,
    items: Array<{ label: string; selected: boolean; disabled?: boolean; icon?: string; select: () => void }>
  ) {
    return openDropdownMenu({
      menuId: className,
      anchor: button,
      container: wrapper,
      dropUp: true,
      align: button === thinkingBtn ? 'right' : 'left',
      presentation: {
        menu: `${className} rounded-lg pb-[3px] text-xs`,
        title: `${className}-title pt-2 px-2.5 pb-2 text-[10px] font-semibold uppercase select-none`,
        item: `${className}-item flex items-center gap-2 py-2 px-2.5 cursor-pointer whitespace-nowrap text-left w-full`,
        list: 'flex flex-col',
        minWidth: button === thinkingBtn ? '104px' : '96px',
      },
      groups: [
        {
          title: titleText,
          items: items.map((entry, index) => ({
            id: String(index),
            label: entry.label,
            selected: entry.selected,
            disabled: entry.disabled,
            iconMarkup: entry.icon,
            onClick: entry.select,
          })),
        },
      ],
    });
  }

  const thinkingMenu = bindMenu(
    thinkingBtn,
    () => {
      const state = effortState();
      return buildChoiceMenu(
        thinkingBtn,
        'thinking-effort-dropdown',
        getString('thinking-effort-title'),
        state.efforts.map((effort) => ({
          label: effortLabelMap[effort] || effort,
          selected: state.current === effort,
          select: () => {
            state.set(effort);
            updateThinkingBtnAppearance();
          },
        }))
      );
    },
    'click'
  );
  const modeMenu = bindMenu(
    chatModeBtn,
    () =>
      buildChoiceMenu(
        chatModeBtn,
        'chat-mode-dropdown',
        getString(chatModeAdjustable ? 'chat-mode-title' : 'chat-mode-fixed'),
        chatModeOrder.map((mode) => ({
          label: chatModeLabel(mode),
          icon: chatModeIconMap[mode],
          selected: session.effectiveChatMode === mode,
          disabled: !chatModeAdjustable,
          select: () => {
            session.chatMode = mode;
            updateChatModeBtnAppearance();
          },
        }))
      ),
    'click'
  );
  const removeThinkingDropdown = () => thinkingMenu.close();
  const removeChatModeDropdown = () => modeMenu.close();
  modelInfoBtn.addEventListener(MODEL_CHANGE_EVENT, () => {
    thinkingMenu.close();
    updateThinkingBtnAppearance();
  });

  screenshotBtn.addEventListener('click', () => {
    if (preview.isFull()) return;
    const reader = captureSourceTabId ? getReaderByTabId(captureSourceTabId) : null;
    if (!reader) {
      ztoolkit.log('[InputArea] No reader available for capture');
      return;
    }
    if (reader?._type === 'pdf') {
      startCaptureMode(reader as _ZoteroTypes.ReaderInstance<'pdf'>, (imageData: string) => {
        if (disposed) return;
        preview.addImage(imageData);
        updateScreenshotBtnState();
      });
    }
  });

  const streamingBySession = new Map<string, boolean>();

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
    setSendButtonMode(sendBtn, isStreaming, 1.25);
    if (!isStreaming) updateSendBtnState();
  }

  const inputAreaAPI: InputAreaAPI = {
    dispose() {
      if (disposed) return;
      disposed = true;
      persistTextDraft();
      cancelHintHide();
      if (resizeFrame !== undefined) doc.defaultView?.cancelAnimationFrame(resizeFrame);
      streamingBySession.clear();
      disposeMenusWithin(wrapper);
      unregisterModelInfoAnchors(wrapper);
      for (const reader of clipboardReaders) {
        reader.onload = reader.onloadend = null;
        if (reader.readyState === 1) reader.abort();
      }
      clipboardReaders.clear();
      preview.destroy();
      addon.data.sharedInputAreas.delete(wrapper);
      hintAnimationSequence++;
    },
    setContext(context) {
      if (disposed) return;
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
      // The mode button is permanently present in every workspace; it is not
      // passed through setCapabilityVisible, whose width clamp would cut off
      // its label and whose clipping would hide its dropdown.
      setCapabilityVisible(screenshotBtn, allowScreenshot);
      updateSelectionHint(addon.data.selection.text, (addon.data.selection.currentReader as any)?.tabID);
      const tokenInfo = contextTokenInfo(session.lastUsage, getActiveModelContextLimit());
      contextTokens.textContent = tokenInfo.text;
      contextTokens.title = tokenInfo.title;
      renderSendState(streamingBySession.get(activeSectionId) ?? !!session.pending.userMessage);
    },
    setStreaming(sessionId, isStreaming) {
      if (disposed) return;
      streamingBySession.set(sessionId, isStreaming);
      if (sessionId === activeSectionId) renderSendState(isStreaming);
    },
    setContextTokens(sessionId, text, title) {
      if (disposed) return;
      if (sessionId === activeSectionId) {
        contextTokens.textContent = text;
        contextTokens.title = title;
      }
    },
  };

  textarea.value = readChatTextDraft(addon.data.inputDraftTexts, draftId);
  // The caller attaches the returned wrapper after this function completes.
  // Measure on the following frame so restored drafts use the mounted layout.
  resizeAfterMount();
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
