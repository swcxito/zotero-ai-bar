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
  fullTextEnabled: boolean = false;
  agentEnabled: boolean = false;
  thinkingEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'none';
  itemId?: number;
  capturedPageImages?: string[];
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
  constructor(id: string) {
    this.id = id;
    this.fullTextEnabled = getPref('chat.autoAttachFullText') ?? false;
    this.agentEnabled = getPref('agent.enabled') ?? false;
    const savedEffort = getPref('chat.thinkingEffort') as Session['thinkingEffort'] | undefined;
    this.thinkingEffort = savedEffort ?? 'none';
    ztoolkit.log('[chat] new Session', id, 'agentEnabled=', this.agentEnabled, 'thinkingEffort=', this.thinkingEffort);
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

type ChatRequestParams = {
  userPrompt: string;
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
    hasImages?: boolean;
  }): Promise<string> {
    const { selectedText, selectionContext, metadata, itemId, fullTextEnabled, agentEnabled, hasImages } = params;
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
- **Image questions**: If the user asks about an uploaded/captured image from the current PDF and the visible image alone may be ambiguous, explore nearby document text before giving the final explanation. Use any readable figure/table number, panel label, title, axis label, legend term, or keyword from the image as a \`grep\` query, then \`read\` the matching lines with surrounding context. If the image was captured from a known PDF page, also \`read\` that page or adjacent lines/pages to find the figure caption and in-text references. Base the answer on both visual evidence and retrieved nearby text, and explicitly mark uncertain visual readings as uncertain.
- **Library-wide questions**: Use \`glob\` to find relevant items, then use \`read\` to inspect their content. Do not guess based on titles alone.
- **Unclear user intent**: Use \`ask_user\` with 2–5 concrete options before proceeding.
- **Translation**: Use the \`translate\` tool ONLY for single words and abbreviations. For sentences or paragraphs, output the translation directly in your response text.
- **Page capture**: Use the \`capture_page\` tool to render a specific PDF page as an image when the user wants to see a figure, table, or visual content. After capturing, use \`read\`/\`grep\` to look for the page's caption or nearby explanatory text when that would improve accuracy, then explain the image.

## Citation Markers
Reference library items using citation markers. The marker format includes an optional title slot:

\`[cite:<itemId>[:<page>][|<title>]]\`

- \`itemId\`: use exactly as it appeared in tool output (\`glob\`, \`tree\`, \`read\`, \`grep\`). If a tool returned an attachment ID, cite that attachment ID directly — the UI resolves it to the parent item's metadata.
- \`page\`: optional, 1-based.
- \`title\`: optional, goes after \`|\`. **You SHOULD include the paper's title here** — the UI displays it as the clickable label. This is the ONLY place titles should appear; the UI uses your provided title (falling back to its own lookup if you omit it).

Examples:
- \`[cite:4291|A Novel Approach to X]\` — inline citation with title
- \`[cite:4291:7|A Novel Approach to X]\` — inline citation to page 7
- \`[cite:4291]\` — inline citation, title resolved by UI

**Standalone citation as a heading**: when a marker is the ONLY content on its own line, the UI renders it as a prominent section header for that paper (full title, prominent styling). Use this when summarizing or discussing a single paper — put the marker alone on its own line as the first line of that section, then write the discussion below it.

Example (correct):
\`\`\`
[cite:4291|A Novel Approach to X]

Smith et al. (2023) propose a method that...
\`\`\`

Rules:
- **Never** write a paper's title in the prose/body text. Titles belong ONLY inside the \`|title\` slot of a citation marker. If you feel the urge to write "This paper, titled X, ...", instead put the title in the marker: \`[cite:4291|X]\` and start the prose with "The authors propose...".
- **Never** apply markdown formatting to a citation marker. The marker has its own styling. Do NOT wrap it in \`**...**\`, \`*...*\`, \`_..._\`, \`~~...~~\`, backticks, or markdown link syntax \`[text](url)\`. Emit the marker as raw text exactly as specified — e.g. write \`[cite:4291|Title]\`, not \`**[cite:4291|Title]**\` or \`[\\[cite:4291\\]](something)\`.
- **Never** refer to literature by raw IDs in prose (e.g. "Item 4291", "item #4291", "document 4291"). Always use a \`[cite:...]\` marker.
- Place inline markers at the point of reference, e.g. "The method achieves 95% accuracy [cite:4291:7|A Novel Approach to X]."
- Author names, years, and other non-title context are fine in prose.
- Only emit markers for item IDs that were returned by tools in this conversation — never invent IDs.`;
    }

    if (hasImages) {
      systemPrompt += `

# Image Analysis Instructions
The current user message includes one or more images. For this turn, analyze the uploaded images directly and use selected text or surrounding document text only as context.
When the general instructions mention <selected>, do not treat them as limiting the task to text only. Prioritize visible image evidence, then captions or nearby document context, then clearly marked inference.
Separate what is visibly readable in the image from what is supplied by document context. Mark unclear OCR, small labels, approximate values, and inferred experimental conditions as uncertain.`;
    }

    // Append volatile context at the end to improve prompt cache hits
    if (selectedText) {
      systemPrompt += '\n\nContent:' + `${contextLeft}\n<selected>\n${selectedText}\n</selected>\n${contextRight}`;
    } else {
      // No text is selected by the user. Provide the surrounding context only
      // as reading reference and explicitly state that nothing is selected,
      // so the model does not treat context text as a "selection".
      const ctx = `${contextLeft}\n${contextRight}`.trim();
      systemPrompt +=
        '\n\n# Current Context\n' +
        'The user has NOT selected any text in the document. Do NOT claim or imply that the user selected something. ' +
        'The text below is surrounding document context for reference only, not a selection.' +
        (ctx ? `\n\nContent:\n${ctx}` : '');
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

    ztoolkit.log('[chat] sendChatRequest', { tabId, itemId, agentEnabled: session.agentEnabled, sourceLabel: params.sourceLabel });

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

      const systemContent = await this.buildSystemContent({
        selectedText,
        selectionContext,
        metadata,
        itemId: itemId,
        fullTextEnabled: session.fullTextEnabled,
        agentEnabled: session.agentEnabled,
        hasImages: modelSupportsImage,
      });
      const systemMsg: SystemModelMessage = {
        role: 'system',
        content: systemContent,
      };

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
