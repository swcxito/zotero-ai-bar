/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * webdavSync.ts
 *
 * Cloud synchronization via WebDAV (Nutstore / 坚果云, Nextcloud, etc.)
 * for Zotero AI Bar.
 */

import { getWebDavPassword } from './webdavCredentials';
import type { UserPrompt } from '../types';
import { getPref, setPref } from '../utils/prefs';
import type { AddedModel, AddedProvider, ProviderId, UserProviderConfigV2 } from '../utils/providers';
import {
  preparePortableItemIndex,
  sanitizeHistoryFile,
  mergeHistoryFiles,
  type MergeHistoryResult,
  type PersistedChatHistoryFile,
} from './chatHistoryStore';

export const WEBDAV_SYNC_SCHEMA = 'zaibar.sync.v1' as const;
export const WEBDAV_SYNC_FILENAME = 'zaibar-sync-v1.json';
const V2_CONFIG_PREF_KEY = 'llm.providerConfigsV2';
const V2_MODELS_FILENAME = 'models-v2.json';
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_SYNC_DELAY_MS = 6000;
const REQUEST_TIMEOUT_MS = 30000;

export interface WebDavConnectionConfig {
  webdavUrl: string;
  username: string;
  password: string;
  remoteFolder: string;
  includeApiKeys: boolean;
}

export interface WebDavSyncMetadata {
  promptUpdatedAt?: Record<string, number>;
  deletedPrompts?: Record<string, number>;
  settingUpdatedAt?: Record<string, number>;
  activeModelUpdatedAt?: number;
  providerUpdatedAt?: Record<string, number>;
  deletedProviders?: Record<string, number>;
  modelUpdatedAt?: Record<string, number>;
  deletedModels?: Record<string, number>;
  envUpdatedAt?: Record<string, Record<string, number>>;
  deletedEnv?: Record<string, Record<string, number>>;
}

export interface MergeSyncMetadataOptions {
  localMeta?: WebDavSyncMetadata;
  remoteMeta?: WebDavSyncMetadata;
  preferRemote?: boolean;
}

export interface WebDavSyncPayload {
  schema: typeof WEBDAV_SYNC_SCHEMA;
  exportedAt: number;
  chatHistory: PersistedChatHistoryFile;
  userPrompts?: UserPrompt[];
  providerConfigV2?: UserProviderConfigV2;
  settings?: Record<string, string | number | boolean>;
  syncMeta?: WebDavSyncMetadata;
}

export interface WebDavSyncResult {
  mode: 'sync' | 'push' | 'pull';
  syncedAt: number;
  imported: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

const SYNCABLE_PREF_KEYS = [
  'llm.temperature100',
  'llm.temperatureEnabled',
  'llm.maxTokensEnabled',
  'llm.maxTokens',
  'extend-selection-context',
  'extend-selection-size',
  'chat.formulaOptimization',
  'chat.contextRounds',
  'chat.defaultMode',
  'chat.fontSize',
  'chat.skin',
  'chat.startConversationMode',
  'chat.autoAttachItemData',
  'chat.autoImagePrompt',
  'chat.thinkingEffort',
  'translate.enableAuto',
  'translate.extendContext',
  'translate.useAlternativeModel',
  'translate.useModelForWords',
  'translate.modelId',
  'translate.targetLanguage',
  'translate.thinkingDepth',
  'translate.separateTab',
] as const;

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let startupSyncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<WebDavSyncResult> | null = null;

export function normalizeWebDavEndpoint(
  baseUrl: string,
  remoteFolder: string,
  fileName: string = WEBDAV_SYNC_FILENAME
): { folderUrl: string; fileUrl: string } {
  const trimmedBase = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmedBase || !/^https?:\/\//i.test(trimmedBase)) {
    throw new Error('Invalid WebDAV URL (must start with http:// or https://)');
  }
  const cleanFolder = (remoteFolder || 'zotero-ai-bar')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const folderUrl = cleanFolder ? `${trimmedBase}/${cleanFolder}/` : `${trimmedBase}/`;
  const fileUrl = `${folderUrl}${encodeURIComponent(fileName)}`;
  return { folderUrl, fileUrl };
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBasicAuth(username: string, password: string): string {
  const utf8Str = unescape(encodeURIComponent(`${username}:${password}`));
  let output = '';
  for (let i = 0; i < utf8Str.length; i += 3) {
    const b1 = utf8Str.charCodeAt(i) & 0xff;
    const hasB2 = i + 1 < utf8Str.length;
    const hasB3 = i + 2 < utf8Str.length;
    const b2 = hasB2 ? utf8Str.charCodeAt(i + 1) & 0xff : 0;
    const b3 = hasB3 ? utf8Str.charCodeAt(i + 2) & 0xff : 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    output += BASE64_CHARS[(triplet >> 18) & 0x3f];
    output += BASE64_CHARS[(triplet >> 12) & 0x3f];
    output += hasB2 ? BASE64_CHARS[(triplet >> 6) & 0x3f] : '=';
    output += hasB3 ? BASE64_CHARS[triplet & 0x3f] : '=';
  }
  return `Basic ${output}`;
}

export function sanitizeProviderConfigForSync(
  v2: UserProviderConfigV2 | null | undefined,
  includeApiKeys: boolean
): UserProviderConfigV2 | undefined {
  if (!v2 || typeof v2 !== 'object') return undefined;
  const clone: UserProviderConfigV2 = JSON.parse(JSON.stringify(v2));
  if (!includeApiKeys) {
    clone.env = {} as Record<ProviderId, Record<string, string>>;
  }
  return clone;
}

export function sanitizeSyncMetaForSync(meta: WebDavSyncMetadata | undefined, includeApiKeys: boolean): WebDavSyncMetadata | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const clone: WebDavSyncMetadata = JSON.parse(JSON.stringify(meta));
  if (!includeApiKeys) {
    clone.envUpdatedAt = {};
    clone.deletedEnv = {};
  }
  return clone;
}

function mergeTimestampMaps(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  }
  for (const [k, v] of Object.entries(b ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = v;
  }
  return out;
}

export function buildSyncMetaFromPayload(payload: Partial<WebDavSyncPayload>, defaultTs = 0, overwriteExisting = false): WebDavSyncMetadata {
  const existing = payload.syncMeta;
  const promptUpdatedAt: Record<string, number> = { ...(existing?.promptUpdatedAt ?? {}) };
  const deletedPrompts: Record<string, number> = { ...(existing?.deletedPrompts ?? {}) };
  const settingUpdatedAt: Record<string, number> = { ...(existing?.settingUpdatedAt ?? {}) };
  const providerUpdatedAt: Record<string, number> = { ...(existing?.providerUpdatedAt ?? {}) };
  const deletedProviders: Record<string, number> = { ...(existing?.deletedProviders ?? {}) };
  const modelUpdatedAt: Record<string, number> = { ...(existing?.modelUpdatedAt ?? {}) };
  const deletedModels: Record<string, number> = { ...(existing?.deletedModels ?? {}) };
  const envUpdatedAt: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(existing?.envUpdatedAt ?? {}));
  const deletedEnv: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(existing?.deletedEnv ?? {}));
  let activeModelUpdatedAt = existing?.activeModelUpdatedAt ?? 0;

  if (defaultTs > 0) {
    for (const p of payload.userPrompts ?? []) {
      if (p?.id && (overwriteExisting || !(p.id in promptUpdatedAt))) {
        promptUpdatedAt[p.id] = defaultTs;
        delete deletedPrompts[p.id];
      }
    }
    for (const k of Object.keys(payload.settings ?? {})) {
      if (overwriteExisting || !(k in settingUpdatedAt)) {
        settingUpdatedAt[k] = defaultTs;
      }
    }
    const v2 = payload.providerConfigV2;
    if (v2) {
      if (v2.active?.providerId && v2.active?.modelId && (overwriteExisting || !activeModelUpdatedAt)) {
        activeModelUpdatedAt = defaultTs;
      }
      for (const pid of Object.keys(v2.addedProviders ?? {})) {
        if (overwriteExisting || !(pid in providerUpdatedAt)) {
          providerUpdatedAt[pid] = defaultTs;
          delete deletedProviders[pid];
        }
      }
      for (const m of v2.addedModels ?? []) {
        if (m?.providerId && m?.id) {
          const mkey = `${m.providerId}:::${m.id}`;
          if (overwriteExisting || !(mkey in modelUpdatedAt)) {
            modelUpdatedAt[mkey] = defaultTs;
            delete deletedModels[mkey];
          }
        }
      }
      for (const [pid, envObj] of Object.entries(v2.env ?? {})) {
        if (!envObj || typeof envObj !== 'object') continue;
        const target = (envUpdatedAt[pid] ??= {});
        for (const [ek, ev] of Object.entries(envObj)) {
          if (ev && (overwriteExisting || !(ek in target))) {
            target[ek] = defaultTs;
            if (deletedEnv[pid]) delete deletedEnv[pid][ek];
          }
        }
      }
    }
    if (overwriteExisting) {
      for (const k of Object.keys(deletedPrompts)) deletedPrompts[k] = defaultTs;
      for (const k of Object.keys(deletedProviders)) deletedProviders[k] = defaultTs;
      for (const k of Object.keys(deletedModels)) deletedModels[k] = defaultTs;
      for (const envMap of Object.values(deletedEnv)) {
        for (const k of Object.keys(envMap ?? {})) envMap[k] = defaultTs;
      }
    }
  }

  return {
    promptUpdatedAt,
    deletedPrompts,
    settingUpdatedAt,
    activeModelUpdatedAt,
    providerUpdatedAt,
    deletedProviders,
    modelUpdatedAt,
    deletedModels,
    envUpdatedAt,
    deletedEnv,
  };
}

export function mergeSyncMetadata(localMeta: WebDavSyncMetadata | undefined, remoteMeta: WebDavSyncMetadata | undefined): WebDavSyncMetadata {
  const promptUpdatedAt = mergeTimestampMaps(localMeta?.promptUpdatedAt, remoteMeta?.promptUpdatedAt);
  const deletedPrompts = mergeTimestampMaps(localMeta?.deletedPrompts, remoteMeta?.deletedPrompts);
  for (const [id, delTs] of Object.entries(deletedPrompts)) {
    if ((promptUpdatedAt[id] ?? 0) > delTs) {
      delete deletedPrompts[id];
    } else {
      delete promptUpdatedAt[id];
    }
  }

  const providerUpdatedAt = mergeTimestampMaps(localMeta?.providerUpdatedAt, remoteMeta?.providerUpdatedAt);
  const deletedProviders = mergeTimestampMaps(localMeta?.deletedProviders, remoteMeta?.deletedProviders);
  for (const [pid, delTs] of Object.entries(deletedProviders)) {
    if ((providerUpdatedAt[pid] ?? 0) > delTs) {
      delete deletedProviders[pid];
    } else {
      delete providerUpdatedAt[pid];
    }
  }

  const modelUpdatedAt = mergeTimestampMaps(localMeta?.modelUpdatedAt, remoteMeta?.modelUpdatedAt);
  const deletedModels = mergeTimestampMaps(localMeta?.deletedModels, remoteMeta?.deletedModels);
  for (const [mkey, delTs] of Object.entries(deletedModels)) {
    if ((modelUpdatedAt[mkey] ?? 0) > delTs) {
      delete deletedModels[mkey];
    } else {
      delete modelUpdatedAt[mkey];
    }
  }

  const settingUpdatedAt = mergeTimestampMaps(localMeta?.settingUpdatedAt, remoteMeta?.settingUpdatedAt);
  const activeModelUpdatedAt = Math.max(localMeta?.activeModelUpdatedAt ?? 0, remoteMeta?.activeModelUpdatedAt ?? 0);

  const envUpdatedAt: Record<string, Record<string, number>> = {};
  const deletedEnv: Record<string, Record<string, number>> = {};
  const envPids = new Set([
    ...Object.keys(localMeta?.envUpdatedAt ?? {}),
    ...Object.keys(remoteMeta?.envUpdatedAt ?? {}),
    ...Object.keys(localMeta?.deletedEnv ?? {}),
    ...Object.keys(remoteMeta?.deletedEnv ?? {}),
  ]);
  for (const pid of envPids) {
    const mergedUpd = mergeTimestampMaps(localMeta?.envUpdatedAt?.[pid], remoteMeta?.envUpdatedAt?.[pid]);
    const mergedDel = mergeTimestampMaps(localMeta?.deletedEnv?.[pid], remoteMeta?.deletedEnv?.[pid]);
    for (const [ek, delTs] of Object.entries(mergedDel)) {
      if ((mergedUpd[ek] ?? 0) > delTs) {
        delete mergedDel[ek];
      } else {
        delete mergedUpd[ek];
      }
    }
    if (Object.keys(mergedUpd).length > 0) envUpdatedAt[pid] = mergedUpd;
    if (Object.keys(mergedDel).length > 0) deletedEnv[pid] = mergedDel;
  }

  return {
    promptUpdatedAt,
    deletedPrompts,
    settingUpdatedAt,
    activeModelUpdatedAt,
    providerUpdatedAt,
    deletedProviders,
    modelUpdatedAt,
    deletedModels,
    envUpdatedAt,
    deletedEnv,
  };
}

export function mergeProviderConfigs(
  local: UserProviderConfigV2 | null | undefined,
  remote: UserProviderConfigV2 | null | undefined,
  includeApiKeys: boolean,
  preferRemoteActive = false,
  options?: MergeSyncMetadataOptions
): UserProviderConfigV2 | undefined {
  if (!local && !remote) return undefined;
  const preferRemote = options?.preferRemote ?? preferRemoteActive;
  const localMeta = options?.localMeta;
  const remoteMeta = options?.remoteMeta;
  const deletedProviders = mergeTimestampMaps(localMeta?.deletedProviders, remoteMeta?.deletedProviders);
  const deletedModels = mergeTimestampMaps(localMeta?.deletedModels, remoteMeta?.deletedModels);

  if (!local) return sanitizeProviderConfigForSync(remote, includeApiKeys);
  if (!remote) return sanitizeProviderConfigForSync(local, true);

  const addedProviders = {} as Record<ProviderId, AddedProvider>;
  const providerIds = new Set<string>([...Object.keys(remote.addedProviders ?? {}), ...Object.keys(local.addedProviders ?? {})]);
  for (const pid of providerIds) {
    const lProv = (local.addedProviders as Record<string, AddedProvider> | undefined)?.[pid];
    const rProv = (remote.addedProviders as Record<string, AddedProvider> | undefined)?.[pid];
    const lTs = localMeta?.providerUpdatedAt?.[pid] ?? 0;
    const rTs = remoteMeta?.providerUpdatedAt?.[pid] ?? 0;
    const delTs = deletedProviders[pid] ?? 0;
    const aliveL = lProv && !(delTs > 0 && delTs >= lTs) ? lProv : undefined;
    const aliveR = rProv && !(delTs > 0 && delTs >= rTs) ? rProv : undefined;
    if (!aliveL && !aliveR) continue;
    if (aliveL && !aliveR) {
      addedProviders[pid as ProviderId] = { ...aliveL };
    } else if (!aliveL && aliveR) {
      addedProviders[pid as ProviderId] = { ...aliveR };
    } else if (aliveL && aliveR) {
      const useRemote = rTs !== lTs ? rTs > lTs : preferRemote;
      addedProviders[pid as ProviderId] = useRemote ? { ...aliveL, ...aliveR } : { ...aliveR, ...aliveL };
    }
  }

  const localModels = new Map<string, AddedModel>();
  for (const m of local.addedModels ?? []) {
    if (m?.providerId && m?.id) localModels.set(`${m.providerId}:::${m.id}`, m);
  }
  const remoteModels = new Map<string, AddedModel>();
  for (const m of remote.addedModels ?? []) {
    if (m?.providerId && m?.id) remoteModels.set(`${m.providerId}:::${m.id}`, m);
  }
  const modelKeys = new Set<string>([...remoteModels.keys(), ...localModels.keys()]);
  const modelMap = new Map<string, AddedModel>();
  for (const key of modelKeys) {
    const lMod = localModels.get(key);
    const rMod = remoteModels.get(key);
    const pid = String((lMod ?? rMod)?.providerId ?? '');
    const lTs = localMeta?.modelUpdatedAt?.[key] ?? 0;
    const rTs = remoteMeta?.modelUpdatedAt?.[key] ?? 0;
    const delTs = Math.max(deletedModels[key] ?? 0, deletedProviders[pid] ?? 0);
    const aliveL = lMod && !(delTs > 0 && delTs >= lTs) ? lMod : undefined;
    const aliveR = rMod && !(delTs > 0 && delTs >= rTs) ? rMod : undefined;
    if (!aliveL && !aliveR) continue;
    if (aliveL && !aliveR) {
      modelMap.set(key, { ...aliveL });
    } else if (!aliveL && aliveR) {
      modelMap.set(key, { ...aliveR });
    } else if (aliveL && aliveR) {
      const useRemote = rTs !== lTs ? rTs > lTs : preferRemote;
      modelMap.set(key, useRemote ? { ...aliveL, ...aliveR } : { ...aliveR, ...aliveL });
    }
  }

  const mergedEnv = {} as Record<ProviderId, Record<string, string>>;
  if (!includeApiKeys) {
    for (const [providerId, envObj] of Object.entries(local.env ?? {})) {
      if (!envObj || typeof envObj !== 'object') continue;
      const target = (mergedEnv[providerId as ProviderId] ??= {});
      for (const [k, v] of Object.entries(envObj)) {
        if (v) target[k] = v;
      }
    }
  } else {
    const envPids = new Set<string>([...Object.keys(remote.env ?? {}), ...Object.keys(local.env ?? {})]);
    for (const pid of envPids) {
      const lObj = (local.env as Record<string, Record<string, string>> | undefined)?.[pid] ?? {};
      const rObj = (remote.env as Record<string, Record<string, string>> | undefined)?.[pid] ?? {};
      const deletedEnvForPid = mergeTimestampMaps(localMeta?.deletedEnv?.[pid], remoteMeta?.deletedEnv?.[pid]);
      const envKeys = new Set<string>([...Object.keys(rObj), ...Object.keys(lObj)]);
      for (const k of envKeys) {
        const lVal = lObj[k] ?? '';
        const rVal = rObj[k] ?? '';
        const lTs = localMeta?.envUpdatedAt?.[pid]?.[k] ?? 0;
        const rTs = remoteMeta?.envUpdatedAt?.[pid]?.[k] ?? 0;
        const delTs = Math.max(deletedEnvForPid[k] ?? 0, deletedProviders[pid] ?? 0);
        const aliveL = lVal && !(delTs > 0 && delTs >= lTs) ? lVal : undefined;
        const aliveR = rVal && !(delTs > 0 && delTs >= rTs) ? rVal : undefined;
        if (!aliveL && !aliveR) continue;
        if (aliveL && !aliveR) {
          (mergedEnv[pid as ProviderId] ??= {})[k] = aliveL;
        } else if (!aliveL && aliveR) {
          (mergedEnv[pid as ProviderId] ??= {})[k] = aliveR;
        } else if (aliveL && aliveR) {
          const useRemote = rTs !== lTs ? rTs > lTs : preferRemote;
          (mergedEnv[pid as ProviderId] ??= {})[k] = useRemote ? aliveR : aliveL;
        }
      }
    }
  }

  const lActiveTs = localMeta?.activeModelUpdatedAt ?? 0;
  const rActiveTs = remoteMeta?.activeModelUpdatedAt ?? 0;
  const useRemoteActive = rActiveTs !== lActiveTs ? rActiveTs > lActiveTs : preferRemote;

  const seenRecent = new Set<string>();
  const recentUsed: Array<{ providerId: ProviderId; modelId: string }> = [];
  for (const entry of [...(useRemoteActive ? (remote.recentUsed ?? []) : []), ...(local.recentUsed ?? []), ...(remote.recentUsed ?? [])]) {
    if (!entry?.providerId || !entry?.modelId) continue;
    const key = `${entry.providerId}:::${entry.modelId}`;
    if (seenRecent.has(key)) continue;
    seenRecent.add(key);
    recentUsed.push({ providerId: entry.providerId, modelId: entry.modelId });
    if (recentUsed.length >= 10) break;
  }

  const primaryActive = useRemoteActive ? remote.active : local.active;
  const fallbackActive = useRemoteActive ? local.active : remote.active;
  const active = primaryActive?.providerId && primaryActive?.modelId ? primaryActive : fallbackActive;

  return {
    ...(active ? { active } : {}),
    env: mergedEnv,
    recentUsed,
    addedProviders,
    addedModels: Array.from(modelMap.values()),
  };
}

export function mergeUserPrompts(
  local: UserPrompt[] | undefined,
  remote: UserPrompt[] | undefined,
  options?: MergeSyncMetadataOptions
): UserPrompt[] {
  const preferRemote = Boolean(options?.preferRemote);
  const localMeta = options?.localMeta;
  const remoteMeta = options?.remoteMeta;
  const deletedPrompts = mergeTimestampMaps(localMeta?.deletedPrompts, remoteMeta?.deletedPrompts);

  const localById = new Map<string, UserPrompt>();
  for (const prompt of local ?? []) {
    if (prompt?.id && prompt?.name) localById.set(prompt.id, prompt);
  }
  const remoteById = new Map<string, UserPrompt>();
  for (const prompt of remote ?? []) {
    if (prompt?.id && prompt?.name) remoteById.set(prompt.id, prompt);
  }

  const allIds = new Set<string>([...remoteById.keys(), ...localById.keys()]);
  const out: UserPrompt[] = [];
  for (const id of allIds) {
    const lPrompt = localById.get(id);
    const rPrompt = remoteById.get(id);
    const lTs = localMeta?.promptUpdatedAt?.[id] ?? 0;
    const rTs = remoteMeta?.promptUpdatedAt?.[id] ?? 0;
    const delTs = deletedPrompts[id] ?? 0;
    const aliveL = lPrompt && !(delTs > 0 && delTs >= lTs) ? lPrompt : undefined;
    const aliveR = rPrompt && !(delTs > 0 && delTs >= rTs) ? rPrompt : undefined;
    if (!aliveL && !aliveR) continue;
    if (aliveL && !aliveR) {
      out.push({ ...aliveL });
    } else if (!aliveL && aliveR) {
      out.push({ ...aliveR });
    } else if (aliveL && aliveR) {
      const useRemote = rTs !== lTs ? rTs > lTs : preferRemote;
      out.push({ ...(useRemote ? aliveR : aliveL) });
    }
  }
  return out;
}

export function mergeSyncPayloads(
  local: WebDavSyncPayload,
  remote: WebDavSyncPayload,
  options?: { includeApiKeys?: boolean; preferRemote?: boolean; zoteroGlobal?: any }
): { mergedPayload: WebDavSyncPayload; historyStats: MergeHistoryResult } {
  const includeApiKeys = options?.includeApiKeys ?? true;
  const preferRemote = options?.preferRemote ?? (remote.exportedAt ?? 0) > (local.exportedAt ?? 0);
  const effectiveLocalMeta = local.syncMeta ?? buildSyncMetaFromPayload(local, local.exportedAt ?? 0);
  const effectiveRemoteMeta = remote.syncMeta ?? buildSyncMetaFromPayload(remote, remote.exportedAt ?? 0);
  const metaOptions: MergeSyncMetadataOptions = {
    localMeta: effectiveLocalMeta,
    remoteMeta: effectiveRemoteMeta,
    preferRemote,
  };

  const historyStats = mergeHistoryFiles(local.chatHistory, remote.chatHistory, options?.zoteroGlobal);
  const mergedPrompts = mergeUserPrompts(local.userPrompts, remote.userPrompts, metaOptions);
  const mergedProviderConfig = mergeProviderConfigs(local.providerConfigV2, remote.providerConfigV2, includeApiKeys, preferRemote, metaOptions);

  const mergedSettings: Record<string, string | number | boolean> = {};
  const settingKeys = new Set<string>([...Object.keys(remote.settings ?? {}), ...Object.keys(local.settings ?? {})]);
  for (const key of settingKeys) {
    const hasL = local.settings !== undefined && key in local.settings;
    const hasR = remote.settings !== undefined && key in remote.settings;
    if (hasL && !hasR) {
      mergedSettings[key] = local.settings![key];
    } else if (!hasL && hasR) {
      mergedSettings[key] = remote.settings![key];
    } else if (hasL && hasR) {
      const lTs = effectiveLocalMeta.settingUpdatedAt?.[key] ?? 0;
      const rTs = effectiveRemoteMeta.settingUpdatedAt?.[key] ?? 0;
      const useRemote = rTs !== lTs ? rTs > lTs : preferRemote;
      mergedSettings[key] = useRemote ? remote.settings![key] : local.settings![key];
    }
  }

  const rawMergedSyncMeta = mergeSyncMetadata(effectiveLocalMeta, effectiveRemoteMeta);
  const mergedSyncMeta = sanitizeSyncMetaForSync(rawMergedSyncMeta, includeApiKeys);
  const maxMergedTs = getMaxTimestampInSyncMeta(rawMergedSyncMeta, Math.max(local.exportedAt ?? 0, remote.exportedAt ?? 0));
  observeSyncTimestamp(maxMergedTs);

  const mergedPayload: WebDavSyncPayload = {
    schema: WEBDAV_SYNC_SCHEMA,
    exportedAt: maxMergedTs > 0 ? maxMergedTs : Date.now(),
    chatHistory: historyStats.merged,
    userPrompts: mergedPrompts,
    ...(mergedProviderConfig ? { providerConfigV2: sanitizeProviderConfigForSync(mergedProviderConfig, includeApiKeys) } : {}),
    settings: mergedSettings,
    syncMeta: mergedSyncMeta,
  };

  return { mergedPayload, historyStats };
}

const LOCAL_SYNC_STATE_PREF_KEY = 'sync.localState';

interface LocalSyncBaseline {
  userPrompts: UserPrompt[];
  providerConfigV2?: UserProviderConfigV2;
  settings: Record<string, string | number | boolean>;
}

interface LocalSyncState {
  lastConfigModifiedAt: number;
  syncMeta: WebDavSyncMetadata;
  baseline?: LocalSyncBaseline;
}

let fallbackLocalSyncState: LocalSyncState = {
  lastConfigModifiedAt: 0,
  syncMeta: {},
};
let lastIssuedSyncTimestamp = 0;

function observeSyncTimestamp(ts: number): void {
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > lastIssuedSyncTimestamp) {
    lastIssuedSyncTimestamp = ts;
  }
}

function nextSyncTimestamp(minTs = 0): number {
  const candidate = Math.max(Date.now(), lastIssuedSyncTimestamp + 1, minTs + 1);
  lastIssuedSyncTimestamp = candidate;
  return candidate;
}

export function resetWebDavSyncStateForTests(): void {
  fallbackLocalSyncState = {
    lastConfigModifiedAt: 0,
    syncMeta: {},
  };
  lastIssuedSyncTimestamp = 0;
  try {
    if (typeof Zotero !== 'undefined' && (Zotero as any)?.Prefs?.set) {
      setPref(LOCAL_SYNC_STATE_PREF_KEY as any, '');
    }
  } catch {
    // ignore in environments without Zotero.Prefs
  }
}

function getMaxTimestampInSyncMeta(meta: WebDavSyncMetadata | undefined, initialMax = 0): number {
  let maxTs = initialMax;
  if (!meta) return maxTs;
  const checkMap = (map: Record<string, number> | undefined) => {
    for (const v of Object.values(map ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v) && v > maxTs) maxTs = v;
    }
  };
  checkMap(meta.promptUpdatedAt);
  checkMap(meta.deletedPrompts);
  checkMap(meta.settingUpdatedAt);
  checkMap(meta.providerUpdatedAt);
  checkMap(meta.deletedProviders);
  checkMap(meta.modelUpdatedAt);
  checkMap(meta.deletedModels);
  if (typeof meta.activeModelUpdatedAt === 'number' && meta.activeModelUpdatedAt > maxTs) {
    maxTs = meta.activeModelUpdatedAt;
  }
  for (const envMap of Object.values(meta.envUpdatedAt ?? {})) {
    checkMap(envMap);
  }
  for (const delEnvMap of Object.values(meta.deletedEnv ?? {})) {
    checkMap(delEnvMap);
  }
  return maxTs;
}

function createBaselineSnapshot(
  userPrompts: UserPrompt[],
  providerConfigV2: UserProviderConfigV2 | undefined,
  settings: Record<string, string | number | boolean>
): LocalSyncBaseline {
  return {
    userPrompts: JSON.parse(JSON.stringify(userPrompts ?? [])),
    ...(providerConfigV2 ? { providerConfigV2: JSON.parse(JSON.stringify(providerConfigV2)) } : {}),
    settings: JSON.parse(JSON.stringify(settings ?? {})),
  };
}

function readLocalSyncState(): LocalSyncState {
  try {
    if (typeof Zotero !== 'undefined' && (Zotero as any)?.Prefs?.get) {
      const raw = getPref(LOCAL_SYNC_STATE_PREF_KEY as any) as string;
      if (!raw) {
        return { lastConfigModifiedAt: 0, syncMeta: {} };
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          lastConfigModifiedAt: typeof parsed.lastConfigModifiedAt === 'number' ? parsed.lastConfigModifiedAt : 0,
          syncMeta: parsed.syncMeta && typeof parsed.syncMeta === 'object' ? parsed.syncMeta : {},
          ...(parsed.baseline ? { baseline: parsed.baseline } : {}),
        };
      }
      return { lastConfigModifiedAt: 0, syncMeta: {} };
    }
  } catch {
    // fall back to in-memory state
  }
  return JSON.parse(JSON.stringify(fallbackLocalSyncState));
}

function writeLocalSyncState(state: LocalSyncState): void {
  fallbackLocalSyncState = JSON.parse(JSON.stringify(state));
  try {
    if (typeof Zotero !== 'undefined' && (Zotero as any)?.Prefs?.set) {
      setPref(LOCAL_SYNC_STATE_PREF_KEY as any, JSON.stringify(state));
    }
  } catch {
    // ignore
  }
}

function readLocalProviderConfigV2(): UserProviderConfigV2 | undefined {
  if (typeof addon !== 'undefined' && addon?.data?.userProviderConfigV2) {
    return JSON.parse(JSON.stringify(addon.data.userProviderConfigV2));
  }
  try {
    const raw = getPref(V2_CONFIG_PREF_KEY as any) as string;
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as UserProviderConfigV2) : undefined;
  } catch {
    return undefined;
  }
}

function reconcileLocalSyncMetadata(
  userPrompts: UserPrompt[],
  fullV2: UserProviderConfigV2 | undefined,
  settings: Record<string, string | number | boolean>,
  includeApiKeys: boolean,
  options?: { isPush?: boolean; isPull?: boolean; minTimestamp?: number; remoteToOverwrite?: WebDavSyncPayload | null }
): { exportedAt: number; syncMeta: WebDavSyncMetadata } {
  if (options?.isPull) {
    return { exportedAt: 0, syncMeta: {} };
  }

  const state = readLocalSyncState();
  const meta = buildSyncMetaFromPayload({ syncMeta: state.syncMeta }, 0);
  const maxKnownTs = getMaxTimestampInSyncMeta(meta, Math.max(state.lastConfigModifiedAt, options?.minTimestamp ?? 0));
  observeSyncTimestamp(maxKnownTs);
  let changeTs = 0;
  const getChangeTs = () => {
    if (!changeTs) changeTs = nextSyncTimestamp(maxKnownTs);
    return changeTs;
  };
  let changed = false;

  if (state.baseline) {
    const basePrompts = new Map<string, UserPrompt>();
    for (const p of state.baseline.userPrompts ?? []) {
      if (p?.id && p?.name) basePrompts.set(p.id, p);
    }
    const currPrompts = new Map<string, UserPrompt>();
    for (const p of userPrompts ?? []) {
      if (p?.id && p?.name) currPrompts.set(p.id, p);
    }
    for (const [id, prompt] of currPrompts.entries()) {
      const prev = basePrompts.get(id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(prompt)) {
        meta.promptUpdatedAt![id] = getChangeTs();
        changed = true;
      }
      delete meta.deletedPrompts![id];
    }
    for (const id of basePrompts.keys()) {
      if (!currPrompts.has(id)) {
        meta.deletedPrompts![id] = getChangeTs();
        delete meta.promptUpdatedAt![id];
        changed = true;
      }
    }

    const baseSettings = state.baseline.settings ?? {};
    for (const key of SYNCABLE_PREF_KEYS) {
      const currVal = settings[key];
      const prevVal = baseSettings[key];
      if (currVal !== undefined && currVal !== prevVal) {
        meta.settingUpdatedAt![key] = getChangeTs();
        changed = true;
      }
    }

    const baseV2 = state.baseline.providerConfigV2;
    const currActive = fullV2?.active?.providerId && fullV2?.active?.modelId ? `${fullV2.active.providerId}:::${fullV2.active.modelId}` : '';
    const prevActive = baseV2?.active?.providerId && baseV2?.active?.modelId ? `${baseV2.active.providerId}:::${baseV2.active.modelId}` : '';
    if (currActive && currActive !== prevActive) {
      meta.activeModelUpdatedAt = getChangeTs();
      changed = true;
    }

    const baseProviders = (baseV2?.addedProviders ?? {}) as Record<string, AddedProvider>;
    const currProviders = (fullV2?.addedProviders ?? {}) as Record<string, AddedProvider>;
    for (const [pid, prov] of Object.entries(currProviders)) {
      const prev = baseProviders[pid];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(prov)) {
        meta.providerUpdatedAt![pid] = getChangeTs();
        changed = true;
      }
      delete meta.deletedProviders![pid];
    }
    for (const pid of Object.keys(baseProviders)) {
      if (!(pid in currProviders)) {
        meta.deletedProviders![pid] = getChangeTs();
        delete meta.providerUpdatedAt![pid];
        changed = true;
      }
    }

    const baseModels = new Map<string, AddedModel>();
    for (const m of baseV2?.addedModels ?? []) {
      if (m?.providerId && m?.id) baseModels.set(`${m.providerId}:::${m.id}`, m);
    }
    const currModels = new Map<string, AddedModel>();
    for (const m of fullV2?.addedModels ?? []) {
      if (m?.providerId && m?.id) currModels.set(`${m.providerId}:::${m.id}`, m);
    }
    for (const [mkey, model] of currModels.entries()) {
      const prev = baseModels.get(mkey);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(model)) {
        meta.modelUpdatedAt![mkey] = getChangeTs();
        changed = true;
      }
      delete meta.deletedModels![mkey];
    }
    for (const mkey of baseModels.keys()) {
      if (!currModels.has(mkey)) {
        meta.deletedModels![mkey] = getChangeTs();
        delete meta.modelUpdatedAt![mkey];
        changed = true;
      }
    }

    const baseEnv = (baseV2?.env ?? {}) as Record<string, Record<string, string>>;
    const currEnv = (fullV2?.env ?? {}) as Record<string, Record<string, string>>;
    const envPids = new Set<string>([...Object.keys(baseEnv), ...Object.keys(currEnv)]);
    for (const pid of envPids) {
      const bObj = baseEnv[pid] ?? {};
      const cObj = currEnv[pid] ?? {};
      const envKeys = new Set<string>([...Object.keys(bObj), ...Object.keys(cObj)]);
      for (const ek of envKeys) {
        const currVal = cObj[ek] ?? '';
        const prevVal = bObj[ek] ?? '';
        if (currVal !== prevVal) {
          const ts = getChangeTs();
          if (currVal) {
            (meta.envUpdatedAt![pid] ??= {})[ek] = ts;
            if (meta.deletedEnv?.[pid]) delete meta.deletedEnv[pid][ek];
          } else {
            (meta.deletedEnv![pid] ??= {})[ek] = ts;
            if (meta.envUpdatedAt?.[pid]) delete meta.envUpdatedAt[pid][ek];
          }
          changed = true;
        }
      }
    }

    if (changed) {
      state.lastConfigModifiedAt = changeTs;
      state.syncMeta = meta;
      state.baseline = createBaselineSnapshot(userPrompts, fullV2, settings);
      writeLocalSyncState(state);
    }
  }

  if (!state.baseline) {
    const ts = 0;
    state.lastConfigModifiedAt = ts;
    state.syncMeta = buildSyncMetaFromPayload({ userPrompts, providerConfigV2: fullV2, settings }, ts);
    state.baseline = createBaselineSnapshot(userPrompts, fullV2, settings);
    writeLocalSyncState(state);
    Object.assign(meta, state.syncMeta);
  }
  if (options?.isPush) {
    const pushTs = changed ? changeTs : nextSyncTimestamp(maxKnownTs);
    const stampedMeta = buildSyncMetaFromPayload({ userPrompts, providerConfigV2: fullV2, settings, syncMeta: meta }, pushTs, true);
    const remoteToOverwrite = options.remoteToOverwrite;
    if (remoteToOverwrite) {
      const currPromptIds = new Set((userPrompts ?? []).map((p) => p.id));
      for (const rp of remoteToOverwrite.userPrompts ?? []) {
        if (rp?.id && !currPromptIds.has(rp.id)) {
          stampedMeta.deletedPrompts![rp.id] = pushTs;
          delete stampedMeta.promptUpdatedAt![rp.id];
        }
      }
      const currPids = new Set(Object.keys(fullV2?.addedProviders ?? {}));
      for (const rpid of Object.keys(remoteToOverwrite.providerConfigV2?.addedProviders ?? {})) {
        if (!currPids.has(rpid)) {
          stampedMeta.deletedProviders![rpid] = pushTs;
          delete stampedMeta.providerUpdatedAt![rpid];
        }
      }
      const currModelKeys = new Set((fullV2?.addedModels ?? []).map((m) => `${m.providerId}:::${m.id}`));
      for (const rm of remoteToOverwrite.providerConfigV2?.addedModels ?? []) {
        if (rm?.providerId && rm?.id) {
          const mkey = `${rm.providerId}:::${rm.id}`;
          if (!currModelKeys.has(mkey)) {
            stampedMeta.deletedModels![mkey] = pushTs;
            delete stampedMeta.modelUpdatedAt![mkey];
          }
        }
      }
      if (includeApiKeys) {
        const currEnv = (fullV2?.env ?? {}) as Record<string, Record<string, string>>;
        for (const [rpid, renv] of Object.entries(remoteToOverwrite.providerConfigV2?.env ?? {})) {
          for (const [rek, rev] of Object.entries(renv ?? {})) {
            if (rev && !currEnv[rpid]?.[rek]) {
              (stampedMeta.deletedEnv![rpid] ??= {})[rek] = pushTs;
              if (stampedMeta.envUpdatedAt?.[rpid]) delete stampedMeta.envUpdatedAt[rpid][rek];
            }
          }
        }
      }
    }
    state.lastConfigModifiedAt = pushTs;
    state.syncMeta = stampedMeta;
    state.baseline = createBaselineSnapshot(userPrompts, fullV2, settings);
    writeLocalSyncState(state);
    return {
      exportedAt: pushTs,
      syncMeta: sanitizeSyncMetaForSync(stampedMeta, includeApiKeys)!,
    };
  }

  return {
    exportedAt: state.lastConfigModifiedAt,
    syncMeta: sanitizeSyncMetaForSync(meta, includeApiKeys)!,
  };
}

function readLocalUserPrompts(): UserPrompt[] {
  if (typeof addon !== 'undefined' && Array.isArray(addon?.data?.userPrompts)) {
    return JSON.parse(JSON.stringify(addon.data.userPrompts));
  }
  try {
    const raw = getPref('prompt.userPrompts') as string;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalUserPrompts(prompts: UserPrompt[]): void {
  if (typeof addon !== 'undefined' && addon?.data) {
    addon.data.userPrompts = prompts;
  }
  setPref('prompt.userPrompts', JSON.stringify(prompts));
}

async function persistV2ConfigToLocal(v2: UserProviderConfigV2): Promise<void> {
  const lightweight = {
    active: v2.active,
    env: v2.env,
    recentUsed: v2.recentUsed,
    addedProviders: v2.addedProviders,
    addedModels: v2.addedModels.map((m) => ({
      providerId: m.providerId,
      id: m.id,
      name: m.name,
      enabled: m.enabled,
    })),
  };
  setPref(V2_CONFIG_PREF_KEY as any, JSON.stringify(lightweight));
  if (typeof addon !== 'undefined' && addon?.data) {
    addon.data.userProviderConfigV2 = v2;
    addon.data.refreshModelInfoAnchors?.();
  }
  if (typeof PathUtils !== 'undefined' && typeof IOUtils !== 'undefined' && typeof addon !== 'undefined') {
    const filePath = PathUtils.join(PathUtils.profileDir, addon.data.config.addonRef, V2_MODELS_FILENAME);
    const allModels: Record<string, Record<string, any>> = {};
    for (const m of v2.addedModels) {
      const { providerId, enabled: _enabled, ...model } = m;
      (allModels[providerId] ??= {})[m.id] = model;
    }
    await IOUtils.writeJSON(filePath, allModels);
  }
}

async function readConnectionConfig(override?: Partial<WebDavConnectionConfig>): Promise<WebDavConnectionConfig> {
  return {
    webdavUrl: (override?.webdavUrl ?? (getPref('sync.webdavUrl' as any) as string) ?? 'https://dav.jianguoyun.com/dav/').trim(),
    username: (override?.username ?? (getPref('sync.username' as any) as string) ?? '').trim(),
    password: override?.password ?? (await getWebDavPassword()),
    remoteFolder: (override?.remoteFolder ?? (getPref('sync.remoteFolder' as any) as string) ?? 'zotero-ai-bar').trim() || 'zotero-ai-bar',
    includeApiKeys: override?.includeApiKeys ?? Boolean(getPref('sync.includeApiKeys' as any) ?? false),
  };
}

function formatHttpError(status: number, context: string): Error {
  if (status === 401) {
    return new Error(`${context}: HTTP 401 Unauthorized (check username and Nutstore/WebDAV app password)`);
  }
  if (status === 403) {
    return new Error(`${context}: HTTP 403 Forbidden (check WebDAV permissions or path)`);
  }
  if (status === 404) {
    return new Error(`${context}: HTTP 404 Not Found`);
  }
  if (status === 507) {
    return new Error(`${context}: HTTP 507 Insufficient Storage on WebDAV server`);
  }
  return new Error(`${context}: HTTP ${status}`);
}

interface SimpleWebDavResponse {
  status: number;
  text(): Promise<string>;
  etag?: string | null;
}

async function webdavRequest(
  url: string,
  init: RequestInit,
  config: WebDavConnectionConfig,
  customFetch?: typeof fetch
): Promise<SimpleWebDavResponse> {
  if (!config.username || !config.password) {
    throw new Error('WebDAV username or app password is empty');
  }
  const method = (init.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    Authorization: encodeBasicAuth(config.username, config.password),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (!customFetch && typeof Zotero !== 'undefined' && typeof (Zotero as any).HTTP?.request === 'function') {
    const xhr = await (Zotero as any).HTTP.request(method, url, {
      headers,
      anon: true,
      logBodyLength: 0,
      body: typeof init.body === 'string' ? init.body : undefined,
      timeout: REQUEST_TIMEOUT_MS,
      successCodes: false,
    });
    return {
      status: Number(xhr?.status ?? 0),
      etag: xhr.getResponseHeader?.('ETag'),
      text: async () => String(xhr?.responseText ?? ''),
    };
  }

  const resolvedFetch: typeof fetch | undefined =
    customFetch ??
    (typeof fetch === 'function'
      ? fetch
      : typeof Zotero !== 'undefined' && typeof (Zotero.getMainWindow?.() as any)?.fetch === 'function'
        ? (Zotero.getMainWindow() as any).fetch.bind(Zotero.getMainWindow())
        : undefined);
  if (!resolvedFetch) {
    throw new Error('HTTP client is not available in this runtime');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`WebDAV ${method} request timed out`)), REQUEST_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([
      resolvedFetch(url, {
        ...init,
        method,
        headers,
      }),
      timeoutPromise,
    ]);
    return {
      status: res.status,
      etag: res.headers?.get('ETag'),
      text: () => res.text(),
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function ensureRemoteFolder(folderUrl: string, config: WebDavConnectionConfig, customFetch?: typeof fetch): Promise<void> {
  const probe = await webdavRequest(folderUrl, { method: 'PROPFIND', headers: { Depth: '0' } }, config, customFetch);
  if (probe.status >= 200 && probe.status < 300) return;
  if (probe.status !== 404) {
    throw formatHttpError(probe.status, 'WebDAV PROPFIND failed');
  }
  const mkcol = await webdavRequest(folderUrl, { method: 'MKCOL' }, config, customFetch);
  if ((mkcol.status >= 200 && mkcol.status < 300) || mkcol.status === 405) {
    return;
  }
  throw formatHttpError(mkcol.status, 'WebDAV MKCOL failed');
}

async function collectLocalPayload(
  includeApiKeys: boolean,
  options?: { isPush?: boolean; isPull?: boolean; minTimestamp?: number; remoteToOverwrite?: WebDavSyncPayload | null }
): Promise<WebDavSyncPayload> {
  const chatManager = typeof addon !== 'undefined' ? (addon?.chatManager ?? (addon?.data as any)?.chatManager) : undefined;
  if (chatManager) {
    await chatManager.flushHistory();
  }
  const chatHistory: PersistedChatHistoryFile = chatManager
    ? chatManager.historyStore.getSnapshot()
    : { version: 2, activeByScope: {}, conversations: [], deletedConversations: {} };

  const fullV2 = readLocalProviderConfigV2();
  const userPrompts = readLocalUserPrompts();
  const settings: Record<string, string | number | boolean> = {};
  for (const key of SYNCABLE_PREF_KEYS) {
    const val = getPref(key as any);
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      settings[key] = val;
    }
  }

  const { exportedAt, syncMeta } = reconcileLocalSyncMetadata(userPrompts, fullV2, settings, includeApiKeys, options);

  if (options?.isPush && exportedAt > 0) {
    const localConvIds = new Set<string>();
    for (const conv of chatHistory.conversations) {
      localConvIds.add(conv.id);
      conv.updatedAt = Math.max(conv.updatedAt ?? 0, conv.lastMessageAt, exportedAt);
    }
    const deletedMap: Record<string, number> = { ...(chatHistory.deletedConversations ?? {}) };
    for (const k of Object.keys(deletedMap)) {
      deletedMap[k] = Math.max(deletedMap[k] ?? 0, exportedAt);
    }
    for (const rConv of options.remoteToOverwrite?.chatHistory?.conversations ?? []) {
      if (rConv?.id && !localConvIds.has(rConv.id)) {
        deletedMap[rConv.id] = exportedAt;
      }
    }
    chatHistory.deletedConversations = deletedMap;
  }

  return {
    schema: WEBDAV_SYNC_SCHEMA,
    exportedAt,
    chatHistory,
    userPrompts,
    providerConfigV2: sanitizeProviderConfigForSync(fullV2, includeApiKeys),
    settings,
    syncMeta,
  };
}

async function applyMergedPayloadToLocal(
  mergedPayload: WebDavSyncPayload,
  remoteChatHistory: PersistedChatHistoryFile,
  includeApiKeys: boolean
): Promise<MergeHistoryResult> {
  const chatManager = typeof addon !== 'undefined' ? (addon?.chatManager ?? (addon?.data as any)?.chatManager) : undefined;
  const historyStats = chatManager
    ? chatManager.applyRemoteHistoryMerge(remoteChatHistory)
    : mergeHistoryFiles(mergedPayload.chatHistory, remoteChatHistory);
  if (Array.isArray(mergedPayload.userPrompts)) {
    writeLocalUserPrompts(mergedPayload.userPrompts);
  }

  let configWrite: Promise<void> | undefined;
  let finalV2: UserProviderConfigV2 | undefined;
  if (mergedPayload.providerConfigV2) {
    const localV2 = readLocalProviderConfigV2();
    finalV2 = {
      ...mergedPayload.providerConfigV2,
      env: includeApiKeys
        ? (mergedPayload.providerConfigV2.env ?? ({} as Record<ProviderId, Record<string, string>>))
        : (localV2?.env ?? ({} as Record<ProviderId, Record<string, string>>)),
    };
    configWrite = persistV2ConfigToLocal(finalV2);
  } else {
    finalV2 = readLocalProviderConfigV2();
  }

  if (mergedPayload.settings && typeof mergedPayload.settings === 'object') {
    for (const key of SYNCABLE_PREF_KEYS) {
      if (key in mergedPayload.settings) {
        const val = mergedPayload.settings[key];
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          setPref(key as any, val as any);
        }
      }
    }
  }

  const baselineTs = Math.max(mergedPayload.exportedAt || Date.now(), 1);
  const localState = readLocalSyncState();
  const baseSyncMeta: WebDavSyncMetadata = includeApiKeys
    ? (mergedPayload.syncMeta ?? {})
    : {
        ...(mergedPayload.syncMeta ?? {}),
        envUpdatedAt: localState.syncMeta?.envUpdatedAt ?? {},
        deletedEnv: localState.syncMeta?.deletedEnv ?? {},
      };
  const finalSyncMeta = buildSyncMetaFromPayload(
    {
      ...mergedPayload,
      providerConfigV2: finalV2,
      syncMeta: baseSyncMeta,
    },
    baselineTs
  );
  mergedPayload.syncMeta = sanitizeSyncMetaForSync(finalSyncMeta, includeApiKeys);
  mergedPayload.exportedAt = getMaxTimestampInSyncMeta(finalSyncMeta, baselineTs);
  observeSyncTimestamp(mergedPayload.exportedAt);

  writeLocalSyncState({
    lastConfigModifiedAt: mergedPayload.exportedAt,
    syncMeta: finalSyncMeta,
    baseline: createBaselineSnapshot(mergedPayload.userPrompts ?? [], finalV2, mergedPayload.settings ?? {}),
  });

  await configWrite;
  if (chatManager) await chatManager.flushHistory();
  return historyStats;
}

export async function testWebDavConnection(override?: Partial<WebDavConnectionConfig>, customFetch?: typeof fetch): Promise<void> {
  const config = await readConnectionConfig(override);
  const { folderUrl } = normalizeWebDavEndpoint(config.webdavUrl, config.remoteFolder);
  await ensureRemoteFolder(folderUrl, config, customFetch);
  const url = folderUrl + 'zaibar-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt';
  const body = 'Zotero AI Bar WebDAV verification';
  const put = await webdavRequest(url, { method: 'PUT', headers: { 'If-None-Match': '*' }, body }, config, customFetch);
  if (put.status < 200 || put.status >= 300) throw formatHttpError(put.status, 'WebDAV test PUT failed');
  let readError: unknown;
  try {
    const get = await webdavRequest(url, { method: 'GET' }, config, customFetch);
    if (get.status !== 200 || (await get.text()) !== body) throw new Error('WebDAV test file could not be read back');
  } catch (error) {
    readError = error;
  }
  const del = await webdavRequest(url, { method: 'DELETE' }, config, customFetch);
  if (readError) throw readError;
  if (del.status !== 200 && del.status !== 204) throw formatHttpError(del.status, 'WebDAV test DELETE failed');
}

export async function syncWithWebDav(
  mode: 'sync' | 'push' | 'pull' = 'sync',
  override?: Partial<WebDavConnectionConfig>,
  customFetch?: typeof fetch
): Promise<WebDavSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const config = await readConnectionConfig(override);
    const { folderUrl, fileUrl } = normalizeWebDavEndpoint(config.webdavUrl, config.remoteFolder);
    await ensureRemoteFolder(folderUrl, config, customFetch);
    await preparePortableItemIndex();

    if (mode === 'push') {
      let existingRemote: WebDavSyncPayload | null = null;
      let remoteMaxTs = 0;
      try {
        const probeGet = await webdavRequest(fileUrl, { method: 'GET' }, config, customFetch);
        if (probeGet.status >= 200 && probeGet.status < 300) {
          const text = await probeGet.text();
          if (text.trim()) {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
              existingRemote = parsed as WebDavSyncPayload;
              remoteMaxTs = getMaxTimestampInSyncMeta(existingRemote.syncMeta, existingRemote.exportedAt ?? 0);
              for (const conv of existingRemote.chatHistory?.conversations ?? []) {
                remoteMaxTs = Math.max(remoteMaxTs, conv.updatedAt ?? 0, conv.lastMessageAt ?? 0);
              }
            }
          }
        }
      } catch {
        // ignore probe GET errors during force push
      }
      const localPayload = await collectLocalPayload(config.includeApiKeys, {
        isPush: true,
        minTimestamp: remoteMaxTs,
        remoteToOverwrite: existingRemote,
      });
      const putRes = await webdavRequest(
        fileUrl,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(localPayload, null, 2),
        },
        config,
        customFetch
      );
      if (putRes.status < 200 || putRes.status >= 300) {
        throw formatHttpError(putRes.status, 'WebDAV PUT failed');
      }
      const syncedAt = Date.now();
      setPref('sync.lastSyncAt' as any, String(syncedAt));
      return {
        mode,
        syncedAt,
        imported: 0,
        updated: localPayload.chatHistory.conversations.length,
        deleted: 0,
        unchanged: 0,
      };
    }

    await collectLocalPayload(config.includeApiKeys, { isPull: mode === 'pull' });
    for (let attempt = 0; attempt < 3; attempt++) {
      const getRes = await webdavRequest(fileUrl, { method: 'GET' }, config, customFetch);
      let remotePayload: WebDavSyncPayload | null = null;
      if (getRes.status === 404) {
        if (mode === 'pull') {
          const syncedAt = Date.now();
          setPref('sync.lastSyncAt' as any, String(syncedAt));
          return { mode, syncedAt, imported: 0, updated: 0, deleted: 0, unchanged: 0 };
        }
      } else if (getRes.status >= 200 && getRes.status < 300) {
        const parsed = JSON.parse(await getRes.text());
        const history = sanitizeHistoryFile(parsed?.chatHistory);
        if (parsed?.schema !== WEBDAV_SYNC_SCHEMA || !history || history === 'unsupported') {
          throw new Error('Unsupported or invalid WebDAV sync snapshot');
        }
        remotePayload = { ...parsed, chatHistory: history };
      } else {
        throw formatHttpError(getRes.status, 'WebDAV GET failed');
      }

      const localPayload = await collectLocalPayload(config.includeApiKeys, { isPull: mode === 'pull' });
      let payloadToUpload = localPayload;

      if (remotePayload) {
        const merged = mergeSyncPayloads(localPayload, remotePayload, {
          includeApiKeys: config.includeApiKeys,
          preferRemote: mode === 'pull',
        });
        payloadToUpload = merged.mergedPayload;
      } else if (mode === 'sync') {
        payloadToUpload = await collectLocalPayload(config.includeApiKeys, { isPush: true });
      }

      if (mode === 'sync') {
        if (getRes.status !== 404 && (!getRes.etag || getRes.etag.startsWith('W/'))) {
          throw new Error('WebDAV server must provide a strong ETag for safe bidirectional sync');
        }
        const putRes = await webdavRequest(
          fileUrl,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              ...(getRes.status === 404 ? { 'If-None-Match': '*' } : { 'If-Match': getRes.etag! }),
            },
            body: JSON.stringify(payloadToUpload, null, 2),
          },
          config,
          customFetch
        );
        if (putRes.status === 412) continue;
        if (putRes.status < 200 || putRes.status >= 300) {
          throw formatHttpError(putRes.status, 'WebDAV PUT failed');
        }
      }
      // Preserve local edits made during network I/O, including the final PUT.
      const latest = await collectLocalPayload(config.includeApiKeys, { isPull: mode === 'pull' });
      const final = mergeSyncPayloads(latest, payloadToUpload, { includeApiKeys: config.includeApiKeys, preferRemote: mode === 'pull' });
      const historyStats = await applyMergedPayloadToLocal(final.mergedPayload, payloadToUpload.chatHistory, config.includeApiKeys);
      const syncedAt = Date.now();
      setPref('sync.lastSyncAt' as any, String(syncedAt));
      return {
        mode,
        syncedAt,
        imported: historyStats.imported,
        updated: historyStats.updated,
        deleted: historyStats.deleted,
        unchanged: historyStats.unchanged,
      };
    }
    throw new Error('WebDAV changed repeatedly during sync; please try again');
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export function startWebDavAutoSync(): void {
  stopWebDavAutoSync();
  const enabled = Boolean(getPref('sync.autoSync' as any));
  const username = ((getPref('sync.username' as any) as string) ?? '').trim();
  if (!enabled || !username) return;

  startupSyncTimer = setTimeout(() => {
    syncWithWebDav('sync').catch((err) => {
      try {
        ztoolkit.log('[webdavSync] startup auto-sync failed:', err);
      } catch {
        // ignore logging error
      }
    });
  }, STARTUP_SYNC_DELAY_MS);

  autoSyncTimer = setInterval(() => {
    if (!getPref('sync.autoSync' as any)) return;
    syncWithWebDav('sync').catch((err) => {
      try {
        ztoolkit.log('[webdavSync] periodic auto-sync failed:', err);
      } catch {
        // ignore logging error
      }
    });
  }, AUTO_SYNC_INTERVAL_MS);
}

export function stopWebDavAutoSync(): void {
  if (startupSyncTimer) {
    clearTimeout(startupSyncTimer);
    startupSyncTimer = null;
  }
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}
