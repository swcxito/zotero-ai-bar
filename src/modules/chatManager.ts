/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * chatManager.ts
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

import { ChatBox } from "../components/chatBox";
import { Icons } from "../components/common";
import { IconView } from "../components/iconView";
import { renderMarkdown } from "../utils/markdown";
import { streamLLM } from "./llmRequest";
import type { Message } from "./llmRequest";
import { getPref } from "../utils/prefs";
import { SYSTEM_PROMPT_PREFIX } from "../utils/prompts";
import {
  ensureChatWindowReady,
  focusChatWindow,
  ensureChatWindow,
} from "../utils/window";
import {
  CHAT_WINDOW_MESSAGE_CONTAINER_ID,
  ensureChatWindowUI,
} from "./chatWindowHost";
import { resizeReaderItemPaneHeight } from "./readerItemPane";
import { getReaderSourceLabel } from "./readerBarPopup";

export type ChatHostMode = "sidebar" | "window";

type RequestState = {
  chatPop?: Element;
  hostMode: ChatHostMode;
  sectionId?: number;
  sourceLabel: string;
  autoCopy?: boolean;
  stopAutoScroll?: boolean;
};

/** Per-section (per-document tab) state for sidebar chat */
export type SidebarSectionState = {
  conversationHistory: Message[];
  isStreaming: boolean;
  fullTextEnabled: boolean;
  abortController?: InstanceType<typeof AbortController>;
  /** requestId of the currently active stream, used to record history */
  activeRequestId?: string;
  /** The user message for the current turn, saved so we can append to history on end */
  pendingUserContent?: string;
};

export class ChatManager {
  public chatHostMode?: ChatHostMode;
  public chatWindow?: Window;
  public abortController?: AbortController;
  public lastMessagesPromise?: Promise<Message[]>;
  public lastRequest?: Omit<RequestState, "chatPop">;
  public requestMap?: Map<string, RequestState>;
  public currentAnnotation?: _ZoteroTypes.Annotations.AnnotationJson;
  public currentReader?: _ZoteroTypes.ReaderInstance<
    "pdf" | "epub" | "snapshot"
  >;
  public currentSection?: number;
  /** Per-section sidebar state (keyed by item.id / sectionId) */
  public sidebarStates: Map<number, SidebarSectionState> = new Map();

  getCurrentHostMode(): ChatHostMode {
    const location = this.chatHostMode || getPref("chat.location");
    return location === "window" ? "window" : "sidebar";
  }

  // ── Per-section sidebar state helpers ───────────────────────────────────

  getOrCreateSectionState(sectionId: number): SidebarSectionState {
    if (!this.sidebarStates.has(sectionId)) {
      this.sidebarStates.set(sectionId, {
        conversationHistory: [],
        isStreaming: false,
        fullTextEnabled: getPref("chat.autoAttachFullText"),
      });
    }
    return this.sidebarStates.get(sectionId)!;
  }

  clearSectionHistory(sectionId: number) {
    const state = this.sidebarStates.get(sectionId);
    if (state) {
      state.conversationHistory = [];
    }
  }

  /**
   * Retrieve metadata for the given Zotero item ID.
   * Returns formatted metadata string including title, abstract, authors, publication, etc.
   */
  getItemMetadata(itemId: number): string | undefined {
    try {
      const item = Zotero.Items.get(itemId) as any;
      if (!item) {
        return undefined;
      }

      // Get the top-level parent item (not attachment)
      let targetItem = item;
      if (item.isAttachment?.()) {
        const parentID = item.parentID;
        if (parentID) {
          const parentItem = Zotero.Items.get(parentID) as any;
          if (parentItem) {
            targetItem = parentItem;
          }
        }
      }

      if (!targetItem.isRegularItem?.()) {
        return undefined;
      }

      // Extract metadata
      const metadata: Record<string, string | string[]> = {};

      // Title
      const title = targetItem.getField("title") as string;
      if (title) {
        metadata["Title"] = title;
      }

      // Authors
      const creators = targetItem.getCreators?.() || [];
      if (creators.length > 0) {
        const authorNames = creators
          .map((creator: any) => {
            if (creator.firstName && creator.lastName) {
              return `${creator.firstName} ${creator.lastName}`;
            } else if (creator.name) {
              return creator.name;
            } else if (creator.lastName) {
              return creator.lastName;
            }
            return undefined;
          })
          .filter(Boolean);
        if (authorNames.length > 0) {
          metadata["Authors"] = authorNames;
        }
      }

      // Abstract
      const abstract = targetItem.getField("abstractNote") as string;
      if (abstract) {
        metadata["Abstract"] = abstract;
      }

      // Publication
      const publication =
        (targetItem.getField("publicationTitle") as string) ||
        (targetItem.getField("bookTitle") as string) ||
        (targetItem.getField("journalAbbreviation") as string) ||
        (targetItem.getField("series") as string);
      if (publication) {
        metadata["Publication"] = publication;
      }

      // Item Type
      const itemTypeID = targetItem.itemTypeID;
      if (itemTypeID) {
        const itemType = Zotero.ItemTypes.getLocalizedString(itemTypeID);
        if (itemType) {
          metadata["Item Type"] = itemType;
        }
      }

      // Date
      const date = targetItem.getField("date") as string;
      if (date) {
        metadata["Publication Date"] = date;
      }

      // Build formatted string
      if (Object.keys(metadata).length === 0) {
        return undefined;
      }

      let result = "# Item Metadata\n";
      for (const [key, value] of Object.entries(metadata)) {
        if (Array.isArray(value)) {
          result += `${key}: ${value.join(", ")}\n`;
        } else {
          result += `${key}: ${value}\n`;
        }
      }

      return result.trim();
    } catch (e) {
      ztoolkit.log("getItemMetadata failed:", e);
      return undefined;
    }
  }

  /**
   * Retrieve the full text of the attachment for the given Zotero item ID.
   * Truncates to 50,000 characters to keep prompts manageable.
   */
  async getItemFullText(itemId: number): Promise<string | undefined> {
    // ztoolkit.log("[getItemFullText] start, itemId:", itemId);
    try {
      const item = Zotero.Items.get(itemId) as any;
      // ztoolkit.log("[getItemFullText] item:", item, "itemType:", item?.itemType, "isAttachment:", item?.isAttachment?.());
      if (!item) {
        // ztoolkit.log("[getItemFullText] item not found");
        return undefined;
      }

      // If this is a regular item (not an attachment), try to get its best attachment
      let targetItem = item;
      if (item.isRegularItem?.() && !item.isAttachment?.()) {
        const attachmentIDs: number[] = item.getAttachments?.() ?? [];
        // ztoolkit.log("[getItemFullText] regular item, attachmentIDs:", attachmentIDs);
        for (const aid of attachmentIDs) {
          const att = Zotero.Items.get(aid) as any;
          // ztoolkit.log("[getItemFullText] checking attachment", aid, "contentType:", att?.attachmentContentType);
          if (
            att?.attachmentContentType === "application/pdf" ||
            att?.attachmentContentType?.startsWith("text/")
          ) {
            targetItem = att;
            break;
          }
        }
        if (targetItem === item) {
          // fall back to first attachment
          if (attachmentIDs.length > 0) {
            targetItem = Zotero.Items.get(attachmentIDs[0]) as any;
          }
        }
      }
      // ztoolkit.log("[getItemFullText] targetItem:", targetItem?.id, "attachmentText type:", typeof targetItem?.attachmentText);

      // Try built-in attachment text
      let text: string | undefined;
      if (typeof targetItem.attachmentText === "string") {
        text = targetItem.attachmentText;
        // ztoolkit.log("[getItemFullText] got text via string property, length:", text?.length);
      } else if (
        targetItem.attachmentText &&
        typeof targetItem.attachmentText.then === "function"
      ) {
        // ztoolkit.log("[getItemFullText] attachmentText is a Promise, awaiting...");
        text = await targetItem.attachmentText;
        // ztoolkit.log("[getItemFullText] awaited attachmentText, result type:", typeof text, "length:", (text as any)?.length);
      } else {
        // ztoolkit.log("[getItemFullText] attachmentText is:", targetItem.attachmentText);
      }

      if (!text) {
        // ztoolkit.log("[getItemFullText] text is empty/undefined after all attempts");
        return undefined;
      }
      const MAX = 50000;
      // ztoolkit.log("[getItemFullText] success, text length:", text.length, "truncated:", text.length > MAX);
      return text.length > MAX ? text.slice(0, MAX) + "\n...[truncated]" : text;
    } catch (e) {
      ztoolkit.log("getItemFullText failed:", e);
      return undefined;
    }
  }

  /**
   * Update the send/stop button in the inputArea inside a section's shadow DOM.
   * Called after isStreaming changes so the UI reflects current state.
   */
  updateSectionInputArea(sectionId: number) {
    const body = addon.data.sidePaneMap?.get(sectionId);
    if (!body) return;
    const root = body.querySelector("#ai-bar-chat-root");
    if (!root?.shadowRoot) return;
    const shadowRoot = root.shadowRoot;

    const inputArea = shadowRoot.querySelector(".input-area");
    if (!inputArea) return;

    const doc = body.ownerDocument;
    const state = this.sidebarStates.get(sectionId);
    const isStreaming = state?.isStreaming ?? false;
    const textarea = inputArea.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const hasText = (textarea?.value?.trim()?.length ?? 0) > 0;

    const sendBtn = inputArea.querySelector(
      ".input-send-btn",
    ) as HTMLButtonElement | null;
    if (!sendBtn) return;

    if (isStreaming) {
      sendBtn.disabled = false;
      sendBtn.dataset.mode = "stop";
      sendBtn.classList.remove(
        "bg-slate-200",
        "dark:bg-neutral-800",
        "text-slate-400",
        "dark:text-neutral-600",
        "bg-rose-500",
        "dark:bg-rose-600",
        "hover:bg-rose-600",
      );
      sendBtn.classList.add(
        "bg-rose-500",
        "dark:bg-rose-600",
        "hover:bg-rose-600",
      );
      sendBtn.innerHTML = "";
      const stopIcon = ztoolkit.UI.createElement(
        doc,
        "span",
        IconView({
          iconMarkup: Icons.Stop,
          sizeRem: 1.5,
          extraClasses: ["text-white"],
        }),
      );
      sendBtn.appendChild(stopIcon);
    } else {
      sendBtn.dataset.mode = "send";
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
      sendBtn.innerHTML = "";
      const sendIcon = ztoolkit.UI.createElement(
        doc,
        "span",
        IconView({
          iconMarkup: Icons.Send,
          sizeRem: 1.5,
          extraClasses: ["text-white"],
        }),
      );
      sendBtn.appendChild(sendIcon);
    }
  }

  // ────────────────────────────────────────────────────────────────────────

  ensureRequestMaps() {
    if (!this.requestMap) this.requestMap = new Map();
  }

  getMessageContainerByRequest(requestId: string): HTMLElement | null {
    const requestState = this.requestMap?.get(requestId);
    const mode = requestState?.hostMode || this.getCurrentHostMode();

    if (mode === "window") {
      const chatWindow = ensureChatWindow();
      ensureChatWindowUI(chatWindow.document);
      return chatWindow.document.querySelector(
        `#${CHAT_WINDOW_MESSAGE_CONTAINER_ID}`,
      ) as HTMLElement | null;
    }

    if (!addon.data.sidePaneMap) return null;
    const sectionId = requestState?.sectionId ?? this.currentSection;
    if (sectionId === undefined) return null;
    const body = addon.data.sidePaneMap.get(sectionId);
    if (!body) return null;
    const root = body.querySelector("#ai-bar-chat-root");
    if (!root?.shadowRoot) return null;

    resizeReaderItemPaneHeight(body, "maximize");
    return root.shadowRoot.querySelector(".message-container") as HTMLElement;
  }

  cleanupRequestData(requestId: string) {
    this.requestMap?.delete(requestId);
  }

  buildSystemContent(
    selectedText?: string,
    selectionContext?: Array<string>,
  ): string {
    const contextLeft = selectionContext?.[0] || "";
    const contextRight = selectionContext?.[2] || "";
    if (!selectedText) {
      return `${SYSTEM_PROMPT_PREFIX}${contextLeft}\n${contextRight}`.trim();
    }
    return (
      SYSTEM_PROMPT_PREFIX +
      `${contextLeft}\n<selected>\n${selectedText}\n</selected>\n${contextRight}`
    );
  }

  async sendChatRequest(params: {
    userPrompt: string;
    selectedText?: string;
    sourceLabel?: string;
    hostMode?: ChatHostMode;
    sectionId?: number;
    autoCopy?: boolean;
  }): Promise<string> {
    const requestId = crypto.randomUUID();
    const route = {
      mode: params.hostMode || this.getCurrentHostMode(),
      sectionId: params.sectionId,
    } as const;

    // Per-section state management (sidebar mode)
    const isSidebarMode =
      route.mode === "sidebar" && route.sectionId !== undefined;
    const sectionState = isSidebarMode
      ? this.getOrCreateSectionState(route.sectionId!)
      : undefined;

    if (sectionState) {
      // Abort any existing stream for this section only
      if (sectionState.abortController) {
        sectionState.abortController.abort();
        sectionState.abortController = undefined;
      }
      const AC = (
        typeof AbortController !== "undefined"
          ? AbortController
          : (Zotero.getMainWindow() as any).AbortController
      ) as typeof AbortController;
      sectionState.abortController = new AC();
      sectionState.pendingUserContent = params.userPrompt;
      sectionState.activeRequestId = requestId;
    }

    const messagesPromise: Promise<Message[]> = (async () => {
      let selectionContext: Array<string> | undefined;
      try {
        if (addon.data.selectionContextPromise) {
          selectionContext = await addon.data.selectionContextPromise;
        }
      } catch (e) {
        ztoolkit.log("Get selection context failed:", e);
      }

      let systemContent = this.buildSystemContent(
        params.selectedText,
        selectionContext,
      );

      // Append item metadata if enabled (after context, before fulltext)
      if (getPref("chat.autoAttachItemData") && route.sectionId !== undefined) {
        const itemMetadata = this.getItemMetadata(route.sectionId);
        if (itemMetadata) {
          systemContent += "\n\n" + itemMetadata;
        }
      }

      // Append full text if enabled for this section (manual toggle) or globally (pref)
      if (sectionState?.fullTextEnabled && route.sectionId !== undefined) {
        const fullText = await this.getItemFullText(route.sectionId);
        if (fullText) {
          systemContent +=
            "\n\n# Full Document Text\n<fulldoc>\n" + fullText + "\n</fulldoc>";
        }
      }

      const systemMsg: Message = { role: "system", content: systemContent };
      const userMsg: Message = { role: "user", content: params.userPrompt };

      // Build history slice for sidebar multi-turn
      if (sectionState && sectionState.conversationHistory.length > 0) {
        const contextRounds = getPref("chat.contextRounds") ?? 8;
        const maxHistoryMessages = contextRounds * 2;
        const history =
          sectionState.conversationHistory.slice(-maxHistoryMessages);
        return [systemMsg, ...history, userMsg];
      }

      return [systemMsg, userMsg];
    })();

    this.lastMessagesPromise = messagesPromise;
    this.ensureRequestMaps();

    const sourceLabel =
      params.sourceLabel || getReaderSourceLabel(this.currentReader);

    this.requestMap!.set(requestId, {
      hostMode: route.mode,
      sectionId: route.sectionId,
      sourceLabel,
      autoCopy: params.autoCopy,
      stopAutoScroll: false,
    });
    this.lastRequest = {
      hostMode: route.mode,
      sectionId: route.sectionId,
      sourceLabel,
    };

    if (route.mode === "window") {
      await ensureChatWindowReady();
      focusChatWindow();
    }

    await streamLLM(
      messagesPromise,
      {
        onStart: () => {
          this.onLLMStreamStart({ requestId });
        },
        onUpdate: async (fullText) => {
          await this.onLLMStreamUpdate({ requestId, fullText });
        },
        onEnd: () => {
          this.onLLMStreamEnd({ requestId });
        },
        onError: (error) => {
          this.onLLMStreamError({ requestId, error });
        },
      },
      undefined,
      sectionState?.abortController,
    );

    return requestId;
  }

  async regenerateResponse() {
    const messagesPromise = this.lastMessagesPromise;
    if (!messagesPromise) return;

    const requestId = crypto.randomUUID();
    this.ensureRequestMaps();
    this.requestMap!.set(requestId, {
      hostMode: this.lastRequest?.hostMode || this.getCurrentHostMode(),
      sectionId: this.lastRequest?.sectionId ?? this.currentSection,
      sourceLabel: this.lastRequest?.sourceLabel || "Unknown Source",
      stopAutoScroll: false,
    });

    await streamLLM(messagesPromise, {
      onStart: () => {
        this.onLLMStreamStart({ requestId });
      },
      onUpdate: async (fullText) => {
        await this.onLLMStreamUpdate({ requestId, fullText });
      },
      onEnd: () => {
        this.onLLMStreamEnd({ requestId });
      },
      onError: (error) => {
        this.onLLMStreamError({ requestId, error });
      },
    });
  }

  onLLMStreamStart(data: { requestId: string }) {
    ztoolkit.log("LLM stream started:", data.requestId);

    // Mark section as streaming
    const requestState = this.requestMap?.get(data.requestId);
    if (
      requestState?.hostMode === "sidebar" &&
      requestState.sectionId !== undefined
    ) {
      const sectionState = this.getOrCreateSectionState(requestState.sectionId);
      sectionState.isStreaming = true;
      this.updateSectionInputArea(requestState.sectionId);
    }

    const container = this.getMessageContainerByRequest(data.requestId);
    if (!container) return;

    const doc = container.ownerDocument;
    if (!doc) return;

    const pop = ChatBox({
      doc,
      annotation: this.currentAnnotation,
      isUser: false,
      onRegenerate: () => this.regenerateResponse(),
    }) as HTMLElement;
    pop.setAttribute("data-request-id", data.requestId);

    const chatMessage = pop.querySelector(
      ".chat-message",
    ) as HTMLElement | null;
    if (chatMessage) {
      const chatRequestState = this.requestMap?.get(data.requestId);
      const sourceLabel = chatRequestState?.sourceLabel;
      const previousSourceLabel = (
        container.lastElementChild as HTMLElement | null
      )?.dataset.sourceLabel;
      const shouldShowSourceLabel =
        !!sourceLabel &&
        chatRequestState?.hostMode === "window" &&
        previousSourceLabel !== sourceLabel;

      if (sourceLabel) {
        pop.dataset.sourceLabel = sourceLabel;
      }

      if (shouldShowSourceLabel) {
        const sourceEl = doc.createElement("div");
        sourceEl.classList.add(
          "text-xs",
          "tracking-wider",
          "font-semibold",
          "text-slate-400",
          "dark:text-neutral-500",
          "mb-1",
        );
        sourceEl.textContent = `Source: ${sourceLabel}`;
        chatMessage.appendChild(sourceEl);
      }

      const contentEl = doc.createElement("div");
      contentEl.classList.add("chat-message-content");
      contentEl.innerHTML = "Thinking...";
      chatMessage.appendChild(contentEl);
    }

    container.appendChild(pop);
    if (requestState) {
      requestState.chatPop = pop;
      this.requestMap!.set(data.requestId, requestState);
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }

  async onLLMStreamUpdate(data: { requestId: string; fullText: string }) {
    const requestState = this.requestMap?.get(data.requestId);
    const pop = requestState?.chatPop;
    if (pop) {
      const chatMessage = pop.querySelector(".chat-message-content");
      if (chatMessage) {
        chatMessage.innerHTML = await renderMarkdown(data.fullText);
        (pop as HTMLElement).dataset.markdown = data.fullText;
      }
      const container = pop.parentElement;
      if (container) {
        if (requestState?.stopAutoScroll) {
          return;
        }

        const containerTop = container.getBoundingClientRect().top;
        const popTop = (pop as HTMLElement).getBoundingClientRect().top;

        // Stop auto-scroll for this response once the latest reply reaches container top.
        if (popTop <= containerTop) {
          requestState.stopAutoScroll = true;
          this.requestMap!.set(data.requestId, requestState);
          return;
        }

        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }
  }

  onLLMStreamEnd(data: { requestId: string }) {
    ztoolkit.log("LLM stream ended:", data.requestId);
    const requestState = this.requestMap?.get(data.requestId);
    const pop = requestState?.chatPop;
    if (pop) {
      const actions = pop.querySelector(".chat-actions");
      if (actions) {
        actions.classList.remove("hidden");
        const container = pop.parentElement;
        if (container && !requestState?.stopAutoScroll) {
          container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        }
      }

      // Auto-copy to clipboard if flag is set
      if (requestState?.autoCopy) {
        const markdown = (pop as HTMLElement).dataset.markdown;
        if (markdown) {
          try {
            new ztoolkit.Clipboard().addText(markdown, "text/plain").copy();
            ztoolkit.log("Auto-copied markdown to clipboard");
          } catch (e) {
            ztoolkit.log("Auto-copy failed:", e);
          }
        }
      }

      // Append turn to conversation history (sidebar mode)
      if (
        requestState?.hostMode === "sidebar" &&
        requestState.sectionId !== undefined
      ) {
        const sectionState = this.sidebarStates.get(requestState.sectionId);
        if (sectionState && sectionState.activeRequestId === data.requestId) {
          const userContent = sectionState.pendingUserContent;
          const assistantContent = (pop as HTMLElement).dataset.markdown || "";
          if (userContent) {
            sectionState.conversationHistory.push(
              { role: "user", content: userContent },
              { role: "assistant", content: assistantContent },
            );
          }
          sectionState.pendingUserContent = undefined;
          sectionState.activeRequestId = undefined;
        }
        sectionState!.isStreaming = false;
        sectionState!.abortController = undefined;
        this.updateSectionInputArea(requestState.sectionId);
      }
    } else {
      // Pop was not created (e.g., container missing), still clear streaming state
      if (
        requestState?.hostMode === "sidebar" &&
        requestState.sectionId !== undefined
      ) {
        const sectionState = this.sidebarStates.get(requestState.sectionId);
        if (sectionState) {
          sectionState.isStreaming = false;
          sectionState.abortController = undefined;
          sectionState.pendingUserContent = undefined;
          sectionState.activeRequestId = undefined;
        }
        this.updateSectionInputArea(requestState.sectionId);
      }
    }
    this.cleanupRequestData(data.requestId);
  }

  onLLMStreamError(data: { requestId: string; error: string }) {
    ztoolkit.log("LLM stream error:", data.requestId, data.error);
    const requestState = this.requestMap?.get(data.requestId);
    const pop = requestState?.chatPop;
    if (pop) {
      const actions = pop.querySelector(".chat-actions");
      if (actions) {
        actions.classList.remove("hidden");
        const actionsContainer = pop.parentElement;
        if (actionsContainer && !requestState?.stopAutoScroll) {
          actionsContainer.scrollTo({
            top: actionsContainer.scrollHeight,
            behavior: "smooth",
          });
        }
      }
      const chatMessage = pop.querySelector(".chat-message-content");
      if (chatMessage) {
        chatMessage.innerHTML = `<div class="ai-bar-error-text">${data.error}</div>`;
      }
      const container = pop.parentElement;
      if (container && !requestState?.stopAutoScroll) {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    }
    // Clear streaming state for sidebar
    if (
      requestState?.hostMode === "sidebar" &&
      requestState.sectionId !== undefined
    ) {
      const sectionState = this.sidebarStates.get(requestState.sectionId);
      if (sectionState) {
        sectionState.isStreaming = false;
        sectionState.abortController = undefined;
        sectionState.pendingUserContent = undefined;
        sectionState.activeRequestId = undefined;
      }
      this.updateSectionInputArea(requestState.sectionId);
    }
    this.cleanupRequestData(data.requestId);
  }
}
