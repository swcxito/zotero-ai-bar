/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * llm.ts
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

import { getModelMetadata, getModelStructuredOutputSupport } from '../utils/providers';
import { getPref } from '../utils/prefs';
import { codexString } from './codex/i18n';
import type { Session } from './chatManager';
import { Output, ToolLoopAgent, parsePartialJson, stepCountIs, type ModelMessage } from 'ai';
import {
  onLLMStreamEndV2,
  onLLMStreamErrorV2,
  onLLMStreamStartV2,
  onLLMStreamUpdateV2,
  consumeAgentStream,
  onReasoningStartV2,
  onReasoningDeltaV2,
  onReasoningEndV2,
  onTranslationResultV2,
  onTranslationPartialV2,
} from './chatUI';
import { ensureWebStreamsGlobals } from '../utils/webStreamsGlobals';
import { createStreamRenderer } from '../utils/streamRenderer';
import type { MarkdownRenderContext } from '../utils/markdown';
import { getActiveModelContextLimit, PROVIDER_ENV_KEY_MAP, resolveApiUrl, type ModelSelect, type ProviderId } from '../utils/providers';
import { buildTools } from './agentTools';
import {
  extractTranslationFallback,
  normalizeTranslationResultCandidate,
  repairTranslationResult,
  translationWireSchema,
  type TranslationRequestMeta,
  type TranslationResult,
} from '../utils/translation';
import {
  buildCompactionPrompt,
  calculateContextBudget,
  COMPACTION_SUMMARY_MAX_TOKENS,
  createCheckpointMessage,
  isContextOverflowError,
  planContextCompaction,
} from './contextCompaction';
// import { JSONObject } from "@ai-sdk/provider";

const SDK_CACHE: Record<string, any> = {};

const MAX_AGENT_ITERATIONS = 30;

/** Models/providers that rejected response_format=json_object this session. */
const STRUCTURED_OUTPUT_UNSUPPORTED_MODELS = new Set<string>();

let streamTextFn: typeof import('ai').streamText | undefined;
let preloadLLMRuntimePromise: Promise<void> | undefined;

Zotero.debug('[zaibar-llm] module loaded');

export async function preloadLLMRuntime() {
  Zotero.debug('[zaibar-llm] preloadLLMRuntime called');
  if (!preloadLLMRuntimePromise) {
    preloadLLMRuntimePromise = (async () => {
      Zotero.debug('[zaibar-llm] importing ai SDK...');
      ensureWebStreamsGlobals();
      const ai = await import('ai');
      streamTextFn = ai.streamText;
      Zotero.debug('[zaibar-llm] ai SDK imported, streamText=' + typeof ai.streamText);
    })().catch((error) => {
      preloadLLMRuntimePromise = undefined;
      Zotero.debug('[zaibar-llm] preloadLLMRuntime failed: ' + (error?.message || error));
      throw error;
    });
  }

  await preloadLLMRuntimePromise;
  Zotero.debug('[zaibar-llm] preloadLLMRuntime done');
}

export function mergePromptCacheProviderOptions(providerOptions: Record<string, any>, providerId: string, cacheKey: string): Record<string, any> {
  const result = { ...providerOptions };
  if (providerId === 'openai') {
    result.openai = { ...result.openai, promptCacheKey: cacheKey };
  } else if (providerId === 'anthropic') {
    result.anthropic = { ...result.anthropic, cacheControl: { type: 'ephemeral' } };
  }
  return result;
}

async function summarizeCompactionHead(params: {
  model: any;
  head: ModelMessage[];
  previousSummary?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  let lastError: unknown;
  for (const toolOutputLimit of [2000, 500]) {
    try {
      const result = streamTextFn!({
        model: params.model,
        messages: buildCompactionPrompt({
          previousSummary: params.previousSummary,
          messages: params.head,
          toolOutputLimit,
        }),
        allowSystemInMessages: true,
        abortSignal: params.abortSignal,
        maxOutputTokens: COMPACTION_SUMMARY_MAX_TOKENS,
        maxRetries: 1,
      });
      const summary = (await result.text).trim();
      if (summary) return summary;
      lastError = new Error('Compaction returned an empty checkpoint.');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Context compaction failed.');
}

async function compactRequestMessages(params: {
  messages: ModelMessage[];
  session: Session;
  model: any;
  tools?: Record<string, any>;
  outputAllowance?: number;
  force?: boolean;
}): Promise<ModelMessage[]> {
  const contextLimit = getActiveModelContextLimit();
  const budget = calculateContextBudget({
    messages: params.messages,
    contextLimit,
    outputAllowance: params.outputAllowance ?? COMPACTION_SUMMARY_MAX_TOKENS,
    tools: params.tools,
  });
  Zotero.debug(
    `[zaibar-compaction] estimated=${budget.estimatedInputTokens}, threshold=${budget.thresholdTokens}, mode=${params.session.effectiveChatMode}`
  );
  if (!params.force && !budget.shouldCompact) return params.messages;

  const systemMessages = params.messages.filter((message) => message.role === 'system');
  const conversationMessages = params.messages.filter((message) => message.role !== 'system');
  const plan = planContextCompaction(conversationMessages, {
    mode: params.session.effectiveChatMode,
    contextRounds: params.session.effectiveChatMode === 'agent' ? undefined : (getPref('chat.contextRounds') ?? 8),
    contextLimit,
  });
  if (!plan?.head.length) return params.messages;

  const summary = await summarizeCompactionHead({
    model: params.model,
    head: plan.head,
    previousSummary: plan.previousSummary,
    abortSignal: params.session.pending.abortController?.signal,
  });
  const checkpointMessage = createCheckpointMessage(summary);
  const currentTurnStart = plan.tail.map((message) => message.role).lastIndexOf('user');
  const completedTail = currentTurnStart >= 0 ? plan.tail.slice(0, currentTurnStart) : plan.tail;
  const completedTailRounds = completedTail.filter((message) => message.role === 'user').length;
  const coveredTurn = params.session.persistedTurns.at(-(completedTailRounds + 1));
  params.session.conversationHistory = [checkpointMessage, ...completedTail];
  if (params.session.lastTurnSnapshot) {
    params.session.lastTurnSnapshot.historyLengthBeforeTurn = params.session.conversationHistory.length;
  }
  params.session.contextCheckpoint = {
    summary,
    coveredThroughTurnId: coveredTurn?.id ?? params.session.contextCheckpoint?.coveredThroughTurnId,
    createdAt: Date.now(),
    recentTail: completedTail.map((message) => ({ ...message })) as ModelMessage[],
  };
  addon.chatManager.persistActiveContext(params.session);
  Zotero.debug(`[zaibar-compaction] checkpoint created, head=${plan.head.length}, tail=${plan.tail.length}`);
  return [...systemMessages, checkpointMessage, ...plan.tail];
}

export async function streamLLMV2(messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>, session: Session) {
  Zotero.debug('[zaibar-llm] streamLLMV2 started, session=' + session.id);
  let streamErrorHandled = false;

  try {
    await preloadLLMRuntime();
    onLLMStreamStartV2(session);
    const selection = resolveModelSelection();
    const model = await createModel(selection);
    Zotero.debug(
      '[zaibar-llm] model created: ' +
        (addon.data.userProviderConfigV2?.active?.providerId || '?') +
        '/' +
        (addon.data.userProviderConfigV2?.active?.modelId || '?')
    );
    const modelSettings = buildModelSettings(selection);
    let messages = await messagesOrPromise;
    Zotero.debug('[zaibar-llm] messages count=' + messages.length);

    const effectiveEffort = session.pending.thinkingEffortOverride ?? session.thinkingEffort;
    const { providerOptions, maxOutputTokens } = buildRequestSettings(selection, effectiveEffort, session);
    const maxOutputTokensSetting = maxOutputTokens === undefined ? {} : { maxOutputTokens };

    const agentEnabled = session.effectiveChatMode === 'agent';
    const tools = agentEnabled ? buildTools() : undefined;
    ztoolkit.log('[llm] agentEnabled:', agentEnabled, 'tools:', Object.keys(tools ?? {}));
    Zotero.debug('[zaibar-llm] agentEnabled=' + agentEnabled + ', toolCount=' + Object.keys(tools ?? {}).length);

    if (agentEnabled) {
      Zotero.debug('[zaibar-llm] using ToolLoopAgent');

      // System prompt is passed as agent instructions; remaining messages are
      // the conversation history plus the current user message.
      messages = await compactRequestMessages({ messages, session, model, tools, outputAllowance: maxOutputTokens });
      const systemMessage = messages.find((message) => message.role === 'system') ?? session.pending.systemMessage;
      session.pending.isAgentMode = true;
      let agentInputMessages = messages.filter((message) => message.role !== 'system');
      let latestStepMessages = agentInputMessages;
      let retryHistory: ModelMessage[] | undefined;
      let retryCheckpoint = session.contextCheckpoint;

      for (let attempt = 0; attempt < 2; attempt++) {
        const agent = new ToolLoopAgent({
          model,
          instructions: systemMessage?.content,
          tools,
          toolChoice: 'auto',
          stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
          experimental_context: session,
          prepareStep: async ({ messages: stepMessages }: any) => {
            const prepared = await compactRequestMessages({
              messages: [{ role: 'system', content: systemMessage?.content ?? '' } as ModelMessage, ...stepMessages],
              session,
              model,
              tools,
              outputAllowance: maxOutputTokens,
            });
            latestStepMessages = prepared.filter((message) => message.role !== 'system');
            return { messages: latestStepMessages };
          },
          providerOptions,
          ...maxOutputTokensSetting,
          maxRetries: 2,
        });

        const result = await agent.stream({
          messages: agentInputMessages,
          abortSignal: session.pending.abortController?.signal,
        });
        const outcome = await consumeAgentStream(session, result, { deferContextOverflow: attempt === 0 });
        if (attempt === 0 && outcome.contextOverflowBeforeOutput) {
          Zotero.debug('[zaibar-compaction] Agent provider overflow before output; compacting and retrying once');
          retryHistory = session.conversationHistory.map((message) => ({ ...message })) as ModelMessage[];
          retryCheckpoint = session.contextCheckpoint;
          const prepared = await compactRequestMessages({
            messages: [{ role: 'system', content: systemMessage?.content ?? '' } as ModelMessage, ...latestStepMessages],
            session,
            model,
            tools,
            outputAllowance: maxOutputTokens,
            force: true,
          });
          agentInputMessages = prepared.filter((message) => message.role !== 'system');
          const currentTurnStart = agentInputMessages.map((message) => message.role).lastIndexOf('user');
          session.pending.agentResumeMessages = currentTurnStart >= 0 ? agentInputMessages.slice(currentTurnStart + 1) : [];
          continue;
        }
        if (attempt === 1 && outcome.failed && retryHistory) {
          session.conversationHistory = retryHistory;
          session.contextCheckpoint = retryCheckpoint;
          addon.chatManager.persistActiveContext(session);
        }
        break;
      }
    } else {
      Zotero.debug('[zaibar-llm] consuming full stream');
      messages = await compactRequestMessages({ messages, session, model, outputAllowance: maxOutputTokens });
      // The system message is built by us from item metadata + stable
      // instructions (no user input), so the prompt-injection risk the SDK
      // warns about doesn't apply here. Keep it in `messages` and explicitly
      // allow it — some openai-compatible providers don't handle the separate
      // `system` option consistently, which produced empty replies.
      const historyBeforeOverflowRetry = session.conversationHistory.map((message) => ({ ...message })) as ModelMessage[];
      const checkpointBeforeOverflowRetry = session.contextCheckpoint;
      for (let attempt = 0; attempt < 2; attempt++) {
        let callbackError: unknown;
        let streamError: unknown;
        let aborted = false;
        let fullText = '';
        let segmentText = '';
        const renderContext: MarkdownRenderContext = new Map();
        const requestPending = session.pending;
        function createTextRenderer(prefix: string) {
          return createStreamRenderer((text, isCurrent) =>
            onLLMStreamUpdateV2({
              session,
              fullText: prefix + text,
              segmentText: text,
              force: true,
              renderContext,
              isCurrent: () => isCurrent() && session.pending === requestPending,
            })
          );
        }
        let textRenderer = createTextRenderer('');
        const result = streamTextFn!({
          model: model,
          messages: messages,
          allowSystemInMessages: true,
          abortSignal: session.pending.abortController?.signal,
          ...modelSettings,
          ...maxOutputTokensSetting,
          providerOptions,
          onError: ({ error }: { error: unknown }) => {
            callbackError = error;
            Zotero.debug('[zaibar-llm] streamText onError: ' + (error as any)?.message);
          },
        });

        try {
          for await (const part of result.fullStream) {
            if (session.pending.abortController?.signal.aborted || part.type === 'abort') {
              aborted = true;
              break;
            }
            switch (part.type) {
              case 'reasoning-start':
                await textRenderer.flush();
                textRenderer.dispose();
                segmentText = '';
                textRenderer = createTextRenderer(fullText);
                onReasoningStartV2(session);
                break;
              case 'reasoning-delta':
                onReasoningDeltaV2(session, part.text);
                break;
              case 'reasoning-end':
                onReasoningEndV2(session);
                break;
              case 'text-delta':
                fullText += part.text;
                segmentText += part.text;
                if (session.pending.messagePop) (session.pending.messagePop as HTMLElement).dataset.markdown = fullText;
                textRenderer.update(segmentText);
                break;
              case 'error':
                streamError = (part as any)?.error ?? part;
                break;
              default:
                Zotero.debug('[zaibar-llm] unhandled stream part type: ' + part.type);
                break;
            }
          }
        } catch (error) {
          streamError = error;
        } finally {
          try {
            await textRenderer.flush(segmentText || undefined);
          } catch (error) {
            streamError ??= error;
          }
          textRenderer.dispose();
        }

        const failure = streamError ?? callbackError;
        if (aborted || session.pending.abortController?.signal.aborted) {
          onLLMStreamEndV2(session, undefined, true);
          break;
        }
        if (failure && !fullText.trim() && attempt === 0 && isContextOverflowError(failure)) {
          Zotero.debug('[zaibar-compaction] provider overflow before output; compacting and retrying once');
          messages = await compactRequestMessages({
            messages,
            session,
            model,
            outputAllowance: maxOutputTokens,
            force: true,
          });
          continue;
        }
        if (failure) {
          if (attempt === 1) {
            session.conversationHistory = historyBeforeOverflowRetry;
            session.contextCheckpoint = checkpointBeforeOverflowRetry;
            addon.chatManager.persistActiveContext(session);
          }
          streamErrorHandled = true;
          handleStreamError(session, failure);
          break;
        }

        let usage: any;
        try {
          usage = await result.usage;
        } catch (error: any) {
          Zotero.debug('[zaibar-llm] usage fetch failed: ' + (error?.message || error));
        }
        if (typeof usage?.cachedInputTokens === 'number') {
          Zotero.debug(`[zaibar-cache] cachedInputTokens=${usage.cachedInputTokens}`);
        }
        onLLMStreamEndV2(session, usage, session.pending.abortController?.signal.aborted);
        break;
      }
    }
  } catch (error: any) {
    Zotero.debug('[zaibar-llm] streamLLMV2 catch: ' + (error?.name || '') + ' ' + (error?.message || error));
    // Abort from intentional stop: use the normal-end handler for UI cleanup
    // but signal `aborted` so the partial turn isn't recorded in history.
    if (session.pending.abortController?.signal.aborted || error?.name === 'AbortError' || error?.name === 'AI_AbortError') {
      onLLMStreamEndV2(session, undefined, true);
      return;
    }
    if (error?.name === 'FullTextRequestCancelledError') {
      onLLMStreamEndV2(session, undefined, true);
      return;
    }
    // If onError already handled this, skip duplicate handling
    if (!streamErrorHandled) {
      handleStreamError(session, error);
    }
  } finally {
    Zotero.debug('[zaibar-llm] streamLLMV2 finally');
    // session.abortController = undefined;
  }
}

type TranslationAttempt = {
  output?: TranslationResult;
  rawText: string;
  plainText: boolean;
  partialTranslatedText?: string;
  partialOutput?: Record<string, any>;
  usage?: any;
};

/**
 * Dedicated structured translation stream. It deliberately bypasses
 * session.chatMode, so agent tools and full-text behavior cannot affect the
 * reader's Translate action.
 */
export async function streamTranslationV2(
  messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  request: TranslationRequestMeta
) {
  Zotero.debug('[zaibar-llm] streamTranslationV2 started, session=' + session.id);
  const requestPending = session.pending;
  const ensureCurrent = () => {
    if (session.pending !== requestPending || requestPending.abortController?.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  try {
    await preloadLLMRuntime();
    ensureCurrent();
    onLLMStreamStartV2(session);
    const messages = await messagesOrPromise;
    ensureCurrent();
    const modelSelection = resolveModelSelection(request.modelKey);
    const model = await createModel(modelSelection);
    ensureCurrent();
    const chatThinkingEffort = session.pending.thinkingEffortOverride ?? session.thinkingEffort;
    const translationThinkingDepth = getPref('translate.thinkingDepth') === 'follow-chat' ? 'follow-chat' : 'minimum';
    const effectiveEffort = resolveTranslationThinkingEffort(translationThinkingDepth, chatThinkingEffort, modelSelection);
    const { providerOptions, maxOutputTokens } = buildRequestSettings(modelSelection, effectiveEffort);
    const declaredStructuredSupport = getModelStructuredOutputSupport(modelSelection);
    logTranslationDebug('request-start', {
      model: getModelKey(modelSelection),
      declaredStructuredSupport,
      selectedTextLength: request.selectedText.length,
      targetLanguage: request.targetLanguage,
      chatMode: session.effectiveChatMode,
      translationThinkingDepth,
      thinkingEffort: effectiveEffort,
    });

    // Qwen-MT is a dedicated translation endpoint rather than a general chat
    // model. It accepts exactly one user message, rejects system messages, and
    // returns plain translated text instead of structured JSON.
    if (isQwenMtModel(modelSelection)) {
      await streamQwenMtTranslation({
        model,
        modelSelection,
        session,
        providerOptions,
        maxOutputTokens,
        targetLanguage: request.targetLanguage,
        selectedText: request.selectedText,
      });
      return;
    }

    const first = await runTranslationAttempt({
      model,
      messages,
      session,
      providerOptions,
      maxOutputTokens,
      modelSelection,
      strict: false,
      selectedText: request.selectedText,
    });
    ensureCurrent();
    const firstOutput = first.output ?? repairTranslationResult(first.rawText);
    logTranslationAttempt('first-attempt-finished', first, firstOutput);
    if (firstOutput) {
      onTranslationResultV2(session, normalizeTranslationOriginal(firstOutput, request.selectedText));
      onLLMStreamEndV2(session, first.usage);
      return;
    }

    const firstPlainText = first.plainText ? extractTranslationFallback(first.rawText) : undefined;
    if (firstPlainText) {
      logTranslationDebug('using-first-attempt-plain-text', { fallbackLength: firstPlainText.length });
      onTranslationResultV2(session, {
        textType: 'text',
        originalText: request.selectedText,
        targetLanguage: request.targetLanguage,
        translatedText: firstPlainText,
      });
      onLLMStreamEndV2(session, first.usage);
      return;
    }

    Zotero.debug('[zaibar-llm] structured translation invalid; retrying once');
    const second = await runTranslationAttempt({
      model,
      messages,
      session,
      providerOptions,
      maxOutputTokens,
      modelSelection,
      strict: true,
      selectedText: request.selectedText,
    });
    ensureCurrent();
    const secondOutput = second.output ?? repairTranslationResult(second.rawText);
    logTranslationAttempt('second-attempt-finished', second, secondOutput);
    if (secondOutput) {
      onTranslationResultV2(session, normalizeTranslationOriginal(secondOutput, request.selectedText));
      onLLMStreamEndV2(session, second.usage);
      return;
    }

    const partialOutput = pickBestPartialTranslation(first.partialOutput, second.partialOutput, request.selectedText);
    if (partialOutput) {
      logTranslationDebug('using-best-partial-output', {
        textType: partialOutput.textType,
        translatedTextLength: partialOutput.translatedText.length,
      });
      onTranslationResultV2(session, partialOutput);
      onLLMStreamEndV2(session, second.usage ?? first.usage);
      return;
    }

    const fallback =
      first.partialTranslatedText ??
      second.partialTranslatedText ??
      extractTranslationFallback(first.rawText) ??
      extractTranslationFallback(second.rawText);
    if (!fallback) {
      logTranslationDebug('no-usable-translation', {
        first: describeTranslationAttempt(first),
        second: describeTranslationAttempt(second),
      });
      throw new Error('The model did not return a usable translation.');
    }
    logTranslationDebug('using-plain-text-fallback', { fallbackLength: fallback.length });
    onTranslationResultV2(session, {
      textType: 'text',
      originalText: request.selectedText,
      targetLanguage: request.targetLanguage,
      translatedText: fallback,
    });
    onLLMStreamEndV2(session, second.usage ?? first.usage);
  } catch (error: any) {
    if (session.pending !== requestPending) return;
    if (isTranslationAbort(session, error)) {
      logTranslationDebug('request-aborted');
      onLLMStreamEndV2(session, undefined, true);
      return;
    }
    logTranslationDebug('request-error', { error: buildErrorMessage(error) });
    Zotero.debug('[zaibar-llm] streamTranslationV2 catch: ' + (error?.name || '') + ' ' + (error?.message || error));
    handleStreamError(session, error);
  }
}

async function streamQwenMtTranslation(params: {
  model: any;
  modelSelection: ModelSelect;
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens?: number;
  targetLanguage: string;
  selectedText: string;
}): Promise<void> {
  const pending = params.session.pending;
  const signal = pending.abortController?.signal;
  const ensureCurrent = () => {
    if (params.session.pending !== pending || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  let streamError: unknown;
  const streamState = createQwenMtStreamState();
  const maxOutputTokensSetting = params.maxOutputTokens === undefined ? {} : { maxOutputTokens: params.maxOutputTokens };
  const result = streamTextFn!({
    model: params.model,
    // Qwen-MT accepts one user message. Put the language instruction in the
    // prompt instead of translation_options so locale codes such as zh-CN do
    // not get rejected by the provider's supported-language enum.
    messages: [{ role: 'user', content: buildQwenMtPrompt(params.targetLanguage, params.selectedText) }],
    abortSignal: params.session.pending.abortController?.signal,
    ...buildModelSettings(params.modelSelection),
    ...maxOutputTokensSetting,
    providerOptions: params.providerOptions,
    maxRetries: 2,
    onError: ({ error }: { error: unknown }) => {
      streamError = error;
    },
  });

  try {
    for await (const part of result.fullStream) {
      ensureCurrent();
      if (part.type === 'abort') throw new DOMException('Cancelled', 'AbortError');
      switch (part.type) {
        case 'reasoning-start':
          onReasoningStartV2(params.session);
          break;
        case 'reasoning-delta':
          onReasoningDeltaV2(params.session, part.text);
          break;
        case 'reasoning-end':
          onReasoningEndV2(params.session);
          break;
        case 'text-delta':
          consumeQwenMtStreamChunk(streamState, part.text);
          if (streamState.text.trim()) {
            onTranslationPartialV2(params.session, {
              textType: 'text',
              originalText: params.selectedText,
              targetLanguage: params.targetLanguage,
              translatedText: streamState.text,
            });
          }
          break;
        case 'error':
          streamError = (part as any).error ?? part;
          break;
      }
    }
  } catch (error) {
    streamError = error;
  }

  if (streamError) throw streamError;
  ensureCurrent();
  const fullText = finalizeQwenMtStream(streamState, qwenMtUsesIncrementalOutput(params.modelSelection));
  if (!fullText.trim()) throw new Error('The Qwen-MT model returned an empty translation.');

  let usage: any;
  try {
    usage = await result.usage;
  } catch {
    // Usage is optional.
  }
  ensureCurrent();
  // Qwen-MT returns plain text, but the translation workspace still expects
  // the common translation-card shape. Wrap the completed text locally; no
  // JSON is requested from or parsed from the model.
  onTranslationResultV2(params.session, {
    textType: 'text',
    originalText: params.selectedText,
    targetLanguage: params.targetLanguage,
    translatedText: fullText,
  });
  onLLMStreamEndV2(params.session, usage);
}

function isTranslationAbort(session: Session, error: unknown): boolean {
  if (session.pending.abortController?.signal.aborted) return true;
  const name = String((error as any)?.name ?? '');
  return name === 'AbortError' || name === 'AI_AbortError';
}

async function runTranslationAttempt(params: {
  model: any;
  modelSelection: ModelSelect;
  messages: ModelMessage[];
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens?: number;
  strict: boolean;
  selectedText: string;
}): Promise<TranslationAttempt> {
  const modelKey = getModelKey(params.modelSelection);
  if (STRUCTURED_OUTPUT_UNSUPPORTED_MODELS.has(modelKey)) {
    logTranslationDebug('preflight-selected-json-text-path', { model: modelKey, strict: params.strict });
    return runJsonTextTranslationAttempt(params);
  }

  try {
    logTranslationDebug('starting-response-format-path', { model: modelKey, strict: params.strict });
    return await runSchemaTranslationAttempt(params);
  } catch (error) {
    const compatibilityError = isJsonResponseFormatCompatibilityError(error);
    logTranslationDebug('response-format-path-error', {
      model: modelKey,
      strict: params.strict,
      compatibilityError,
      error: buildErrorMessage(error),
    });
    if (!compatibilityError) throw error;
    STRUCTURED_OUTPUT_UNSUPPORTED_MODELS.add(modelKey);
    Zotero.debug('[zaibar-llm] response_format JSON unsupported; falling back to streamed JSON text for ' + modelKey);
    return runJsonTextTranslationAttempt(params);
  }
}

type TranslationAttemptParams = {
  model: any;
  modelSelection: ModelSelect;
  messages: ModelMessage[];
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens?: number;
  strict: boolean;
  selectedText: string;
};

export async function consumeTranslationStream(result: any, params: TranslationAttemptParams, structured: boolean): Promise<TranslationAttempt> {
  const controller = params.session.pending.abortController;
  const signal = controller?.signal;
  const isCurrent = () => !signal?.aborted && params.session.pending.abortController === controller;
  let rawText = '';
  let plainText = false;
  let partialTranslatedText: string | undefined;
  let partialOutput: Record<string, any> | undefined;
  let reasoning = false;
  let streamError: unknown;
  try {
    for await (const part of result.fullStream) {
      if (!isCurrent() || part.type === 'abort') throw new DOMException('Cancelled', 'AbortError');
      if (part.type === 'reasoning-start' || part.type === 'reasoning-delta') {
        if (!reasoning) {
          reasoning = true;
          onReasoningStartV2(params.session);
        }
        if (part.type === 'reasoning-delta') onReasoningDeltaV2(params.session, part.text);
      } else if (part.type === 'reasoning-end') {
        if (reasoning) onReasoningEndV2(params.session);
        reasoning = false;
      } else if (part.type === 'text-delta') {
        rawText += part.text;
        plainText ||= classifyTranslationStreamPrefix(rawText) === 'plain';
        if (plainText) {
          renderPlainTranslationPreview(params.session, params.selectedText, rawText);
          continue;
        }
        const start = rawText.indexOf('{');
        const partial = await parsePartialJson(start >= 0 ? rawText.slice(start) : rawText);
        if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
        if (partial.value && typeof partial.value === 'object' && !Array.isArray(partial.value)) {
          partialOutput = partial.value as Record<string, any>;
          if (typeof partialOutput.translatedText === 'string' && partialOutput.translatedText.trim())
            partialTranslatedText = partialOutput.translatedText;
          onTranslationPartialV2(params.session, { ...partialOutput, originalText: params.selectedText });
        }
      } else if (part.type === 'error') streamError = part.error ?? part;
    }
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    if (streamError) throw streamError;
    let output: TranslationResult | undefined;
    if (structured) {
      try {
        output = normalizeTranslationResultCandidate(await result.output, params.selectedText);
      } catch (error) {
        logTranslationDebug('response-format-validation-failed', { error: buildErrorMessage(error) });
      }
    } else output = repairTranslationResult(rawText);
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    let usage: any;
    try {
      usage = await result.usage;
    } catch {
      /* Usage is advisory. */
    }
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    return { output, rawText, plainText, partialTranslatedText, partialOutput, usage };
  } finally {
    if (reasoning && isCurrent()) onReasoningEndV2(params.session);
  }
}

async function createTranslationAttempt(params: TranslationAttemptParams, structured: boolean): Promise<TranslationAttempt> {
  const prompt = buildDedicatedTranslationPrompt(params.messages, params.strict, !structured);
  let callbackError: unknown;
  const result = streamTextFn!({
    model: params.model,
    system: prompt.system,
    messages: prompt.messages,
    abortSignal: params.session.pending.abortController?.signal,
    ...buildModelSettings(params.modelSelection),
    ...(params.maxOutputTokens === undefined ? {} : { maxOutputTokens: params.maxOutputTokens }),
    providerOptions: params.providerOptions,
    maxRetries: 2,
    ...(structured
      ? { output: Output.object({ schema: translationWireSchema, name: 'translation_result', description: 'A classified translation result.' }) }
      : {}),
    onError: ({ error }: { error: unknown }) => {
      callbackError = error;
    },
  });
  const attempt = await consumeTranslationStream(result, params, structured);
  if (callbackError) throw callbackError;
  logTranslationAttempt(structured ? 'response-format-attempt-complete' : 'json-text-attempt-complete', attempt);
  return attempt;
}

const runSchemaTranslationAttempt = (params: TranslationAttemptParams) => createTranslationAttempt(params, true);
const runJsonTextTranslationAttempt = (params: TranslationAttemptParams) => createTranslationAttempt(params, false);

function logTranslationAttempt(event: string, attempt: TranslationAttempt, resolvedOutput?: TranslationResult): void {
  logTranslationDebug(event, {
    ...describeTranslationAttempt(attempt),
    resolvedOutput: resolvedOutput
      ? {
          textType: resolvedOutput.textType,
          translatedTextLength: resolvedOutput.translatedText.length,
          keys: Object.keys(resolvedOutput),
        }
      : undefined,
  });
}

function describeTranslationAttempt(attempt: TranslationAttempt): Record<string, unknown> {
  return {
    hasValidatedOutput: Boolean(attempt.output),
    plainText: attempt.plainText,
    rawTextLength: attempt.rawText.length,
    rawTextPreview: previewTranslationRawText(attempt.rawText),
    partialTranslatedTextLength: attempt.partialTranslatedText?.length ?? 0,
    partialKeys: attempt.partialOutput ? Object.keys(attempt.partialOutput) : [],
  };
}

export type TranslationStreamPrefixKind = 'pending' | 'structured' | 'plain';

/** Classify a streamed translation locally before exposing any raw JSON. */
export function classifyTranslationStreamPrefix(rawText: string): TranslationStreamPrefixKind {
  const value = rawText.trimStart();
  if (!value) return 'pending';
  if (value.startsWith('{') || value.startsWith('[')) return 'structured';

  // Wait while a possible Markdown JSON fence is still incomplete. Once the
  // opening fence is known, keep it hidden and let the JSON repair path parse it.
  const lower = value.toLowerCase();
  if ('```json'.startsWith(lower)) return 'pending';
  if (lower.startsWith('```')) return 'structured';
  return 'plain';
}

function renderPlainTranslationPreview(session: Session, selectedText: string, rawText: string): void {
  const translatedText = rawText.trimStart();
  if (!translatedText) return;
  onTranslationPartialV2(session, {
    textType: 'text',
    originalText: selectedText,
    translatedText,
  });
}

function previewTranslationRawText(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  return normalized.length > 1500 ? normalized.slice(0, 1500) + '…' : normalized;
}

function logTranslationDebug(event: string, details?: Record<string, unknown>): void {
  let suffix = '';
  if (details) {
    try {
      suffix = ' ' + JSON.stringify(details);
    } catch {
      suffix = ' [unserializable details]';
    }
  }
  const message = `[zaibar-translation] ${event}${suffix}`;
  Zotero.debug(message);
  // This logger is visible beside the generic stream errors in installed
  // builds, so partial-output failures can be diagnosed without a debug build.
  ztoolkit.log(message);
}

function pickBestPartialTranslation(
  first: Record<string, any> | undefined,
  second: Record<string, any> | undefined,
  selectedText: string
): TranslationResult | undefined {
  const candidates = [first, second]
    .filter((value): value is Record<string, any> => Boolean(value))
    .sort((a, b) => String(b.translatedText ?? '').length - String(a.translatedText ?? '').length);
  for (const candidate of candidates) {
    const parsed = normalizeTranslationResultCandidate(candidate, selectedText);
    if (parsed) return parsed;
  }
  return undefined;
}

function buildDedicatedTranslationPrompt(messages: ModelMessage[], strict: boolean, jsonTextFallback: boolean) {
  const sourceSystem = messages.find((message) => message.role === 'system');
  const baseSystem = sourceSystem && typeof sourceSystem.content === 'string' ? sourceSystem.content : 'You are a dedicated translation engine.';
  const contract = [
    baseSystem,
    '',
    '# JSON output contract',
    'Return exactly one JSON object and nothing else. Do not use Markdown fences, commentary, or surrounding prose.',
    jsonTextFallback
      ? 'Required fields: "textType" and "translatedText". "originalText" and "targetLanguage" are optional.'
      : 'Include every schema field. Use "" for inapplicable string fields and [] when there are no other meanings.',
    '"textType" must be "word", "abbreviation", or "text".',
    'Write all translatable natural-language fields in the requested target language, including "translatedText", "explanation", and every "otherMeanings[].translatedText". Keep only "originalText", source-language "pronunciation", source-language "fullForm", and English POS abbreviations untranslated.',
    'For "word", "translatedText" must be a concise dictionary-style equivalent in the target language, never the original word or an explanatory sentence.',
    'For "word", include the source-language "pronunciation" and English-abbreviated "pos" when available.',
    'For "word", explain only specialized, technical, domain-specific, idiomatic, or non-literal meanings, or meanings that "translatedText" alone cannot adequately convey. Avoid boilerplate such as "in this context".',
    'Every "pos" must use a conventional English abbreviation such as "n.", "v.", "vt.", "vi.", "adj.", "adv.", "prep.", "pron.", or "conj."; never use a full word or a translated label.',
    'If present, "otherMeanings" must be an array of objects shaped exactly as {"pos":"...","translatedText":["..."]}; "translatedText" must be a non-empty array of strings.',
    'For "abbreviation", both "fullForm" and "explanation" are required. Keep "fullForm" in its source language and write "translatedText" and "explanation" in the requested target language.',
    'For "text", return a fluent, accurate, academic translation. Dictionary fields do not apply.',
    'If the source is or may be a list (for example, it contains bullets such as •, ◦, □, ■, , or ; numbering; repeated short items; or a heading followed by items), preserve it as Markdown in "translatedText" instead of merging it into prose.',
    'Use "- " for unordered Markdown list items, preserve the heading separately, and use nested Markdown indentation when different bullet symbols or source indentation imply subitems.',
    jsonTextFallback ? 'Produce the JSON object as ordinary streamed text while obeying this contract.' : '',
    strict ? 'This is a retry: ensure the JSON object is complete, valid, and contains a non-empty "translatedText".' : '',
  ]
    .filter(Boolean)
    .join('\n');

  // The AI SDK recommends the dedicated `system` option. Translation also
  // deliberately excludes prior assistant and history turns.
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUserMessage = userMessages[userMessages.length - 1];
  return {
    system: contract,
    messages: latestUserMessage ? [latestUserMessage] : [],
  };
}

function getModelKey(selection: ModelSelect): string {
  return `${selection.providerId}::${selection.modelId}`;
}

function resolveModelSelection(modelKey?: string): ModelSelect {
  const active = addon.data.userProviderConfigV2?.active;
  if (modelKey) {
    const separator = modelKey.indexOf('::');
    if (separator > 0 && separator < modelKey.length - 2) {
      const candidate = {
        providerId: modelKey.slice(0, separator) as ProviderId,
        modelId: modelKey.slice(separator + 2),
      };
      const exists = addon.data.userProviderConfigV2?.addedModels.some(
        (model) => model.providerId === candidate.providerId && model.id === candidate.modelId && model.enabled !== false
      );
      if (exists) return candidate;
      Zotero.debug('[zaibar-llm] configured translation model is unavailable: ' + modelKey);
    }
  }
  if (!active) throw new Error('No active model selected.');
  return active;
}

export function isJsonResponseFormatCompatibilityError(error: unknown): boolean {
  const message = buildErrorMessage(error).toLowerCase();
  const mentionsJsonMode = message.includes('response_format') || message.includes('json_object');
  const incompatible =
    message.includes('not supported') ||
    message.includes('unsupported') ||
    message.includes('unavailable') ||
    message.includes('not available') ||
    message.includes('not valid') ||
    message.includes('invalid schema for response_format') ||
    message.includes('invalidparameter') ||
    message.includes("must contain the word 'json'");
  return mentionsJsonMode && incompatible;
}

function normalizeTranslationOriginal(output: TranslationResult, selectedText: string): TranslationResult {
  return normalizeTranslationResultCandidate(output, selectedText) ?? ({ ...output, originalText: selectedText } as TranslationResult);
}

export function isQwenMtModel(selection: Pick<ModelSelect, 'modelId'>): boolean {
  const modelId = selection.modelId.trim().toLowerCase();
  return /^qwen-mt(?:$|[-_.])/.test(modelId);
}

export function qwenMtUsesIncrementalOutput(selection: Pick<ModelSelect, 'modelId'>): boolean {
  const modelId = selection.modelId.trim().toLowerCase();
  return !/^qwen-mt-(?:plus|turbo)(?:$|[-_.])/.test(modelId);
}

type QwenMtStreamMode = 'append' | 'replace';

type QwenMtStreamState = {
  mode?: QwenMtStreamMode;
  lastChunk: string;
  appendText: string;
  replaceText: string;
  text: string;
};

function createQwenMtStreamState(): QwenMtStreamState {
  return { lastChunk: '', appendText: '', replaceText: '', text: '' };
}

function consumeQwenMtStreamChunk(state: QwenMtStreamState, chunk: string): void {
  if (!chunk) return;

  const previousChunk = state.lastChunk;
  state.appendText += chunk;
  state.replaceText = chunk;

  if (!state.mode && previousChunk) {
    // A cumulative stream grows from the previous chunk; an incremental
    // stream emits a separate delta that normally is not prefixed by it.
    if (chunk.length > previousChunk.length && chunk.startsWith(previousChunk)) {
      state.mode = 'replace';
    } else if (chunk !== previousChunk) {
      state.mode = 'append';
    }
  }

  state.lastChunk = chunk;
  state.text = state.mode === 'append' ? state.appendText : state.replaceText;
}

function finalizeQwenMtStream(state: QwenMtStreamState, fallbackIncremental: boolean): string {
  if (!state.mode) {
    state.mode = fallbackIncremental ? 'append' : 'replace';
    state.text = state.mode === 'append' ? state.appendText : state.replaceText;
  }
  return state.text;
}

export function mergeQwenMtStreamChunks(chunks: string[], fallbackIncremental: boolean): { mode: QwenMtStreamMode; text: string } {
  const state = createQwenMtStreamState();
  for (const chunk of chunks) consumeQwenMtStreamChunk(state, chunk);
  const text = finalizeQwenMtStream(state, fallbackIncremental);
  return { mode: state.mode!, text };
}

export function buildQwenMtPrompt(targetLanguage: string, selectedText: string): string {
  const normalizedLanguage = targetLanguage.trim();
  const displayLanguage = getLanguageDisplayName(normalizedLanguage);
  const languageInstruction =
    displayLanguage && displayLanguage !== normalizedLanguage ? `${displayLanguage} (${normalizedLanguage})` : displayLanguage;
  return [
    `Translate the following text into ${languageInstruction || 'the requested target language'}.`,
    'Return only the translation. Do not add explanations, labels, quotation marks, or commentary.',
    '# Text to translate',
    selectedText,
  ].join('\n\n');
}

function getLanguageDisplayName(language: string): string {
  if (!language) return '';
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    return displayNames.of(language) ?? language;
  } catch {
    return language;
  }
}

export function buildRequestSettings(selection: ModelSelect, effort: Session['thinkingEffort'], chatSession?: Session) {
  let providerOptions = buildProviderOptions(effort, selection);
  if (chatSession) {
    const key = `${chatSession.conversationId ?? chatSession.id}:${selection.providerId}:${selection.modelId}`;
    providerOptions = mergePromptCacheProviderOptions(providerOptions, selection.providerId, key);
  }
  return { providerOptions, maxOutputTokens: getMaxOutputTokensWithThinkingHeadroom(effort, providerOptions, selection) };
}

function buildProviderOptions(effort: Session['thinkingEffort'], selection: ModelSelect): Record<string, any> {
  const activeProviderId = selection.providerId;
  const providerOptions: Record<string, any> = { ...V2_PROVIDER_OPTIONS };
  providerOptions.google = getGoogleThinkingConfig(selection.modelId, effort);
  const thinkingOpts = isQwenMtModel(selection) ? undefined : getThinkingProviderOptions(activeProviderId, effort);
  if (thinkingOpts && activeProviderId) {
    providerOptions[activeProviderId] = {
      ...providerOptions[activeProviderId],
      ...thinkingOpts,
    };
  }
  return providerOptions;
}

function resolveTranslationThinkingEffort(
  depth: 'minimum' | 'follow-chat',
  chatEffort: Session['thinkingEffort'],
  selection: ModelSelect
): Session['thinkingEffort'] {
  if (depth === 'follow-chat') return chatEffort;

  // Non-reasoning models have nothing to disable. For reasoning models,
  // explicitly disable thinking where supported; otherwise use the lowest
  // reasoning level exposed by the provider.
  if (getModelMetadata(selection)?.reasoning !== true) return 'none';
  return providerCanDisableThinking(selection) ? 'none' : 'low';
}

function providerCanDisableThinking(selection: ModelSelect): boolean {
  const { providerId, modelId } = selection;
  if (providerId === 'codex-subscription') {
    throw new Error(codexString('codex-error-api-backend', 'Codex 订阅模型必须通过本地运行时连接，不能使用 API 后端。'));
  }
  if (providerId === 'google' || providerId.startsWith('google-vertex')) {
    const normalizedModelId = modelId.toLowerCase();
    // Gemini 3 and Gemini 2.5 Pro expose a minimum thinking level rather
    // than a true off state. Flash-family models accept thinkingBudget=0.
    return !normalizedModelId.startsWith('gemini-3') && !normalizedModelId.includes('gemini-2.5-pro');
  }
  return getThinkingProviderOptions(providerId, 'none') !== undefined;
}

function getMaxOutputTokensWithThinkingHeadroom(
  effort: Session['thinkingEffort'],
  providerOptions: Record<string, any>,
  selection: ModelSelect
): number | undefined {
  let maxOutputTokens = getConfiguredMaxOutputTokens();
  const activeProviderId = selection.providerId;
  const providerThinking = activeProviderId ? providerOptions[activeProviderId] : undefined;
  const anthropicBudget = providerThinking?.thinking?.budgetTokens;
  const googleBudget = providerOptions.google?.thinkingBudget;
  const thinkingBudget = (typeof anthropicBudget === 'number' ? anthropicBudget : 0) + (typeof googleBudget === 'number' ? googleBudget : 0);
  if (effort !== 'none' && maxOutputTokens !== undefined && maxOutputTokens <= thinkingBudget) maxOutputTokens = thinkingBudget + 2000;
  if (effort !== 'none' && effort !== 'low' && (activeProviderId === 'openai' || activeProviderId === 'openrouter')) {
    const minHeadroom = effort === 'xhigh' ? 16000 : effort === 'high' ? 10000 : 6000;
    if (maxOutputTokens !== undefined && maxOutputTokens < minHeadroom) maxOutputTokens = minHeadroom;
  }
  return maxOutputTokens;
}

function getConfiguredMaxOutputTokens(): number | undefined {
  if (!getPref('llm.maxTokensEnabled')) return undefined;
  const configured = getPref('llm.maxTokens');
  return configured > 0 ? configured : 2000;
}

export function buildModelSettings(selection: ModelSelect = resolveModelSelection()) {
  const temperatureEnabled = getPref('llm.temperatureEnabled');
  if (!temperatureEnabled) {
    Zotero.debug('[zaibar-llm] temperature disabled by user setting');
    return {};
  }
  const temp100 = getPref('llm.temperature100');
  const modelMetadata = getModelMetadata(selection);
  if (modelMetadata?.temperature === false) {
    Zotero.debug('[zaibar-llm] temperature disabled for active model');
    return {};
  }
  return { temperature: temp100 / 100 };
}

export function buildErrorMessage(error: unknown): string {
  const err = error as any;
  let message: string;
  if (typeof err?.message === 'string' && err.message) {
    const label = err.name && err.name !== 'Error' ? err.name : '';
    message = label ? `${label}: ${err.message}` : err.message;
  } else if (typeof error === 'object' && error !== null) {
    message = JSON.stringify(error);
  } else {
    message = String(error);
  }
  if (typeof err?.statusCode === 'number') {
    message = `[HTTP ${err.statusCode}] ${message}`;
  }
  return message;
}

function handleStreamError(session: Session, error: unknown) {
  const message = buildErrorMessage(error);
  ztoolkit.log('LLM stream error:', session.id, message);

  try {
    onLLMStreamErrorV2({ session, error: message });
  } catch (e) {
    ztoolkit.log('onLLMStreamErrorV2 failed:', e);
  }
}

/**
 * Provider-specific options passed via streamText.
 * The AI SDK auto-routes options to the matching provider by namespace key.
 * Namespaces match the `name` param passed to createOpenAICompatible (v2 providerId).
 */
const V2_PROVIDER_OPTIONS: Record<string, any> = {};

function getThinkingProviderOptions(providerId: string, effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh'): Record<string, any> | undefined {
  if (effort === 'none') {
    switch (providerId) {
      case 'anthropic':
        return { thinking: { type: 'disabled' } };
      case 'zhipuai':
      case 'zhipuai-coding-plan':
      case 'zai':
      case 'zai-coding-plan':
      case 'minimax-cn':
        return { thinking: { type: 'disabled' } };
      case 'alibaba':
      case 'alibaba-cn':
      case 'alibaba-coding-plan':
      case 'alibaba-coding-plan-cn':
        return { enable_thinking: false };
      default:
        return undefined;
    }
  }

  switch (providerId) {
    case 'openai':
    case 'openrouter': {
      const map: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' };
      return { reasoningEffort: map[effort] };
    }
    case 'anthropic': {
      if (effort === 'low') return { thinking: { type: 'adaptive' } };
      const budgetMap: Record<string, number> = { medium: 4096, high: 8192, xhigh: 16384 };
      return { thinking: { type: 'enabled', budgetTokens: budgetMap[effort] } };
    }
    case 'zhipuai':
    case 'zhipuai-coding-plan':
    case 'zai':
    case 'zai-coding-plan':
      return { thinking: { type: 'adaptive' } };
    case 'minimax-cn': {
      if (effort === 'low') return { thinking: { type: 'adaptive' } };
      const budgetMap: Record<string, number> = { medium: 4096, high: 8192, xhigh: 16384 };
      return { thinking: { type: 'enabled', budgetTokens: budgetMap[effort] } };
    }
    case 'alibaba':
    case 'alibaba-cn':
    case 'alibaba-coding-plan':
    case 'alibaba-coding-plan-cn':
      return { enable_thinking: true };
    default:
      return undefined;
  }
}

/**
 * Gemini 3 系列使用 thinkingLevel 控制推理深度，
 * Gemini 2.5 系列使用 thinkingBudget 控制思考 token 数。
 */
function getGoogleThinkingConfig(modelId: string, effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh') {
  if (effort === 'none') {
    return { thinkingBudget: 0, includeThoughts: false };
  }
  const levelMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high' };
  if (modelId.startsWith('gemini-3')) {
    return { thinkingLevel: levelMap[effort], includeThoughts: true };
  }
  const budgetMap: Record<string, number> = { low: 256, medium: 1024, high: 4096, xhigh: 8192 };
  if (modelId.startsWith('gemini-2.5')) {
    return { thinkingBudget: budgetMap[effort], includeThoughts: true };
  }
  return { thinkingBudget: budgetMap[effort] ?? 0, includeThoughts: true };
}

async function createProvider(
  npm: string | undefined,
  opts: {
    providerId: string;
    modelId: string;
    providerEnv: Record<string, string>;
    baseUrl?: string;
    supportsStructuredOutputs?: boolean;
  }
) {
  const { providerId, modelId, providerEnv } = opts;
  Zotero.debug('[zaibar-llm] createProvider providerId=' + providerId + ', npm=' + npm + ', modelId=' + modelId);

  switch (npm) {
    case '@ai-sdk/amazon-bedrock': {
      const { createAmazonBedrock } = (SDK_CACHE['@ai-sdk/amazon-bedrock'] ??= await import('@ai-sdk/amazon-bedrock'));
      if (providerEnv['AWS_BEARER_TOKEN_BEDROCK']) {
        return createAmazonBedrock({ region: providerEnv['AWS_REGION'], apiKey: providerEnv['AWS_BEARER_TOKEN_BEDROCK'] })(modelId as any);
      }
      return createAmazonBedrock({
        region: providerEnv['AWS_REGION'],
        accessKeyId: providerEnv['AWS_ACCESS_KEY_ID'],
        secretAccessKey: providerEnv['AWS_SECRET_ACCESS_KEY'],
        sessionToken: providerEnv['AWS_SESSION_TOKEN'] || undefined,
      })(modelId as any);
    }

    case '@ai-sdk/azure': {
      const { createAzure } = (SDK_CACHE['@ai-sdk/azure'] ??= await import('@ai-sdk/azure'));
      return createAzure({
        resourceName: providerEnv['AZURE_RESOURCE_NAME'] || providerEnv['AZURE_COGNITIVE_SERVICES_RESOURCE_NAME'],
        apiKey: providerEnv['AZURE_API_KEY'] || providerEnv['AZURE_COGNITIVE_SERVICES_API_KEY'],
      })(modelId as any);
    }

    case '@ai-sdk/google-vertex':
    case '@ai-sdk/google-vertex/edge': {
      const { createVertex } = (SDK_CACHE['@ai-sdk/google-vertex/edge'] ??= await import('@ai-sdk/google-vertex/edge'));
      return createVertex({ project: providerEnv['GOOGLE_VERTEX_PROJECT'], location: providerEnv['GOOGLE_VERTEX_LOCATION'] })(modelId as any);
    }

    case '@ai-sdk/google-vertex/anthropic':
    case '@ai-sdk/google-vertex/anthropic/edge': {
      const { createVertexAnthropic } = (SDK_CACHE['@ai-sdk/google-vertex/anthropic/edge'] ??= await import('@ai-sdk/google-vertex/anthropic/edge'));
      return createVertexAnthropic({ project: providerEnv['GOOGLE_VERTEX_PROJECT'], location: providerEnv['GOOGLE_VERTEX_LOCATION'] })(
        modelId as any
      );
    }

    case 'ai-gateway-provider': {
      const { createOpenAICompatible } = (SDK_CACHE['@ai-sdk/openai-compatible'] ??= await import('@ai-sdk/openai-compatible'));
      return createOpenAICompatible({
        name: providerId,
        includeUsage: true,
        supportsStructuredOutputs: opts.supportsStructuredOutputs,
        apiKey: providerEnv['CLOUDFLARE_API_TOKEN'],
        baseURL: `https://gateway.ai.cloudflare.com/v1/${providerEnv['CLOUDFLARE_ACCOUNT_ID']}/${providerEnv['CLOUDFLARE_GATEWAY_ID']}`,
      })(modelId as any);
    }

    default:
      return createGenericProvider(npm, opts);
  }
}

/**
 * Resolve the API key for a provider. Prefer the canonical env name from
 * PROVIDER_ENV_KEY_MAP; fall back to the first non-empty value so legacy
 * keys (e.g. GOOGLE_GENERATIVE_AI_API_KEY) still work after rename.
 */
function resolveProviderApiKey(providerId: string, providerEnv: Record<string, string>): string {
  const canonical = PROVIDER_ENV_KEY_MAP[providerId];
  if (canonical && providerEnv[canonical]) return providerEnv[canonical];
  for (const v of Object.values(providerEnv)) {
    if (v) return v;
  }
  return '';
}

/** Unified factory for openai, anthropic, xai, openrouter, google, openai-compatible */
async function createGenericProvider(
  npm: string | undefined,
  opts: { providerId: string; modelId: string; providerEnv: Record<string, string>; baseUrl?: string; supportsStructuredOutputs?: boolean }
) {
  const { providerId, modelId, providerEnv, baseUrl } = opts;

  const apiKey = resolveProviderApiKey(providerId, providerEnv);
  if (!apiKey) throw new Error(`API key not configured for ${providerId}`);

  const cfg: Record<string, unknown> = { name: providerId, apiKey };
  if (npm === '@ai-sdk/openai-compatible' || !npm) cfg.includeUsage = true;
  if (npm === '@ai-sdk/openai-compatible' || !npm) cfg.supportsStructuredOutputs = opts.supportsStructuredOutputs === true;
  if (baseUrl) cfg.baseURL = resolveApiUrl(baseUrl, providerEnv);

  const sdk = await loadSDK(npm || '@ai-sdk/openai-compatible');
  return sdk(cfg as any)(modelId as any);
}

async function loadSDK(npm: string): Promise<(cfg: Record<string, unknown>) => any> {
  switch (npm) {
    case '@ai-sdk/openai':
      return (SDK_CACHE['@ai-sdk/openai'] ??= await import('@ai-sdk/openai')).createOpenAI;
    case '@ai-sdk/anthropic':
      return (SDK_CACHE['@ai-sdk/anthropic'] ??= await import('@ai-sdk/anthropic')).createAnthropic;
    case '@ai-sdk/xai':
      return (SDK_CACHE['@ai-sdk/xai'] ??= await import('@ai-sdk/xai')).createXai;
    case '@openrouter/ai-sdk-provider':
      return (SDK_CACHE['@openrouter/ai-sdk-provider'] ??= await import('@openrouter/ai-sdk-provider')).createOpenRouter;
    case '@ai-sdk/google':
      return (SDK_CACHE['@ai-sdk/google'] ??= await import('@ai-sdk/google')).createGoogleGenerativeAI;
    default:
      return (SDK_CACHE['@ai-sdk/openai-compatible'] ??= await import('@ai-sdk/openai-compatible')).createOpenAICompatible;
  }
}

export async function createModel(selection: ModelSelect = resolveModelSelection()) {
  await preloadLLMRuntime();
  Zotero.debug('[zaibar-llm] createModel start');

  const v2 = addon.data.userProviderConfigV2;
  if (!v2) throw new Error('Model configuration is unavailable.');

  const { providerId, modelId } = selection;
  Zotero.debug('[zaibar-llm] createModel active=' + providerId + '/' + modelId);
  const providerEnv = v2.env[providerId] ?? {};
  const commonProvider = addon.data.commonProviders?.[providerId];
  const addedProvider = v2.addedProviders[providerId];

  let npm: string | undefined;
  let baseUrl: string | undefined;
  let resolvedModelId: string;

  if (commonProvider) {
    const model = commonProvider.models[modelId];
    if (!model && Object.keys(commonProvider.models).length > 0) {
      const userAdded = v2.addedModels.find((m) => m.providerId === providerId && m.id === modelId);
      if (!userAdded) throw new Error(`Model not found: ${modelId}`);
    }
    npm = commonProvider.npm;
    baseUrl = commonProvider.api;
    resolvedModelId = modelId;
  } else if (addedProvider) {
    const model = v2.addedModels.find((m) => m.providerId === providerId && m.id === modelId);
    if (!model?.name) throw new Error(`Model not found: ${modelId}`);
    if (!addedProvider.api) throw new Error(`Base URL not configured for ${providerId}`);
    baseUrl = addedProvider.api;
    resolvedModelId = model.id;
  } else {
    throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
  }

  Zotero.debug('[zaibar-llm] createModel provider npm=' + npm + ', baseUrl=' + (baseUrl ? 'yes' : 'no'));
  const supportsStructuredOutputs = getModelStructuredOutputSupport(selection) === true;
  const model = await createProvider(npm, {
    providerId,
    modelId: resolvedModelId,
    providerEnv,
    baseUrl,
    supportsStructuredOutputs,
  });
  Zotero.debug('[zaibar-llm] createModel done');
  return model;
}
