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

export interface ProviderInfo {
  key: string;
  baseUrl: string;
  models?: string[];
}

export interface UserProviderModel {
  id?: string; // 模型唯一 ID (UUID)
  name: string; // 模型名称
  enable?: boolean; // 是否启用
  providerId?: string; // 所属 Provider ID
}

export interface UserProvider {
  id: string; // Provider 唯一 ID (UUID)
  key?: keyof typeof PROVIDERS; // 如果是预设，则有此字段，对应 defaultProvidersMap 的 key
  name: string; // Provider 名称 (可由用户修改)
  baseUrl?: string; // API Base URL
  apiKey?: string; // API Key
  models?: UserProviderModel[]; // 模型列表
  isCustom: boolean; // 是否为自定义 Provider
}

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
