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
import type { Session } from './chatManager';
import { IconView } from '../components/iconView';
import { Icons } from '../components/common';
import { getString } from '../utils/locale';

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
    contentEl.innerHTML = 'Thinking...';
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

    const containerTop = container.getBoundingClientRect().top;
    const popTop = (pop as HTMLElement).getBoundingClientRect().top;

    // Stop auto-scroll for this response once the latest reply reaches container top.
    if (popTop <= containerTop) {
      data.session.pending.shouldAutoScroll = false;
      return;
    }
    scrollToBottom(container as HTMLElement);
  }
}

export function onLLMStreamEndV2(session: Session) {
  const pop = session.pending.messagePop;
  if (pop) {
    const actions = pop.querySelector('.chat-actions');
    if (actions) {
      actions.classList.remove('hidden');
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

  const summary = hasError ? getString('tool-call-status-error') : getString('tool-call-status-done');
  updateToolCallBox(box, summary, JSON.stringify(output, null, 2));
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
        case 'text-delta': {
          if (firstText) {
            firstText = false;
            if (currentTextSegment) currentTextSegment.innerHTML = '';
          }
          textBuffer += part.text; // AI SDK v6: field is `text`, not `textDelta`
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
          // ask_user renders its own question cards; skip the generic ToolCallBox
          if (part.toolName !== 'ask_user') {
            onToolCallStartV2(session, part);
          }
          break;
        case 'tool-result':
          // ask_user results are already shown by the Q&A cards
          if (part.toolName !== 'ask_user') {
            onToolCallEndV2(session, part);
          }
          break;
        case 'tool-error':
          ztoolkit.log('[chatUI] agent stream tool error part:', part);
          break;
        case 'error':
          ztoolkit.log('[chatUI] agent stream error part:', part);
          break;
      }

      if (session.pending.shouldAutoScroll && chatMessage.parentElement) {
        scrollToBottom(chatMessage.parentElement as HTMLElement);
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      aborted = true;
    } else {
      ztoolkit.log('[chatUI] agent stream iteration failed:', e);
    }
  }

  // Flush remaining text
  ensureTextSegment();
  await flushTextBuffer();

  // Collect markdown for copy/regenerate from all rendered segments
  (pop as HTMLElement).dataset.markdown = Array.from(chatMessage.querySelectorAll('.chat-message-content'))
    .map((el) => el.textContent || '')
    .join('\n\n');

  if (!aborted) {
    try {
      const response = await result.response;
      if (response?.messages && Array.isArray(response.messages)) {
        if (session.pending.userMessage) {
          session.conversationHistory.push(session.pending.userMessage);
        }
        session.conversationHistory.push(...response.messages);
      }
    } catch (e) {
      ztoolkit.log('[chatUI] failed to get agent response messages:', e);
    }
  }

  onLLMStreamEndV2(session);
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
    allowCustomInput?: boolean;
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

    if (q.allowCustomInput) {
      const customInput = doc.createElement('input') as HTMLInputElement;
      customInput.type = 'text';
      customInput.classList.add(
        'w-full',
        'mt-2',
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
      customInput.addEventListener('input', () => {
        state[qIndex].customInput = customInput.value;
      });
      qWrapper.appendChild(customInput);
    }

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

    const answers = questions.map((q, i) => ({
      question: q.question,
      selectedOptions: Array.from(state[i].selected)
        .sort((a, b) => a - b)
        .map((idx) => q.options[idx]),
      customInput: state[i].customInput || undefined,
    }));

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
