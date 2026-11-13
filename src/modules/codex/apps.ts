import type { CodexRpc } from './protocol';
import { getPref, setPref } from '../../utils/prefs';

export interface CodexApp {
  id: string;
  name: string;
  description: string;
  isAccessible: boolean;
  isEnabled: boolean;
  installUrl?: string;
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id) && id !== '_default';

export function appFeatures(policy: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  const flags: Record<string, unknown> = { 'features.apps': enabled };
  for (const name of ['auth_elicitation', 'tool_call_mcp_elicitation', 'mcp_oauth_refresh_coordination']) {
    const key = `features.${name}`;
    if (Object.hasOwn(policy, key)) flags[key] = enabled;
  }
  return flags;
}

/** A malformed entry is skipped (never selectable) so one bad row cannot hide a catalog of thousands. */
export function parseApps(data: unknown): CodexApp[] {
  if (!Array.isArray(data)) throw new Error('Invalid Codex app list');
  const apps = new Map<string, CodexApp>();
  for (const app of data) {
    if (!app || !validId(app.id) || typeof app.name !== 'string') continue;
    apps.set(app.id, {
      id: app.id,
      name: app.name,
      description: typeof app.description === 'string' ? app.description : '',
      isAccessible: app.isAccessible === true,
      isEnabled: app.isEnabled === true,
      installUrl: appInstallUrl(app.installUrl),
    });
  }
  return [...apps.values()];
}

/** Only official app-directory links are opened from the discovery list. */
export function appInstallUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.username && !url.password && !url.port) return url.href;
  } catch {
    /* No usable installation link. */
  }
  return undefined;
}

/**
 * The catalog is the whole ChatGPT app directory (thousands of entries). Show the
 * connected ones, plus selected ones that lost access so they can be turned off.
 */
export function visibleApps(apps: CodexApp[], selected: string[]): CodexApp[] {
  return apps.filter((app) => app.isAccessible || selected.includes(app.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Short reason for a failed app/list, from the runtime's error (which may embed an HTML page). */
export function appListFailureReason(error: unknown): string {
  const message = String((error as { rpcError?: { message?: unknown } })?.rpcError?.message ?? '');
  const status = /status (\d{3})/.exec(message)?.[1];
  if (!status) return '';
  return /Enable JavaScript and cookies/i.test(message) ? `HTTP ${status}, browser verification` : `HTTP ${status}`;
}

export async function listApps(rpc: CodexRpc, forceRefetch = false): Promise<CodexApp[]> {
  const apps = new Map<string, CodexApp>();
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await rpc.request('app/list', { cursor, limit: 100, forceRefetch: forceRefetch && !cursor }, 60000);
    for (const app of parseApps(page.data)) apps.set(app.id, app);
    cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined && (typeof cursor !== 'string' || !cursor || seen.has(cursor) || seen.size >= 100))
      throw new Error('Invalid Codex app pagination');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function selections(): Record<string, string[]> {
  try {
    const value = JSON.parse(getPref('codex.apps.selection') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    /* A damaged preference never enables an app. */
  }
  return {};
}

export function selectedAppIds(account: string): string[] {
  const ids = selections()[account];
  return Array.isArray(ids) ? [...new Set(ids.filter(validId))].sort() : [];
}

export function selectApp(account: string, id: string, enabled: boolean): void {
  if (!account || !validId(id)) throw new Error('Invalid Codex app selection');
  const all = selections();
  const ids = new Set(selectedAppIds(account));
  if (enabled) ids.add(id);
  else ids.delete(id);
  Object.defineProperty(all, account, { value: [...ids].sort(), enumerable: true, configurable: true, writable: true });
  setPref('codex.apps.selection', JSON.stringify(all));
}

/** Override inherited per-app enables too. Never write to the shared Codex config. */
export function appThreadPolicy(config: Record<string, unknown>, selected: string[]): Record<string, unknown> {
  const inherited = config.apps;
  if (inherited != null && (typeof inherited !== 'object' || Array.isArray(inherited))) throw new Error('Invalid Codex apps configuration');
  const ids = new Set([...Object.keys(inherited || {}).filter((id) => id !== '_default'), ...selected]);
  const overrides: Record<string, unknown> = { 'features.apps': selected.length > 0, 'apps._default.enabled': false };
  for (const id of ids) {
    if (!validId(id)) throw new Error('Invalid Codex app configuration key');
    overrides[`apps.${id}.enabled`] = selected.includes(id);
  }
  return overrides;
}
