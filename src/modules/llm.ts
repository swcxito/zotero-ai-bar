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

import { getPref } from "../utils/prefs";
import { Session } from "./chatManager";
import { ModelMessage } from "ai";
import {
  onLLMStreamEndV2,
  onLLMStreamErrorV2,
  onLLMStreamStartV2,
  onLLMStreamUpdateV2,
} from "./chatUI";
import { ensureWebStreamsGlobals } from "../utils/webStreamsGlobals";
import { PROVIDER_ENV_KEY_MAP } from "../utils/providers";

type InstalledAISDKPackage =
  | "@ai-sdk/openai-compatible"
  | "@ai-sdk/amazon-bedrock"
  | "@ai-sdk/anthropic"
  | "@ai-sdk/azure"
  | "@ai-sdk/google"
  | "@ai-sdk/xai"
  | "@ai-sdk/openai"
  | "@openrouter/ai-sdk-provider";

type ProviderCreateFunction =
  | typeof import("@ai-sdk/openai-compatible").createOpenAICompatible
  | typeof import("@ai-sdk/amazon-bedrock").createAmazonBedrock
  | typeof import("@ai-sdk/anthropic").createAnthropic
  | typeof import("@ai-sdk/azure").createAzure
  | typeof import("@ai-sdk/google").createGoogleGenerativeAI
  | typeof import("@ai-sdk/xai").createXai
  | typeof import("@ai-sdk/openai").createOpenAI
  | typeof import("@openrouter/ai-sdk-provider").createOpenRouter;

type ProviderCreateFunctionMap = Partial<
  Record<InstalledAISDKPackage, ProviderCreateFunction>
>;

export const CREATE_PROVIDER_FNS: ProviderCreateFunctionMap = {};

let streamTextFn: typeof import("ai").streamText | undefined;
let preloadLLMRuntimePromise: Promise<void> | undefined;

export async function preloadLLMRuntime() {
  if (!preloadLLMRuntimePromise) {
    preloadLLMRuntimePromise = (async () => {
      ensureWebStreamsGlobals();

      const [
        ai,
        openaiCompatible,
        openai,
        amazonBedrock,
        anthropic,
        azure,
        google,
        xai,
        openrouter,
      ] = await Promise.all([
        import("ai"),
        import("@ai-sdk/openai-compatible"),
        import("@ai-sdk/openai"),
        import("@ai-sdk/amazon-bedrock"),
        import("@ai-sdk/anthropic"),
        import("@ai-sdk/azure"),
        import("@ai-sdk/google"),
        import("@ai-sdk/xai"),
        import("@openrouter/ai-sdk-provider"),
      ]);

      streamTextFn = ai.streamText;

      CREATE_PROVIDER_FNS["@ai-sdk/openai-compatible"] =
        openaiCompatible.createOpenAICompatible;
      CREATE_PROVIDER_FNS["@ai-sdk/openai"] = openai.createOpenAI;
      CREATE_PROVIDER_FNS["@ai-sdk/amazon-bedrock"] =
        amazonBedrock.createAmazonBedrock;
      CREATE_PROVIDER_FNS["@ai-sdk/anthropic"] = anthropic.createAnthropic;
      CREATE_PROVIDER_FNS["@ai-sdk/azure"] = azure.createAzure;
      CREATE_PROVIDER_FNS["@ai-sdk/google"] = google.createGoogleGenerativeAI;
      CREATE_PROVIDER_FNS["@ai-sdk/xai"] = xai.createXai;
      CREATE_PROVIDER_FNS["@openrouter/ai-sdk-provider"] =
        openrouter.createOpenRouter;
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
  refreshRate: number = getRefreshRateFromPref(),
) {
  try {
    await preloadLLMRuntime();
    onLLMStreamStartV2(session);
    const model = await createModel();

    const temp100 = getPref("llm.temperature100");
    const temp = temp100 / 100;
    const maxTokens = getPref("llm.maxTokens") || 2000;
    const messages = await messagesOrPromise;

    const { textStream } = streamTextFn!({
      model: model,
      messages: messages,
      abortSignal: session.pending.abortController?.signal,
      temperature: temp,
      maxOutputTokens: maxTokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerOptions: V2_PROVIDER_OPTIONS as any,
    });

    let fullText = "";
    let count = 0;

    for await (const textPart of textStream) {
      fullText += textPart;
      count++;
      if (count % refreshRate === 0) {
        await onLLMStreamUpdateV2({ session, fullText });
      }
    }

    // Final update - ensure all content including trailing newlines are flushed
    await onLLMStreamUpdateV2({ session, fullText });
    onLLMStreamEndV2(session);
  } catch (error: any) {
    onLLMStreamErrorV2({
      session,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // session.abortController = undefined;
  }
}

/**
 * Provider-specific options passed via streamText.
 * The AI SDK auto-routes options to the matching provider by namespace key.
 * Namespaces match the `name` param passed to createOpenAICompatible (v2 providerId).
 */
const V2_PROVIDER_OPTIONS: Record<string, Record<string, unknown>> = {
  "alibaba-cn": { enable_thinking: false, enable_search: true },
  alibaba: { enable_thinking: false, enable_search: true },
  "alibaba-coding-plan": { enable_thinking: false, enable_search: true },
  "alibaba-coding-plan-cn": { enable_thinking: false, enable_search: true },
  zhipuai: { thinking: { type: "disabled" } },
  "zhipuai-coding-plan": { thinking: { type: "disabled" } },
  zai: { thinking: { type: "disabled" } },
  "zai-coding-plan": { thinking: { type: "disabled" } },
  // "minimax-cn": { thinking: { type: "enabled" } },
};

function resolveSDKPackage(npm?: string): InstalledAISDKPackage {
  if (npm && npm in CREATE_PROVIDER_FNS) {
    return npm as InstalledAISDKPackage;
  }
  return "@ai-sdk/openai-compatible";
}

function createProvider(
  createFn: ProviderCreateFunction,
  sdkPackage: InstalledAISDKPackage,
  opts: { apiKey: string; baseUrl?: string; providerId: string; modelId: string },
) {
  if (sdkPackage === "@ai-sdk/openai" || sdkPackage === "@ai-sdk/openai-compatible") {
    const fn = createFn as typeof import("@ai-sdk/openai-compatible").createOpenAICompatible;
    if (!opts.baseUrl) throw new Error(`Base URL required for ${sdkPackage}`);
    return fn({
      name: opts.providerId,
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      includeUsage: true,
    })(opts.modelId);
  }
  // Native SDKs: anthropic, google, xai, openrouter, etc.
  const fn = createFn as (config: { apiKey: string; baseURL?: string }) => any;
  return fn({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
  })(opts.modelId);
}

async function createModel() {
  await preloadLLMRuntime();

  const v2 = addon.data.userProviderConfigV2;
  const providers = addon.data.commonProviders;
  if (!v2?.active || !providers) throw new Error("No active model selected.");

  const { providerId, modelId } = v2.active;
  const provider = providers[providerId];
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  const model = provider.models[modelId];
  if (!model) throw new Error(`Model not found: ${modelId}`);

  // Resolve API key from v2 env
  const envKey = PROVIDER_ENV_KEY_MAP[providerId] || "API_KEY";
  const apiKey = v2.env[providerId]?.[envKey];
  if (!apiKey) throw new Error(`API key not configured for ${providerId}`);

  const sdkPackage = resolveSDKPackage(provider.npm);
  const createFn = CREATE_PROVIDER_FNS[sdkPackage];
  if (!createFn) throw new Error(`Provider SDK not loaded: ${sdkPackage}`);

  const baseUrl = provider.api;

  return createProvider(createFn, sdkPackage, { apiKey, baseUrl, providerId, modelId });
}

function getRefreshRateFromPref() {
  const speed = getPref("llm.streamUpdateSpeed");
  switch (speed) {
    case "realtime":
      return 1;
    case "fast":
      return 2;
    case "performance":
      return 8;
    case "default":
    default:
      return 4;
  }
}
