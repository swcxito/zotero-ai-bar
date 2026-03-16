/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * modelsDevCache.ts
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

import {
  ModelsDevApiResponse,
  ModelsDevCache,
  ModelsDevModel,
} from "../types/modelMetadata";
import { PROVIDERS } from "./providerRegistry";
import { getPref, setPref } from "./prefs";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCache(): ModelsDevCache | undefined {
  try {
    const raw = getPref("modelsdev.cache");
    if (!raw) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const cache = parsed as ModelsDevCache;
    if (!cache.providers || typeof cache.providers !== "object") {
      return undefined;
    }

    if (
      typeof cache.lastFetch !== "number" ||
      !Number.isFinite(cache.lastFetch)
    ) {
      return undefined;
    }

    return cache;
  } catch {
    return undefined;
  }
}

function getSupportedModelsDevIds(): Set<string> {
  const providerIds = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    if (provider.modelsDevId) {
      providerIds.add(provider.modelsDevId);
    }
  }
  return providerIds;
}

export async function refreshModelsDevCache(): Promise<void> {
  try {
    const cache = readCache();
    if (cache && Date.now() - cache.lastFetch < MODELS_DEV_CACHE_TTL_MS) {
      return;
    }

    const response = await Zotero.HTTP.request("GET", MODELS_DEV_API_URL);
    const apiData = JSON.parse(response.response) as ModelsDevApiResponse;

    const supportedModelsDevIds = getSupportedModelsDevIds();
    const providers = Object.fromEntries(
      Object.entries(apiData).filter(([providerId]) =>
        supportedModelsDevIds.has(providerId),
      ),
    );

    const nextCache: ModelsDevCache = {
      providers,
      lastFetch: Date.now(),
    };

    setPref("modelsdev.cache", JSON.stringify(nextCache));
  } catch (e) {
    ztoolkit.log("Models.dev fetch failed", e);
  }
}

export function getModelMetadata(
  modelsDevId: string,
  modelId: string,
): ModelsDevModel | undefined {
  try {
    const cache = readCache();
    return cache?.providers[modelsDevId]?.models[modelId];
  } catch {
    return undefined;
  }
}

export function getCachedProviderModels(
  modelsDevId: string,
): ModelsDevModel[] | undefined {
  try {
    const cache = readCache();
    const models = cache?.providers[modelsDevId]?.models;
    if (!models) {
      return undefined;
    }

    return Object.values(models);
  } catch {
    return undefined;
  }
}
