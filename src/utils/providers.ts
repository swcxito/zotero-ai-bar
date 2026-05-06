/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * providers.ts
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

// 基于 common_providers.json 生成的 TypeScript 类型定义
// 包含 25 个 providers 和 763 个 models

import { config } from "../../package.json";
import type { UserProviderConfig } from "../types";

/** 模态类型 */
export type ModalityType = "audio" | "image" | "pdf" | "text" | "video";

/** 模型状态 */
export type ModelStatus = "beta" | "deprecated" | "preview";

/** 模态配置 */
export interface Modalities {
  input: ModalityType[];
  output: ModalityType[];
}

/** 交错的 reasoning 配置 */
export interface InterleavedConfig {
  field: string;
}

/** Provider 覆盖配置 */
export interface ProviderOverride {
  npm: string;
  api: string;
}

/** 成本配置 */
export interface CostConfig {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  input_audio?: number;
  output_audio?: number;
  reasoning?: number;
  context_over_200k?: {
    input: number;
    output: number;
    cache_read?: number;
  };
  // 其他可能的成本字段
  [key: string]: number | object | undefined;
}

/** 限制配置 */
export interface LimitConfig {
  context: number;
  output: number;
  input?: number;
}

/** 模型定义 */
export interface Model {
  id: string;
  name: string;
  family: ModelFamily;
  attachment?: boolean;
  reasoning: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities: Modalities;
  open_weights: boolean;
  cost: CostConfig;
  limit: LimitConfig;
  interleaved?: InterleavedConfig;
  provider?: ProviderOverride;
  status?: ModelStatus;
}

/** Provider 定义 */
export interface Provider {
  id: ProviderId;
  env: string[];
  npm?: string;
  name: string;
  api?: string;
  doc?: string;
  models: Record<string, Model>;
}

/** Common Providers 配置 */
export type CommonProviders = Record<ProviderId, Provider>;
interface ModelSelect {
  providerId: ProviderId;
  modelId: string;
  active?: boolean;
}
export interface UserProviderConfigV2 {
  active?: ModelSelect;
  env: Record<ProviderId, Record<string, string>>;
  recentUsed: Array<ModelSelect>;
  addedModels: Array<ModelSelect>;
}

export interface ConvertLLMConfigResult {
  userProviderConfigV2: UserProviderConfigV2;
  legacyCustomProviderConfigs: UserProviderConfig[];
}

const PROVIDER_KEY_TO_ID: Record<string, ProviderId> = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE_CLOUD: "google",
  ALIBABA_CLOUD: "alibaba-cn",
  OPENROUTER: "openrouter",
  ZHIPU: "zhipuai",
  ZAI: "zai",
  DEEPSEEK: "deepseek",
  MINIMAX: "minimax-cn",
  VOLCENGINE: "volcengine",
};

/**
 * 将旧版 provider key 映射为标准化 ProviderId。
 * @param key - 旧版配置中的 provider key（如 "OPENAI"）
 * @returns 对应的 ProviderId，未匹配时返回 undefined
 */
function normalizeProviderIdFromKey(key?: string): ProviderId | undefined {
  if (key && PROVIDER_KEY_TO_ID[key]) {
    return PROVIDER_KEY_TO_ID[key];
  }
  return undefined;
}

/**
 * 安全解析旧版 LLM 配置，支持 JSON 字符串和数组两种格式。
 * @returns 解析失败或为空时返回 []
 */
function safeParseLegacyLLMConfig(
  llmConfig: string | UserProviderConfig[] | null | undefined,
): UserProviderConfig[] {
  if (!llmConfig) return [];
  if (Array.isArray(llmConfig)) return llmConfig;

  try {
    const parsed = JSON.parse(llmConfig);
    return Array.isArray(parsed) ? (parsed as UserProviderConfig[]) : [];
  } catch {
    return [];
  }
}

/** 将 providerId 和 model 对象转换为 ModelSelect。 */
function toModelSelect(
  providerId: ProviderId,
  model: { id?: string; name: string },
) {
  const modelId = model.name;
  return {
    providerId,
    modelId,
  } as ModelSelect;
}

export const PROVIDER_ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "alibaba-cn": "DASHSCOPE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  zhipuai: "ZHIPU_API_KEY",
  zai: "ZHIPU_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  "minimax-cn": "MINIMAX_API_KEY",
  volcengine: "ARK_API_KEY",
};

/**
 * 将旧版 llm.providerConfigs 转换为基于 key 的 V2 结构。
 * 同时返回仅包含 custom provider 的旧版配置，供兼容路径继续使用。
 * @param LegacyLlmConfig - 旧版配置
 * @param LegacyActiveLlmModelId - 用于设置 active
 */
export function convertLegacyLLMConfigByKey(
  LegacyLlmConfig: string | UserProviderConfig[] | null | undefined,
  LegacyActiveLlmModelId?: string | null,
): ConvertLLMConfigResult {
  const legacyConfigs = safeParseLegacyLLMConfig(LegacyLlmConfig);
  const legacyCustomProviderConfigs = legacyConfigs.filter(
    (provider) => provider.isCustom,
  );

  const env: Record<ProviderId, Record<string, string>> = {};
  const addedModels: ModelSelect[] = [];
  const recentUsed: ModelSelect[] = [];
  const seen = new Set<string>();

  for (const provider of legacyConfigs) {
    if (provider.isCustom || !provider.key) {
      continue;
    }

    const providerId = normalizeProviderIdFromKey(String(provider.key));
    if (!providerId) {
      continue;
    }

    const currentEnv = (env[providerId] ||= {});
    if (provider.apiKey) {
      const apiKeyName = PROVIDER_ENV_KEY_MAP[providerId] || "API_KEY";
      currentEnv[apiKeyName] = provider.apiKey;
    }

    for (const model of provider.models || []) {
      if (!model.name) {
        continue;
      }
      const modelSelect = toModelSelect(providerId, model);
      const dedupKey = `${modelSelect.providerId}::${modelSelect.modelId}`;
      if (seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      addedModels.push(modelSelect);
    }
  }

  const activeFromModelId = LegacyActiveLlmModelId
    ? addedModels.find((model) => model.modelId === LegacyActiveLlmModelId)
    : undefined;

  const active = activeFromModelId || recentUsed[0] || addedModels[0];

  return {
    userProviderConfigV2: {
      active,
      env,
      recentUsed,
      addedModels,
    },
    legacyCustomProviderConfigs,
  };
}

/**
 * 从 providers JSON 初始化配置。
 * 只负责解析并补齐基础字段，不处理兼容性与业务校验。
 * @returns 补齐了 id 字段
 */
export function initProvidersFromJSON(json: string | object): CommonProviders {
  const source = typeof json === "string" ? JSON.parse(json) : json;
  const providers = source as CommonProviders;

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider.id) {
      provider.id = providerId as ProviderId;
    }

    provider.models ||= {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!model.id) {
        model.id = modelId;
      }
    }
  }

  return providers;
}

/** 默认 providers json 文件地址 */
export const DEFAULT_PROVIDERS_JSON_URL = `chrome://${config.addonRef}/content/common_providers.min.json`;

/** 从 json 文件读取并解析 providers 配置。 */
export async function loadProvidersFromFile(
  jsonUrl = DEFAULT_PROVIDERS_JSON_URL,
): Promise<CommonProviders> {
  const response = await fetch(jsonUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load providers json: ${jsonUrl} (${response.status})`,
    );
  }

  const jsonText = await response.text();
  return initProvidersFromJSON(jsonText);
}

/** Provider ID */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "amazon"
  | "cohere"
  | "mistral"
  | "grok"
  | "deepseek"
  | "groq"
  | "perplexity"
  | "openrouter"
  | "alibaba-cloud"
  | "ai21"
  | "zhipu"
  | "minimax"
  | "moonshot"
  | "novita"
  | "qwen"
  | "togetherai"
  | "fireworks"
  | "hyperbolic"
  | "zai"
  | "tngtech"
  | "sarapa"
  | "vertex"
  | string; // 允许自定义 provider ID

/** 模型家族 */
export type ModelFamily =
  | "allenai"
  | "alpha"
  | "claude-haiku"
  | "claude-opus"
  | "claude-sonnet"
  | "codestral"
  | "cohere-embed"
  | "command-a"
  | "command-r"
  | "deepseek"
  | "deepseek-thinking"
  | "devstral"
  | "flux"
  | "gemini"
  | "gemini-flash"
  | "gemini-flash-lite"
  | "gemini-pro"
  | "gemma"
  | "glm"
  | "glm-air"
  | "glm-flash"
  | "glm-z"
  | "gpt"
  | "gpt-codex"
  | "gpt-codex-mini"
  | "gpt-codex-spark"
  | "gpt-mini"
  | "gpt-nano"
  | "gpt-oss"
  | "gpt-pro"
  | "grok"
  | "grok-beta"
  | "grok-vision"
  | "hermes"
  | "kat-coder"
  | "kimi"
  | "kimi-thinking"
  | "liquid"
  | "llama"
  | "magistral"
  | "mai"
  | "mercury"
  | "mimo"
  | "minimax"
  | "ministral"
  | "mistral"
  | "mistral-large"
  | "mistral-medium"
  | "mistral-nemo"
  | "mistral-small"
  | "model-router"
  | "nemotron"
  | "nova"
  | "nova-lite"
  | "nova-micro"
  | "nova-pro"
  | "o"
  | "o-mini"
  | "o-pro"
  | "palmyra"
  | "phi"
  | "qvq"
  | "qwen"
  | "qwerky"
  | "reka"
  | "sarvam"
  | "seed"
  | "sherlock"
  | "sourceful"
  | "step"
  | "text-embedding"
  | "tngtech"
  | "trinity"
  | "trinity-mini"
  | "yi"
  | "zhipu"
  | string;
