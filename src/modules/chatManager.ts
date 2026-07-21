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
import {
  SYSTEM_PROMPT_PREFIX,
  getAutoImagePrompt,
  AGENT_INSTRUCTIONS_PROMPT,
  IMAGE_ANALYSIS_PROMPT,
  IMAGE_ANALYSIS_AGENT_SUFFIX,
} from '../utils/prompts';
import { checkModelSupportsImage, getActiveModelContextLimit } from '../utils/providers';
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
  chatMode: 'normal' | 'full-text' | 'agent' = 'normal';
  thinkingEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'none';
  itemId?: number;
  capturedPageImages?: string[];
  /**
   * The selection text sent to the model in the previous turn (or undefined
   * if none was sent). Used to suppress redundant selection blocks across
   * consecutive turns with the same selection, and to emit a `<no-selection>`
   * notice only on the transition from "has selection" → "no selection".
   */
  lastSentSelectionText?: string;
  /** Token usage returned by the most recent request (persists across pending resets). */
  lastUsage?: TokenUsage;
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
    // --- reasoning ---
    reasoningBox?: HTMLElement;
    reasoningTextEl?: HTMLElement;
    /** Per-request override of session.thinkingEffort. */
    thinkingEffortOverride?: Session['thinkingEffort'];
    // --- auto-scroll state ---
    /** User paused (scrolled up). Highest priority — disables all auto-scroll. */
    scrollUserPaused?: boolean;
    /** Length-based auto-pause: final-answer segment top would reach viewport top. */
    scrollLengthPaused?: boolean;
    /** User explicitly scrolled to bottom — override length-pause until they scroll up. */
    scrollUserOverride?: boolean;
    /** True during tool-call/tool-result (and interim text is treated as tool phase). */
    inToolPhase?: boolean;
    /** The active text segment element, used for the 6px geometric check. */
    currentTextSegment?: HTMLElement | null;
  } = {};
  /**
   * Snapshot of the most recent turn, for the Retry button. Overwritten on
   * each new turn so only the last reply is retryable. Lives on `session`
   * (not `pending`) so it survives `cleanupRequestData`.
   */
  lastTurnSnapshot?: {
    userMessage: UserModelMessage;
    systemMessage: SystemModelMessage;
    thinkingEffort?: Session['thinkingEffort'];
    /** conversationHistory.length captured after the pre-turn trim, before
     *  the turn's messages were appended. Retry truncates history back to
     *  this (no-op if the turn errored/aborted and never appended). */
    historyLengthBeforeTurn: number;
  };
  /**
   * Most recent assistant bubble element. Used to disable its Retry button
   * once a newer turn starts (so only the latest reply is retryable), and to
   * locate/remove it when Retry is pressed.
   */
  lastAssistantPop?: HTMLElement;
  constructor(id: string) {
    this.id = id;
    this.chatMode = (getPref('chat.defaultMode') as Session['chatMode'] | undefined) ?? 'normal';
    const savedEffort = getPref('chat.thinkingEffort') as Session['thinkingEffort'] | undefined;
    this.thinkingEffort = savedEffort ?? 'none';
    ztoolkit.log('[chat] new Session', id, 'chatMode=', this.chatMode, 'thinkingEffort=', this.thinkingEffort);
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

/**
 * A "round" starts at a `user` message and includes every following
 * assistant/tool message up to (but not including) the next `user` message.
 * Cutting only at round boundaries guarantees we never split an
 * `assistant.tool_calls` from its `tool` results — which is what triggers
 * DeepSeek's "Messages with role 'tool' must be a response to a preceding
 * message with 'tool_calls'" error.
 *
 * conversationHistory never contains a `system` message (it's appended
 * separately in sendChatRequest), so we only deal with user/assistant/tool.
 */
function findRoundStartIndices(messages: ModelMessage[]): number[] {
  const starts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') starts.push(i);
  }
  return starts;
}

/**
 * Trim history to at most `maxMessages`, never breaking a round.
 * If the most recent round alone exceeds the cap, we keep only that round
 * rather than splitting it.
 */
function trimHistoryToRounds(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  if (messages.length <= maxMessages) return messages;
  const starts = findRoundStartIndices(messages);
  if (starts.length === 0) return messages.slice(-maxMessages);
  // Walk from the last round backward, accumulating until we exceed the cap.
  let keepFrom = starts[starts.length - 1];
  let count = messages.length - keepFrom;
  for (let i = starts.length - 2; i >= 0; i--) {
    const roundLen = starts[i + 1] - starts[i];
    if (count + roundLen > maxMessages) break;
    keepFrom = starts[i];
    count += roundLen;
  }
  return messages.slice(keepFrom);
}

/**
 * Token-aware narrowing: if the last request's prompt tokens approach the
 * active model's context window, drop oldest rounds until we estimate we're
 * back under ~70% of the limit. Falls back gracefully when usage or limit is
 * unknown. Always cuts on round boundaries (pair-safe).
 */
function narrowHistoryByTokenBudget(
  messages: ModelMessage[],
  lastPromptTokens: number | undefined,
  contextLimit: number | undefined
): ModelMessage[] {
  if (!lastPromptTokens || !contextLimit || contextLimit <= 0) return messages;
  if (lastPromptTokens / contextLimit < 0.85) return messages;
  const target = contextLimit * 0.7;
  const starts = findRoundStartIndices(messages);
  if (starts.length <= 1) return messages;
  // Drop rounds from the front. Estimate new token usage proportionally to
  // message count (coarse but cheap; the next request's real usage will
  // re-calibrate).
  let keepFrom = starts[0];
  for (let i = 1; i < starts.length; i++) {
    const keptFraction = (messages.length - starts[i]) / messages.length;
    const estimated = lastPromptTokens * keptFraction;
    if (estimated <= target) {
      keepFrom = starts[i];
      break;
    }
    keepFrom = starts[i];
    if (i === starts.length - 1) break;
  }
  return messages.slice(keepFrom);
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

type ChatRequestParams = (
  | {
      /** Raw user text for a normal turn. */
      userPrompt: string;
      messagesOverride?: undefined;
    }
  | {
      /**
       * Internal retry path: re-stream with pre-built messages instead of
       * re-resolving selection/context. Faithfully replays the original
       * turn's user message (avoids re-running the stateful selectionBlock
       * logic). Mutually exclusive with `userPrompt`.
       */
      messagesOverride: { userMessage: UserModelMessage; systemMessage: SystemModelMessage };
      userPrompt?: undefined;
    }
) & {
  sourceLabel?: string;
  doesCopyResponse?: boolean;
  isFromPopup?: boolean;
  contextPromise?: Promise<string[] | undefined>;
  images?: string[];
  /** Override the session's thinkingEffort for this single request. */
  thinkingEffort?: Session['thinkingEffort'];
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
      // Drop Retry state too: the UI bubbles are gone, so the snapshot and
      // last-bubble ref are stale and must not survive the clear.
      session.lastTurnSnapshot = undefined;
      session.lastAssistantPop = undefined;
    }
  }

  /**
   * Retry the last turn: remove the last assistant reply (UI + history) and
   * re-stream the original user message verbatim. Only the most recent reply
   * is retryable - older Retry buttons are disabled when a newer turn starts.
   */
  async regenerateLastResponse(session: Session) {
    const snap = session.lastTurnSnapshot;
    const pop = session.lastAssistantPop;
    if (!snap || !pop || !pop.isConnected) return;
    // Defensive: shouldn't be reachable while streaming (the actions row is
    // hidden until the stream ends), but abort an in-flight stream first.
    if (session.pending.abortController) {
      session.pending.abortController.abort();
      session.pending.abortController = undefined;
    }
    // Remove the assistant reply bubble; keep the user's question bubble so
    // the retried question stays visible (standard "regenerate" UX).
    pop.remove();
    // Drop the last turn's messages from history. If the turn never recorded
    // (error/abort), history is already at this length -> no-op. Guard the
    // length assignment so a concurrent history clear can't pad with undefined.
    if (session.conversationHistory.length >= snap.historyLengthBeforeTurn) {
      session.conversationHistory.length = snap.historyLengthBeforeTurn;
    }
    session.lastAssistantPop = undefined;
    await this.sendChatRequest({
      tabId: session.id,
      messagesOverride: { userMessage: snap.userMessage, systemMessage: snap.systemMessage },
      thinkingEffort: snap.thinkingEffort,
    });
  }

  getCurrentHostMode(): ChatHostMode {
    const location = this.chatHostMode || getPref('chat.location');
    ztoolkit.log('Current chat host mode:', location);
    return location === 'window' ? 'window' : 'sidebar';
  }

  // ────────────────────────────────────────────────────────────────────────

  async buildSystemContent(params: {
    metadata?: ItemMetadata;
    itemId?: number;
    chatMode?: 'normal' | 'full-text' | 'agent';
    imageCapableModel?: boolean;
  }): Promise<string> {
    const { metadata, itemId, chatMode, imageCapableModel } = params;
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

    // Append full text if enabled (stable → cacheable).
    // Agent mode skips this — the agent discovers content on demand via
    // grep/read (see Tool Orchestration), so we don't bloat the prompt.
    if (chatMode === 'full-text' && itemId !== undefined) {
      const fullText = await getItemFullText(itemId);
      if (fullText) {
        systemPrompt += '\n\n# Full Document Text\n<fulldoc>\n' + fullText + '\n</fulldoc>';
      }
    }

    // Agent instructions: ask user when intent is unclear, plus tool orchestration
    if (chatMode === 'agent') {
      systemPrompt += AGENT_INSTRUCTIONS_PROMPT;
    }

    if (imageCapableModel) {
      systemPrompt += IMAGE_ANALYSIS_PROMPT;
      if (chatMode === 'agent') {
        systemPrompt += IMAGE_ANALYSIS_AGENT_SUFFIX;
      }
    }

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

    ztoolkit.log('[chat] sendChatRequest', { tabId, itemId, chatMode: session.chatMode, sourceLabel: params.sourceLabel });

    const route = this.getCurrentHostMode();
    const metadata = itemId !== undefined && getPref('chat.autoAttachItemData') ? getItemMetadata(itemId) : undefined;

    session.pending.isNewSource = !!params.sourceLabel && session.sourceLabel !== params.sourceLabel;

    // cleanup history — pair-safe trimming.
    // `contextRounds` caps how many rounds we keep; the token-aware pass
    // below can drop more if the last request approached the context window.
    const contextRounds = getPref('chat.contextRounds') ?? 8;
    const maxHistoryMessages = contextRounds * 2;
    if (params.isFromPopup || session.pending.isNewSource) {
      session.conversationHistory = [];
      // History reset means the model has no memory of prior turns, so the
      // "last sent selection" tracking must also reset — otherwise a popup
      // action that fires with the same selection as before would suppress
      // the block and leave the new conversation without any selection context.
      session.lastSentSelectionText = undefined;
    } else {
      session.conversationHistory = trimHistoryToRounds(session.conversationHistory, maxHistoryMessages);
      session.conversationHistory = narrowHistoryByTokenBudget(
        session.conversationHistory,
        session.lastUsage?.promptTokens,
        getActiveModelContextLimit()
      );
    }
    if (session.pending.abortController) {
      session.pending.abortController.abort();
      session.pending.abortController = undefined;
    }
    const messagesPromise: Promise<ModelMessage[]> = (async () => {
      // Retry path: replay the snapshotted messages verbatim. Skip context
      // resolution / selectionBlock / lastSentSelectionText so the retried
      // turn is a faithful replay of the original user message.
      if (params.messagesOverride) {
        const userMsg = params.messagesOverride.userMessage;
        const systemMsg = params.messagesOverride.systemMessage;
        session.pending.userMessage = userMsg;
        session.pending.systemMessage = systemMsg;
        session.lastTurnSnapshot = {
          userMessage: userMsg,
          systemMessage: systemMsg,
          thinkingEffort: params.thinkingEffort,
          historyLengthBeforeTurn: session.conversationHistory.length,
        };
        return session.conversationHistory.length > 0 ? [systemMsg, ...session.conversationHistory, userMsg] : [systemMsg, userMsg];
      }
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

      // Build user message content — include images if model supports them
      const inputImages = params.images ?? addon.data.inputImages.get(tabId) ?? [];
      const capturedImages = session.capturedPageImages ?? [];
      const images = [...capturedImages, ...inputImages];
      const hasImages = images.length > 0;
      const modelSupportsImage = hasImages && checkModelSupportsImage();
      // Model capability is stable per active model — drives the (cacheable)
      // image-instructions section in the system prompt, independent of
      // whether images are attached this turn.
      const imageCapableModel = checkModelSupportsImage();

      const systemContent = await this.buildSystemContent({
        metadata,
        itemId: itemId,
        chatMode: session.chatMode,
        imageCapableModel,
      });
      const systemMsg: SystemModelMessage = {
        role: 'system',
        content: systemContent,
      };

      if (hasImages && !imageCapableModel) {
        ztoolkit.log('[chat] Model does not support image input, sending text only');
      }

      // Build the per-turn document-context block that travels inside the
      // user message (not the system prompt). Keeping it here — instead of in
      // the system prompt — means switching selections no longer invalidates
      // the cacheable system prefix, and each historical turn carries its own
      // selection so multi-round context stays aligned.
      // Note: the displayed user bubble is built from the raw prompt text
      // (see inputArea.ts / userBubble.ts), so this block never reaches the
      // UI or the copy button.
      const contextLeft = selectionContext?.[0] || '';
      const contextRight = selectionContext?.[2] || '';
      let selectionBlock = '';
      // Only emit selection tags when the state changed since the last turn:
      //  - first turn with a selection → emit <selection> + <context>
      //  - same selection as last turn → omit (avoid redundant tokens,
      //    and keep multi-round history from repeating the same block)
      //  - transition from "had selection" → "no selection" → emit
      //    <no-selection> only (no <context>), so the model knows the user
      //    cleared the selection and doesn't carry the prior context forward
      //  - no selection now and none was sent last turn → emit nothing
      if (selectedText) {
        if (session.lastSentSelectionText !== selectedText) {
          const parts: string[] = [];
          if (contextLeft) parts.push(`<context>${contextLeft}</context>`);
          parts.push(`<selection>\n${selectedText}\n</selection>`);
          if (contextRight) parts.push(`<context>${contextRight}</context>`);
          selectionBlock = parts.join('\n') + '\n\n';
        }
        session.lastSentSelectionText = selectedText;
      } else {
        const hadSelectionLastTurn = session.lastSentSelectionText !== undefined;
        if (hadSelectionLastTurn) {
          selectionBlock = '<no-selection>The user has cleared the selection.</no-selection>\n\n';
        }
        session.lastSentSelectionText = undefined;
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
        userContent = [{ type: 'text', text: selectionBlock + promptText }, ...images.map((dataUrl) => ({ type: 'image' as const, image: dataUrl }))];
        ztoolkit.log(`[chat] Sending with ${images.length} image(s)`);
      } else {
        userContent = selectionBlock + params.userPrompt;
      }

      const userMsg: UserModelMessage = {
        role: 'user',
        content: userContent,
      };

      session.pending.userMessage = userMsg;
      session.pending.systemMessage = systemMsg;
      // Snapshot this turn for the Retry button. historyLengthBeforeTurn is
      // captured after the pre-turn trim above, before the turn's messages
      // get appended at stream end - so Retry can truncate back to here.
      session.lastTurnSnapshot = {
        userMessage: userMsg,
        systemMessage: systemMsg,
        thinkingEffort: params.thinkingEffort,
        historyLengthBeforeTurn: session.conversationHistory.length,
      };

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
    session.pending.thinkingEffortOverride = params.thinkingEffort;

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
