/** Audited against a local mock Responses endpoint; never widen this to a semver range. */
export const AUDITED_CODEX_VERSIONS = ['0.154.0-alpha.6.2'];
export const CODEX_PROVIDER_ID = 'codex-subscription';

export interface CodexBinding {
  threadId: string;
  account: string;
  model: string;
  mode: string;
  /** Local history fingerprint corresponding to the last completed remote turn. */
  context: string;
  turnId?: string;
}

export function sanitizeCodexBinding(value: unknown): CodexBinding | undefined {
  const v = value as CodexBinding | undefined;
  if (!v || !['threadId', 'account', 'model', 'mode', 'context'].every((k) => typeof (v as any)[k] === 'string')) return undefined;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(v.threadId)) return undefined;
  return {
    threadId: v.threadId,
    account: v.account,
    model: v.model,
    mode: v.mode,
    context: v.context,
    turnId: typeof v.turnId === 'string' ? v.turnId : undefined,
  };
}

/** Not a security hash: detects local history edits, retries and backend switches. */
export function contextFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

export function runtimePolicy(versionOutput: string, featureOutput: string): Record<string, unknown> {
  const version = versionOutput.trim().replace(/^codex-cli\s+/, '');
  if (!AUDITED_CODEX_VERSIONS.includes(version)) {
    throw new Error(`Codex ${version}: 此版本尚未验证工具权限，已停用。已验证版本：${AUDITED_CODEX_VERSIONS.join(', ')}`);
  }
  const names = featureOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[0]);
  if (!['shell_tool', 'unified_exec', 'apps', 'plugins', 'view_image', 'browser_use', 'computer_use'].every((name) => names.includes(name))) {
    throw new Error('Codex 功能清单不完整，不能验证工具权限。');
  }
  if (names.some((name) => !/^[a-z][a-z0-9_.]*$/.test(name))) throw new Error('Codex 功能清单格式不兼容。');
  return {
    ...Object.fromEntries(names.map((name) => [`features.${name}`, false])),
    'features.skip_host_skill_discovery': true,
    web_search: 'live',
    sandbox_mode: 'read-only',
    approval_policy: 'never',
    cli_auth_credentials_store: 'file',
    check_for_update_on_startup: false,
    model_provider: 'openai',
  };
}

/** Empty tables merge in Codex. Disable every configured server by name before creating a thread. */
export function disableConfiguredMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (!config || typeof config !== 'object') throw new Error('无法读取 Codex 的实际配置，已阻止创建会话。');
  const servers = config.mcp_servers;
  if (servers === undefined || servers === null) return {};
  if (typeof servers !== 'object' || Array.isArray(servers)) throw new Error('MCP 配置格式无法安全限制。');
  const overrides: Record<string, unknown> = {};
  for (const name of Object.keys(servers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('插件专用 Codex 配置含不兼容的 MCP 名称，请移除额外 MCP 配置。');
    overrides[`mcp_servers.${name}.enabled`] = false;
  }
  return overrides;
}

export function policyArguments(policy: Record<string, unknown>): string[] {
  return Object.entries(policy).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]);
}

export function isPublicPdfUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    // No IP literals, local hostnames, credentials, alternate protocols or local network resources.
    const host = url.hostname.toLowerCase();
    return host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
  } catch {
    return false;
  }
}
