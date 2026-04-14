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
import { getReaderSourceLabel } from "./readerBarPopup";
import { streamLLMV2 } from "./llm";
import type { ModelMessage, SystemModelMessage, UserModelMessage } from "ai";

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

export class ChatManager {
  public chatHostMode?: ChatHostMode;
  public chatWindow?: Window;
  public currentTabID?: string;
  /** Per-section sidebar state (keyed by item.id / sectionId) */

  public sessionsMap: Map<string, Session> = new Map();

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
    sectionId?: string;
    fullTextEnabled?: boolean;
  }): Promise<string> {
    const { selectedText, selectionContext, sectionId, fullTextEnabled } =
      params;
    const contextLeft = selectionContext?.[0] || "";
    const contextRight = selectionContext?.[2] || "";
    let systemContent = !selectedText
      ? `${SYSTEM_PROMPT_PREFIX}${contextLeft}\n${contextRight}`.trim()
      : SYSTEM_PROMPT_PREFIX +
        `${contextLeft}\n<selected>\n${selectedText}\n</selected>\n${contextRight}`;

    // Append item metadata if enabled (after context, before fulltext)
    if (getPref("chat.autoAttachItemData") && sectionId !== undefined) {
      ztoolkit.log("getting item metadata");
      const itemMetadata = getItemMetadata(sectionId);
      if (itemMetadata) {
        systemContent += "\n\n" + itemMetadata;
      }
    }

    // Append full text if enabled for this section (manual toggle) or globally (pref)
    if (fullTextEnabled && sectionId !== undefined) {
      const fullText = await getItemFullText(sectionId);
      if (fullText) {
        systemContent +=
          "\n\n# Full Document Text\n<fulldoc>\n" + fullText + "\n</fulldoc>";
      }
    }

    return systemContent;
  }

  async sendChatRequest(params: {
    userPrompt: string;
    sourceLabel?: string;
    doesCopyResponse?: boolean;
    isFromPopup?: boolean;
    // for distinguishing different sections, probably useless
    // todo maybe itemId is better
    sectionId?: string;
    contextPromise?: Promise<string[] | undefined>;
  }) {
    const selectedText = addon.data.selection.text;
    const sectionId = params.sectionId ?? addon.chatManager.currentTabID;

    const route = this.getCurrentHostMode();

    if (sectionId === undefined) {
      throw new Error("No section ID available for chat request.");
    }

    const session = this.sessionsMap.get(sectionId) ?? new Session(sectionId);
    this.sessionsMap.set(sectionId, session);

    const nextSourceLabel =
      params.sourceLabel ||
      getReaderSourceLabel(addon.data.selection.currentReader);
    session.pending.isNewSource =
      !!nextSourceLabel && session.sourceLabel !== nextSourceLabel;

    // cleanup history
    const contextRounds = getPref("chat.contextRounds") ?? 8;
    const maxHistoryMessages = contextRounds * 2;
    if (params.isFromPopup || nextSourceLabel === session.sourceLabel) {
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
        sectionId,
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

    session.sourceLabel = nextSourceLabel;

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
      sectionId,
    });
    await streamLLMV2(messagesPromise, session);
  }
}
