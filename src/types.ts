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

/**
 * @deprecated 旧版 provider 配置格式。使用 `UserProviderConfigV2`（来自 `src/utils/providers.ts`）代替。
 * 启动时通过 `convertLegacyLLMConfigByKey()` 自动转换为 v2 格式。
 * 旧格式的自定义 provider 保留在 `legacyCustomProviderConfigs` 中。
 */
export interface UserProviderConfig {
  id: string;
  key?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: {
    id?: string;
    name: string;
    enable?: boolean;
    providerId?: string;
  }[];
  isCustom: boolean;
}

export interface UserPrompt {
  id: string;
  name: string;
  description: string;
  prompt: string;
}
