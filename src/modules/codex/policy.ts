import { codexString } from './i18n';

/**
 * Minimum version whose tool-permission contract has been audited against the
 * local mock Responses endpoint. Newer versions must still expose the
 * required feature set below, but do not need to be listed individually.
 */
export const MINIMUM_SUPPORTED_CODEX_VERSION = '0.154.0-alpha.6.2';
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

interface ParsedCodexVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

function parseCodexVersion(value: string): ParsedCodexVersion | undefined {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  const numbers = match.slice(1, 4).map(Number);
  if (numbers.some((number) => !Number.isSafeInteger(number))) return undefined;
  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease: match[4] ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [],
  };
}

function compareCodexVersions(left: ParsedCodexVersion, right: ParsedCodexVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    if (i >= left.prerelease.length) return -1;
    if (i >= right.prerelease.length) return 1;
    const a = left.prerelease[i];
    const b = right.prerelease[i];
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
    if (typeof a === 'number') return -1;
    if (typeof b === 'number') return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function isCodexVersionSupported(versionOutput: string): boolean {
  const version = versionOutput.trim().replace(/^codex-cli\s+/, '');
  const actual = parseCodexVersion(version);
  const minimum = parseCodexVersion(MINIMUM_SUPPORTED_CODEX_VERSION);
  return !!actual && !!minimum && compareCodexVersions(actual, minimum) >= 0;
}

export function runtimePolicy(versionOutput: string, featureOutput: string): Record<string, unknown> {
  const version = versionOutput.trim().replace(/^codex-cli\s+/, '');
  if (!isCodexVersionSupported(version)) {
    throw new Error(
      codexString(
        'codex-error-version-unverified',
        `Codex ${version}: 低于最低支持版本 ${MINIMUM_SUPPORTED_CODEX_VERSION}，或版本格式无法识别，已停用。`,
        {
          version,
          minimum: MINIMUM_SUPPORTED_CODEX_VERSION,
        }
      )
    );
  }
  const names = featureOutput
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[0]);
  const requiredFeatures = [
    'shell_tool',
    'unified_exec',
    'apps',
    'plugins',
    'view_image',
    'browser_use',
    'computer_use',
    // Agent-mode dynamic tools are routed through Codex Code Mode.
    'code_mode',
    'code_mode_host',
  ];
  if (!requiredFeatures.every((name) => names.includes(name))) {
    throw new Error(codexString('codex-error-features-incomplete', 'Codex 功能清单不完整，不能验证工具权限。'));
  }
  if (names.some((name) => !/^[a-z][a-z0-9_.]*$/.test(name)))
    throw new Error(codexString('codex-error-features-format', 'Codex 功能清单格式不兼容。'));
  return {
    ...Object.fromEntries(names.map((name) => [`features.${name}`, false])),
    // The model catalog marks the current Agent models as code_mode_only. Keep
    // the Code Mode bridge enabled so registered Zotero dynamic tools can be
    // called, while all shell/browser/app features remain disabled above.
    'features.code_mode': true,
    'features.code_mode_host': true,
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
  if (!config || typeof config !== 'object')
    throw new Error(codexString('codex-error-config-unreadable', '无法读取 Codex 的实际配置，已阻止创建会话。'));
  const servers = config.mcp_servers;
  if (servers === undefined || servers === null) return {};
  if (typeof servers !== 'object' || Array.isArray(servers))
    throw new Error(codexString('codex-error-mcp-config-format', 'MCP 配置格式无法安全限制。'));
  const overrides: Record<string, unknown> = {};
  for (const name of Object.keys(servers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error(codexString('codex-error-mcp-name', '插件专用 Codex 配置含不兼容的 MCP 名称，请移除额外 MCP 配置。'));
    overrides[`mcp_servers.${name}.enabled`] = false;
  }
  return overrides;
}

export function policyArguments(policy: Record<string, unknown>): string[] {
  return Object.entries(policy).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]);
}
