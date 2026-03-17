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

import { Icons } from "./common";
import { IconView } from "./iconView";
import { ChatBox } from "./chatBox";
import { getString } from "../utils/locale";

/**
 * Build the InputArea widget and wire up all interactive logic.
 * @param doc   The owner Document (from the Zotero item-pane body).
 * @param sectionId  The Zotero item ID that identifies this sidebar section.
 */
export function InputArea(doc: Document, sectionId: number): HTMLElement {
  // ── outer wrapper (contains input-row + disclaimer) ──────────────────────
  const wrapper = doc.createElement("div");
  wrapper.classList.add(
    "input-area-wrapper",
    "max-w-3xl",
    "w-full",
    "mx-auto",
    "my-2",
    "flex",
    "flex-col",
    "gap-1",
  );

  // ── input row ─────────────────────────────────────────────────────────────
  const container = doc.createElement("div");
  container.classList.add(
    "input-area",
    "w-full",
    "flex",
    "items-center",
    "justify-center",
    "gap-2",
    "bg-slate-50",
    "dark:bg-neutral-900",
    "p-2",
    "rounded-2xl",
    "border-2",
    "border-slate-200",
    "dark:border-neutral-800",
    "focus-within:border-rose-300",
    "dark:focus-within:border-rose-900",
    "transition-all",
    "duration-300",
  );

  // ── full-text toggle button (left) ────────────────────────────────────────
  const fullTextBtn = doc.createElement("button");
  fullTextBtn.title = getString("input-full-text-tooltip");
  fullTextBtn.classList.add(
    "input-fulltext-btn",
    "flex",
    "justify-center",
    "p-2.5",
    "rounded-xl",
    "text-slate-400",
    "dark:text-neutral-500",
    "hover:text-rose-500",
    "transition-colors",
    "flex-shrink-0",
  );
  fullTextBtn.appendChild(
    ztoolkit.UI.createElement(
      doc,
      "span",
      IconView({ iconMarkup: Icons.FileText, sizeRem: 1 }),
    ),
  );
  if (addon.chatManager.getOrCreateSectionState(sectionId).fullTextEnabled) {
    fullTextBtn.classList.remove(
      "text-slate-400",
      "dark:text-neutral-500",
      "hover:text-rose-500",
    );
    fullTextBtn.classList.add("text-rose-500", "dark:text-rose-400");
    fullTextBtn.title = getString("input-full-text-tooltip");
  }

  // ── textarea ──────────────────────────────────────────────────────────────
  const textarea = doc.createElement("textarea") as HTMLTextAreaElement;
  textarea.rows = 1;
  textarea.placeholder = getString("reader-bar-ask-placeholder");
  textarea.classList.add(
    "flex-1",
    "bg-transparent",
    "border-none",
    "outline-none",
    "text-slate-900",
    "dark:text-white",
    "placeholder-slate-400",
    "dark:placeholder-neutral-600",
    "resize-none",
    "text-sm",
    "font-medium",
    "overflow-y-auto",
  );
  // max-height approximately 5 lines, overflow scrolls
  textarea.style.maxHeight = "7rem";

  // ── send / stop button (right) ────────────────────────────────────────────
  const sendBtn = doc.createElement("button") as HTMLButtonElement;
  sendBtn.disabled = true;
  sendBtn.dataset.mode = "send";
  sendBtn.classList.add(
    "input-send-btn",
    "flex",
    "justify-center",
    "p-2.5",
    "rounded-xl",
    "transition-all",
    "bg-slate-200",
    "dark:bg-neutral-800",
    "text-slate-400",
    "dark:text-neutral-600",
    "flex-shrink-0",
  );
  sendBtn.appendChild(
    ztoolkit.UI.createElement(
      doc,
      "span",
      IconView({
        iconMarkup: Icons.Send,
        sizeRem: 1.5,
        extraClasses: ["text-white"],
      }),
    ),
  );

  container.appendChild(fullTextBtn);
  container.appendChild(textarea);
  container.appendChild(sendBtn);

  // ── disclaimer label ──────────────────────────────────────────────────────
  const disclaimer = doc.createElement("div");
  disclaimer.classList.add(
    "text-xs",
    "text-center",
    "text-slate-400",
    "dark:text-neutral-500",
    "px-2",
    "pb-1",
  );
  disclaimer.textContent = getString("input-ai-disclaimer");

  wrapper.appendChild(container);
  wrapper.appendChild(disclaimer);

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: auto-resize textarea height
  // ─────────────────────────────────────────────────────────────────────────
  function autoResize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 112) + "px"; // 112 ≈ 7rem
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: update send button appearance based on textarea content
  // ─────────────────────────────────────────────────────────────────────────
  function updateSendBtnState() {
    const sectionState = addon.chatManager.sidebarStates.get(sectionId);
    const isStreaming = sectionState?.isStreaming ?? false;
    if (isStreaming) return; // streaming state is controlled by ChatManager.updateSectionInputArea
    const hasText = textarea.value.trim().length > 0;
    if (hasText) {
      sendBtn.disabled = false;
      sendBtn.classList.remove(
        "bg-slate-200",
        "dark:bg-neutral-800",
        "text-slate-400",
        "dark:text-neutral-600",
      );
      sendBtn.classList.add(
        "bg-rose-500",
        "dark:bg-rose-600",
        "hover:bg-rose-600",
      );
    } else {
      sendBtn.disabled = true;
      sendBtn.classList.remove(
        "bg-rose-500",
        "dark:bg-rose-600",
        "hover:bg-rose-600",
      );
      sendBtn.classList.add(
        "bg-slate-200",
        "dark:bg-neutral-800",
        "text-slate-400",
        "dark:text-neutral-600",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: scroll message container to bottom
  // ─────────────────────────────────────────────────────────────────────────
  function scrollToBottom() {
    const body = addon.data.sidePaneMap?.get(sectionId);
    if (!body) return;
    const root = body.querySelector("#ai-bar-chat-root");
    const container = root?.shadowRoot?.querySelector(".message-container");
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: send a user message
  // ─────────────────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = textarea.value.trim();
    if (!text) return;

    const sectionState = addon.chatManager.sidebarStates.get(sectionId);
    if (sectionState?.isStreaming) return;

    // Get message container from shadow DOM
    const body = addon.data.sidePaneMap?.get(sectionId);
    if (!body) return;
    const root = body.querySelector("#ai-bar-chat-root");
    if (!root?.shadowRoot) return;
    const messageContainer = root.shadowRoot.querySelector(
      ".message-container",
    ) as HTMLElement | null;
    if (!messageContainer) return;

    // Append user bubble
    const userBubble = ChatBox({
      doc,
      annotation: undefined,
      isUser: true,
    }) as HTMLElement;
    const msgEl = userBubble.querySelector(
      ".chat-message",
    ) as HTMLElement | null;
    if (msgEl) msgEl.textContent = text;
    messageContainer.appendChild(userBubble);
    scrollToBottom();

    // Clear textarea and reset height
    textarea.value = "";
    textarea.style.height = "auto";
    updateSendBtnState();

    // Kick off the request
    try {
      await addon.chatManager.sendChatRequest({
        userPrompt: text,
        hostMode: "sidebar",
        sectionId,
      });
    } catch (e) {
      ztoolkit.log("sendChatRequest error:", e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event wiring
  // ─────────────────────────────────────────────────────────────────────────

  // textarea: auto-resize + button state sync
  textarea.addEventListener("input", () => {
    autoResize();
    updateSendBtnState();
  });

  // Enter to send, Shift+Enter for newline
  textarea.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled && sendBtn.dataset.mode === "send") {
        handleSend();
      }
    }
  });

  // Send / Stop button click
  sendBtn.addEventListener("click", () => {
    if (sendBtn.dataset.mode === "stop") {
      // Abort the ongoing stream for this section
      const sectionState = addon.chatManager.sidebarStates.get(sectionId);
      if (sectionState?.abortController) {
        sectionState.abortController.abort();
      }
    } else {
      handleSend();
    }
  });

  // Full-text toggle button
  fullTextBtn.addEventListener("click", () => {
    const sectionState = addon.chatManager.getOrCreateSectionState(sectionId);
    sectionState.fullTextEnabled = !sectionState.fullTextEnabled;
    if (sectionState.fullTextEnabled) {
      fullTextBtn.classList.remove(
        "text-slate-400",
        "dark:text-neutral-500",
        "hover:text-rose-500",
      );
      fullTextBtn.classList.add("text-rose-500", "dark:text-rose-400");
      fullTextBtn.title = getString("input-full-text-tooltip");
    } else {
      fullTextBtn.classList.remove("text-rose-500", "dark:text-rose-400");
      fullTextBtn.classList.add(
        "text-slate-400",
        "dark:text-neutral-500",
        "hover:text-rose-500",
      );
      fullTextBtn.title = getString("input-full-text-tooltip");
    }
  });

  return wrapper;
}
