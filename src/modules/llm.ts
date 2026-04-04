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
import type { UserProviderConfig, UserProviderModel } from "../types";
import { Session } from "./chatManager";
import { ModelMessage } from "ai";
import {
  onLLMStreamEndV2,
  onLLMStreamErrorV2,
  onLLMStreamStartV2,
  onLLMStreamUpdateV2,
} from "./chatUI";
import { ensureWebStreamsGlobals } from "../utils/webStreamsGlobals";

export async function streamLLMV2(
  messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  // externalController?: InstanceType<typeof AbortController>,
  refreshRate: number = getRefreshRateFromPref(),
) {
  try {
    ensureWebStreamsGlobals();
    const { streamText } = await import("ai");
    onLLMStreamStartV2(session);
    const model = await createModel();

    const temp100 = getPref("llm.temperature100");
    const temp = temp100 / 100;
    const maxTokens = getPref("llm.maxTokens") || 2000;
    const messages = await messagesOrPromise;

    const { textStream } = streamText({
      model: model,
      messages: messages,
      abortSignal: session.pending.abortController?.signal,
      temperature: temp,
      maxOutputTokens: maxTokens,
    });

    // if (provider.key === "ZHIPU" || provider.key === "ZAI") {
    //   body.thinking = { type: "disabled" };
    // } else if (
    //   provider.key === "ALIBABA_CLOUD" &&
    //   model.name.startsWith("qwen")
    // ) {
    //   body.enable_thinking = false;
    //   body.enable_search = true;
    // } else if (provider.key === "MINIMAX") {
    //   body.reasoning_split = true;
    // }

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

async function createModel() {
  const modelId = getPref("llm.modelId");
  if (!modelId) throw new Error("No model selected.");
  ztoolkit.log(`Using model ID: ${modelId}`);

  const configs = addon.data.userProviderConfigs || [];
  let providerConfig: UserProviderConfig | undefined;
  let modelConfig: UserProviderModel | undefined;

  // Find model and provider
  for (const conf of configs) {
    if (conf.models) {
      const found = conf.models.find((m) => {
        // ztoolkit.log(`Checking model ${m.id}`);
        return m.id === modelId;
      });
      if (found) {
        modelConfig = found;
        providerConfig = conf;
        break;
      }
    }
  }

  if (!providerConfig || !modelConfig) {
    throw new Error("Model config not found.");
  }
  if (!modelConfig.name) throw new Error("Model name is missing.");
  if (!providerConfig.baseUrl) throw new Error("Base URL is missing.");
  if (!providerConfig.apiKey) throw new Error("API Key is missing.");

  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const provider = createOpenAICompatible({
    name: providerConfig.name,
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseUrl,
    includeUsage: true, // Include usage information in streaming responses
  });
  return provider(modelConfig.name);
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
