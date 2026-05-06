/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * types.ts
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

import { PROVIDERS } from "./utils/providerInfo";

/**
 * @deprecated 使用 `Provider`（来自 `src/utils/providers.ts`）代替。
 * Provider 元数据现在从 common_providers.min.json 加载，不再硬编码。
 */
export interface ProviderInfo {
  key: string;
  baseUrl: string;
  models?: string[];
}

/**
 * @deprecated 使用 `Model`（来自 `src/utils/providers.ts`）或 `ModelSelect` 代替。
 * 模型信息现在由 common_providers.min.json 中的 `Provider.models` 提供。
 */
export interface UserProviderModel {
  // 模型唯一 ID (UUID)
  id?: string;
  // 模型名称
  name: string;
  // 是否启用
  enable?: boolean;
  // 所属 Provider ID
  providerId?: string;
}

/**
 * @deprecated 使用 `Provider`（来自 `src/utils/providers.ts`）代替。
 * Provider 元数据（npm SDK 包、base URL、模型列表）从 common_providers.min.json 加载。
 * 用户偏好（API key、active model）存储在 `UserProviderConfigV2` 中。
 *
 * 迁移指南：
 * - `key` (如 "OPENAI") → `ProviderId` (如 "openai")，映射见 `PROVIDER_KEY_TO_ID`
 * - `baseUrl` → `Provider.api`
 * - `models` → `Provider.models`
 * - `apiKey` → `UserProviderConfigV2.env[providerId]`
 */
export interface UserProvider {
  id: string; // Provider 唯一 ID (UUID)
  key?: keyof typeof PROVIDERS; // 如果是预设，则有此字段，对应 defaultProvidersMap 的 key
  name: string; // Provider 名称 (可由用户修改)
  baseUrl?: string; // API Base URL
  apiKey?: string; // API Key
  models?: UserProviderModel[]; // 模型列表
  isCustom: boolean; // 是否为自定义 Provider
}

/**
 * @deprecated 使用 `UserProviderConfigV2`（来自 `src/utils/providers.ts`）代替。
 * V2 配置通过 `convertLegacyLLMConfigByKey()` 从旧格式自动转换。
 * 旧格式的自定义 provider 保留在 `legacyCustomProviderConfigs` 中。
 */
export interface UserProviderConfig extends UserProvider {
  name: string; // Provider 名称 (可由用户修改)
  baseUrl: string; // API Base URL
  apiKey: string; // API Key
  models: UserProviderModel[]; // 模型列表
}

export interface UserPrompt {
  id: string; // UUID via crypto.randomUUID()
  name: string; // Display name (e.g., "Critique Method")
  description: string; // Short description shown in table/menu
  prompt: string; // The actual prompt content text
}
