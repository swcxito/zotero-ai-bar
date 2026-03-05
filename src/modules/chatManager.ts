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

    getCurrentHostMode(): ChatHostMode {
        const location = this.chatHostMode || getPref("chat.location");
        return location === "window" ? "window" : "sidebar";
    }

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
    }): Promise<string> {
        const requestId = crypto.randomUUID();

        const messagesPromise: Promise<Message[]> = (async () => {
            let selectionContext: Array<string> | undefined;
            try {
                if (addon.data.selectionContextPromise) {
                    selectionContext = await addon.data.selectionContextPromise;
                }
            } catch (e) {
                ztoolkit.log("Get selection context failed:", e);
            }

            return [
                {
                    role: "system",
                    content: this.buildSystemContent(
                        params.selectedText,
                        selectionContext,
                    ),
                },
                {
                    role: "user",
                    content: params.userPrompt,
                },
            ];
        })();

        this.lastMessagesPromise = messagesPromise;
        this.ensureRequestMaps();

        const route = {
            mode: params.hostMode || this.getCurrentHostMode(),
            sectionId: params.sectionId,
        } as const;

        const sourceLabel =
            params.sourceLabel || getReaderSourceLabel(this.currentReader);

        this.requestMap!.set(requestId, {
            hostMode: route.mode,
            sectionId: route.sectionId,
            sourceLabel,
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

        await streamLLM(messagesPromise, {
            onStart: () => {
                this.onLLMStreamStart({ requestId });
            },
            onUpdate: async (fullText) => {
                this.onLLMStreamUpdate({ requestId, fullText });
            },
            onEnd: () => {
                this.onLLMStreamEnd({ requestId });
            },
            onError: (error) => {
                this.onLLMStreamError({ requestId, error });
            },
        });

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
        });

        await streamLLM(messagesPromise, {
            onStart: () => {
                this.onLLMStreamStart({ requestId });
            },
            onUpdate: async (fullText) => {
                this.onLLMStreamUpdate({ requestId, fullText });
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

        const chatMessage = pop.querySelector(".chat-message") as HTMLElement | null;
        if (chatMessage) {
            const requestState = this.requestMap?.get(data.requestId);
            const sourceLabel = requestState?.sourceLabel;
            const previousSourceLabel =
                (container.lastElementChild as HTMLElement | null)?.dataset
                    .sourceLabel;
            const shouldShowSourceLabel =
                !!sourceLabel &&
                requestState?.hostMode === "window" &&
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
        const requestState = this.requestMap?.get(data.requestId);
        if (requestState) {
            requestState.chatPop = pop;
            this.requestMap!.set(data.requestId, requestState);
        }
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }

    async onLLMStreamUpdate(data: { requestId: string; fullText: string }) {
        const pop = this.requestMap?.get(data.requestId)?.chatPop;
        if (pop) {
            const chatMessage = pop.querySelector(".chat-message-content");
            if (chatMessage) {
                chatMessage.innerHTML = await renderMarkdown(data.fullText);
                (pop as HTMLElement).dataset.markdown = data.fullText;
            }
            const container = pop.parentElement;
            if (container) {
                container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
            }
        }
    }

    onLLMStreamEnd(data: { requestId: string }) {
        ztoolkit.log("LLM stream ended:", data.requestId);
        const pop = this.requestMap?.get(data.requestId)?.chatPop;
        if (pop) {
            const actions = pop.querySelector(".chat-actions");
            if (actions) {
                actions.classList.remove("hidden");
            }
        }
        this.cleanupRequestData(data.requestId);
    }

    onLLMStreamError(data: { requestId: string; error: string }) {
        ztoolkit.log("LLM stream error:", data.requestId, data.error);
        const pop = this.requestMap?.get(data.requestId)?.chatPop;
        if (pop) {
            const actions = pop.querySelector(".chat-actions");
            if (actions) {
                actions.classList.remove("hidden");
            }
            const chatMessage = pop.querySelector(".chat-message-content");
            if (chatMessage) {
                chatMessage.innerHTML = `<div style="color: red; white-space: pre-wrap; word-break: break-word;">${data.error}</div>`;
            }
            const container = pop.parentElement;
            if (container) {
                container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
            }
        }
        this.cleanupRequestData(data.requestId);
    }
}
