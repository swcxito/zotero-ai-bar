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

import { getPref } from '../utils/prefs';
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
  clearTranslationPreviewV2,
} from './chatUI';
import { ensureWebStreamsGlobals } from '../utils/webStreamsGlobals';
import { getActiveModelStructuredOutputSupport, PROVIDER_ENV_KEY_MAP, resolveApiUrl, type Model } from '../utils/providers';
import { buildTools } from './agentTools';
import {
  extractTranslationFallback,
  normalizeTranslationResultCandidate,
  repairTranslationResult,
  translationResultSchema,
  type TranslationRequestMeta,
  type TranslationResult,
} from '../utils/translation';
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

export async function streamLLMV2(
  messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  // externalController?: InstanceType<typeof AbortController>,
  refreshRate: number = getRefreshRateFromPref()
) {
  Zotero.debug('[zaibar-llm] streamLLMV2 started, session=' + session.id);
  let streamErrorHandled = false;

  try {
    await preloadLLMRuntime();
    onLLMStreamStartV2(session);
    const model = await createModel();
    Zotero.debug(
      '[zaibar-llm] model created: ' +
        (addon.data.userProviderConfigV2?.active?.providerId || '?') +
        '/' +
        (addon.data.userProviderConfigV2?.active?.modelId || '?')
    );

    const modelSettings = buildModelSettings();
    const messages = await messagesOrPromise;
    Zotero.debug('[zaibar-llm] messages count=' + messages.length);

    const activeProviderId = addon.data.userProviderConfigV2?.active?.providerId ?? '';
    const providerOptions: Record<string, any> = {};
    for (const [k, v] of Object.entries(V2_PROVIDER_OPTIONS)) {
      providerOptions[k] = v;
    }
    const effectiveEffort = session.pending.thinkingEffortOverride ?? session.thinkingEffort;
    providerOptions.google = getGoogleThinkingConfig(addon.data.userProviderConfigV2?.active?.modelId ?? '', effectiveEffort);
    const thinkingOpts = getThinkingProviderOptions(activeProviderId, effectiveEffort);
    if (thinkingOpts && activeProviderId) {
      providerOptions[activeProviderId] = {
        ...providerOptions[activeProviderId],
        ...thinkingOpts,
      };
    }

    // Thinking models consume part of maxOutputTokens for reasoning tokens.
    // If the budget equals or exceeds maxOutputTokens, the API returns only
    // reasoning with no text output (Anthropic enforces budget_tokens <
    // max_tokens; OpenAI o-series counts reasoning against
    // max_completion_tokens; Google counts against maxOutputTokens).
    // Bump maxOutputTokens to leave room for actual output when thinking is on.
    let maxOutputTokens = getPref('llm.maxTokens') || 2000;
    const anthropicBudget = (thinkingOpts as any)?.thinking?.budgetTokens;
    const googleBudget = (providerOptions.google as any)?.thinkingBudget;
    const thinkingBudget = (typeof anthropicBudget === 'number' ? anthropicBudget : 0) + (typeof googleBudget === 'number' ? googleBudget : 0);
    const hasThinking = effectiveEffort !== 'none';
    if (hasThinking && maxOutputTokens <= thinkingBudget) {
      maxOutputTokens = thinkingBudget + 2000;
    }
    // For OpenAI o-series and Alibaba, which don't expose an explicit budget
    // but still consume maxOutputTokens for reasoning, ensure a minimum headroom
    // when thinking is enabled at medium or higher effort.
    if (hasThinking && effectiveEffort !== 'low' && (activeProviderId === 'openai' || activeProviderId === 'openrouter')) {
      const minHeadroom = effectiveEffort === 'xhigh' ? 16000 : effectiveEffort === 'high' ? 10000 : 6000;
      if (maxOutputTokens < minHeadroom) maxOutputTokens = minHeadroom;
    }
    Zotero.debug(
      '[zaibar-llm] maxOutputTokens=' +
        maxOutputTokens +
        ', thinkingBudget=' +
        thinkingBudget +
        ', effort=' +
        effectiveEffort +
        ', provider=' +
        activeProviderId
    );

    const agentEnabled = session.chatMode === 'agent';
    const tools = agentEnabled ? buildTools() : undefined;
    ztoolkit.log('[llm] agentEnabled:', agentEnabled, 'tools:', Object.keys(tools ?? {}));
    Zotero.debug('[zaibar-llm] agentEnabled=' + agentEnabled + ', toolCount=' + Object.keys(tools ?? {}).length);

    if (agentEnabled) {
      Zotero.debug('[zaibar-llm] using ToolLoopAgent');

      // System prompt is passed as agent instructions; remaining messages are
      // the conversation history plus the current user message.
      const systemMessage = session.pending.systemMessage;
      const conversationMessages = messages.filter((m) => m.role !== 'system');

      const agent = new ToolLoopAgent({
        model,
        instructions: systemMessage?.content,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(MAX_AGENT_ITERATIONS),
        experimental_context: session,
        providerOptions,
        maxOutputTokens: maxOutputTokens,
        maxRetries: 2,
      });

      const result = await agent.stream({
        messages: conversationMessages,
        abortSignal: session.pending.abortController?.signal,
      });

      session.pending.isAgentMode = true;
      await consumeAgentStream(session, result, refreshRate);
    } else {
      Zotero.debug('[zaibar-llm] consuming full stream');
      // The system message is built by us from item metadata + stable
      // instructions (no user input), so the prompt-injection risk the SDK
      // warns about doesn't apply here. Keep it in `messages` and explicitly
      // allow it — some openai-compatible providers don't handle the separate
      // `system` option consistently, which produced empty replies.
      const result = streamTextFn!({
        model: model,
        messages: messages,
        allowSystemInMessages: true,
        abortSignal: session.pending.abortController?.signal,
        ...modelSettings,
        maxOutputTokens: maxOutputTokens,
        providerOptions,
        onError: ({ error }: { error: unknown }) => {
          streamErrorHandled = true;
          Zotero.debug('[zaibar-llm] streamText onError: ' + (error as any)?.message);
          handleStreamError(session, error);
        },
      });

      let fullText = '';
      let count = 0;
      let streamPartError: string | undefined;

      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'reasoning-start':
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
            count++;
            if (count % refreshRate === 0) {
              await onLLMStreamUpdateV2({ session, fullText });
            }
            break;
          case 'error': {
            // AI SDK v6 emits terminal stream errors as an `error` part rather
            // than via onError. Without this case the error is silently
            // dropped and the user sees reasoning with no final output.
            const errObj = (part as any)?.error ?? part;
            streamPartError = buildErrorMessage(errObj);
            Zotero.debug('[zaibar-llm] streamText error part: ' + streamPartError);
            break;
          }
          default:
            Zotero.debug('[zaibar-llm] unhandled stream part type: ' + part.type);
            break;
        }
      }

      if (streamPartError && !streamErrorHandled) {
        streamErrorHandled = true;
        handleStreamError(session, streamPartError);
      }

      if (!streamErrorHandled) {
        await onLLMStreamUpdateV2({ session, fullText, force: true });
        let usage: any;
        try {
          usage = await result.usage;
        } catch (e: any) {
          Zotero.debug('[zaibar-llm] usage fetch failed: ' + (e?.message || e));
        }
        onLLMStreamEndV2(session, usage);
      }
    }
  } catch (error: any) {
    Zotero.debug('[zaibar-llm] streamLLMV2 catch: ' + (error?.name || '') + ' ' + (error?.message || error));
    // Abort from intentional stop: use the normal-end handler for UI cleanup
    // but signal `aborted` so the partial turn isn't recorded in history.
    if (error?.name === 'AbortError') {
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
  try {
    await preloadLLMRuntime();
    onLLMStreamStartV2(session);
    const model = await createModel();
    const messages = await messagesOrPromise;
    const chatThinkingEffort = session.pending.thinkingEffortOverride ?? session.thinkingEffort;
    const translationThinkingDepth = getPref('translate.thinkingDepth') === 'follow-chat' ? 'follow-chat' : 'minimum';
    const effectiveEffort = resolveTranslationThinkingEffort(translationThinkingDepth, chatThinkingEffort);
    const providerOptions = buildProviderOptions(effectiveEffort);
    const maxOutputTokens = getMaxOutputTokensWithThinkingHeadroom(effectiveEffort, providerOptions);
    const declaredStructuredSupport = getActiveModelStructuredOutputSupport();
    logTranslationDebug('request-start', {
      model: getActiveModelKey(),
      declaredStructuredSupport,
      selectedTextLength: request.selectedText.length,
      targetLanguage: request.targetLanguage,
      chatMode: session.chatMode,
      translationThinkingDepth,
      thinkingEffort: effectiveEffort,
    });

    const first = await runTranslationAttempt({
      model,
      messages,
      session,
      providerOptions,
      maxOutputTokens,
      strict: false,
      selectedText: request.selectedText,
    });
    if (finishAbortedTranslation(session)) return;
    const firstOutput = first.output ?? repairTranslationResult(first.rawText);
    logTranslationAttempt('first-attempt-finished', first, firstOutput);
    if (firstOutput) {
      onTranslationResultV2(session, normalizeTranslationOriginal(firstOutput, request.selectedText));
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
      strict: true,
      selectedText: request.selectedText,
    });
    if (finishAbortedTranslation(session)) return;
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
    clearTranslationPreviewV2(session);
    await onLLMStreamUpdateV2({ session, fullText: fallback, force: true });
    onLLMStreamEndV2(session, second.usage ?? first.usage);
  } catch (error: any) {
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

function finishAbortedTranslation(session: Session): boolean {
  if (!session.pending.abortController?.signal.aborted) return false;
  logTranslationDebug('request-aborted');
  onLLMStreamEndV2(session, undefined, true);
  return true;
}

function isTranslationAbort(session: Session, error: unknown): boolean {
  if (session.pending.abortController?.signal.aborted) return true;
  const name = String((error as any)?.name ?? '');
  return name === 'AbortError' || name === 'AI_AbortError';
}

async function runTranslationAttempt(params: {
  model: any;
  messages: ModelMessage[];
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens: number;
  strict: boolean;
  selectedText: string;
}): Promise<TranslationAttempt> {
  const modelKey = getActiveModelKey();
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

async function runSchemaTranslationAttempt(params: {
  model: any;
  messages: ModelMessage[];
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens: number;
  strict: boolean;
  selectedText: string;
}): Promise<TranslationAttempt> {
  let streamError: unknown;
  let partialUpdateCount = 0;
  const prompt = buildDedicatedTranslationPrompt(params.messages, params.strict, false);
  const result = streamTextFn!({
    model: params.model,
    system: prompt.system,
    messages: prompt.messages,
    abortSignal: params.session.pending.abortController?.signal,
    ...buildModelSettings(),
    maxOutputTokens: params.maxOutputTokens,
    providerOptions: params.providerOptions,
    maxRetries: 2,
    output: Output.object({
      schema: translationResultSchema,
      name: 'translation_result',
      description: 'A validated translation result classified as word, abbreviation, or text.',
    }),
    onError: ({ error }: { error: unknown }) => {
      streamError = error;
    },
  });

  let rawText = '';
  let partialTranslatedText: string | undefined;
  let partialOutput: Record<string, any> | undefined;
  let reasoningActive = false;
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'reasoning-start':
        if (!reasoningActive) {
          reasoningActive = true;
          onReasoningStartV2(params.session);
          logTranslationDebug('reasoning-start', { strict: params.strict });
        }
        break;
      case 'reasoning-delta':
        // Some compatible providers emit deltas without explicit boundaries.
        if (!reasoningActive) {
          reasoningActive = true;
          onReasoningStartV2(params.session);
          logTranslationDebug('reasoning-start-from-delta', { strict: params.strict });
        }
        onReasoningDeltaV2(params.session, part.text);
        break;
      case 'reasoning-end':
        if (reasoningActive) {
          reasoningActive = false;
          onReasoningEndV2(params.session);
          logTranslationDebug('reasoning-end', { strict: params.strict });
        }
        break;
      case 'text-delta': {
        rawText += part.text;
        const objectStart = rawText.indexOf('{');
        const partialSource = objectStart >= 0 ? rawText.slice(objectStart) : rawText;
        const partial = await parsePartialJson(partialSource);
        if (partial.value && typeof partial.value === 'object' && !Array.isArray(partial.value)) {
          partialUpdateCount++;
          partialOutput = partial.value as Record<string, any>;
          if (partialUpdateCount === 1) {
            logTranslationDebug('response-format-first-partial', {
              strict: params.strict,
              keys: Object.keys(partialOutput),
            });
          }
          if (typeof (partial.value as any).translatedText === 'string' && (partial.value as any).translatedText.trim()) {
            partialTranslatedText = (partial.value as any).translatedText;
          }
          onTranslationPartialV2(params.session, {
            ...(partial.value as Record<string, any>),
            originalText: params.selectedText,
          });
        }
        break;
      }
      case 'error':
        streamError = (part as any).error ?? part;
        break;
    }
  }
  if (reasoningActive) onReasoningEndV2(params.session);
  if (streamError) throw streamError;

  let output: TranslationResult | undefined;
  try {
    output = (await result.output) as TranslationResult;
  } catch (error) {
    Zotero.debug('[zaibar-llm] translation output validation failed: ' + buildErrorMessage(error));
    logTranslationDebug('response-format-validation-failed', {
      strict: params.strict,
      error: buildErrorMessage(error),
      rawTextLength: rawText.length,
      rawTextPreview: previewTranslationRawText(rawText),
      partialUpdateCount,
      partialKeys: partialOutput ? Object.keys(partialOutput) : [],
    });
  }

  let usage: any;
  try {
    usage = await result.usage;
  } catch {
    // Usage is optional and must not turn a valid translation into an error.
  }
  let warnings: unknown;
  try {
    warnings = await result.warnings;
  } catch {
    // Warnings are advisory only.
  }
  if (warnings) {
    logTranslationDebug('response-format-warnings', {
      strict: params.strict,
      warnings: previewTranslationRawText(safeStringify(warnings)),
    });
  }
  const attempt = { output, rawText, partialTranslatedText, partialOutput, usage };
  logTranslationDebug('response-format-attempt-complete', {
    strict: params.strict,
    partialUpdateCount,
    ...describeTranslationAttempt(attempt),
  });
  return attempt;
}

/**
 * Compatibility path for models that reject response_format=json_object.
 * JSON is streamed as ordinary text, repaired incrementally by the AI SDK,
 * and never rendered directly.
 */
async function runJsonTextTranslationAttempt(params: {
  model: any;
  messages: ModelMessage[];
  session: Session;
  providerOptions: Record<string, any>;
  maxOutputTokens: number;
  strict: boolean;
  selectedText: string;
}): Promise<TranslationAttempt> {
  let streamError: unknown;
  let textDeltaCount = 0;
  let partialParseCount = 0;
  let failedPartialParseCount = 0;
  let reasoningActive = false;
  const prompt = buildDedicatedTranslationPrompt(params.messages, params.strict, true);
  const result = streamTextFn!({
    model: params.model,
    system: prompt.system,
    messages: prompt.messages,
    abortSignal: params.session.pending.abortController?.signal,
    ...buildModelSettings(),
    maxOutputTokens: params.maxOutputTokens,
    providerOptions: params.providerOptions,
    maxRetries: 2,
    onError: ({ error }: { error: unknown }) => {
      streamError = error;
    },
  });

  let rawText = '';
  let partialTranslatedText: string | undefined;
  let partialOutput: Record<string, any> | undefined;
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'reasoning-start':
        if (!reasoningActive) {
          reasoningActive = true;
          onReasoningStartV2(params.session);
          logTranslationDebug('reasoning-start', { strict: params.strict, path: 'json-text' });
        }
        continue;
      case 'reasoning-delta':
        if (!reasoningActive) {
          reasoningActive = true;
          onReasoningStartV2(params.session);
          logTranslationDebug('reasoning-start-from-delta', { strict: params.strict, path: 'json-text' });
        }
        onReasoningDeltaV2(params.session, part.text);
        continue;
      case 'reasoning-end':
        if (reasoningActive) {
          reasoningActive = false;
          onReasoningEndV2(params.session);
          logTranslationDebug('reasoning-end', { strict: params.strict, path: 'json-text' });
        }
        continue;
      case 'error':
        streamError = (part as any).error ?? part;
        continue;
    }
    if (part.type !== 'text-delta') continue;
    textDeltaCount++;
    if (textDeltaCount === 1) {
      logTranslationDebug('json-text-first-delta', { strict: params.strict, deltaLength: part.text.length });
    }
    rawText += part.text;
    const objectStart = rawText.indexOf('{');
    const partialSource = objectStart >= 0 ? rawText.slice(objectStart) : rawText;
    const partial = await parsePartialJson(partialSource);
    if (partial.state === 'failed-parse') failedPartialParseCount++;
    if (partial.value && typeof partial.value === 'object' && !Array.isArray(partial.value)) {
      partialParseCount++;
      partialOutput = partial.value as Record<string, any>;
      if (typeof (partial.value as any).translatedText === 'string' && (partial.value as any).translatedText.trim()) {
        partialTranslatedText = (partial.value as any).translatedText;
      }
      onTranslationPartialV2(params.session, {
        ...(partial.value as Record<string, any>),
        originalText: params.selectedText,
      });
    }
  }
  if (reasoningActive) onReasoningEndV2(params.session);
  if (streamError) throw streamError;

  let usage: any;
  try {
    usage = await result.usage;
  } catch {
    // Usage is optional.
  }
  const attempt = { output: repairTranslationResult(rawText), rawText, partialTranslatedText, partialOutput, usage };
  logTranslationDebug('json-text-attempt-complete', {
    strict: params.strict,
    textDeltaCount,
    partialParseCount,
    failedPartialParseCount,
    ...describeTranslationAttempt(attempt),
  });
  return attempt;
}

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
    rawTextLength: attempt.rawText.length,
    rawTextPreview: previewTranslationRawText(attempt.rawText),
    partialTranslatedTextLength: attempt.partialTranslatedText?.length ?? 0,
    partialKeys: attempt.partialOutput ? Object.keys(attempt.partialOutput) : [],
  };
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
    'Required fields: "textType" and "translatedText". "originalText" and "targetLanguage" are optional.',
    '"textType" must be "word", "abbreviation", or "text".',
    'Write all translatable natural-language fields in the requested target language, including "translatedText", "explanation", and every "otherMeanings[].translatedText". Keep only "originalText", source-language "pronunciation", source-language "fullForm", and English POS abbreviations untranslated.',
    'For "word", "translatedText" must be a concise dictionary-style equivalent in the target language, never the original word or an explanatory sentence.',
    'For "word", include the source-language "pronunciation" and English-abbreviated "pos" when available.',
    'For "word", include "explanation" only when the meaning is specialized, technical, domain-specific, idiomatic, non-literal, or cannot be adequately conveyed by "translatedText" alone. Omit "explanation" for ordinary dictionary meanings and avoid boilerplate such as "in this context".',
    'Every "pos" must use a conventional English abbreviation such as "n.", "v.", "vt.", "vi.", "adj.", "adv.", "prep.", "pron.", or "conj."; never use a full word or a translated label.',
    'If present, "otherMeanings" must be an array of objects shaped exactly as {"pos":"...","translatedText":"..."}; never return a string or an array of strings.',
    'For "abbreviation", both "fullForm" and "explanation" are required. Keep "fullForm" in its source language and write "translatedText" and "explanation" in the requested target language.',
    'For "text", return a fluent, accurate, academic translation and omit dictionary-only fields.',
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

function getActiveModelKey(): string {
  const active = addon.data.userProviderConfigV2?.active;
  return active ? `${active.providerId}::${active.modelId}` : 'unknown';
}

function isJsonResponseFormatCompatibilityError(error: unknown): boolean {
  const message = buildErrorMessage(error).toLowerCase();
  const mentionsJsonMode = message.includes('response_format') || message.includes('json_object');
  const incompatible =
    message.includes('not supported') ||
    message.includes('unsupported') ||
    message.includes('not valid') ||
    message.includes('invalidparameter') ||
    message.includes("must contain the word 'json'");
  return mentionsJsonMode && incompatible;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeTranslationOriginal(output: TranslationResult, selectedText: string): TranslationResult {
  return normalizeTranslationResultCandidate(output, selectedText) ?? ({ ...output, originalText: selectedText } as TranslationResult);
}

function buildProviderOptions(effort: Session['thinkingEffort']): Record<string, any> {
  const activeProviderId = addon.data.userProviderConfigV2?.active?.providerId ?? '';
  const providerOptions: Record<string, any> = { ...V2_PROVIDER_OPTIONS };
  providerOptions.google = getGoogleThinkingConfig(addon.data.userProviderConfigV2?.active?.modelId ?? '', effort);
  const thinkingOpts = getThinkingProviderOptions(activeProviderId, effort);
  if (thinkingOpts && activeProviderId) {
    providerOptions[activeProviderId] = {
      ...providerOptions[activeProviderId],
      ...thinkingOpts,
    };
  }
  return providerOptions;
}

function resolveTranslationThinkingEffort(depth: 'minimum' | 'follow-chat', chatEffort: Session['thinkingEffort']): Session['thinkingEffort'] {
  if (depth === 'follow-chat') return chatEffort;

  // Non-reasoning models have nothing to disable. For reasoning models,
  // explicitly disable thinking where supported; otherwise use the lowest
  // reasoning level exposed by the provider.
  if (getActiveModelMetadata()?.reasoning !== true) return 'none';
  const providerId = addon.data.userProviderConfigV2?.active?.providerId ?? '';
  return providerCanDisableThinking(providerId) ? 'none' : 'low';
}

function providerCanDisableThinking(providerId: string): boolean {
  if (providerId === 'google' || providerId.startsWith('google-vertex')) {
    const modelId = (addon.data.userProviderConfigV2?.active?.modelId ?? '').toLowerCase();
    // Gemini 3 and Gemini 2.5 Pro expose a minimum thinking level rather
    // than a true off state. Flash-family models accept thinkingBudget=0.
    return !modelId.startsWith('gemini-3') && !modelId.includes('gemini-2.5-pro');
  }
  return getThinkingProviderOptions(providerId, 'none') !== undefined;
}

function getMaxOutputTokensWithThinkingHeadroom(effort: Session['thinkingEffort'], providerOptions: Record<string, any>): number {
  let maxOutputTokens = getPref('llm.maxTokens') || 2000;
  const activeProviderId = addon.data.userProviderConfigV2?.active?.providerId ?? '';
  const providerThinking = activeProviderId ? providerOptions[activeProviderId] : undefined;
  const anthropicBudget = providerThinking?.thinking?.budgetTokens;
  const googleBudget = providerOptions.google?.thinkingBudget;
  const thinkingBudget = (typeof anthropicBudget === 'number' ? anthropicBudget : 0) + (typeof googleBudget === 'number' ? googleBudget : 0);
  if (effort !== 'none' && maxOutputTokens <= thinkingBudget) maxOutputTokens = thinkingBudget + 2000;
  if (effort !== 'none' && effort !== 'low' && (activeProviderId === 'openai' || activeProviderId === 'openrouter')) {
    const minHeadroom = effort === 'xhigh' ? 16000 : effort === 'high' ? 10000 : 6000;
    if (maxOutputTokens < minHeadroom) maxOutputTokens = minHeadroom;
  }
  return maxOutputTokens;
}

function buildModelSettings() {
  const temperatureEnabled = getPref('llm.temperatureEnabled');
  if (!temperatureEnabled) {
    Zotero.debug('[zaibar-llm] temperature disabled by user setting');
    return {};
  }
  const temp100 = getPref('llm.temperature100');
  const modelMetadata = getActiveModelMetadata();
  if (modelMetadata?.temperature === false) {
    Zotero.debug('[zaibar-llm] temperature disabled for active model');
    return {};
  }
  return { temperature: temp100 / 100 };
}

function getActiveModelMetadata(): Model | undefined {
  const v2 = addon.data.userProviderConfigV2;
  const active = v2?.active;
  if (!active) return undefined;

  return (
    addon.data.commonProviders?.[active.providerId]?.models[active.modelId] ??
    v2?.addedModels.find((model) => model.providerId === active.providerId && model.id === active.modelId)
  );
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

export async function createModel() {
  await preloadLLMRuntime();
  Zotero.debug('[zaibar-llm] createModel start');

  const v2 = addon.data.userProviderConfigV2;
  if (!v2?.active) throw new Error('No active model selected.');

  const { providerId, modelId } = v2.active;
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
  const supportsStructuredOutputs = getActiveModelStructuredOutputSupport() === true;
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

function getRefreshRateFromPref() {
  const speed = getPref('llm.streamUpdateSpeed');
  switch (speed) {
    case 'realtime':
      return 1;
    case 'default':
      return 2;
    case 'slow':
      return 4;
    case 'performance':
      return 8;
    default:
      return 2;
  }
}
