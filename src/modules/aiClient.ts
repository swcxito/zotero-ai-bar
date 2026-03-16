/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * aiClient.ts
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

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { ModelMessage } from "ai";
import { UserProviderConfig, UserProviderModel } from "../types";
import { getPref } from "../utils/prefs";

export type { ModelMessage as Message } from "ai";

export interface StreamCallbacks {
  onStart?: () => void;
  onUpdate?: (fullText: string) => Promise<void> | void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

const getAbortController = () => {
  if (typeof AbortController !== "undefined") return AbortController;
  return (Zotero.getMainWindow() as any).AbortController;
};

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

function applyProviderSpecificFlags(
  provider: UserProviderConfig,
  model: UserProviderModel,
  body: Record<string, unknown>,
) {
  if (provider.key === "ZHIPU" || provider.key === "ZAI") {
    body.thinking = { type: "disabled" };
  } else if (
    provider.key === "ALIBABA_CLOUD" &&
    model.name.startsWith("qwen")
  ) {
    body.enable_thinking = false;
    body.enable_search = true;
  } else if (provider.key === "MINIMAX") {
    body.reasoning_split = true;
  }
}

export async function streamChat(
  messagesOrPromise: ModelMessage[] | Promise<ModelMessage[]>,
  callbacks: StreamCallbacks,
  refreshRate: number = getRefreshRateFromPref(),
  externalController?: InstanceType<typeof AbortController>,
): Promise<void> {
  const AC = getAbortController();
  let controller: InstanceType<typeof AbortController>;
  let useGlobal: boolean;

  if (externalController) {
    controller = externalController;
    useGlobal = false;
  } else {
    if (addon.chatManager.abortController) {
      addon.chatManager.abortController.abort();
      addon.chatManager.abortController = undefined;
    }
    controller = new AC();
    addon.chatManager.abortController = controller;
    useGlobal = true;
  }

  try {
    callbacks.onStart?.();
    const messages = await messagesOrPromise;

    const modelId = getPref("llm.modelId");
    if (!modelId) throw new Error("No model selected.");
    ztoolkit.log(`Using model ID: ${modelId}`);

    const configs = addon.data.userProviderConfigs || [];
    let provider: UserProviderConfig | undefined;
    let model: UserProviderModel | undefined;

    for (const conf of configs) {
      if (conf.models) {
        const found = conf.models.find((m) => {
          ztoolkit.log(`Checking model ${m.id}`);
          return m.id === modelId;
        });
        if (found) {
          model = found;
          provider = conf;
          break;
        }
      }
    }

    if (!provider || !model) {
      throw new Error("Model config not found.");
    }
    if (!model.name) throw new Error("Model name is missing.");
    if (!provider.baseUrl) throw new Error("Base URL is missing.");
    if (!provider.apiKey) throw new Error("API Key is missing.");

    const temp100 = getPref("llm.temperature100");
    const temp = temp100 / 100;
    const maxTokens = getPref("llm.maxTokens") || 2000;

    const client = createOpenAICompatible({
      baseURL: provider.baseUrl.replace(/\/$/, ""),
      name: provider.name || provider.key || "openai-compatible",
      apiKey: provider.apiKey,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      fetch: async (input, init) => {
        let nextInit = init;

        if (init?.body && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body) as Record<string, unknown>;
            applyProviderSpecificFlags(provider, model, parsed);
            nextInit = {
              ...init,
              body: JSON.stringify(parsed),
            };
          } catch {}
        }

        return fetch(input, nextInit);
      },
    });

    const result = streamText({
      model: client.chatModel(model.name),
      messages,
      temperature: temp,
      maxOutputTokens: maxTokens,
      abortSignal: controller.signal,
    });

    let fullText = "";
    let started = false;
    let count = 0;

    for await (const textPart of result.textStream) {
      if (!textPart) continue;
      started = true;
      fullText += textPart;
      count++;

      if (count % refreshRate === 0) {
        await callbacks.onUpdate?.(fullText);
      }
    }

    if (fullText || started) {
      await callbacks.onUpdate?.(fullText);
    }
    callbacks.onEnd?.();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      ztoolkit.log("LLM Request Cancelled");
      callbacks.onEnd?.();
      return;
    }
    callbacks.onError?.(error instanceof Error ? error.message : String(error));
  } finally {
    if (useGlobal && addon.chatManager.abortController === controller) {
      addon.chatManager.abortController = undefined;
    }
  }
}
