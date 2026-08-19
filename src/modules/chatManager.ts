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
import { getString } from '../utils/locale';
import { streamLLMV2, streamTranslationV2 } from './llm';
import type { ModelMessage, SystemModelMessage, UserModelMessage } from 'ai';
import { getItemIdFromTab } from './tabObserver';
import { openSidePane } from './mainWindowSidePane';
import type { ItemMetadata } from '../utils/itemContext';
import { buildStructuredTranslationPrompt, TRANSLATION_SYSTEM_PROMPT, type TranslationRequestMeta } from '../utils/translation';
import {
  getSessionKind,
  getTranslationRoute,
  removeWorkspaceSource,
  selectWorkspaceKind,
  showTranslationWorkspace,
  type ChatSessionKind,
} from './chatWorkspace';
import {
  ChatHistoryStore,
  getConversationScope,
  makeConversationTitle,
  type ConversationScope,
  type PersistedConversation,
  type PersistedTurn,
} from './chatHistoryStore';
import { createUserMessageBubble } from '../components/userBubble';
import { disposeChatTurnNavigatorHost } from '../components/chatTurnNavigator';
import { calculateContextBudget, createCheckpointMessage, type ContextCheckpoint } from './contextCompaction';
import { buildDocumentSnapshot, createDocumentFingerprint } from '../utils/documentSnapshot';

Zotero.debug('[zaibar-chatManager] module loaded');

export type ChatHostMode = 'sidebar' | 'window';

/** Per-section (per-document tab) state for sidebar chat */
export class Session {
  id: string;
  kind: ChatSessionKind;
  sourceTabId?: string;
  lockedChatMode?: 'normal' | 'agent';
  conversationHistory: ModelMessage[] = [];
  conversationId?: string;
  conversationTitle?: string;
  favorite = false;
  conversationCreatedAt?: number;
  conversationLastMessageAt?: number;
  persistedTurns: PersistedTurn[] = [];
  persistedContextMessages: ModelMessage[] = [];
  contextCheckpoint?: ContextCheckpoint;
  sourceLabel?: string;
  chatMode: 'normal' | 'full-text' | 'agent' = 'normal';
  thinkingEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'none';
  itemId?: number;
  capturedPageImages?: string[];
  /** The currently executing stream, kept outside pending so superseding
   * popup actions can wait for the old stream's cleanup to finish. */
  activeRequestPromise?: Promise<void>;
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
    /** Messages already produced in the current Agent turn before an overflow retry. */
    agentResumeMessages?: ModelMessage[];
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
    /** Dedicated structured translation request; independent of chatMode. */
    translationRequest?: TranslationRequestMeta;
    /** Visible user text and quoted selection for the local transcript. */
    displayUserText?: string;
    displayReferenceText?: string;
    displaySourceLabel?: string;
    /** Popup turns create their own user bubble when the target host is ready. */
    shouldRenderUserBubble?: boolean;
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
    translationRequest?: TranslationRequestMeta;
    /** conversationHistory.length captured after the pre-turn trim, before
     *  the turn's messages were appended. Retry truncates history back to
     *  this (no-op if the turn errored/aborted and never appended). */
    historyLengthBeforeTurn: number;
    displayUserText?: string;
    displayReferenceText?: string;
    displaySourceLabel?: string;
    persistedTurnId?: string;
  };
  /**
   * Most recent assistant bubble element. Used to disable its Retry button
   * once a newer turn starts (so only the latest reply is retryable), and to
   * locate/remove it when Retry is pressed.
   */
  lastAssistantPop?: HTMLElement;
  constructor(id: string, options?: { kind?: ChatSessionKind; sourceTabId?: string; lockedChatMode?: 'normal' | 'agent' }) {
    this.id = id;
    this.kind = options?.kind ?? getSessionKind(id);
    this.sourceTabId = options?.sourceTabId;
    this.lockedChatMode = options?.lockedChatMode;
    this.chatMode = (getPref('chat.defaultMode') as Session['chatMode'] | undefined) ?? 'normal';
    if (this.lockedChatMode) this.chatMode = this.lockedChatMode;
    const savedEffort = getPref('chat.thinkingEffort') as Session['thinkingEffort'] | undefined;
    this.thinkingEffort = savedEffort ?? 'none';
    ztoolkit.log('[chat] new Session', id, 'chatMode=', this.chatMode, 'thinkingEffort=', this.thinkingEffort);
  }

  get effectiveChatMode(): Session['chatMode'] {
    return this.lockedChatMode ?? this.chatMode;
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
  sessionId: string;
  sessionKind: ChatSessionKind;
  sourceTabId?: string;
  sourceLabel?: string;
  doesCopyResponse?: boolean;
  isFromPopup?: boolean;
  contextPromise?: Promise<string[] | undefined>;
  /** Immutable selection captured by the caller before any async UI work. */
  selectionSnapshot?: {
    text?: string;
    contextPromise?: Promise<string[] | undefined>;
  };
  images?: string[];
  /** Override the session's thinkingEffort for this single request. */
  thinkingEffort?: Session['thinkingEffort'];
  /** Internal marker for the dedicated structured translation path. */
  translationRequest?: TranslationRequestMeta;
  itemId?: number;
  /** Internal transcript metadata retained by Retry. */
  displayUserText?: string;
  displayReferenceText?: string;
  displaySourceLabel?: string;
};

export type TranslationRequestParams = {
  targetLanguage: string;
  selectedText?: string;
  sourceLabel?: string;
  isFromPopup?: boolean;
  contextPromise?: Promise<string[] | undefined>;
  itemId: number;
  sourceTabId: string;
};

export class ChatManager {
  public chatHostMode?: ChatHostMode;
  public chatWindow?: Window;
  public currentTabID: string;
  public readonly historyStore = new ChatHistoryStore();
  private historyListeners = new Set<() => void>();
  private initializedScopeConversations = new Map<ConversationScope, string>();
  private fullTextChoices = new Map<string, 'agent' | 'snapshot' | 'cancel'>();
  /** Per-section sidebar state (keyed by item.id / sectionId) */

  public sessionsMap: Map<string, Session> = new Map();

  constructor(currentTabID: string) {
    if (!currentTabID.trim()) {
      throw new Error('currentTabID must be a non-empty string.');
    }
    this.currentTabID = currentTabID;
  }

  async initializeHistory(): Promise<void> {
    await this.historyStore.initialize();
  }

  async flushHistory(): Promise<void> {
    await this.historyStore.flush();
  }

  subscribeHistory(listener: () => void): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  notifyHistoryStateChanged(): void {
    this.notifyHistoryChanged();
  }

  private notifyHistoryChanged(): void {
    for (const listener of Array.from(this.historyListeners)) {
      try {
        listener();
      } catch (error) {
        ztoolkit.log('[chatHistory] listener failed:', error);
      }
    }
  }

  private synchronizePrunedSessions(): void {
    const draftIds = new Map<ConversationScope, string>();
    for (const session of this.sessionsMap.values()) {
      if (!session.conversationId || !session.persistedTurns.length || this.historyStore.get(session.conversationId)) continue;
      const scope = this.getSessionScope(session);
      if (!scope) continue;
      this.hydrateSession(session);
      const draftId = draftIds.get(scope) ?? this.createConversationId();
      draftIds.set(scope, draftId);
      this.initializedScopeConversations.set(scope, draftId);
      session.conversationId = draftId;
      const container = this.getSessionMessageContainer(session.id);
      if (container) container.dataset.conversationId = '';
    }
  }

  private createConversationId(): string {
    return `${Date.now().toString(36)}-${Zotero.Utilities.randomString(10)}`;
  }

  private getSessionScope(session: Session): ConversationScope | undefined {
    if (session.kind === 'translation') return undefined;
    return getConversationScope(session.kind, session.itemId);
  }

  private hydrateSession(session: Session, conversation?: PersistedConversation): void {
    if (!conversation) {
      session.conversationId = this.createConversationId();
      session.conversationTitle = undefined;
      session.favorite = false;
      session.conversationCreatedAt = Date.now();
      session.conversationLastMessageAt = undefined;
      session.persistedTurns = [];
      session.persistedContextMessages = [];
      session.conversationHistory = [];
      session.contextCheckpoint = undefined;
      session.sourceLabel = undefined;
      session.lastSentSelectionText = undefined;
      session.lastTurnSnapshot = undefined;
      session.lastAssistantPop = undefined;
      return;
    }
    session.conversationId = conversation.id;
    session.conversationTitle = conversation.title;
    session.favorite = conversation.favorite;
    session.conversationCreatedAt = conversation.createdAt;
    session.conversationLastMessageAt = conversation.lastMessageAt;
    session.persistedTurns = conversation.turns.map((turn) => ({ ...turn }));
    session.contextCheckpoint = conversation.checkpoint
      ? { ...conversation.checkpoint, recentTail: conversation.checkpoint.recentTail.map((message) => ({ ...message })) }
      : undefined;
    const restoredContext = conversation.contextMessages.length
      ? conversation.contextMessages
      : session.contextCheckpoint
        ? [createCheckpointMessage(session.contextCheckpoint.summary), ...session.contextCheckpoint.recentTail]
        : [];
    session.persistedContextMessages = restoredContext.map((message) => ({ ...message })) as ModelMessage[];
    session.conversationHistory = session.persistedContextMessages.map((message) => ({ ...message })) as ModelMessage[];
    session.sourceLabel = conversation.turns
      .slice()
      .reverse()
      .find((turn) => !!turn.sourceLabel)?.sourceLabel;
    session.lastSentSelectionText = undefined;
    session.lastTurnSnapshot = undefined;
    session.lastAssistantPop = undefined;
  }

  private ensureSessionConversation(session: Session): void {
    if (session.kind === 'translation' || session.conversationId) return;
    const scope = this.getSessionScope(session);
    if (!scope) return;
    const initializedConversationId = this.initializedScopeConversations.get(scope);
    if (initializedConversationId) {
      this.hydrateSession(session, this.historyStore.get(initializedConversationId));
      session.conversationId = initializedConversationId;
      return;
    }
    const startMode = getPref('chat.startConversationMode');
    const conversation = startMode === 'restore-latest' ? this.historyStore.list(scope)[0] : undefined;
    this.hydrateSession(session, conversation);
    this.initializedScopeConversations.set(scope, session.conversationId!);
  }

  listConversations(session: Session): PersistedConversation[] {
    const scope = this.getSessionScope(session);
    return scope ? this.historyStore.list(scope) : [];
  }

  startNewConversation(session: Session): boolean {
    if (session.pending.abortController || session.kind === 'translation') return false;
    const scope = this.getSessionScope(session);
    if (!scope) return false;
    const draftId = this.createConversationId();
    this.initializedScopeConversations.set(scope, draftId);
    for (const candidate of this.sessionsMap.values()) {
      if (this.getSessionScope(candidate) !== scope) continue;
      this.hydrateSession(candidate);
      candidate.conversationId = draftId;
      const container = this.getSessionMessageContainer(candidate.id);
      if (container) {
        container.innerHTML = '';
        container.dataset.conversationId = draftId;
      }
    }
    this.notifyHistoryChanged();
    return true;
  }

  activateConversation(session: Session, conversationId: string): boolean {
    if (session.pending.abortController) return false;
    const conversation = this.historyStore.get(conversationId);
    const scope = this.getSessionScope(session);
    if (!conversation || !scope || conversation.scope !== scope) return false;
    for (const candidate of this.sessionsMap.values()) {
      if (this.getSessionScope(candidate) !== scope) continue;
      this.hydrateSession(candidate, conversation);
      const container = this.getSessionMessageContainer(candidate.id);
      if (container) container.dataset.conversationId = '';
    }
    this.initializedScopeConversations.set(scope, conversation.id);
    this.historyStore.setActive(scope, conversation.id);
    this.notifyHistoryChanged();
    return true;
  }

  renameConversation(conversationId: string, title: string): boolean {
    const trimmed = title.trim();
    if (!trimmed) return false;
    this.historyStore.rename(conversationId, trimmed);
    for (const session of this.sessionsMap.values()) {
      if (session.conversationId === conversationId) session.conversationTitle = trimmed;
    }
    this.notifyHistoryChanged();
    return true;
  }

  toggleFavorite(conversationId: string): boolean {
    const conversation = this.historyStore.get(conversationId);
    if (!conversation) return false;
    const favorite = !conversation.favorite;
    this.historyStore.setFavorite(conversationId, favorite);
    this.synchronizePrunedSessions();
    const updated = this.historyStore.get(conversationId);
    for (const session of this.sessionsMap.values()) {
      if (session.conversationId === conversationId) {
        session.favorite = favorite;
        if (updated) session.persistedTurns = updated.turns.map((turn) => ({ ...turn }));
      }
    }
    this.notifyHistoryChanged();
    return favorite;
  }

  deleteConversation(session: Session, conversationId: string): boolean {
    if (session.pending.abortController) return false;
    const conversation = this.historyStore.get(conversationId);
    const scope = this.getSessionScope(session);
    if (!conversation || !scope || conversation.scope !== scope) return false;
    this.historyStore.delete(conversationId);
    const draftId = this.createConversationId();
    if (this.initializedScopeConversations.get(scope) === conversationId) this.initializedScopeConversations.set(scope, draftId);
    for (const candidate of this.sessionsMap.values()) {
      if (candidate.conversationId === conversationId) {
        this.hydrateSession(candidate);
        candidate.conversationId = draftId;
        const container = this.getSessionMessageContainer(candidate.id);
        if (container) container.dataset.conversationId = '';
      }
    }
    this.notifyHistoryChanged();
    return true;
  }

  recordCompletedTurn(session: Session, assistantMarkdown: string, aborted?: boolean): void {
    if (aborted || !assistantMarkdown.trim() || session.kind === 'translation') return;
    const scope = this.getSessionScope(session);
    if (!scope) return;
    this.ensureSessionConversation(session);
    const now = Date.now();
    const turn: PersistedTurn = {
      id: this.createConversationId(),
      createdAt: now,
      userText: session.pending.displayUserText?.trim() || undefined,
      referenceText: session.pending.displayReferenceText?.trim() ? session.pending.displayReferenceText : undefined,
      assistantMarkdown,
      sourceLabel: session.pending.displaySourceLabel,
    };
    session.persistedTurns.push(turn);
    session.conversationTitle ??= makeConversationTitle(turn.userText, assistantMarkdown, getString('history-default-title' as any));
    session.conversationCreatedAt ??= now;
    session.conversationLastMessageAt = now;
    session.persistedContextMessages = session.conversationHistory.map((message) => ({ ...message })) as ModelMessage[];
    if (session.contextCheckpoint) {
      session.contextCheckpoint = {
        ...session.contextCheckpoint,
        recentTail: session.conversationHistory.slice(1).map((message) => ({ ...message })) as ModelMessage[],
      };
    }
    const persistedKind: PersistedConversation['kind'] = session.kind === 'global-agent' ? 'global-agent' : 'article';
    const conversation: PersistedConversation = {
      id: session.conversationId!,
      scope,
      kind: persistedKind,
      itemId: session.kind === 'article' ? session.itemId : undefined,
      title: session.conversationTitle,
      favorite: session.favorite,
      createdAt: session.conversationCreatedAt,
      lastMessageAt: now,
      turns: session.favorite ? session.persistedTurns : session.persistedTurns.slice(-100),
      contextMessages: session.persistedContextMessages,
      checkpoint: session.contextCheckpoint,
    };
    session.persistedTurns = conversation.turns.map((entry) => ({ ...entry }));
    this.historyStore.upsert(conversation);
    this.synchronizePrunedSessions();
    const stored = this.historyStore.get(conversation.id);
    if (stored) {
      for (const candidate of this.sessionsMap.values()) {
        if (candidate === session || this.getSessionScope(candidate) !== scope) continue;
        this.hydrateSession(candidate, stored);
        const container = this.getSessionMessageContainer(candidate.id);
        if (container) container.dataset.conversationId = '';
      }
    }
    if (session.lastTurnSnapshot) session.lastTurnSnapshot.persistedTurnId = turn.id;
    this.notifyHistoryChanged();
  }

  /** Persist a model-context checkpoint without changing the durable UI transcript. */
  persistActiveContext(session: Session): void {
    const scope = this.getSessionScope(session);
    if (!scope || !session.conversationId || !session.conversationCreatedAt || !session.persistedTurns.length) return;
    session.persistedContextMessages = session.conversationHistory.map((message) => ({ ...message })) as ModelMessage[];
    const existing = this.historyStore.get(session.conversationId);
    if (!existing) return;
    this.historyStore.upsert({
      ...existing,
      contextMessages: session.persistedContextMessages,
      checkpoint: session.contextCheckpoint,
    });
  }

  removePersistedTurnForRetry(session: Session, turnId: string | undefined): void {
    if (!turnId || session.kind === 'translation') return;
    session.persistedTurns = session.persistedTurns.filter((turn) => turn.id !== turnId);
    const lastUserIndex = session.persistedContextMessages.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex >= 0) session.persistedContextMessages = session.persistedContextMessages.slice(0, lastUserIndex);
    if (session.contextCheckpoint) {
      session.contextCheckpoint = {
        ...session.contextCheckpoint,
        recentTail: session.conversationHistory.slice(1).map((message) => ({ ...message })) as ModelMessage[],
      };
    }
    if (!session.persistedTurns.length) {
      if (session.conversationId) this.historyStore.delete(session.conversationId);
      session.conversationTitle = undefined;
      session.conversationLastMessageAt = undefined;
      return;
    }
    const scope = this.getSessionScope(session);
    if (!scope || !session.conversationId || !session.conversationCreatedAt) return;
    const lastMessageAt = session.persistedTurns.at(-1)!.createdAt;
    session.conversationLastMessageAt = lastMessageAt;
    const persistedKind: PersistedConversation['kind'] = session.kind === 'global-agent' ? 'global-agent' : 'article';
    this.historyStore.upsert({
      id: session.conversationId,
      scope,
      kind: persistedKind,
      itemId: session.kind === 'article' ? session.itemId : undefined,
      title: session.conversationTitle || getString('history-default-title' as any),
      favorite: session.favorite,
      createdAt: session.conversationCreatedAt,
      lastMessageAt,
      turns: session.persistedTurns,
      contextMessages: session.persistedContextMessages,
      checkpoint: session.contextCheckpoint,
    });
  }

  private getSessionMessageContainer(sessionId: string): HTMLElement | null {
    const body = addon.data.sidePaneBodyMap?.get(sessionId);
    const root = body?.querySelector('#ai-bar-chat-root') as HTMLElement | null;
    return (root?.shadowRoot?.querySelector('.message-container') ?? body?.querySelector('.message-container') ?? null) as HTMLElement | null;
  }

  getOrCreateSession(params: { sessionId: string; kind: ChatSessionKind; sourceTabId?: string; itemId?: number }): Session {
    const existing = this.sessionsMap.get(params.sessionId);
    if (existing) {
      existing.kind = params.kind;
      existing.sourceTabId = params.sourceTabId;
      existing.itemId = params.kind === 'global-agent' ? undefined : (params.itemId ?? existing.itemId);
      existing.lockedChatMode = params.kind === 'global-agent' ? 'agent' : params.kind === 'translation' ? 'normal' : undefined;
      if (existing.lockedChatMode) existing.chatMode = existing.lockedChatMode;
      this.ensureSessionConversation(existing);
      return existing;
    }

    if (params.sourceTabId) {
      const sourceIds = Array.from(this.sessionsMap.values())
        .map((session) => session.sourceTabId)
        .filter((sourceId): sourceId is string => !!sourceId);
      const uniqueSourceIds = Array.from(new Set(sourceIds));
      if (!uniqueSourceIds.includes(params.sourceTabId) && uniqueSourceIds.length >= 12) {
        const oldestSourceId = uniqueSourceIds[0];
        for (const [sessionId, session] of Array.from(this.sessionsMap.entries())) {
          if (session.sourceTabId === oldestSourceId) {
            this.sessionsMap.delete(sessionId);
            const body = addon.data.sidePaneBodyMap?.get(sessionId);
            disposeChatTurnNavigatorHost(body);
            body?.remove();
            addon.data.sidePaneBodyMap?.delete(sessionId);
          }
        }
        removeWorkspaceSource(oldestSourceId, false);
      }
    }

    const lockedChatMode = params.kind === 'global-agent' ? 'agent' : params.kind === 'translation' ? 'normal' : undefined;
    const session = new Session(params.sessionId, {
      kind: params.kind,
      sourceTabId: params.sourceTabId,
      lockedChatMode,
    });
    session.itemId = params.itemId;
    this.sessionsMap.set(params.sessionId, session);
    this.ensureSessionConversation(session);
    return session;
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
    this.removePersistedTurnForRetry(session, snap.persistedTurnId);
    session.lastAssistantPop = undefined;
    await this.sendChatRequest({
      sessionId: session.id,
      sessionKind: session.kind,
      sourceTabId: session.sourceTabId,
      itemId: session.itemId,
      messagesOverride: { userMessage: snap.userMessage, systemMessage: snap.systemMessage },
      thinkingEffort: snap.thinkingEffort,
      translationRequest: snap.translationRequest,
      displayUserText: snap.displayUserText,
      displayReferenceText: snap.displayReferenceText,
      displaySourceLabel: snap.displaySourceLabel,
    });
  }

  /**
   * Translate the current selection through a mode-independent structured
   * output path. The normal/full-text/agent session mode is intentionally
   * ignored for this request.
   */
  async sendTranslationRequest(params: TranslationRequestParams) {
    const selectedText = params.selectedText ?? addon.data.selection.text;
    if (!selectedText?.trim()) throw new Error('No selected text available for translation.');
    const separateTab = getPref('translate.separateTab');
    const { sessionId, sessionKind } = getTranslationRoute(params.sourceTabId, separateTab);
    if (separateTab) {
      showTranslationWorkspace(params.sourceTabId);
    } else {
      selectWorkspaceKind('article', params.sourceTabId);
    }
    return this.sendChatRequest({
      ...params,
      sessionId,
      sessionKind,
      userPrompt: buildStructuredTranslationPrompt(params.targetLanguage),
      translationRequest: {
        selectedText,
        targetLanguage: params.targetLanguage,
        modelKey: getPref('translate.useAlternativeModel') ? getPref('translate.modelId') || undefined : undefined,
      },
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
    session?: Session;
  }): Promise<string> {
    const { metadata, itemId, imageCapableModel, session } = params;
    let chatMode = params.chatMode;
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
        const active = addon.data.userProviderConfigV2?.active;
        const contextLimit = getActiveModelContextLimit();
        const fingerprint = `${itemId}:${active?.providerId ?? ''}:${active?.modelId ?? ''}:${createDocumentFingerprint(fullText)}`;
        const fullDocumentBlock = '\n\n# Full Document Text\n<fulldoc>\n' + fullText + '\n</fulldoc>';
        const unsafe = calculateContextBudget({
          messages: [{ role: 'system', content: systemPrompt + fullDocumentBlock }],
          contextLimit,
          outputAllowance: 4096,
        }).shouldCompact;
        const previousChoice = unsafe ? this.fullTextChoices.get(fingerprint) : undefined;
        let useSnapshot = previousChoice === 'snapshot';
        if (previousChoice === 'agent' && session) {
          session.chatMode = 'agent';
          chatMode = 'agent';
        } else if (previousChoice === 'cancel') {
          const error = new Error('Full-text request cancelled.');
          error.name = 'FullTextRequestCancelledError';
          throw error;
        }
        if (unsafe && !previousChoice) {
          const services = Zotero.getMainWindow().Services as any;
          const flags =
            services.prompt.BUTTON_POS_0 * services.prompt.BUTTON_TITLE_IS_STRING +
            services.prompt.BUTTON_POS_1 * services.prompt.BUTTON_TITLE_IS_STRING +
            services.prompt.BUTTON_POS_2 * services.prompt.BUTTON_TITLE_CANCEL;
          const english = String((Zotero as any).locale ?? '').startsWith('en');
          const result = services.prompt.confirmEx(
            Zotero.getMainWindow(),
            english ? 'Document is too long' : '文档过长',
            english
              ? 'The complete document may exceed this model’s context window. Agent mode can inspect it on demand with grep/read.'
              : '完整文档可能超过当前模型的上下文窗口。Agent 模式可通过 grep/read 按需读取。',
            flags,
            english ? 'Switch to Agent (recommended)' : '切换到 Agent（推荐）',
            english ? 'Continue with document snapshot' : '继续使用文档快照',
            '',
            '',
            {}
          );
          if (result === 0 && session) {
            this.fullTextChoices.set(fingerprint, 'agent');
            session.chatMode = 'agent';
            chatMode = 'agent';
          } else if (result === 1) {
            useSnapshot = true;
            this.fullTextChoices.set(fingerprint, 'snapshot');
          } else {
            this.fullTextChoices.set(fingerprint, 'cancel');
            const error = new Error('Full-text request cancelled.');
            error.name = 'FullTextRequestCancelledError';
            throw error;
          }
        }
        if (chatMode === 'full-text') {
          if (useSnapshot) {
            const snapshotBudget = Math.max(4096, Math.min(32000, Math.round((contextLimit ?? 64000) * 0.35)));
            const snapshot = buildDocumentSnapshot(fullText, metadata, snapshotBudget);
            systemPrompt +=
              '\n\n# Document Snapshot\nThis is a deterministic partial snapshot, not the complete document. Do not claim that it contains the full text.\n<document-snapshot>\n' +
              snapshot +
              '\n</document-snapshot>';
          } else {
            systemPrompt += fullDocumentBlock;
          }
        }
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
    // Translation requests carry their own immutable selection snapshot. Do
    // not read the mutable global selection after the button was clicked.
    const selectionSourceTabId = (addon.data.selection.currentReader as any)?.tabID as string | undefined;
    const canUseCurrentSelection = params.sessionKind !== 'global-agent' && !!params.sourceTabId && selectionSourceTabId === params.sourceTabId;
    const selectedText =
      params.translationRequest?.selectedText ??
      (params.selectionSnapshot !== undefined ? params.selectionSnapshot.text : canUseCurrentSelection ? addon.data.selection.text : undefined);
    const sessionId = params.sessionId;
    const sourceTabId = params.sourceTabId;
    const itemId = params.itemId ?? (sourceTabId ? getItemIdFromTab(sourceTabId) : undefined);

    if (params.sessionKind !== 'global-agent' && sourceTabId === undefined && itemId === undefined) {
      throw new Error('No article available for chat request.');
    }

    const session = this.getOrCreateSession({
      sessionId,
      kind: params.sessionKind,
      sourceTabId,
      itemId,
    });

    // Popup actions may be triggered while the previous answer is still
    // streaming. Abort first and wait for that stream's end/error handler to
    // finish before touching the shared pending state for the next request.
    if (params.isFromPopup) {
      const supersededSessions = Array.from(this.sessionsMap.values()).filter(
        (candidate) => !!candidate.activeRequestPromise && (candidate === session || (!!sourceTabId && candidate.sourceTabId === sourceTabId))
      );
      for (const candidate of supersededSessions) candidate.pending.abortController?.abort();
      await Promise.all(
        supersededSessions.map(async (candidate) => {
          try {
            await candidate.activeRequestPromise;
          } catch (e) {
            // Stream functions normally consume their own errors. A
            // defensive catch still allows the newly selected action to run.
            ztoolkit.log('[chat] superseded popup request cleanup failed:', e);
          }
        })
      );
    }

    ztoolkit.log('[chat] sendChatRequest', {
      sessionId,
      sourceTabId,
      itemId,
      chatMode: session.effectiveChatMode,
      sourceLabel: params.sourceLabel,
    });

    const route = this.getCurrentHostMode();
    const metadata = itemId !== undefined && getPref('chat.autoAttachItemData') ? getItemMetadata(itemId) : undefined;

    session.pending.isNewSource = !!params.sourceLabel && session.sourceLabel !== params.sourceLabel;

    // Reader popup shortcuts append to the current article conversation.
    // Only an actual source change resets model context; starting a new
    // conversation remains an explicit action in the chat header.
    if (session.pending.isNewSource) {
      session.conversationHistory = [];
      session.persistedContextMessages = [];
      session.contextCheckpoint = undefined;
      // History reset means the model has no memory of prior turns, so the
      // "last sent selection" tracking must also reset — otherwise a popup
      // action that fires with the same selection as before would suppress
      // the block and leave the new conversation without any selection context.
      session.lastSentSelectionText = undefined;
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
          translationRequest: params.translationRequest,
          historyLengthBeforeTurn: session.conversationHistory.length,
          displayUserText: params.displayUserText,
          displayReferenceText: params.displayReferenceText,
          displaySourceLabel: params.displaySourceLabel,
        };
        if (params.translationRequest) return [systemMsg, userMsg];
        return session.conversationHistory.length > 0 ? [systemMsg, ...session.conversationHistory, userMsg] : [systemMsg, userMsg];
      }
      // get selection context
      let selectionContext: Array<string> | undefined;
      try {
        if (params.selectionSnapshot !== undefined) {
          selectionContext = await params.selectionSnapshot.contextPromise;
        } else if (params.contextPromise) {
          selectionContext = await params.contextPromise;
        } else if (canUseCurrentSelection && addon.data.selection.contextPromise) {
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
      const inputImages = params.translationRequest ? [] : (params.images ?? addon.data.inputImages.get(sessionId) ?? []);
      const capturedImages = params.translationRequest ? [] : (session.capturedPageImages ?? []);
      const images = [...capturedImages, ...inputImages];
      const hasImages = images.length > 0;
      const modelSupportsImage = hasImages && checkModelSupportsImage();
      // Model capability is stable per active model — drives the (cacheable)
      // image-instructions section in the system prompt, independent of
      // whether images are attached this turn.
      const imageCapableModel = checkModelSupportsImage();

      const systemContent = params.translationRequest
        ? TRANSLATION_SYSTEM_PROMPT
        : await this.buildSystemContent({
            metadata,
            itemId: itemId,
            chatMode: session.effectiveChatMode,
            imageCapableModel,
            session,
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
        // Every translation is a standalone request, so the selected text
        // must be included even when it is identical to the prior turn.
        if (params.translationRequest || session.lastSentSelectionText !== selectedText) {
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
        translationRequest: params.translationRequest,
        historyLengthBeforeTurn: session.conversationHistory.length,
        displayUserText: params.translationRequest ? undefined : (params.displayUserText ?? params.userPrompt),
        displayReferenceText: selectedText,
        displaySourceLabel: session.pending.isNewSource ? params.sourceLabel : undefined,
      };

      // Clear images for this tab after building the message
      if (inputImages.length > 0) {
        addon.data.inputImages.delete(sessionId);
      }
      if (capturedImages.length > 0) {
        session.capturedPageImages = [];
      }

      // Build history slice for sidebar multi-turn
      if (!params.translationRequest && session.conversationHistory.length > 0) {
        return [systemMsg, ...session.conversationHistory, userMsg];
      }
      return [systemMsg, userMsg];
    })();

    session.sourceLabel = params.sourceLabel ?? session.sourceLabel;
    session.pending.thinkingEffortOverride = params.thinkingEffort;
    session.pending.translationRequest = params.translationRequest;
    session.pending.displayUserText = params.messagesOverride
      ? params.displayUserText
      : params.translationRequest
        ? undefined
        : (params.displayUserText ?? params.userPrompt);
    session.pending.displayReferenceText = params.messagesOverride ? params.displayReferenceText : selectedText;
    session.pending.displaySourceLabel = params.messagesOverride
      ? params.displaySourceLabel
      : session.pending.isNewSource
        ? params.sourceLabel
        : undefined;
    session.pending.shouldRenderUserBubble = !!params.isFromPopup && !params.messagesOverride && !!session.pending.displayUserText?.trim();

    if (params.sessionKind === 'translation' && sourceTabId) {
      showTranslationWorkspace(sourceTabId);
    } else if (params.sessionKind === 'article' && sourceTabId) {
      selectWorkspaceKind('article', sourceTabId);
    }

    if (route === 'window') {
      await ensureChatWindowReady();
      focusChatWindow();
    } else {
      // Sidebar mode: reveal the independent side pane (mirrors focusing the
      // chat window) so popup actions land in a visible panel.
      openSidePane();
    }

    // Popup actions have no InputArea sender to create their user bubble.
    // Render it as soon as the destination host exists; onLLMStreamStartV2
    // retains a fallback for hosts that finish mounting asynchronously.
    if (session.pending.shouldRenderUserBubble && session.pending.displayUserText?.trim()) {
      const container = this.getSessionMessageContainer(session.id);
      if (container) {
        container.appendChild(
          createUserMessageBubble(
            container.ownerDocument,
            session.pending.displayUserText.trim(),
            [],
            () => undefined,
            session.pending.displayReferenceText
          )
        );
        container.scrollTop = container.scrollHeight;
        session.pending.shouldRenderUserBubble = false;
      }
    }

    const AC = (typeof AbortController !== 'undefined' ? AbortController : (Zotero.getMainWindow() as any).AbortController) as typeof AbortController;
    session.pending.abortController = new AC();
    this.notifyHistoryChanged();
    ztoolkit.log('[chat] sendChatRequest:stream-start', {
      sectionId: sessionId,
    });
    const requestPromise = params.translationRequest
      ? streamTranslationV2(messagesPromise, session, params.translationRequest)
      : streamLLMV2(messagesPromise, session);
    session.activeRequestPromise = requestPromise;
    try {
      await requestPromise;
    } finally {
      if (session.activeRequestPromise === requestPromise) {
        session.activeRequestPromise = undefined;
      }
    }
  }
}
