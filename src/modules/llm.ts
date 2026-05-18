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
import { Session } from './chatManager';
import { ModelMessage } from 'ai';
import { onLLMStreamEndV2, onLLMStreamErrorV2, onLLMStreamStartV2, onLLMStreamUpdateV2 } from './chatUI';
import { ensureWebStreamsGlobals } from '../utils/webStreamsGlobals';
import { resolveApiUrl } from '../utils/providers';
// import { JSONObject } from "@ai-sdk/provider";

const SDK_CACHE: Record<string, any> = {};

let streamTextFn: typeof import('ai').streamText | undefined;
let preloadLLMRuntimePromise: Promise<void> | undefined;

export async function preloadLLMRuntime() {
  if (!preloadLLMRuntimePromise) {
    preloadLLMRuntimePromise = (async () => {
      ensureWebStreamsGlobals();
      const ai = await import('ai');
      streamTextFn = ai.streamText;
    })().catch((error) => {
      preloadLLMRuntimePromise = undefined;
      throw error;
    });
  }

  await preloadLLMRuntimePromise;
}

export async function streamLLMV2(
  messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  // externalController?: InstanceType<typeof AbortController>,
  refreshRate: number = getRefreshRateFromPref()
) {
  let streamErrorHandled = false;

  try {
    await preloadLLMRuntime();
    onLLMStreamStartV2(session);
    const model = await createModel();

    const temp100 = getPref('llm.temperature100');
    const temp = temp100 / 100;
    const maxTokens = getPref('llm.maxTokens') || 2000;
    const messages = await messagesOrPromise;

    const providerOptions = {
      ...V2_PROVIDER_OPTIONS,
      google: getGoogleThinkingConfig(addon.data.userProviderConfigV2?.active?.modelId ?? ''),
    };

    const { textStream } = streamTextFn!({
      model: model,
      messages: messages,
      abortSignal: session.pending.abortController?.signal,
      temperature: temp,
      maxOutputTokens: maxTokens,
      providerOptions,
      onError: ({ error }: { error: unknown }) => {
        streamErrorHandled = true;
        handleStreamError(session, error);
      },
    });

    let fullText = '';
    let count = 0;

    for await (const textPart of textStream) {
      fullText += textPart;
      count++;
      if (count % refreshRate === 0) {
        await onLLMStreamUpdateV2({ session, fullText });
      }
    }

    await onLLMStreamUpdateV2({ session, fullText });
    onLLMStreamEndV2(session);
  } catch (error: any) {
    // Skip abort errors from intentional stop — treat as normal end
    if (error?.name === 'AbortError') {
      onLLMStreamEndV2(session);
      return;
    }
    // If onError already handled this, skip duplicate handling
    if (!streamErrorHandled) {
      handleStreamError(session, error);
    }
  } finally {
    // session.abortController = undefined;
  }
}

function buildErrorMessage(error: unknown): string {
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
const V2_PROVIDER_OPTIONS: Record<string, any> = {
  'alibaba-cn': { enable_thinking: false, enable_search: true },
  alibaba: { enable_thinking: false, enable_search: true },
  'alibaba-coding-plan': { enable_thinking: false, enable_search: true },
  'alibaba-coding-plan-cn': { enable_thinking: false, enable_search: true },
  zhipuai: { thinking: { type: 'disabled' } },
  'zhipuai-coding-plan': { thinking: { type: 'disabled' } },
  zai: { thinking: { type: 'disabled' } },
  'zai-coding-plan': { thinking: { type: 'disabled' } },
  'minimax-cn': { thinking: { type: 'disabled' } },
  // "minimax-cn": { thinking: { type: "adaptive" }, effort: "max" },
  anthropic: { thinking: { type: 'disabled' } },
};

/**
 * Gemini 3 系列使用 thinkingLevel 控制推理深度，
 * Gemini 2.5 系列使用 thinkingBudget 控制思考 token 数（-1 禁用）。
 */
function getGoogleThinkingConfig(modelId: string) {
  if (modelId.startsWith('gemini-3')) {
    return { thinkingLevel: 'low', includeThoughts: false };
  }
  if (modelId.startsWith('gemini-2.5')) {
    return { thinkingBudget: -1, includeThoughts: false };
  }
  return { thinkingBudget: 0, includeThoughts: false };
}

async function createProvider(
  npm: string | undefined,
  opts: {
    providerId: string;
    modelId: string;
    providerEnv: Record<string, string>;
    baseUrl?: string;
  }
) {
  const { providerId, modelId, providerEnv, baseUrl } = opts;

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
        apiKey: providerEnv['CLOUDFLARE_API_TOKEN'],
        baseURL: `https://gateway.ai.cloudflare.com/v1/${providerEnv['CLOUDFLARE_ACCOUNT_ID']}/${providerEnv['CLOUDFLARE_GATEWAY_ID']}`,
      })(modelId as any);
    }

    default:
      return createGenericProvider(npm, opts);
  }
}

/** Unified factory for openai, anthropic, xai, openrouter, google, openai-compatible */
async function createGenericProvider(
  npm: string | undefined,
  opts: { providerId: string; modelId: string; providerEnv: Record<string, string>; baseUrl?: string }
) {
  const { providerId, modelId, providerEnv, baseUrl } = opts;

  const apiKey = Object.values(providerEnv)[0];
  if (!apiKey) throw new Error(`API key not configured for ${providerId}`);

  const cfg: Record<string, unknown> = { name: providerId, apiKey };
  if (npm === '@ai-sdk/openai-compatible' || !npm) cfg.includeUsage = true;
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

async function createModel() {
  await preloadLLMRuntime();

  const v2 = addon.data.userProviderConfigV2;
  if (!v2?.active) throw new Error('No active model selected.');

  const { providerId, modelId } = v2.active;
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

  return await createProvider(npm, { providerId, modelId: resolvedModelId, providerEnv, baseUrl });
}

function getRefreshRateFromPref() {
  const speed = getPref('llm.streamUpdateSpeed');
  switch (speed) {
    case 'realtime':
      return 1;
    case 'fast':
      return 2;
    case 'performance':
      return 8;
    case 'default':
    default:
      return 4;
  }
}
