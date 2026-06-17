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
import { getItemFullText, getItemMetadata } from '../utils/itemContext';
import { getPref } from '../utils/prefs';
import { SYSTEM_PROMPT_PREFIX, getAutoImagePrompt } from '../utils/prompts';
import { checkModelSupportsImage } from '../utils/providers';
import { ensureChatWindowReady, focusChatWindow } from '../utils/window';
import { streamLLMV2 } from './llm';
import type { ModelMessage, SystemModelMessage, UserModelMessage } from 'ai';
import { getItemIdFromTab } from './tabObserver';
import type { ItemMetadata } from '../utils/itemContext';

Zotero.debug('[zaibar-chatManager] module loaded');

export type ChatHostMode = 'sidebar' | 'window';

/** Per-section (per-document tab) state for sidebar chat */
export class Session {
  id: string;
  conversationHistory: ModelMessage[] = [];
  sourceLabel?: string;
  fullTextEnabled: boolean = false;
  agentEnabled: boolean = false;
  itemId?: number;
  capturedPageImages?: string[];
  pending: {
    shouldAutoScroll?: boolean;
    messagePop?: Element;
    abortController?: InstanceType<typeof AbortController>;
    shouldCopyResponse?: boolean;
    userMessage?: UserModelMessage;
    systemMessage?: SystemModelMessage;
    isNewSource?: boolean;
    lastRenderedLength?: number;
    // --- agent ---
    isAgentMode?: boolean;
    toolCalls?: Map<string, AgentToolCall>;
    toolResults?: Map<string, AgentToolResult>;
    toolCallBoxes?: Map<string, HTMLElement>;
    userAnswerResolve?: (value: AgentUserAnswer[]) => void;
    userAnswerReject?: (reason?: any) => void;
  } = {};
  constructor(id: string) {
    this.id = id;
    this.fullTextEnabled = getPref('chat.autoAttachFullText') ?? false;
    this.agentEnabled = getPref('agent.enabled') ?? false;
    ztoolkit.log('[chat] new Session', id, 'agentEnabled=', this.agentEnabled);
  }
}

export type AgentToolCall = {
  toolCallId: string;
  toolName: string;
  args: any;
};

export type AgentToolResult = {
  toolCallId: string;
  toolName: string;
  result: any;
};

export type AgentUserAnswer = {
  question: string;
  selectedOptions: string[];
  customInput?: string;
};

type ChatRequestParams = {
  userPrompt: string;
  sourceLabel?: string;
  doesCopyResponse?: boolean;
  isFromPopup?: boolean;
  contextPromise?: Promise<string[] | undefined>;
  images?: string[];
} & ({ itemId: number; tabId?: string } | { itemId?: number; tabId: string });

export class ChatManager {
  public chatHostMode?: ChatHostMode;
  public chatWindow?: Window;
  public currentTabID: string;
  /** Per-section sidebar state (keyed by item.id / sectionId) */

  public sessionsMap: Map<string, Session> = new Map();

  constructor(currentTabID: string) {
    if (!currentTabID.trim()) {
      throw new Error('currentTabID must be a non-empty string.');
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
    const location = this.chatHostMode || getPref('chat.location');
    ztoolkit.log('Current chat host mode:', location);
    return location === 'window' ? 'window' : 'sidebar';
  }

  // ────────────────────────────────────────────────────────────────────────

  async buildSystemContent(params: {
    selectedText?: string;
    selectionContext?: string[];
    metadata?: ItemMetadata;
    itemId?: number;
    fullTextEnabled?: boolean;
    agentEnabled?: boolean;
  }): Promise<string> {
    const { selectedText, selectionContext, metadata, itemId, fullTextEnabled, agentEnabled } = params;
    const contextLeft = selectionContext?.[0] || '';
    const contextRight = selectionContext?.[2] || '';
    let systemPrompt = SYSTEM_PROMPT_PREFIX;

    // Append item metadata if enabled (stable → cacheable)
    if (getPref('chat.autoAttachItemData') && metadata) {
      const metadataLines: string[] = ['# Item Metadata'];
      const metadataFieldLabels: Array<[keyof ItemMetadata, string]> = [
        ['itemId', 'Item ID'],
        ['title', 'Title'],
        ['authors', 'Authors'],
        ['abstract', 'Abstract'],
        ['publication', 'Publication'],
        ['itemType', 'Item Type'],
        ['publicationDate', 'Publication Date'],
      ];
      for (const [key, label] of metadataFieldLabels) {
        const value = metadata[key];
        if (!value) {
          continue;
        }
        metadataLines.push(Array.isArray(value) ? `${label}: ${value.join(', ')}` : `${label}: ${value}`);
      }
      systemPrompt += '\n\n' + metadataLines.join('\n');
    }

    // Append full text if enabled (stable → cacheable)
    // In agent mode, avoid stuffing the entire document into the system prompt
    // because the agent can read it on-demand via the read tool. Instead,
    // just note that the full text is available.
    if (fullTextEnabled && itemId !== undefined) {
      if (agentEnabled) {
        systemPrompt +=
          '\n\n# Full Document Text\nThe full text of the current document is available. Use the `read` tool to read it in chunks if needed.';
      } else {
        const fullText = await getItemFullText(itemId);
        if (fullText) {
          systemPrompt += '\n\n# Full Document Text\n<fulldoc>\n' + fullText + '\n</fulldoc>';
        }
      }
    }

    // Agent instructions: ask user when intent is unclear, plus tool usage guide
    if (agentEnabled) {
      systemPrompt += `

# Agent Instructions
You have access to tools. Before taking any action, make sure you understand the user's request.
If the user's goal, question, or required output format is ambiguous, incomplete, or could reasonably be interpreted in more than one way, do NOT guess. Use the \`ask_user\` tool to ask 1–3 concise clarifying questions.
Each question should:
- Offer 2–5 concrete options when possible.
- Include an "Other (please specify)" or custom input option when the answer is open-ended.
- Be brief and written in the same language as the user's message.
Only proceed with tool calls or answers once the intent is clear. If the user provides a vague follow-up (e.g., "explain this", "analyze", "help"), ask what aspect they care about, what depth they want, or what output format they prefer.

## Tool Usage Guide
- **Current document questions**: If the answer is not in the provided context, use \`grep\` to search the full text first to find matching line numbers. Then use \`read\` with startLine/endLine to read the relevant lines with surrounding context (default 2 context lines). For PDFs, you can also use \`read\` with pageNumber to read an entire page. Both \`grep\` and \`read\` accept an optional itemId to target a specific document; omit to use the current document.
- **Library-wide questions**: Use \`glob\` to find relevant items, then use \`read\` to inspect their content. Do not guess based on titles alone.
- **Unclear user intent**: Use \`ask_user\` with 2–5 concrete options before proceeding.
- **Translation**: Use the \`translate\` tool ONLY for single words and abbreviations. For sentences or paragraphs, output the translation directly in your response text.
- **Page capture**: Use the \`capture_page\` tool to render a specific PDF page as an image when the user wants to see a figure, table, or visual content. After capturing, tell the user the page is displayed and ask what they would like to know about it.`;
    }

    // Append volatile context at the end to improve prompt cache hits
    systemPrompt +=
      '\n\nContent:' +
      (!selectedText ? `${contextLeft}\n${contextRight}`.trim() : `${contextLeft}\n<selected>\n${selectedText}\n</selected>\n${contextRight}`);

    return systemPrompt;
  }

  async sendChatRequest(params: ChatRequestParams) {
    const selectedText = addon.data.selection.text;
    const tabId = params.tabId ?? addon.chatManager.currentTabID;
    const itemId = params.itemId ?? getItemIdFromTab(params.tabId);

    if (tabId === undefined && itemId === undefined) {
      throw new Error('No article available for chat request.');
    }

    const session = this.sessionsMap.get(tabId) ?? new Session(tabId);
    if (!this.sessionsMap.has(tabId) && this.sessionsMap.size >= 12) {
      const oldest = this.sessionsMap.keys().next().value!;
      this.sessionsMap.delete(oldest);
    }
    this.sessionsMap.set(tabId, session);
    session.itemId = itemId;

    ztoolkit.log('[chat] sendChatRequest', { tabId, itemId, agentEnabled: session.agentEnabled, sourceLabel: params.sourceLabel });

    const route = this.getCurrentHostMode();
    const metadata = itemId !== undefined && getPref('chat.autoAttachItemData') ? getItemMetadata(itemId) : undefined;

    session.pending.isNewSource = !!params.sourceLabel && session.sourceLabel !== params.sourceLabel;

    // cleanup history
    const contextRounds = getPref('chat.contextRounds') ?? 8;
    const maxHistoryMessages = contextRounds * 2;
    if (params.isFromPopup || session.pending.isNewSource) {
      session.conversationHistory = [];
    } else if (session.conversationHistory.length > maxHistoryMessages) {
      session.conversationHistory = session.conversationHistory.slice(-maxHistoryMessages);
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
        ztoolkit.log('Get selection context failed:', e);
      }

      ztoolkit.log('[chat] sendChatRequest:selection-context', {
        hasSelectionContext: Boolean(selectionContext),
        selectionContextLength: selectionContext?.length ?? 0,
      });

      const systemContent = await this.buildSystemContent({
        selectedText,
        selectionContext,
        metadata,
        itemId: itemId,
        fullTextEnabled: session.fullTextEnabled,
        agentEnabled: session.agentEnabled,
      });
      const systemMsg: SystemModelMessage = {
        role: 'system',
        content: systemContent,
      };

      // Build user message content — include images if model supports them
      const inputImages = params.images ?? addon.data.inputImages.get(tabId) ?? [];
      const capturedImages = session.capturedPageImages ?? [];
      const images = [...capturedImages, ...inputImages];
      const hasImages = images.length > 0;
      const modelSupportsImage = hasImages && checkModelSupportsImage();

      if (hasImages && !modelSupportsImage) {
        ztoolkit.log('[chat] Model does not support image input, sending text only');
      }

      let userContent: UserModelMessage['content'];
      if (modelSupportsImage) {
        let promptText = params.userPrompt;
        if (!promptText.trim() && getPref('chat.autoImagePrompt')) {
          const locale = (Zotero as any).locale || 'zh-CN';
          const outputLang = String(locale).startsWith('en') ? 'English' : '中文';
          promptText = getAutoImagePrompt(outputLang);
          ztoolkit.log('[chat] Auto-supplementing image prompt');
        }
        userContent = [{ type: 'text', text: promptText }, ...images.map((dataUrl) => ({ type: 'image' as const, image: dataUrl }))];
        ztoolkit.log(`[chat] Sending with ${images.length} image(s)`);
      } else {
        userContent = params.userPrompt;
      }

      const userMsg: UserModelMessage = {
        role: 'user',
        content: userContent,
      };

      session.pending.userMessage = userMsg;
      session.pending.systemMessage = systemMsg;

      // Clear images for this tab after building the message
      if (inputImages.length > 0) {
        addon.data.inputImages.delete(tabId);
      }
      if (capturedImages.length > 0) {
        session.capturedPageImages = [];
      }

      // Build history slice for sidebar multi-turn
      if (session.conversationHistory.length > 0) {
        return [systemMsg, ...session.conversationHistory, userMsg];
      }
      return [systemMsg, userMsg];
    })();

    session.sourceLabel = params.sourceLabel ?? session.sourceLabel;

    if (route === 'window') {
      await ensureChatWindowReady();
      focusChatWindow();
    }

    const AC = (typeof AbortController !== 'undefined' ? AbortController : (Zotero.getMainWindow() as any).AbortController) as typeof AbortController;
    session.pending.abortController = new AC();
    ztoolkit.log('[chat] sendChatRequest:stream-start', {
      sectionId: tabId,
    });
    await streamLLMV2(messagesPromise, session);
  }
}
