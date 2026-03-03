/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * constants.ts
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

import { config } from "../package.json";

export function getLogoUrl(providerKey: string): string {
  return `chrome://${config.addonRef}/content/icons/${providerKey.toLowerCase()}.svg`;
}

export const PROVIDERS = {
  OPENAI: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    l10n: false,
    models: [
      "gpt-4o",
      "gpt-4.1",
      "gpt-5",
      "gpt-5-mini",
      "gpt-5.2",
      "gpt-5.2-pro",
    ],
  },
  ANTHROPIC: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    l10n: false,
    models: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-5",
      "claude-sonnet-4",
    ],
  },
  GOOGLE_CLOUD: {
    name: "Google Cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    l10n: false,
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
    ],
  },
  // TODO: Add support for inline env like Azure
  // AZURE: {name: 'Azure OpenAI', baseUrl: 'https://YOUR_AZURE_RESOURCE_NAME.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT_NAME/'},
  ALIBABA_CLOUD: {
    name: "pref-provider-alibaba",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    l10n: true,
    models: ["qwen-plus", "qwen3-max", "qwen-flash", "qwen-turbo"],
  },
  VOLCENGINE: {
    name: "pref-provider-volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    l10n: true,
    models: ["doubao-seed-1.8", "doubao-seed-1.6"],
  },
  OPENROUTER: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    l10n: false,
    models: [],
  },
  ZHIPU: {
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    l10n: false,
    models: ["glm-5", "glm-4.7", "glm-4.7-flashx", "glm-4.7-flash"],
  },
  ZAI: {
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    l10n: false,
    models: ["glm-5", "glm-4.7", "glm-4.7-flashx", "glm-4.7-flash"],
  },
  DEEPSEEK: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    l10n: false,
    models: ["deepseek-chat"],
  },
  MINIMAX: {
    name: "Minimax",
    baseUrl: "https://api.minimaxi.com/v1",
    l10n: false,
    models: ["MiniMax-M2.5", "MiniMax-M2.5-highspeed"],
  },
} as const;
