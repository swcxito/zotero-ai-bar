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

// todo 拆分文件
// TODO 优化provider管理，适配sdk
// todo !! 一个tab不止对应一个文件
import { getItemFullText, getItemMetadata } from "../utils/itemContext";
import { getPref } from "../utils/prefs";
import { SYSTEM_PROMPT_PREFIX } from "../utils/prompts";
import { ensureChatWindowReady, focusChatWindow } from "../utils/window";
import { streamLLMV2 } from "./llm";
import type { ModelMessage, SystemModelMessage, UserModelMessage } from "ai";
import { getItemIdFromTab } from "./tabObserver";
import type { ItemMetadata } from "../utils/itemContext";

export type ChatHostMode = "sidebar" | "window";

/** Per-section (per-document tab) state for sidebar chat */
export class Session {
  id: string;
  conversationHistory: ModelMessage[] = [];
  sourceLabel?: string;
  fullTextEnabled: boolean = false;
  pending: {
    shouldAutoScroll?: boolean;
    messagePop?: Element;
    abortController?: InstanceType<typeof AbortController>;
    shouldCopyResponse?: boolean;
    userMessage?: UserModelMessage;
    isNewSource?: boolean;
  } = {};
  constructor(id: string) {
    this.id = id;
  }
}

type ChatRequestParams =
  | {
      userPrompt: string;
      sourceLabel?: string;
      doesCopyResponse?: boolean;
      isFromPopup?: boolean;
      itemId: number;
      tabId?: string;
      contextPromise?: Promise<string[] | undefined>;
    }
  | {
      userPrompt: string;
      sourceLabel?: string;
      doesCopyResponse?: boolean;
      isFromPopup?: boolean;
      itemId?: number;
      tabId: string;
      contextPromise?: Promise<string[] | undefined>;
    };

export class ChatManager {
  public chatHostMode?: ChatHostMode;
  public chatWindow?: Window;
  public currentTabID: string;
  /** Per-section sidebar state (keyed by item.id / sectionId) */

  public sessionsMap: Map<string, Session> = new Map();

  constructor(currentTabID: string) {
    if (!currentTabID.trim()) {
      throw new Error("currentTabID must be a non-empty string.");
    }
    this.currentTabID = currentTabID;
  }

  clearSectionHistory(sectionId: string) {
    const session = this.sessionsMap.get(sectionId);
    if (session) {
      session.conversationHistory = [];
    }
  }

  getCurrentHostMode(): ChatHostMode {
    const location = this.chatHostMode || getPref("chat.location");
    ztoolkit.log("Current chat host mode:", location);
    return location === "window" ? "window" : "sidebar";
  }

  // ────────────────────────────────────────────────────────────────────────

  async buildSystemContent(params: {
    selectedText?: string;
    selectionContext?: string[];
    metadata?: ItemMetadata;
    itemId?: number;
    fullTextEnabled?: boolean;
  }): Promise<string> {
    const {
      selectedText,
      selectionContext,
      metadata,
      itemId,
      fullTextEnabled,
    } = params;
    const contextLeft = selectionContext?.[0] || "";
    const contextRight = selectionContext?.[2] || "";
    let systemPrompt = SYSTEM_PROMPT_PREFIX;

    // Append item metadata if enabled (stable → cacheable)
    if (getPref("chat.autoAttachItemData") && metadata) {
      const metadataLines: string[] = ["# Item Metadata"];
      const metadataFieldLabels: Array<[keyof ItemMetadata, string]> = [
        ["title", "Title"],
        ["authors", "Authors"],
        ["abstract", "Abstract"],
        ["publication", "Publication"],
        ["itemType", "Item Type"],
        ["publicationDate", "Publication Date"],
      ];
      for (const [key, label] of metadataFieldLabels) {
        const value = metadata[key];
        if (!value) {
          continue;
        }
        metadataLines.push(
          Array.isArray(value)
            ? `${label}: ${value.join(", ")}`
            : `${label}: ${value}`,
        );
      }
      systemPrompt += "\n\n" + metadataLines.join("\n");
    }

    // Append full text if enabled (stable → cacheable)
    if (fullTextEnabled && itemId !== undefined) {
      const fullText = await getItemFullText(itemId);
      if (fullText) {
        systemPrompt +=
          "\n\n# Full Document Text\n<fulldoc>\n" + fullText + "\n</fulldoc>";
      }
    }

    // Append volatile context at the end to improve prompt cache hits
    systemPrompt += "\n\nContent:" + (!selectedText
      ? `${contextLeft}\n${contextRight}`.trim()
      : `${contextLeft}\n<selected>\n${selectedText}\n</selected>\n${contextRight}`);

    return systemPrompt;
  }

  async sendChatRequest(params: ChatRequestParams) {
    const selectedText = addon.data.selection.text;
    const tabId = params.tabId ?? addon.chatManager.currentTabID;
    const itemId = params.itemId ?? getItemIdFromTab(params.tabId);

    if (tabId === undefined && itemId === undefined) {
      throw new Error("No article available for chat request.");
    }

    const session = this.sessionsMap.get(tabId) ?? new Session(tabId);
    this.sessionsMap.set(tabId, session);

    const route = this.getCurrentHostMode();
    const metadata = itemId !== undefined ? getItemMetadata(itemId) : undefined;

    session.pending.isNewSource =
      !!params.sourceLabel && session.sourceLabel !== params.sourceLabel;

    // cleanup history
    const contextRounds = getPref("chat.contextRounds") ?? 8;
    const maxHistoryMessages = contextRounds * 2;
    if (params.isFromPopup || session.pending.isNewSource) {
      session.conversationHistory = [];
    } else if (session.conversationHistory.length > maxHistoryMessages) {
      session.conversationHistory =
        session.conversationHistory.slice(-maxHistoryMessages);
    }
    if (session.pending.abortController) {
      session.pending.abortController.abort();
      session.pending.abortController = undefined;
    }
    const messagesPromise: Promise<ModelMessage[]> = (async () => {
      // get selection context
      let selectionContext: Array<string> | undefined;
      try {
        if (params.contextPromise) {
          selectionContext = await params.contextPromise;
        } else if (addon.data.selection.contextPromise) {
          selectionContext = await addon.data.selection.contextPromise;
        }
      } catch (e) {
        ztoolkit.log("Get selection context failed:", e);
      }

      ztoolkit.log("[chat] sendChatRequest:selection-context", {
        hasSelectionContext: Boolean(selectionContext),
        selectionContextLength: selectionContext?.length ?? 0,
      });

      const systemContent = await this.buildSystemContent({
        selectedText,
        selectionContext,
        metadata,
        itemId: itemId,
        fullTextEnabled: session.fullTextEnabled,
      });
      const systemMsg: SystemModelMessage = {
        role: "system",
        content: systemContent,
      };
      const userMsg: UserModelMessage = {
        role: "user",
        content: params.userPrompt,
      };

      // Build history slice for sidebar multi-turn
      if (session.conversationHistory.length > 0) {
        return [systemMsg, ...session.conversationHistory, userMsg];
      }
      return [systemMsg, userMsg];
    })();

    session.sourceLabel = params.sourceLabel ?? session.sourceLabel;

    if (route === "window") {
      await ensureChatWindowReady();
      focusChatWindow();
    }

    const AC = (
      typeof AbortController !== "undefined"
        ? AbortController
        : (Zotero.getMainWindow() as any).AbortController
    ) as typeof AbortController;
    session.pending.abortController = new AC();
    ztoolkit.log("[chat] sendChatRequest:stream-start", {
      sectionId: tabId,
    });
    await streamLLMV2(messagesPromise, session);
  }
}
