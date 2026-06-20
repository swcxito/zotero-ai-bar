/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatUI.ts
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

import { ChatBox } from '../components/chatBox';
import { ToolCallBox, updateToolCallBox } from '../components/toolCallBox';
import { escapeHtml, renderMarkdown } from '../utils/markdown';
import { ensureChatWindow } from '../utils/window';
import { CHAT_WINDOW_MESSAGE_CONTAINER_ID, ensureChatWindowUI } from './chatWindowHost';
import { resizeReaderItemPaneHeight, scrollToBottom, setSendBtnEnabled } from './readerItemPane';
import type { Session, TokenUsage } from './chatManager';
import { IconView } from '../components/iconView';
import { Icons } from '../components/common';
import { getString } from '../utils/locale';
import { createImageViewer } from '../components/imagePreview';
import { getReaderByTabId } from './tabObserver';
import { buildErrorMessage } from './llm';
import { getActiveModelContextLimit } from '../utils/providers';

Zotero.debug('[zaibar-chatUI] module loaded');

export function onLLMStreamStartV2(session: Session) {
  ztoolkit.log('LLM stream started:', session.id);

  updateSectionInputArea(session.id, true);
  session.pending.shouldAutoScroll = true;
  const container = getMessageContainer(session);
  if (!container) return;

  const doc = container.ownerDocument;
  if (!doc) return;

  const pop = ChatBox({
    doc,
    isUser: false,
    //todo regenerate
    // onRegenerate: () => regenerateResponse(),
  }) as HTMLElement;
  // pop.setAttribute("data-request-id", data.requestId);

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (chatMessage) {
    const sourceLabel = session.sourceLabel;
    const shouldShowSourceLabel = !!sourceLabel && !!session.pending.isNewSource;

    if (sourceLabel) {
      pop.dataset.sourceLabel = sourceLabel;
    }

    if (shouldShowSourceLabel) {
      const sourceEl = doc.createElement('div');
      sourceEl.classList.add('text-xs', 'tracking-wider', 'font-semibold', 'text-slate-400', 'dark:text-neutral-500', 'mb-1');
      sourceEl.textContent = `Source: ${sourceLabel}`;
      sourceEl.style.userSelect = 'none';
      chatMessage.appendChild(sourceEl);
    }

    const contentEl = doc.createElement('div');
    contentEl.classList.add('chat-message-content');
    chatMessage.appendChild(contentEl);
  }

  container.appendChild(pop);
  session.pending.messagePop = pop;
  scrollToBottom(container as HTMLElement);
}

export async function onLLMStreamUpdateV2(data: { session: Session; fullText: string; force?: boolean }) {
  const pop = data.session.pending.messagePop;
  if (!pop) return;

  const chatMessage = pop.querySelector('.chat-message-content');
  if (!chatMessage) return;

  const newLen = data.fullText.length;
  const prevLen = data.session.pending.lastRenderedLength ?? 0;
  if (!data.force && newLen - prevLen < 20 && prevLen > 0) return;

  chatMessage.innerHTML = await renderMarkdown(data.fullText);
  (pop as HTMLElement).dataset.markdown = data.fullText;
  data.session.pending.lastRenderedLength = newLen;

  const container = pop.parentElement;
  if (container) {
    if (!data.session.pending.shouldAutoScroll) {
      return;
    }
    if (shouldStopAutoScroll(data.session, pop as HTMLElement, container as HTMLElement)) {
      return;
    }
    scrollToBottom(container as HTMLElement);
  }
}

function shouldStopAutoScroll(session: Session, pop: HTMLElement, container: HTMLElement): boolean {
  if (!session.pending.shouldAutoScroll) return true;
  const stopOffset = 24;
  const containerTop = container.getBoundingClientRect().top;
  if (pop.getBoundingClientRect().top <= containerTop + stopOffset) {
    session.pending.shouldAutoScroll = false;
    return true;
  }
  return false;
}

export function onLLMStreamEndV2(session: Session, usage?: TokenUsage) {
  const pop = session.pending.messagePop;
  if (pop) {
    const actions = pop.querySelector('.chat-actions');
    if (actions) {
      actions.classList.remove('hidden');
      appendUsageBadge(actions as HTMLElement, usage);
      const container = pop.parentElement;
      if (container && session.pending.shouldAutoScroll) {
        scrollToBottom(container as HTMLElement);
      }
    }

    // Auto-copy to clipboard if flag is set
    if (session.pending.shouldCopyResponse) {
      const markdown = (pop as HTMLElement).dataset.markdown;
      if (markdown) {
        try {
          new ztoolkit.Clipboard().addText(markdown, 'text/plain').copy();
          ztoolkit.log('Auto-copied markdown to clipboard');
        } catch (e) {
          ztoolkit.log('Auto-copy failed:', e);
        }
      }
    }

    // Append turn to conversation history (sidebar mode).
    // In agent mode the history is managed by consumeAgentStream using the
    // SDK's response.messages, so skip the simple text-only append here.
    if (!session.pending.isAgentMode) {
      const userMessage = session.pending.userMessage;
      const assistantContent = (pop as HTMLElement).dataset.markdown || '';
      if (userMessage) {
        session.conversationHistory.push(userMessage);
      }
      if (assistantContent) {
        session.conversationHistory.push({
          role: 'assistant',
          content: assistantContent,
        });
      }
    }
  }
  updateSectionInputArea(session.id, false);
  cleanupRequestData(session);
  if (usage) {
    session.lastUsage = normalizeUsage(usage);
    updateContextTokenIndicator(session.id, session.lastUsage);
  }
}

function normalizeUsage(raw: any): TokenUsage {
  if (!raw || typeof raw !== 'object') return {};
  const promptTokens = typeof raw.inputTokens === 'number' ? raw.inputTokens : typeof raw.promptTokens === 'number' ? raw.promptTokens : undefined;
  const completionTokens =
    typeof raw.outputTokens === 'number' ? raw.outputTokens : typeof raw.completionTokens === 'number' ? raw.completionTokens : undefined;
  const totalTokens =
    typeof raw.totalTokens === 'number'
      ? raw.totalTokens
      : promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function formatTokenCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1) + 'K';
  return Math.round(n / 1000) + 'K';
}

function appendUsageBadge(actions: HTMLElement, usage: any): void {
  const normalized = normalizeUsage(usage);
  const hasAny = normalized.promptTokens !== undefined || normalized.completionTokens !== undefined || normalized.totalTokens !== undefined;
  if (!hasAny) return;
  const doc = actions.ownerDocument!;
  const existing = actions.querySelector('.chat-token-usage');
  if (existing) existing.remove();
  const badge = doc.createElement('span');
  badge.classList.add(
    'chat-token-usage',
    'ml-auto',
    'text-xs',
    'font-medium',
    'px-2',
    'py-0.5',
    'rounded-md',
    'bg-slate-200/80',
    'text-slate-700',
    'dark:bg-zinc-700/80',
    'dark:text-zinc-200',
    'select-none',
    'whitespace-nowrap'
  );
  const promptStr = formatTokenCount(normalized.promptTokens);
  const compStr = formatTokenCount(normalized.completionTokens);
  badge.textContent = `↑${promptStr} ↓${compStr}`;
  const titleParts: string[] = [];
  if (normalized.promptTokens !== undefined) titleParts.push(`${getString('token-usage-input')}: ${normalized.promptTokens.toLocaleString()}`);
  if (normalized.completionTokens !== undefined)
    titleParts.push(`${getString('token-usage-output')}: ${normalized.completionTokens.toLocaleString()}`);
  if (normalized.totalTokens !== undefined) titleParts.push(`${getString('token-usage-total')}: ${normalized.totalTokens.toLocaleString()}`);
  badge.title = titleParts.join(' · ');
  actions.appendChild(badge);
}

function updateContextTokenIndicator(sessionId: string, usage: TokenUsage): void {
  let indicator: HTMLElement | null = null;
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  if (body) {
    const root = body.querySelector('#ai-bar-chat-root');
    if (root?.shadowRoot) {
      indicator = root.shadowRoot.querySelector('.input-context-tokens') as HTMLElement | null;
    }
  }
  if (!indicator && addon.chatManager.getCurrentHostMode() === 'window') {
    try {
      const chatWindow = ensureChatWindow();
      indicator = chatWindow.document.querySelector('.input-context-tokens') as HTMLElement | null;
    } catch (e) {
      // window not ready — skip
    }
  }
  if (!indicator) return;
  const promptTokens = usage.promptTokens;
  const contextLimit = getActiveModelContextLimit();
  const ctxStr = formatTokenCount(promptTokens);
  let text: string;
  if (contextLimit && contextLimit > 0 && promptTokens !== undefined) {
    const pct = Math.min(100, (promptTokens / contextLimit) * 100);
    const pctStr = pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
    text = `${getString('token-usage-context')}: ${ctxStr} / ${formatTokenCount(contextLimit)} · ${pctStr}%`;
  } else if (promptTokens !== undefined) {
    text = `${getString('token-usage-context')}: ${ctxStr}`;
  } else {
    text = `${getString('token-usage-context')}: —`;
  }
  indicator.textContent = text;
  indicator.title = contextLimit
    ? `${getString('token-usage-context-window')}: ${contextLimit.toLocaleString()}`
    : getString('token-usage-context-window-unknown');
}

export function onLLMStreamErrorV2(data: { session: Session; error: string }) {
  ztoolkit.log('LLM stream error:', data.session.id, data.error);
  let pop = data.session.pending.messagePop;

  // If no message pop exists yet (error during init), create one
  if (!pop) {
    const container = getMessageContainer(data.session);
    if (container) {
      const doc = container.ownerDocument;
      pop = ChatBox({ doc, isUser: false }) as HTMLElement;
      const chatMsg = pop.querySelector('.chat-message') as HTMLElement | null;
      if (chatMsg) {
        const contentEl = doc.createElement('div');
        contentEl.classList.add('chat-message-content');
        chatMsg.appendChild(contentEl);
      }
      container.appendChild(pop);
      data.session.pending.messagePop = pop;
    }
  }

  if (pop) {
    const actions = pop.querySelector('.chat-actions');
    if (actions) {
      actions.classList.remove('hidden');
      const actionsContainer = pop.parentElement;
      if (actionsContainer && data.session.pending.shouldAutoScroll) {
        scrollToBottom(actionsContainer as HTMLElement);
      }
    }
    const chatMessage = pop.querySelector('.chat-message-content');
    if (chatMessage) {
      chatMessage.innerHTML = `<div class="ai-bar-error-text">${escapeHtml(data.error)}</div>`;
    } else {
      const chatMsg = pop.querySelector('.chat-message') as HTMLElement | null;
      if (chatMsg) {
        chatMsg.innerHTML = `<div class="ai-bar-error-text">${escapeHtml(data.error)}</div>`;
      }
    }
    const container = pop.parentElement;
    if (container && data.session.pending.shouldAutoScroll) {
      scrollToBottom(container as HTMLElement);
    }
  }
  // Clear streaming state
  updateSectionInputArea(data.session.id, false);
  cleanupRequestData(data.session);
}

function cleanupRequestData(session: Session) {
  session.pending = {};
}

function getMessageContainer(session: Session): HTMLElement | null {
  if (addon.chatManager.getCurrentHostMode() === 'window') {
    const chatWindow = ensureChatWindow();
    ensureChatWindowUI(chatWindow.document);
    return chatWindow.document.querySelector(`#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`) as HTMLElement | null;
  }

  if (!addon.data.sidePaneBodyMap) return null;
  const sectionId = session.id ?? addon.chatManager.currentTabID;
  if (sectionId === undefined) return null;
  const body = addon.data.sidePaneBodyMap.get(sectionId);
  if (!body) return null;
  const root = body.querySelector('#ai-bar-chat-root');
  if (!root?.shadowRoot) return null;

  resizeReaderItemPaneHeight(body, 'maximize');
  return root.shadowRoot.querySelector('.message-container') as HTMLElement;
}

/**
 * Update the send/stop button in the inputArea inside a section's shadow DOM.
 * Called after isStreaming changes so the UI reflects current state.
 */
function updateSectionInputArea(sessionId: string, isStreaming: boolean) {
  const body = addon.data.sidePaneBodyMap?.get(sessionId);
  if (!body) return;
  const root = body.querySelector('#ai-bar-chat-root');
  if (!root?.shadowRoot) return;
  const shadowRoot = root.shadowRoot;

  const inputArea = shadowRoot.querySelector('.input-area');
  if (!inputArea) return;

  const doc = body.ownerDocument;
  const textarea = inputArea.querySelector('textarea') as HTMLTextAreaElement | null;
  const hasText = (textarea?.value?.trim()?.length ?? 0) > 0;

  const sendBtn = inputArea.querySelector('.input-send-btn') as HTMLButtonElement | null;
  if (!sendBtn) return;

  if (isStreaming) {
    sendBtn.dataset.mode = 'stop';
    setSendBtnEnabled(sendBtn, true);
    sendBtn.innerHTML = '';
    sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Stop, sizeRem: 1.5, extraClasses: ['text-white'] })));
  } else {
    sendBtn.dataset.mode = 'send';
    setSendBtnEnabled(sendBtn, hasText);
    sendBtn.innerHTML = '';
    sendBtn.appendChild(ztoolkit.UI.createElement(doc, 'span', IconView({ iconMarkup: Icons.Send, sizeRem: 1.5, extraClasses: ['text-white'] })));
  }
}

export function onToolCallStartV2(session: Session, toolCall: any) {
  Zotero.debug('[zaibar-chatui] onToolCallStartV2 ' + toolCall.toolName);
  const pop = session.pending.messagePop;
  if (!pop) return;
  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const box = ToolCallBox({
    doc: pop.ownerDocument!,
    toolName: toolCall.toolName,
    summary: getString('tool-call-status-running'),
    details: JSON.stringify(toolCall.input ?? toolCall.args, null, 2),
    isExpanded: toolCall.toolName === 'capture_page',
  });
  chatMessage.appendChild(box);
  session.pending.toolCallBoxes = session.pending.toolCallBoxes || new Map();
  session.pending.toolCallBoxes.set(toolCall.toolCallId, box);

  const container = chatMessage.parentElement;
  if (container && session.pending.shouldAutoScroll) {
    scrollToBottom(container as HTMLElement);
  }
}

export function onToolCallEndV2(session: Session, toolResult: any) {
  Zotero.debug('[zaibar-chatui] onToolCallEndV2 ' + toolResult.toolName);
  const box = session.pending.toolCallBoxes?.get(toolResult.toolCallId);
  if (!box) return;

  const output = toolResult.output ?? toolResult.result;
  const hasError = output && typeof output === 'object' && 'error' in output;

  if (toolResult.toolName === 'ask_user' && Array.isArray(output)) {
    const parts: string[] = [];
    const detailLines: string[] = [];
    for (let i = 0; i < output.length; i++) {
      const a = output[i];
      const selected = a.selectedOptions?.join(', ') || '(none)';
      const custom = a.customInput ? ` [+ "${a.customInput}"]` : '';
      parts.push(`${selected}${custom}`);
      detailLines.push(`Q: ${a.question}\n  → ${selected}${custom}`);
    }
    const summary = parts.join('; ');
    updateToolCallBox(box, summary, detailLines.join('\n\n'));
    return;
  }

  if (toolResult.toolName === 'grep' && output && typeof output === 'object') {
    const input = toolResult.input ?? toolResult.args ?? {};
    const detailsEl = buildGrepDetails(box.ownerDocument!, input, output);
    const excerpts = Array.isArray(output.excerpts) ? output.excerpts : [];
    const matchCount = typeof output.matches === 'number' ? output.matches : excerpts.length;
    const patternStr = typeof input.pattern === 'string' && input.pattern ? `“${input.pattern}”` : '';
    const summary = patternStr
      ? `${getString('tool-call-status-done')} · ${matchCount} ${matchCount === 1 ? 'match' : 'matches'} · ${patternStr}`
      : `${getString('tool-call-status-done')} · ${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;
    updateToolCallBox(box, summary, detailsEl);
    return;
  }

  if (toolResult.toolName === 'tree' && output && typeof output === 'object' && typeof output.tree === 'string') {
    updateToolCallBox(box, getString('tool-call-status-done'), output.tree);
    return;
  }

  if (toolResult.toolName === 'read' && output && typeof output === 'object' && output.text) {
    updateToolCallBox(box, getString('tool-call-status-done'), output.text);
    return;
  }

  if (toolResult.toolName === 'capture_page' && output && typeof output === 'object' && output.dataUrl) {
    const imgDoc = box.ownerDocument;
    const img = imgDoc.createElement('img');
    img.src = output.dataUrl;
    img.classList.add('max-w-full', 'max-h-96', 'object-contain', 'rounded-lg', 'cursor-pointer');
    img.addEventListener('click', () => {
      const root = box.getRootNode() as any;
      let parent: HTMLElement;
      let ownerDoc: Document;
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
            ownerDoc = imgDoc;
          }
        } else {
          parent = root as unknown as HTMLElement;
          ownerDoc = imgDoc;
        }
      } else {
        parent = imgDoc.body;
        ownerDoc = imgDoc;
      }
      createImageViewer([output.dataUrl], 0, parent, ownerDoc);
    });
    updateToolCallBox(box, `Page ${output.pageNumber}`, img);
    if (!session.capturedPageImages) session.capturedPageImages = [];
    session.capturedPageImages.push(output.dataUrl);
    return;
  }

  if (hasError) {
    const errDoc = box.ownerDocument;
    const errEl = errDoc.createElement('span');
    errEl.classList.add('text-red-600', 'dark:text-red-400');
    errEl.textContent = JSON.stringify(output, null, 2);
    updateToolCallBox(box, getString('tool-call-status-error'), errEl);
  } else {
    updateToolCallBox(box, getString('tool-call-status-done'), JSON.stringify(output, null, 2));
  }
}

function buildGrepDetails(doc: Document, input: any, output: any): HTMLElement {
  const container = doc.createElement('div');
  container.classList.add('flex', 'flex-col', 'gap-2');

  const params = doc.createElement('div');
  params.classList.add('flex', 'flex-wrap', 'gap-x-3', 'gap-y-1.5', 'pb-2', 'border-b', 'border-slate-200', 'dark:border-zinc-700');
  const paramItems: string[] = [];
  if (typeof input.pattern === 'string' && input.pattern) paramItems.push(`pattern: ${input.pattern}`);
  if (input.useRegex) paramItems.push('regex: true');
  if (input.maxResults != null) paramItems.push(`max: ${input.maxResults}`);
  if (input.itemId != null) paramItems.push(`itemId: ${input.itemId}`);
  for (const item of paramItems) {
    const pill = doc.createElement('span');
    pill.classList.add(
      'inline-flex',
      'items-center',
      'px-1.5',
      'py-0',
      'rounded-md',
      'bg-slate-200/70',
      'dark:bg-zinc-700/70',
      'text-slate-600',
      'dark:text-zinc-300'
    );
    pill.textContent = item;
    params.appendChild(pill);
  }
  container.appendChild(params);

  const results = doc.createElement('div');
  results.classList.add('whitespace-pre-wrap');
  const excerpts = Array.isArray(output.excerpts) ? output.excerpts : [];
  const lines: string[] = [];
  for (const m of excerpts) {
    const lineNo = m?.line != null ? `${m.line}` : '?';
    const pageStr = m?.page != null ? `(P${m.page})` : '';
    lines.push(`${lineNo}${pageStr}| ${m?.excerpt ?? ''}`);
  }
  results.textContent = lines.length > 0 ? lines.join('\n') : '(no matches)';
  container.appendChild(results);

  return container;
}

function buildTranslateDetails(doc: Document, output: any): HTMLElement {
  const t = output.textType as string;
  const container = doc.createElement('div');
  container.classList.add(
    'translate-result',
    'flex',
    'flex-col',
    'gap-1',
    'my-2',
    'p-4',
    'rounded-xl',
    'shadow-lg',
    'border',
    'border-slate-200',
    'dark:border-zinc-700',
    'border-l-4',
    'border-l-rose-500',
    'bg-white',
    'dark:bg-zinc-900'
  );

  if (t === 'word') {
    const wordEl = doc.createElement('div');
    wordEl.classList.add('text-2xl', 'font-bold', 'text-slate-800', 'dark:text-zinc-100');
    wordEl.textContent = output.originalText;
    container.appendChild(wordEl);

    if (output.pronunciation) {
      const pronEl = doc.createElement('div');
      pronEl.classList.add('text-base', 'text-rose-600', 'dark:text-rose-400', 'font-mono');
      pronEl.textContent = output.pronunciation;
      container.appendChild(pronEl);
    }

    if (output.meaning) {
      const meaningEl = doc.createElement('div');
      meaningEl.classList.add('text-lg', 'text-slate-700', 'dark:text-zinc-200');
      const posSpan = doc.createElement('span');
      posSpan.classList.add('italic', 'mr-1');
      posSpan.textContent = output.meaning.pos;
      meaningEl.appendChild(posSpan);
      const meaningText = doc.createElement('span');
      meaningText.classList.add('font-bold');
      meaningText.textContent = output.meaning.meaning;
      meaningEl.appendChild(meaningText);
      container.appendChild(meaningEl);
    }

    if (output.otherMeanings && output.otherMeanings.length > 0) {
      const divider = doc.createElement('div');
      divider.classList.add('border-t', 'border-slate-200', 'dark:border-zinc-600', 'my-1');
      container.appendChild(divider);

      for (const m of output.otherMeanings as Array<{ pos: string; meaning: string }>) {
        const otherEl = doc.createElement('div');
        otherEl.classList.add('text-base', 'text-slate-500', 'dark:text-zinc-400');
        const posSpan = doc.createElement('span');
        posSpan.classList.add('italic', 'mr-1');
        posSpan.textContent = m.pos;
        otherEl.appendChild(posSpan);
        otherEl.appendChild(doc.createTextNode(m.meaning));
        container.appendChild(otherEl);
      }
    }
  } else if (t === 'abbreviation') {
    const abbrEl = doc.createElement('div');
    abbrEl.classList.add('text-2xl', 'font-bold', 'text-slate-800', 'dark:text-zinc-100');
    abbrEl.textContent = output.originalText;
    container.appendChild(abbrEl);

    if (output.fullForm) {
      const fullEl = doc.createElement('div');
      fullEl.classList.add(
        'rounded-md',
        'bg-rose-100',
        'dark:bg-rose-900/40',
        'px-1.5',
        'py-0.5',
        'font-mono',
        'text-base',
        'font-medium',
        'text-rose-700',
        'dark:text-rose-300',
        'inline-block'
      );
      fullEl.textContent = output.fullForm;
      container.appendChild(fullEl);
    }

    const trans = output.translatedText;
    if (trans) {
      const transEl = doc.createElement('div');
      transEl.classList.add('text-lg', 'text-slate-700', 'dark:text-zinc-200');
      const label = doc.createElement('span');
      label.classList.add('text-sm', 'text-slate-500', 'dark:text-zinc-400', 'mr-1');
      label.textContent = 'abbr.';
      transEl.appendChild(label);
      const transText = doc.createElement('span');
      transText.classList.add('font-bold');
      transText.textContent = trans;
      transEl.appendChild(transText);
      container.appendChild(transEl);
    }

    if (output.explanation) {
      const explEl = doc.createElement('div');
      explEl.classList.add('text-base', 'text-slate-500', 'dark:text-zinc-400');
      explEl.textContent = output.explanation;
      container.appendChild(explEl);
    }
  }

  return container;
}

export function onReasoningStartV2(session: Session) {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  if (!pop) return;
  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const doc = pop.ownerDocument!;
  const reasoningText = doc.createElement('div');
  reasoningText.classList.add('whitespace-pre-wrap');

  const box = ToolCallBox({
    doc,
    toolName: 'thinking',
    icon: Icons.Brain,
    summary: getString('thinking-card-title'),
    details: reasoningText,
    isExpanded: true,
  });

  // Remove any empty placeholder content divs so the reasoning card lands at
  // the true end of the stream order (text will create a fresh div after it).
  const contentDivs = chatMessage.querySelectorAll('.chat-message-content');
  for (const div of contentDivs) {
    if (!div.innerHTML.trim()) {
      div.remove();
    }
  }
  chatMessage.appendChild(box);

  session.pending.reasoningBox = box;
  session.pending.reasoningTextEl = reasoningText;
}

export function onReasoningDeltaV2(session: Session, text: string) {
  if (session.pending.reasoningTextEl) {
    session.pending.reasoningTextEl.textContent += text;
  }
  // Auto-scroll the thinking card's details panel so the latest reasoning
  // stays in view while tokens stream in.
  const reasoningBox = session.pending.reasoningBox as HTMLElement | undefined;
  if (reasoningBox) {
    const detailsPanel = reasoningBox.querySelector('.tool-call-details') as HTMLElement | null;
    if (detailsPanel) {
      detailsPanel.scrollTop = detailsPanel.scrollHeight;
    }
  }
  const container = (session.pending.messagePop as HTMLElement | undefined)?.parentElement;
  if (container && session.pending.shouldAutoScroll) {
    scrollToBottom(container as HTMLElement);
  }
}

export function onReasoningEndV2(session: Session) {
  const box = session.pending.reasoningBox as HTMLElement | undefined;
  if (!box) return;

  const summaryEl = box.querySelector('.tool-call-summary') as HTMLElement | null;
  if (summaryEl) summaryEl.textContent = getString('thinking-card-done');

  // Force-collapse (not toggle) so the card always folds up when this
  // reasoning segment ends, regardless of manual interaction during streaming.
  const detailsPanel = box.querySelector('.tool-call-details') as HTMLElement | null;
  const chevron = box.querySelector('.tool-call-chevron') as HTMLElement | null;
  if (detailsPanel) {
    detailsPanel.classList.remove('max-h-[32rem]', 'overflow-y-auto');
    detailsPanel.classList.add('max-h-0', 'overflow-hidden');
  }
  if (chevron) {
    chevron.classList.remove('rotate-180');
  }

  session.pending.reasoningBox = undefined;
  session.pending.reasoningTextEl = undefined;
}

/**
 * Consume the fullStream from a ToolLoopAgent result, rendering text deltas
 * and tool-call / tool-result UI in the current chat message bubble.
 *
 * Text segments and tool cards are interleaved in stream order:
 *   text-segment-1 → tool-card-1 → text-segment-2 → tool-card-2 → ...
 */
export async function consumeAgentStream(session: Session, result: any, refreshRate: number) {
  const pop = session.pending.messagePop as HTMLElement | undefined;
  if (!pop) return;

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) return;

  const doc = pop.ownerDocument!;

  // Reuse the .chat-message-content created by onLLMStreamStartV2 for the
  // first text segment.  Clear the placeholder "Thinking..." on first content.
  let currentTextSegment = chatMessage.querySelector('.chat-message-content') as HTMLElement | null;
  let firstText = true;

  let textBuffer = '';
  let textChunkCount = 0;
  let aborted = false;
  let fullMarkdownBuffer = ''; // accumulate raw markdown for copy

  function ensureTextSegment(): HTMLElement {
    if (!currentTextSegment) {
      currentTextSegment = doc.createElement('div');
      currentTextSegment.classList.add('chat-message-content');
      chatMessage!.appendChild(currentTextSegment);
    }
    return currentTextSegment;
  }

  // Render the accumulated text buffer into the current segment.
  // Does NOT clear the buffer — callers are responsible for resetting
  // between segments via startNewTextSegment().
  async function flushTextBuffer(): Promise<void> {
    if (!textBuffer) return;
    const seg = ensureTextSegment();
    seg.innerHTML = await renderMarkdown(textBuffer);
    textChunkCount = 0;
  }

  function startNewTextSegment(): void {
    currentTextSegment = null;
    textBuffer = '';
    textChunkCount = 0;
  }

  try {
    for await (const part of result.fullStream) {
      if (session.pending.abortController?.signal.aborted) {
        aborted = true;
        break;
      }

      switch (part.type) {
        case 'reasoning-start': {
          // If the current text segment is an empty placeholder, drop it so
          // the reasoning card is appended in true stream order and the next
          // text-delta creates a fresh segment after the reasoning card.
          if (currentTextSegment && !currentTextSegment.innerHTML.trim()) {
            currentTextSegment.remove();
            currentTextSegment = null;
          }
          onReasoningStartV2(session);
          break;
        }
        case 'reasoning-delta': {
          onReasoningDeltaV2(session, part.text);
          break;
        }
        case 'reasoning-end': {
          onReasoningEndV2(session);
          break;
        }
        case 'text-delta': {
          if (firstText) {
            firstText = false;
            if (currentTextSegment) currentTextSegment.innerHTML = '';
          }
          textBuffer += part.text; // AI SDK v6: field is `text`, not `textDelta`
          fullMarkdownBuffer += part.text;
          textChunkCount++;
          if (textChunkCount % refreshRate === 0) {
            ensureTextSegment();
            await flushTextBuffer();
          }
          break;
        }
        case 'tool-call':
          await flushTextBuffer();
          startNewTextSegment();
          // ask_user renders its own question cards; translate renders its own card on result
          if (part.toolName !== 'ask_user' && part.toolName !== 'translate') {
            onToolCallStartV2(session, part);
          }
          break;
        case 'tool-result':
          if (part.toolName === 'translate') {
            await flushTextBuffer();
            startNewTextSegment();
            const output = part.output ?? part.result;
            if (output && typeof output === 'object') {
              const card = buildTranslateDetails(doc, output);
              chatMessage!.appendChild(card);
            }
            break;
          }
          // ask_user results are already shown by the Q&A cards
          if (part.toolName !== 'ask_user') {
            onToolCallEndV2(session, part);
          }
          break;
        case 'tool-error': {
          ztoolkit.log('[chatUI] agent stream tool error part:', part);
          const errMsg = part.error || 'Tool execution failed';
          const errEl = doc.createElement('span');
          errEl.classList.add('text-red-600', 'dark:text-red-400');
          errEl.textContent = errMsg;
          const box = session.pending.toolCallBoxes?.get(part.toolCallId);
          if (box) {
            updateToolCallBox(box, getString('tool-call-status-error'), errEl);
          } else {
            const errBox = ToolCallBox({
              doc,
              toolName: part.toolName || 'unknown',
              summary: getString('tool-call-status-error'),
              details: errEl,
            });
            chatMessage!.appendChild(errBox);
          }
          break;
        }
        case 'error': {
          ztoolkit.log('[chatUI] agent stream error part:', part);
          const errObj = (part as any)?.error ?? part;
          const errMsg = buildErrorMessage(errObj);
          onLLMStreamErrorV2({ session, error: errMsg });
          aborted = true;
          break;
        }
      }

      if (session.pending.shouldAutoScroll) {
        const container = (pop as HTMLElement).parentElement as HTMLElement | null;
        if (container) {
          if (!shouldStopAutoScroll(session, pop as HTMLElement, container)) {
            scrollToBottom(container);
          }
        }
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      aborted = true;
    } else {
      ztoolkit.log('[chatUI] agent stream iteration failed:', e);
      const errMsg = buildErrorMessage(e);
      onLLMStreamErrorV2({ session, error: errMsg });
      aborted = true;
    }
  }

  // Flush remaining text (skip if buffer is empty to avoid creating an empty segment)
  if (textBuffer) {
    ensureTextSegment();
    await flushTextBuffer();
  }

  // Collect raw markdown for copy/regenerate
  (pop as HTMLElement).dataset.markdown = fullMarkdownBuffer.trim();

  let agentUsage: any;
  if (!aborted) {
    try {
      const response = await result.response;
      if (response?.messages && Array.isArray(response.messages)) {
        if (session.pending.userMessage) {
          session.conversationHistory.push(session.pending.userMessage);
        }
        session.conversationHistory.push(...response.messages);
      }
      agentUsage = (response as any)?.usage;
      if (!agentUsage) {
        try {
          agentUsage = await (result as any).usage;
        } catch (e) {
          ztoolkit.log('[chatUI] agent usage fetch failed:', e);
        }
      }
    } catch (e) {
      ztoolkit.log('[chatUI] failed to get agent response messages:', e);
    }
  }

  onLLMStreamEndV2(session, agentUsage);
}

export function onAgentAskUser(session: Session, payload: any) {
  Zotero.debug('[zaibar-chatui] onAgentAskUser questions=' + (payload.questions?.length || 0));
  const pop = session.pending.messagePop;
  if (!pop) {
    // Fallback if no message pop exists
    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve([]);
    }
    return;
  }

  const chatMessage = pop.querySelector('.chat-message') as HTMLElement | null;
  if (!chatMessage) {
    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve([]);
    }
    return;
  }

  const doc = pop.ownerDocument!;
  const questions: Array<{
    question: string;
    options: string[];
    multiple?: boolean;
  }> = payload.questions || [];

  const wrapper = doc.createElement('div');
  wrapper.classList.add(
    'agent-ask-user',
    'rounded-xl',
    'border',
    'border-slate-200',
    'dark:border-zinc-700',
    'bg-slate-50',
    'dark:bg-zinc-800',
    'p-3',
    'my-2'
  );

  const state: Array<{ selected: Set<number>; customInput: string }> = questions.map(() => ({ selected: new Set(), customInput: '' }));

  questions.forEach((q, qIndex) => {
    const qWrapper = doc.createElement('div');
    qWrapper.classList.add('agent-ask-user-question', 'mb-3');

    const qTitle = doc.createElement('div');
    qTitle.classList.add('text-sm', 'font-medium', 'text-slate-800', 'dark:text-zinc-100', 'mb-2');
    qTitle.textContent = q.question;
    qWrapper.appendChild(qTitle);

    const inputType = q.multiple ? 'checkbox' : 'radio';
    const groupName = `agent-ask-${session.id}-${qIndex}`;

    const customOptIndex = q.options.length; // virtual index for the custom input option

    q.options.forEach((option, optIndex) => {
      const label = doc.createElement('label');
      label.classList.add('flex', 'items-center', 'gap-2', 'text-sm', 'text-slate-700', 'dark:text-zinc-200', 'mb-1', 'cursor-pointer');

      const input = doc.createElement('input') as HTMLInputElement;
      input.type = inputType;
      input.name = groupName;
      input.value = option;
      input.addEventListener('change', () => {
        if (inputType === 'radio') {
          state[qIndex].selected.clear();
          state[qIndex].selected.add(optIndex);
          // clear custom input when a preset option is selected
          state[qIndex].customInput = '';
          customInput.value = '';
        } else {
          if (input.checked) {
            state[qIndex].selected.add(optIndex);
          } else {
            state[qIndex].selected.delete(optIndex);
          }
        }
      });

      label.appendChild(input);
      label.appendChild(doc.createTextNode(option));
      qWrapper.appendChild(label);
    });

    // Always show custom input with a radio/checkbox before it
    const customLabel = doc.createElement('label');
    customLabel.classList.add('flex', 'items-center', 'gap-2', 'text-sm', 'text-slate-700', 'dark:text-zinc-200', 'mb-1', 'cursor-pointer');

    const customRadio = doc.createElement('input') as HTMLInputElement;
    customRadio.type = inputType;
    customRadio.name = groupName;
    customRadio.value = '__custom__';

    const customInput = doc.createElement('input') as HTMLInputElement;
    customInput.type = 'text';
    customInput.classList.add(
      'flex-1',
      'px-2',
      'py-1',
      'text-sm',
      'rounded',
      'border',
      'border-slate-300',
      'dark:border-zinc-600',
      'bg-white',
      'dark:bg-zinc-900',
      'text-slate-800',
      'dark:text-zinc-100'
    );
    customInput.placeholder = getString('tool-call-ask-user-custom-placeholder');

    customRadio.addEventListener('change', () => {
      if (inputType === 'radio') {
        state[qIndex].selected.clear();
        state[qIndex].selected.add(customOptIndex);
      } else {
        if (customRadio.checked) {
          state[qIndex].selected.add(customOptIndex);
        } else {
          state[qIndex].selected.delete(customOptIndex);
        }
      }
    });

    customInput.addEventListener('focus', () => {
      // Auto-select the custom radio/checkbox when user starts typing
      if (!customRadio.checked) {
        customRadio.checked = true;
        customRadio.dispatchEvent(new Event('change'));
      }
    });
    customInput.addEventListener('input', () => {
      state[qIndex].customInput = customInput.value;
    });

    customLabel.appendChild(customRadio);
    customLabel.appendChild(customInput);
    qWrapper.appendChild(customLabel);

    wrapper.appendChild(qWrapper);
  });

  const submitBtn = doc.createElement('button');
  submitBtn.textContent = getString('tool-call-ask-user-submit');
  submitBtn.classList.add(
    'px-3',
    'py-1.5',
    'text-sm',
    'font-medium',
    'rounded-lg',
    'bg-rose-500',
    'text-white',
    'hover:bg-rose-600',
    'transition-colors'
  );

  let onAbort: (() => void) | undefined;
  const abortSignal = session.pending.abortController?.signal;

  submitBtn.addEventListener('click', () => {
    if (onAbort && abortSignal) {
      abortSignal.removeEventListener('abort', onAbort);
    }

    const answers = questions.map((q, i) => {
      const selectedIndices = Array.from(state[i].selected).sort((a, b) => a - b);
      const selectedOptions = selectedIndices.filter((idx) => idx < q.options.length).map((idx) => q.options[idx]);
      const hasCustom = selectedIndices.includes(q.options.length);
      return {
        question: q.question,
        selectedOptions,
        customInput: hasCustom && state[i].customInput ? state[i].customInput : undefined,
      };
    });

    try {
      // Replace question controls with a collapsible Q&A result card
      const details = doc.createElement('div');
      details.classList.add('flex', 'flex-col', 'gap-3');

      answers.forEach((a, i) => {
        const block = doc.createElement('div');
        block.classList.add('flex', 'flex-col', 'gap-2');
        if (i < answers.length - 1) {
          block.classList.add('border-b', 'border-slate-200', 'dark:border-zinc-700', 'pb-3');
        }

        const questionRow = doc.createElement('div');
        questionRow.classList.add('flex', 'items-center', 'gap-2');
        const qIcon = ztoolkit.UI.createElement(
          doc,
          'span',
          IconView({ iconMarkup: Icons.CircleQuestion, sizeRem: 0.9, extraClasses: ['text-rose-500', 'flex-shrink-0'] })
        );
        questionRow.appendChild(qIcon);
        const qText = doc.createElement('div');
        qText.classList.add('text-xs', 'font-medium', 'text-slate-700', 'dark:text-zinc-200');
        qText.textContent = a.question;
        questionRow.appendChild(qText);
        block.appendChild(questionRow);

        const answerRow = doc.createElement('div');
        answerRow.classList.add('flex', 'items-center', 'gap-2');
        const aIcon = ztoolkit.UI.createElement(
          doc,
          'span',
          IconView({ iconMarkup: Icons.MessageSquare, sizeRem: 0.9, extraClasses: ['text-emerald-500', 'flex-shrink-0'] })
        );
        answerRow.appendChild(aIcon);
        const aText = doc.createElement('div');
        aText.classList.add('text-xs', 'text-slate-600', 'dark:text-zinc-300');
        const selected = a.selectedOptions?.length ? a.selectedOptions.join(', ') : '(none)';
        const custom = a.customInput ? ` — ${a.customInput}` : '';
        aText.textContent = `${selected}${custom}`;
        answerRow.appendChild(aText);
        block.appendChild(answerRow);

        details.appendChild(block);
      });

      const resultBox = ToolCallBox({
        doc,
        toolName: 'ask_user',
        summary: getString('tool-call-status-done'),
        details,
        isExpanded: false,
      });

      wrapper.parentNode?.replaceChild(resultBox, wrapper);
    } catch (e: any) {
      Zotero.debug('[zaibar-chatui] ask_user submit failed: ' + (e?.message || e));
      ztoolkit.log('[chatUI] ask_user submit failed:', e);
    }

    if (session.pending.userAnswerResolve) {
      session.pending.userAnswerResolve(answers);
      session.pending.userAnswerResolve = undefined;
      session.pending.userAnswerReject = undefined;
    }
  });

  const btnRow = doc.createElement('div');
  btnRow.classList.add('flex', 'justify-end');
  btnRow.appendChild(submitBtn);
  wrapper.appendChild(btnRow);

  chatMessage.appendChild(wrapper);

  if (abortSignal) {
    onAbort = () => {
      abortSignal.removeEventListener('abort', onAbort!);
      if (session.pending.userAnswerReject) {
        session.pending.userAnswerReject(new DOMException('Aborted', 'AbortError'));
        session.pending.userAnswerResolve = undefined;
        session.pending.userAnswerReject = undefined;
      }
      wrapper.remove();
      updateSectionInputArea(session.id, false);
    };
    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener('abort', onAbort);
  }

  const container = chatMessage.parentElement;
  if (container && session.pending.shouldAutoScroll) {
    scrollToBottom(container as HTMLElement);
  }
}
