/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelMetadata.ts
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

export interface ModelsDevModel {
  id: string;
  name: string;
  cost?: { input?: number; output?: number; reasoning?: number };
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  reasoning?: boolean;
  tool_call?: boolean;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

/** The full API response shape */
export type ModelsDevApiResponse = Record<string, ModelsDevProvider>;

/** Filtered cache: only providers the user has configured */
export interface ModelsDevCache {
  providers: Record<string, ModelsDevProvider>;
  lastFetch: number;
}
