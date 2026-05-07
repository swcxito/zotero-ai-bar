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
// import { JSONObject } from "@ai-sdk/provider";

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
  let streamErrorHandled = false;

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
      providerOptions: V2_PROVIDER_OPTIONS,
      onError: ({ error }: { error: unknown }) => {
        streamErrorHandled = true;
        handleStreamError(session, error);
      },
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

    await onLLMStreamUpdateV2({ session, fullText });
    onLLMStreamEndV2(session);
  } catch (error: any) {
    // Skip abort errors from intentional stop — treat as normal end
    if (error?.name === "AbortError") {
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
  if (typeof err?.message === "string" && err.message) {
    const label = err.name && err.name !== "Error" ? err.name : "";
    message = label ? `${label}: ${err.message}` : err.message;
  } else {
    message = String(error);
  }
  if (typeof err?.statusCode === "number") {
    message = `[HTTP ${err.statusCode}] ${message}`;
  }
  return message;
}

function handleStreamError(session: Session, error: unknown) {
  const message = buildErrorMessage(error);

  // Write error directly into the message pop DOM
  const pop = session.pending.messagePop;
  if (pop) {
    const contentEl = pop.querySelector(".chat-message-content");
    if (contentEl) {
      const escaped = message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      contentEl.innerHTML = `<div class="ai-bar-error-text">${escaped}</div>`;
    }
  }
  ztoolkit.log("LLM stream error:", session.id, message);

  // Delegate cleanup + edge cases (pop doesn't exist, window mode, etc.)
  try {
    onLLMStreamErrorV2({ session, error: message });
  } catch (e) {
    ztoolkit.log("onLLMStreamErrorV2 failed:", e);
  }
}

/**
 * Provider-specific options passed via streamText.
 * The AI SDK auto-routes options to the matching provider by namespace key.
 * Namespaces match the `name` param passed to createOpenAICompatible (v2 providerId).
 */
const V2_PROVIDER_OPTIONS: Record<string, any> = {
  "alibaba-cn": { enable_thinking: false, enable_search: true },
  alibaba: { enable_thinking: false, enable_search: true },
  "alibaba-coding-plan": { enable_thinking: false, enable_search: true },
  "alibaba-coding-plan-cn": { enable_thinking: false, enable_search: true },
  zhipuai: { thinking: { type: "disabled" } },
  "zhipuai-coding-plan": { thinking: { type: "disabled" } },
  zai: { thinking: { type: "disabled" } },
  "zai-coding-plan": { thinking: { type: "disabled" } },
  "minimax-cn": { thinking: { type: "disabled" } },
  // "minimax-cn": { thinking: { type: "adaptive" }, effort: "max" },
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
  opts: {
    apiKey: string;
    baseUrl?: string;
    providerId: string;
    modelId: string;
  },
) {
  if (sdkPackage === "@ai-sdk/openai-compatible") {
    const fn =
      createFn as typeof import("@ai-sdk/openai-compatible").createOpenAICompatible;
    if (!opts.baseUrl) throw new Error(`Base URL required for ${sdkPackage}`);
    return fn({
      name: opts.providerId,
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      includeUsage: true,
    })(opts.modelId);
  }
  // Native SDKs: openai, anthropic, google, xai, openrouter, etc.
  const fn = createFn as (config: {
    apiKey: string;
    name: string;
    baseURL?: string;
  }) => any;
  return fn({
    apiKey: opts.apiKey,
    name: opts.providerId,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
  })(opts.modelId);
}

async function createModel() {
  await preloadLLMRuntime();

  const v2 = addon.data.userProviderConfigV2;
  if (!v2?.active) throw new Error("No active model selected.");

  const { providerId, modelId } = v2.active;
  const commonProviders = addon.data.commonProviders;
  const provider = commonProviders?.[providerId];

  // V2 path: provider found in common_providers.json → use native SDK dispatch
  if (provider) {
    const model = provider.models[modelId];
    // Providers with empty models dict (openrouter, azure, etc.) accept
    // dynamic model IDs — proceed with the active modelId as-is.
    if (!model && Object.keys(provider.models).length > 0) {
      const userAdded = v2.addedModels.find(
        (m) => m.providerId === providerId && (m.id === modelId || m.name === modelId),
      );
      if (!userAdded) throw new Error(`Model not found: ${modelId}`);
    }

    const envKey = PROVIDER_ENV_KEY_MAP[providerId] || "API_KEY";
    const apiKey = v2.env[providerId]?.[envKey];
    if (!apiKey) throw new Error(`API key not configured for ${providerId}`);

    const sdkPackage = resolveSDKPackage(provider.npm);
    const createFn = CREATE_PROVIDER_FNS[sdkPackage];
    if (!createFn) throw new Error(`Provider SDK not loaded: ${sdkPackage}`);

    return createProvider(createFn, sdkPackage, {
      apiKey,
      baseUrl: provider.api,
      providerId,
      modelId,
    });
  }

  // V2 custom provider: not in commonProviders but in v2.addedProviders
  const addedProvider = v2.addedProviders[providerId];
  if (addedProvider) {
    const model = v2.addedModels.find(
      (m) =>
        m.providerId === providerId && (m.id === modelId || m.name === modelId),
    );
    if (!model?.name) throw new Error(`Model not found: ${modelId}`);

    const envValues = v2.env[providerId] ?? {};
    const apiKey = Object.values(envValues)[0];
    if (!apiKey) throw new Error(`API key not configured for ${providerId}`);

    const baseUrl = addedProvider.api;
    if (!baseUrl) throw new Error(`Base URL not configured for ${providerId}`);

    const createFn = CREATE_PROVIDER_FNS["@ai-sdk/openai-compatible"];
    if (!createFn) throw new Error("OpenAI-compatible SDK not loaded.");

    return createProvider(
      createFn as typeof import("@ai-sdk/openai-compatible").createOpenAICompatible,
      "@ai-sdk/openai-compatible",
      { apiKey, baseUrl, providerId, modelId: model.name },
    );
  }

  throw new Error(`Provider or model not found: ${providerId}/${modelId}`);
}

// export async function llmTest() {
//   ztoolkit.log("LLM test function called");
//   const fn = CREATE_PROVIDER_FNS["@ai-sdk/anthropic"] as typeof import("@ai-sdk/anthropic").createAnthropic | undefined;
//   if (fn && streamTextFn) {
//     try {
//       const minimax = fn({
//         apiKey:
//         baseURL: "https://api.minimaxi.com/anthropic/v1",
//         name: "minimax-cn",
//       });
//       const { textStream } = streamTextFn({
//         model: minimax("minimax-m2.7"),
//         prompt: "Write a poem about embedding models.",
//         providerOptions: V2_PROVIDER_OPTIONS,
//         onError: ({ error }: { error: unknown }) => {
//           const err = error as any;
//           ztoolkit.log("llmTest onError captured:");
//           ztoolkit.log("  name:", err?.name);
//           ztoolkit.log("  message:", err?.message);
//           ztoolkit.log("  statusCode:", err?.statusCode);
//           ztoolkit.log("  url:", err?.url);
//           ztoolkit.log("  requestBodyValues:", err?.requestBodyValues);
//           ztoolkit.log("  responseHeaders:", err?.responseHeaders);
//           ztoolkit.log("  responseBody:", err?.responseBody);
//         },
//       });
//
//       for await (const textPart of textStream) {
//         ztoolkit.log(textPart);
//       }
//       ztoolkit.log("llmTest completed successfully");
//     } catch (error: any) {
//       ztoolkit.log("llmTest error details:");
//       ztoolkit.log("  name:", error?.name);
//       ztoolkit.log("  message:", error?.message);
//       ztoolkit.log("  statusCode:", error?.statusCode);
//       ztoolkit.log("  url:", error?.url);
//       ztoolkit.log("  requestBody:", error?.requestBodyValues);
//       ztoolkit.log("  responseHeaders:", error?.responseHeaders);
//       ztoolkit.log("  responseBody:", error?.responseBody);
//       ztoolkit.log("  cause:", error?.cause);
//       ztoolkit.log("  full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
//     }
//   } else {
//     ztoolkit.log(fn, streamTextFn);
//   }
// }

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
