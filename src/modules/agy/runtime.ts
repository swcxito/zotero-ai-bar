import { getPref, setPref } from '../../utils/prefs';
import {
  AgyAcpClient,
  AGY_SYSTEM_PROMPT,
  AGY_TOOL_SERVER,
  REQUIRED_AGY_ACP_FLAGS,
  agyAcpArguments,
  agyAgentSystemPrompt,
  agyEnvironment,
  agyModelsFromSessionNew,
  agyPermissionResult,
  agyTierFromSessionNew,
  ensureLoopbackNoProxy,
  redactAgyError,
  resolveAgySessionModel,
  type AgyModel,
  type AgyPromptBlock,
  type AgyToolServer,
  type AgyUsage,
} from './protocol';
import { startAgyMcpServer, type LoopbackMcpHandle } from './mcpServer';

function subprocess(): any {
  return (ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs') as any).Subprocess;
}

function directory(): string {
  return PathUtils.join(PathUtils.profileDir, 'zaibar', 'agy', 'workspace');
}

const children = new Set<any>();
const mcpHandles = new Set<LoopbackMcpHandle>();

export async function stopAgy(): Promise<void> {
  for (const handle of mcpHandles) handle.close();
  mcpHandles.clear();
  await Promise.allSettled([...children].map((child) => child.kill(1000)));
  children.clear();
}

async function collect(pipe: any, limit = 1024 * 1024): Promise<string> {
  let text = '';
  for (;;) {
    const chunk = await pipe.readString();
    if (!chunk) return text;
    text += chunk;
    if (text.length > limit) throw new Error('Antigravity diagnostic output is too large.');
  }
}

export async function findAgy(manual?: string): Promise<string> {
  const configured = manual?.trim() || getPref('agy.runtimePath')?.trim();
  if (configured) {
    if (!PathUtils.isAbsolute(configured) || /\.(cmd|bat|ps1)$/i.test(configured) || !(await IOUtils.exists(configured)))
      throw new Error('Select the official native agy executable using its absolute path (agy.exe on Windows).');
    return configured;
  }
  const env = subprocess().getEnvironment();
  const home = env.USERPROFILE || env.HOME;
  const candidates: string[] = [];
  if (Zotero.isWin && env.LOCALAPPDATA) candidates.push(PathUtils.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  if (home) {
    candidates.push(PathUtils.join(home, '.local', 'bin', Zotero.isWin ? 'agy.exe' : 'agy'));
    candidates.push(PathUtils.join(home, '.agy', 'bin', Zotero.isWin ? 'agy.exe' : 'agy'));
  }
  if (Zotero.isMac) candidates.push('/opt/homebrew/bin/agy', '/usr/local/bin/agy');
  for (const candidate of candidates) if (await IOUtils.exists(candidate)) return candidate;
  try {
    return await subprocess().pathSearch(Zotero.isWin ? 'agy.exe' : 'agy');
  } catch {
    throw new Error('Antigravity CLI (agy) was not found. Install agy, run agy to sign in, then select its executable here.');
  }
}

async function launch(command: string, args: string[], env: Record<string, string>) {
  await IOUtils.makeDirectory(directory(), { permissions: 0o700, ignoreExisting: true });
  const child = await subprocess().call({ command, arguments: args, environment: env, stderr: 'pipe', workdir: directory() });
  children.add(child);
  return child;
}

async function diagnostic(command: string, args: string[], env: Record<string, string>, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const child = await launch(command, args, env);
  const cancel = () => void child.kill(1000).catch(() => undefined);
  signal?.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    signal?.throwIfAborted();
    await child.stdin.close();
    return await Promise.race([
      Promise.all([collect(child.stdout), collect(child.stderr), child.wait()]).then(([out, err, status]) => {
        if (status.exitCode !== 0) throw new Error('Antigravity CLI is not ready. Run agy in a terminal and complete login first.');
        return out || err ? `${out}\n${err}` : '';
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Antigravity CLI check timed out.')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    await child.kill(1000).catch(() => undefined);
    children.delete(child);
  }
}

/** Resolve the actual Google Antigravity destinations from Zotero proxy settings. */
async function networkEnvironment(): Promise<Record<string, string>> {
  const env = agyEnvironment(subprocess().getEnvironment());
  const service = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);
  const explicit = env.HTTPS_PROXY || env.https_proxy || env.ALL_PROXY || env.all_proxy;
  if (service.proxyConfigType === 5 && explicit) return ensureLoopbackNoProxy(env);
  const resolve = (url: string) =>
    new Promise<string | undefined>((accept, reject) => {
      const timer = setTimeout(() => {
        request.cancel(Components.results.NS_ERROR_ABORT);
        reject(new Error('Unable to resolve Zotero proxy settings.'));
      }, 5000);
      const request = service.asyncResolve(Services.io.newURI(url), 0, {
        onProxyAvailable: (_request: unknown, _channel: unknown, proxy: nsIProxyInfo | null, status: number) => {
          clearTimeout(timer);
          if (!Components.isSuccessCode(status)) {
            reject(new Error('Unable to resolve Zotero proxy settings.'));
            return;
          }
          if (!proxy || proxy.type === 'direct') {
            accept(undefined);
            return;
          }
          const scheme = ({ http: 'http', https: 'https' } as Record<string, string>)[proxy.type];
          if (!scheme || !proxy.host || proxy.port < 1) {
            reject(new Error('Use an HTTP/HTTPS proxy for Antigravity CLI.'));
            return;
          }
          const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
          accept(`${scheme}://${host}:${proxy.port}`);
        },
      } as nsIProtocolProxyCallback);
    });
  const [api, auth] = await Promise.all([resolve('https://daily-cloudcode-pa.googleapis.com/'), resolve('https://accounts.google.com/')]);
  if (api !== auth) throw new Error('Antigravity API and Google login destinations need the same proxy setting for this integration.');
  for (const key of Object.keys(env)) if (/^(https?_proxy|all_proxy)$/i.test(key)) delete env[key];
  return ensureLoopbackNoProxy({ ...env, ...(api ? { HTTPS_PROXY: api } : {}) });
}

async function startAcpProcess(
  command: string,
  env: Record<string, string>,
  signal: AbortSignal | undefined,
  allowedToolNames?: ReadonlySet<string>,
  onUsageSize?: (size: number) => void,
  onDeniedTool?: (toolName: string) => void
): Promise<{
  child: any;
  client: AgyAcpClient;
  version: string;
  readLoop: Promise<void>;
  stderrPromise: Promise<string>;
  cleanup: () => Promise<void>;
}> {
  signal?.throwIfAborted();
  const child = await launch(command, agyAcpArguments(), env);
  const client = new AgyAcpClient((text) => child.stdin.write(text));
  client.onRequest = async (message) => {
    if (message.method === 'session/request_permission') {
      const reply = agyPermissionResult(message.params, allowedToolNames);
      const toolName = typeof message.params?.toolCall?.name === 'string' ? message.params.toolCall.name : '';
      if (reply.outcome.outcome === 'cancelled' || reply.outcome.optionId === 'deny') {
        if (toolName) onDeniedTool?.(toolName);
      }
      return reply;
    }
    throw new Error('Unsupported ACP request.');
  };
  if (onUsageSize) {
    client.listeners.add((message) => {
      if (message.method === 'session/update' && message.params?.update?.sessionUpdate === 'usage_update') {
        const size = message.params.update.size;
        if (typeof size === 'number' && size > 0) onUsageSize(size);
      }
    });
  }

  let cleaned = false;
  const stderrPromise = collect(child.stderr, 64 * 1024).catch(() => '');
  const readLoop = (async () => {
    try {
      for (;;) {
        const chunk = await child.stdout.readString();
        if (!chunk) {
          client.feed('', true);
          break;
        }
        client.feed(chunk);
      }
    } catch {
      // Closed by abort or process exit; close() rejects pending requests below.
    } finally {
      const stderr = await stderrPromise;
      const detail = redactAgyError(stderr.trim().slice(-600));
      client.close(new Error(detail ? `Antigravity ACP exited: ${detail}` : 'Antigravity ACP connection closed unexpectedly.'));
    }
  })();

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    client.close();
    await child.stdin.close().catch(() => undefined);
    await child.kill(1000).catch(() => undefined);
    children.delete(child);
  };

  try {
    const init = await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'zotero-ai-bar', version: '1.0.0' },
      },
      20000
    );
    const serverName = String(init?.agentInfo?.name || '');
    if (!/Antigravity/i.test(serverName)) {
      throw new Error('The selected executable is not recognized as official Antigravity CLI.');
    }
    const version = String(init?.agentInfo?.version || '').trim() || 'unknown';
    return { child, client, version, readLoop, stderrPromise, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export interface AgyCheckResult {
  path: string;
  version: string;
  plan: string;
  models: AgyModel[];
  contextWindow: number;
}

function formatAgyAuthError(error: unknown): Error {
  const message = redactAgyError(String((error as Error)?.message || error || ''));
  if (/auth|login|sign.?in|unauthenticated|credential|unauthorized|401/i.test(message)) {
    return new Error('Antigravity CLI is not signed in. Run agy (or agy acp --login) in a terminal to sign in, then retry.');
  }
  return new Error(message || 'Unable to connect to Antigravity CLI. Run agy in a terminal and sign in first.');
}

/** Verifies binary, ACP flags, existing login, subscription tier and account model catalog in one check. */
export async function checkAgy(manual?: string, signal?: AbortSignal): Promise<AgyCheckResult> {
  signal?.throwIfAborted();
  const command = await findAgy(manual);
  const baseEnv = agyEnvironment(subprocess().getEnvironment());
  const help = await diagnostic(command, ['acp', '--help'], baseEnv, signal);
  if (REQUIRED_AGY_ACP_FLAGS.some((flag) => !help.includes(flag))) {
    throw new Error('Update Antigravity CLI: required ACP isolation options are missing.');
  }
  const env = await networkEnvironment();
  signal?.throwIfAborted();

  let contextWindow = 0;
  const acp = await startAcpProcess(command, env, signal, undefined, (size) => {
    contextWindow = size;
  });
  const onAbort = () => void acp.cleanup();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    let created: any;
    try {
      created = await acp.client.request('session/new', { cwd: directory(), mcpServers: [] }, 30000);
    } catch (error) {
      signal?.throwIfAborted();
      throw formatAgyAuthError(error);
    }
    const models = agyModelsFromSessionNew(created);
    if (!models.length) {
      throw new Error('Antigravity CLI returned no models. Run agy (or agy acp --login) in a terminal to sign in, then retry.');
    }
    if (typeof created?.sessionId === 'string') {
      await acp.client.request('session/close', { sessionId: created.sessionId }, 5000).catch(() => undefined);
    }
    signal?.throwIfAborted();
    if (manual?.trim()) setPref('agy.runtimePath', command);
    return {
      path: command,
      version: acp.version,
      plan: agyTierFromSessionNew(created),
      models,
      contextWindow,
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await acp.cleanup();
  }
}

export interface AgyRunResult {
  text: string;
  segment: string;
  usage?: AgyUsage;
  contextWindow: number;
  path: string;
  version: string;
}

/**
 * Runs one turn over `agy acp --stdio`.
 * With `server` (Agent mode), starts an ephemeral loopback-only HTTP MCP server authenticated
 * with a per-turn Bearer token and allowlists only AI Bar's registered Zotero tools.
 */
export async function runAgy(
  model: string,
  prompt: AgyPromptBlock[],
  signal: AbortSignal | undefined,
  onText: (fullText: string, segmentText: string) => Promise<void>,
  effort?: string,
  server?: AgyToolServer
): Promise<AgyRunResult> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const command = await findAgy();
  const env = await networkEnvironment();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const segments: string[] = [''];
  const fullText = () => segments.filter((segment) => segment.trim()).join('\n\n');
  const currentSegment = () => segments.at(-1) ?? '';

  // Split assistant text into a fresh segment whenever a Zotero tool executes so
  // post-tool text renders below the tool card, matching Codex and Claude Code.
  const wrappedServer: AgyToolServer | undefined = server
    ? {
        tools: server.tools,
        async call(name, args, toolUseId) {
          const result = await server.call(name, args, toolUseId);
          if (segments.at(-1)?.trim()) segments.push('');
          return result;
        },
      }
    : undefined;

  const allowedTools = server ? new Set(server.tools.map((tool) => `mcp_${AGY_TOOL_SERVER}_${tool.name}`)) : undefined;
  let mcpHandle: LoopbackMcpHandle | undefined;
  if (wrappedServer) {
    mcpHandle = startAgyMcpServer(wrappedServer);
    mcpHandles.add(mcpHandle);
  }

  let contextWindow = 0;
  let deniedTool: string | undefined;
  let acp: Awaited<ReturnType<typeof startAcpProcess>>;
  try {
    acp = await startAcpProcess(
      command,
      env,
      signal,
      allowedTools,
      (size) => {
        contextWindow = size;
      },
      (toolName) => {
        deniedTool = toolName;
      }
    );
  } catch (error) {
    if (mcpHandle) {
      mcpHandle.close();
      mcpHandles.delete(mcpHandle);
    }
    throw error;
  }

  let sessionId: string | undefined;
  let active = true;
  let renderChain = Promise.resolve();
  let rejectAbort!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    active = false;
    if (sessionId) void acp.client.notify('session/cancel', { sessionId }).catch(() => undefined);
    void acp.cleanup();
    rejectAbort(new DOMException('Cancelled', 'AbortError'));
  };
  signal?.addEventListener('abort', abort, { once: true });

  acp.client.listeners.add((message) => {
    if (message.method !== 'session/update') return;
    if (sessionId && message.params?.sessionId !== sessionId) return;
    const update = message.params?.update;
    if (server && update?.sessionUpdate === 'tool_call') {
      if (segments.at(-1)?.trim()) segments.push('');
      return;
    }
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') {
      segments[segments.length - 1] += update.content.text;
      const fullSnapshot = fullText();
      const segSnapshot = currentSegment();
      renderChain = renderChain.then(async () => {
        if (active && !signal?.aborted) await onText(fullSnapshot, segSnapshot);
      });
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal?.aborted) abort();
    const work = (async (): Promise<AgyRunResult> => {
      let created: any;
      try {
        created = await acp.client.request(
          'session/new',
          {
            cwd: directory(),
            mcpServers: mcpHandle
              ? [
                  {
                    type: 'http',
                    name: AGY_TOOL_SERVER,
                    url: mcpHandle.url,
                    headers: [{ name: 'Authorization', value: `Bearer ${mcpHandle.token}` }],
                  },
                ]
              : [],
            _meta: {
              systemPrompt: {
                append: server ? agyAgentSystemPrompt(server.tools.map((t) => t.name)) : AGY_SYSTEM_PROMPT,
              },
            },
          },
          30000
        );
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        throw formatAgyAuthError(error);
      }
      sessionId = created?.sessionId;
      if (typeof sessionId !== 'string' || !sessionId) {
        throw new Error('Antigravity ACP did not return a valid session id.');
      }
      const sessionModels = agyModelsFromSessionNew(created);
      const targetModelId = resolveAgySessionModel(model, effort, sessionModels);
      await acp.client.request('session/set_model', { sessionId, modelId: targetModelId }, 15000);
      const response = await acp.client.request('session/prompt', { sessionId, prompt }, 600000);
      await renderChain;
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (response?.stopReason === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
      const finalText = fullText();
      if (!finalText.trim()) {
        if (deniedTool) {
          throw new Error(
            server
              ? `Antigravity tried to run restricted local tool "${deniedTool}" instead of Zotero tools, which was blocked for safety. Please retry.`
              : `Antigravity tried to run restricted local tool "${deniedTool}", which was blocked for safety. Switch to Agent mode to access your Zotero library, or retry.`
          );
        }
        throw new Error('Antigravity returned no text. Check sign-in, quota and network settings in agy.');
      }
      await acp.client.request('session/close', { sessionId }, 5000).catch(() => undefined);
      return {
        text: finalText,
        segment: currentSegment(),
        usage: response?.usage,
        contextWindow,
        path: command,
        version: acp.version,
      };
    })();

    return await Promise.race([
      work,
      cancelled,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Antigravity request timed out after 10 minutes.')), 600000);
      }),
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (mcpHandle) {
      mcpHandle.close();
      mcpHandles.delete(mcpHandle);
    }
    await acp.cleanup();
  }
}
