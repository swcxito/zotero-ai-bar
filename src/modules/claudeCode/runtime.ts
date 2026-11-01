import { getPref, setPref } from '../../utils/prefs';
import {
  claudeArguments, claudeControlError, claudeControlResponse, claudeDiscoveryArguments, claudeEnvironment, claudeInitializeRequest,
  claudeMcpReply, claudeModelsFromLine, ClaudeStream, CLAUDE_INITIALIZE_REQUEST, CLAUDE_TOOL_SERVER, REQUIRED_CLAUDE_FLAGS,
  type ClaudeCodeModel, type ClaudeToolServer,
} from './protocol';

function subprocess(): any {
  return (ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs') as any).Subprocess;
}

function directory(): string { return PathUtils.join(PathUtils.profileDir, 'zaibar', 'claude-code', 'workspace'); }
const children = new Set<any>();

export async function stopClaudeCode(): Promise<void> {
  await Promise.allSettled([...children].map((child) => child.kill(1000)));
  children.clear();
}

async function collect(pipe: any, limit = 1024 * 1024): Promise<string> {
  let text = '';
  for (;;) {
    const chunk = await pipe.readString();
    if (!chunk) return text;
    text += chunk;
    if (text.length > limit) throw new Error('Claude Code diagnostic output is too large.');
  }
}

export async function findClaudeCode(manual?: string): Promise<string> {
  const configured = manual?.trim() || getPref('claudeCode.runtimePath')?.trim();
  if (configured) {
    if (!PathUtils.isAbsolute(configured) || /\.(cmd|bat|ps1)$/i.test(configured) || !(await IOUtils.exists(configured)))
      throw new Error('Select the official native claude executable using its absolute path (claude.exe on Windows).');
    return configured;
  }
  const env = subprocess().getEnvironment();
  const home = env.USERPROFILE || env.HOME;
  const candidates: string[] = [];
  if (home) candidates.push(PathUtils.join(home, '.local', 'bin', Zotero.isWin ? 'claude.exe' : 'claude'));
  if (Zotero.isWin && env.LOCALAPPDATA) candidates.push(PathUtils.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'));
  for (const candidate of candidates) if (await IOUtils.exists(candidate)) return candidate;
  try { return await subprocess().pathSearch(Zotero.isWin ? 'claude.exe' : 'claude'); } catch {
    throw new Error('Claude Code was not found. Install the official native CLI, run claude to sign in, then select its executable here.');
  }
}

async function launch(command: string, args: string[], env: Record<string, string>) {
  await IOUtils.makeDirectory(directory(), { permissions: 0o700, ignoreExisting: true });
  const child = await subprocess().call({ command, arguments: args, environment: env, stderr: 'pipe', workdir: directory() });
  children.add(child);
  return child;
}

async function diagnostic(command: string, args: string[], env: Record<string, string>): Promise<string> {
  const child = await launch(command, args, env);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await child.stdin.close();
    return await Promise.race([
      Promise.all([collect(child.stdout), collect(child.stderr), child.wait()]).then(([out, , status]) => {
        if (status.exitCode !== 0) throw new Error('Claude Code is not ready. Run claude in a terminal and complete the official login first.');
        return out;
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude Code check timed out.')), 15000); }),
    ]);
  } finally { clearTimeout(timer); await child.kill(1000).catch(() => undefined); children.delete(child); }
}

/** Resolve the actual Claude destinations; do not reuse OpenAI-specific proxy resolution. */
async function networkEnvironment(): Promise<Record<string, string>> {
  const env = claudeEnvironment(subprocess().getEnvironment());
  const service = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);
  const explicit = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  if (service.proxyConfigType === 5 && explicit) return env;
  const resolve = (url: string) => new Promise<string | undefined>((accept, reject) => {
    const timer = setTimeout(() => { request.cancel(Components.results.NS_ERROR_ABORT); reject(new Error('Unable to resolve Zotero proxy settings.')); }, 5000);
    const request = service.asyncResolve(Services.io.newURI(url), 0, {
      onProxyAvailable: (_request: unknown, _channel: unknown, proxy: nsIProxyInfo | null, status: number) => {
        clearTimeout(timer);
        if (!Components.isSuccessCode(status)) { reject(new Error('Unable to resolve Zotero proxy settings.')); return; }
        if (!proxy || proxy.type === 'direct') { accept(undefined); return; }
        const scheme = ({ http: 'http', https: 'https' } as Record<string, string>)[proxy.type];
        if (!scheme || !proxy.host || proxy.port < 1) { reject(new Error('Use an HTTP/HTTPS proxy for Claude Code.')); return; }
        const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
        accept(`${scheme}://${host}:${proxy.port}`);
      },
    } as nsIProtocolProxyCallback);
  });
  const [api, auth] = await Promise.all([resolve('https://api.anthropic.com/'), resolve('https://claude.ai/')]);
  if (api !== auth) throw new Error('Claude API and login destinations need the same proxy setting for this integration.');
  for (const key of Object.keys(env)) if (/^(https?_proxy|all_proxy)$/i.test(key)) delete env[key];
  return { ...env, ...(api ? { HTTPS_PROXY: api } : {}) };
}

export async function checkClaudeCode(manual?: string): Promise<{ path: string; version: string; plan: string }> {
  const command = await findClaudeCode(manual);
  const env = claudeEnvironment(subprocess().getEnvironment());
  const version = (await diagnostic(command, ['--version'], env)).trim();
  if (!/Claude Code/i.test(version)) throw new Error('The selected executable is not recognized as official Claude Code.');
  const help = await diagnostic(command, ['--help'], env);
  if (REQUIRED_CLAUDE_FLAGS.some((flag) => !help.includes(flag))) throw new Error('Update Claude Code: required streaming/isolation options are missing.');
  let status: any;
  try { status = JSON.parse(await diagnostic(command, ['auth', 'status', '--json'], env)); } catch {
    throw new Error('Unable to check Claude Code login. Run claude and sign in with your Claude account, then retry.');
  }
  if (status.loggedIn !== true || status.authMethod !== 'claude.ai')
    throw new Error('Sign in to the official Claude Code CLI using your Claude subscription. This provider does not use API-key billing.');
  if (manual?.trim()) setPref('claudeCode.runtimePath', command);
  return { path: command, version, plan: typeof status.subscriptionType === 'string' ? status.subscriptionType : 'Claude account' };
}

/** The models the official CLI offers this account (as in its /model picker). No model call is made. */
export async function listClaudeCodeModels(command: string): Promise<ClaudeCodeModel[]> {
  const child = await launch(command, claudeDiscoveryArguments(), await networkEnvironment());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    void collect(child.stderr, 64 * 1024).catch(() => undefined);
    await child.stdin.write(CLAUDE_INITIALIZE_REQUEST);
    const read = (async () => {
      let buffer = '';
      for (;;) {
        const chunk = await child.stdout.readString();
        if (!chunk) throw new Error('Claude Code exited before listing its models.');
        buffer += chunk;
        if (buffer.length > 1024 * 1024) throw new Error('Claude Code model list is too large.');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const models = claudeModelsFromLine(line);
          if (models) return models;
        }
      }
    })();
    return await Promise.race([
      read,
      // Generous: the first launch after an upgrade can be slow while the new binary is scanned.
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude Code model list timed out.')), 30000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await child.kill(1000).catch(() => undefined);
    children.delete(child);
  }
}

/**
 * With `server` (Agent mode) the CLI also gets AI Bar's Zotero tools as an in-process
 * MCP server: its tool calls arrive as control requests on stdout and are answered on
 * stdin, so stdin stays open until the final result.
 */
export async function runClaudeCode(
  model: string, input: string, signal: AbortSignal | undefined, onText: (text: string, segment: string) => Promise<void>,
  effort?: string, server?: ClaudeToolServer
): Promise<{ text: string; segment: string; usage: any; path: string; version: string }> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const info = await checkClaudeCode();
  const env = await networkEnvironment();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const child = await launch(info.path, claudeArguments(model, effort, !!server), env);
  const parser = new ClaudeStream();
  let active = true;
  let stdinClosed = false;
  const closeStdin = async () => {
    if (stdinClosed) return;
    stdinClosed = true;
    await child.stdin.close().catch(() => undefined);
  };
  if (server) {
    // Not awaited: a tool such as ask_user can wait for the user while the stream continues.
    parser.onControlRequest = (event) => void (async () => {
      const id = String(event.request_id);
      let reply: string;
      try {
        if (event.request?.subtype !== 'mcp_message' || event.request.server_name !== CLAUDE_TOOL_SERVER) throw new Error('Unsupported control request.');
        reply = claudeControlResponse(id, { mcp_response: await claudeMcpReply(event.request.message, server) });
      } catch (error) {
        reply = claudeControlError(id, (error as Error).message || 'Tool call failed.');
      }
      if (!stdinClosed) await child.stdin.write(reply).catch(() => undefined);
    })();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { void child.kill(1000).catch(() => undefined); rejectAbort(new DOMException('Cancelled', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const work = Promise.all([
      (async () => {
        for (;;) {
          const chunk = await child.stdout.readString();
          if (!chunk) break;
          const previous = parser.text;
          const previousSegment = parser.segment;
          parser.push(chunk);
          if (active && !signal?.aborted && (previous !== parser.text || previousSegment !== parser.segment)) await onText(parser.text, parser.segment);
          if (parser.result) await closeStdin();
        }
      })(),
      collect(child.stderr, 64 * 1024),
      child.wait(),
      (async () => {
        // An early CLI exit closes stdin ("File closed"); the exit status and stderr explain why.
        try {
          if (server) await child.stdin.write(claudeInitializeRequest('zaibar-init', [CLAUDE_TOOL_SERVER]));
          await child.stdin.write(input);
        } catch { /* reported by finish() */ }
        if (!server) await closeStdin();
      })(),
    ]);
    if (signal?.aborted) abort();
    const [, stderr, status] = await Promise.race([
      work, cancelled,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Claude Code request timed out after 10 minutes.')), 600000); }),
    ]);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { text: parser.finish(status.exitCode, stderr), segment: parser.segment, usage: parser.result?.usage, path: info.path, version: info.version };
  } finally {
    active = false;
    stdinClosed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await child.kill(1000).catch(() => undefined);
    children.delete(child);
  }
}
