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
import { renderMarkdown } from '../utils/markdown';
import { ensureChatWindow } from '../utils/window';
import { CHAT_WINDOW_MESSAGE_CONTAINER_ID, ensureChatWindowUI } from './chatWindowHost';
import { resizeReaderItemPaneHeight } from './readerItemPane';
import { Session } from './chatManager';
import { IconView } from '../components/iconView';
import { Icons } from '../components/common';

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
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

export async function onLLMStreamUpdateV2(data: { session: Session; fullText: string }) {
  const pop = data.session.pending.messagePop;
  if (!pop) return;

  const chatMessage = pop.querySelector('.chat-message-content');
  if (!chatMessage) return;

  const newLen = data.fullText.length;
  const prevLen = data.session.pending.lastRenderedLength ?? 0;
  if (newLen - prevLen < 20 && prevLen > 0) return;

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
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        });
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

    // Append turn to conversation history (sidebar mode)
    const userMessage = session.pending.userMessage;
    const assistantContent = (pop as HTMLElement).dataset.markdown || '';
    if (userMessage) {
      session.conversationHistory.push(userMessage, {
        role: 'assistant',
        content: assistantContent,
      });
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
        actionsContainer.scrollTo({
          top: actionsContainer.scrollHeight,
          behavior: 'smooth',
        });
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
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }
  // Clear streaming state
  updateSectionInputArea(data.session.id, false);
  cleanupRequestData(data.session);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
    sendBtn.disabled = false;
    sendBtn.dataset.mode = 'stop';
    sendBtn.classList.remove(
      'bg-slate-200',
      'dark:bg-neutral-800',
      'text-slate-400',
      'dark:text-neutral-600',
      'bg-rose-500',
      'dark:bg-rose-600',
      'hover:bg-rose-600'
    );
    sendBtn.classList.add('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
    sendBtn.innerHTML = '';
    const stopIcon = ztoolkit.UI.createElement(
      doc,
      'span',
      IconView({
        iconMarkup: Icons.Stop,
        sizeRem: 1.5,
        extraClasses: ['text-white'],
      })
    );
    sendBtn.appendChild(stopIcon);
  } else {
    sendBtn.dataset.mode = 'send';
    if (hasText) {
      sendBtn.disabled = false;
      sendBtn.classList.remove('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
      sendBtn.classList.add('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
    } else {
      sendBtn.disabled = true;
      sendBtn.classList.remove('bg-rose-500', 'dark:bg-rose-600', 'hover:bg-rose-600');
      sendBtn.classList.add('bg-slate-200', 'dark:bg-neutral-800', 'text-slate-400', 'dark:text-neutral-600');
    }
    sendBtn.innerHTML = '';
    const sendIcon = ztoolkit.UI.createElement(
      doc,
      'span',
      IconView({
        iconMarkup: Icons.Send,
        sizeRem: 1.5,
        extraClasses: ['text-white'],
      })
    );
    sendBtn.appendChild(sendIcon);
  }
}
