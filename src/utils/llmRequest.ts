import { getPref } from "./prefs";
import { UserProviderConfig, UserProviderModel } from "../types";

export interface Message {
  role: string;
  content: string;
}

export interface StreamCallbacks {
  onStart?: () => void;
  onUpdate?: (fullText: string) => Promise<void> | void;
  onError?: (error: string) => void;
}

const getAbortController = () => {
  if (typeof AbortController !== "undefined") return AbortController;
  return (Zotero.getMainWindow() as any).AbortController;
};

// TODO： 区分HTTP网络错误和API返回的错误信息，提供更具体的错误反馈。
/**
 * Send a streaming request to the LLM.
 * @param messages List of messages.
 * @param callbacks Callbacks for stream events.
 * @param refreshRate Update UI every N chunks.
 */
export async function streamLLM(
  messages: Message[],
  callbacks: StreamCallbacks,
  refreshRate: number = 5,
) {
  // Cancel previous request if exists
  if (addon.data.abortController) {
    addon.data.abortController.abort();
    addon.data.abortController = undefined;
  }

  const AC = getAbortController();
  const controller = new AC();
  addon.data.abortController = controller;

  try {
    const modelId = getPref("llm.modelId");
    if (!modelId) throw new Error("No model selected.");
    ztoolkit.log(`Using model ID: ${modelId}`);

    const configs = addon.data.userProviderConfigs || [];
    let provider: UserProviderConfig | undefined;
    let model: UserProviderModel | undefined;

    // Find model and provider
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

    // Remove trailing slash and append /chat/completions
    const url = provider.baseUrl.replace(/\/$/, "") + "/chat/completions";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: model.name,
        messages: messages,
        temperature: temp,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errText = await response.text();
      try {
        const json = JSON.parse(errText);
        if (json.error && json.error.message) errText = json.error.message;
      } catch {
        // use raw text
      }
      throw new Error(`API Error ${response.status}: ${errText}`);
    }

    if (!response.body) throw new Error("No response body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";
    let started = false;
    let count = 0;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") continue;

        try {
          const json = JSON.parse(dataStr);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            if (!started) {
              started = true;
              callbacks.onStart?.();
            }
            fullText += content;
            count++;
            if (count % refreshRate === 0) {
              await callbacks.onUpdate?.(fullText);
            }
          }
        } catch (e) {
          // Ignore parse errors for partial chunks
        }
      }
    }

    // Final update
    if (fullText) {
      await callbacks.onUpdate?.(fullText);
    }
  } catch (error: any) {
    if (error.name === "AbortError") {
      ztoolkit.log("LLM Request Cancelled");
      return;
    }
    callbacks.onError?.(error instanceof Error ? error.message : String(error));
  } finally {
    if (addon.data.abortController === controller) {
      addon.data.abortController = undefined;
    }
  }
}
