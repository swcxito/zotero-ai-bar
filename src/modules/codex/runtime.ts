import { getPref, setPref } from '../../utils/prefs';
import { policyArguments, runtimePolicy } from './policy';
import { CodexRpc } from './protocol';
import { version as pluginVersion } from '../../../package.json';

export interface RuntimeCandidate {
  path: string;
  source: 'desktop' | 'system' | 'manual';
}
export interface RuntimeInfo extends RuntimeCandidate {
  version: string;
  policy: Record<string, unknown>;
}
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  inputModalities: string[];
  supportedReasoningEfforts: { reasoningEffort: string }[];
  defaultReasoningEffort: string;
}
export interface CodexAccount {
  type: string;
  email?: string;
  planType?: string;
}

function subprocess(): any {
  return (ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs') as any).Subprocess;
}

export function codexDirectory(): string {
  return PathUtils.join(PathUtils.profileDir, 'zaibar', 'codex');
}

async function prepareDirectories(): Promise<void> {
  await IOUtils.makeDirectory(codexDirectory(), { permissions: 0o700, ignoreExisting: true });
  await IOUtils.makeDirectory(PathUtils.join(codexDirectory(), 'workspace'), { permissions: 0o700, ignoreExisting: true });
}

/** Do not inherit API keys, desktop bridge sockets, provider overrides or proxy credentials. */
function environment(sharedLogin = false): Record<string, string> {
  const inherited = subprocess().getEnvironment();
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
  ];
  const env = Object.fromEntries(allowed.filter((k) => inherited[k]).map((k) => [k, inherited[k]]));
  // A separate home also prevents discovery of the user's global skills/config.
  const userHome = inherited.HOME || inherited.USERPROFILE;
  const sharedHome = inherited.CODEX_HOME || (userHome ? PathUtils.join(userHome, '.codex') : undefined);
  return { ...env, HOME: codexDirectory(), CODEX_HOME: sharedLogin && sharedHome ? sharedHome : codexDirectory() };
}

/** Child processes do not inherit Gecko/system proxy settings. Resolve them without reading credentials. */
export async function runtimeNetworkEnvironment(): Promise<Record<string, string>> {
  const inherited = subprocess().getEnvironment();
  const service = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);
  const explicit = inherited.HTTPS_PROXY || inherited.https_proxy || inherited.ALL_PROXY || inherited.all_proxy;
  if (service.proxyConfigType === 5 && explicit)
    return { HTTPS_PROXY: explicit, ...(inherited.NO_PROXY || inherited.no_proxy ? { NO_PROXY: inherited.NO_PROXY || inherited.no_proxy } : {}) };
  const resolve = (url: string): Promise<string | undefined> =>
    new Promise((accept, reject) => {
      const timer = setTimeout(() => {
        request.cancel(Components.results.NS_ERROR_ABORT);
        reject(new Error('无法读取 Zotero 网络代理，请检查网络设置后重试。'));
      }, 5000);
      const request = service.asyncResolve(Services.io.newURI(url), 0, {
        onProxyAvailable: (_request: unknown, _channel: unknown, proxy: nsIProxyInfo | null, status: number) => {
          clearTimeout(timer);
          if (!Components.isSuccessCode(status)) {
            reject(new Error('Zotero 网络代理解析失败。'));
            return;
          }
          if (!proxy || proxy.type === 'direct') {
            accept(undefined);
            return;
          }
          const scheme = ({ http: 'http', https: 'https', socks: 'socks5h', socks4: 'socks4a' } as Record<string, string>)[proxy.type];
          if (!scheme || !proxy.host || proxy.port < 1) {
            reject(new Error('当前网络代理类型不受 Codex 支持。'));
            return;
          }
          const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
          accept(`${scheme}://${host}:${proxy.port}`);
        },
      } as nsIProtocolProxyCallback);
    });
  const [chat, auth] = await Promise.all([resolve('https://chatgpt.com/backend-api/codex/responses'), resolve('https://auth.openai.com/')]);
  if (chat !== auth) throw new Error('ChatGPT 和登录服务使用不同的代理规则；当前 Codex 连接无法安全复用，请使用统一代理设置。');
  return chat ? { HTTPS_PROXY: chat } : {};
}

async function collect(pipe: any): Promise<string> {
  let text = '';
  for (;;) {
    const chunk = await pipe.readString();
    if (!chunk) return text;
    text += chunk;
    if (text.length > 2 * 1024 * 1024) throw new Error('运行时检测输出过大。');
  }
}

export async function runLocal(command: string, args: string[], timeout = 6000): Promise<string> {
  const process = await subprocess().call({ command, arguments: args, environment: environment(), stderr: 'pipe', workdir: codexDirectory() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all([collect(process.stdout), collect(process.stderr), process.wait()]).then(([out, , result]) => {
        if (result.exitCode !== 0) throw new Error('运行时检测命令失败。');
        return out;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('运行时检测超时。')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await process.kill(1000).catch(() => undefined);
  }
}

/** Bounded traversal of known application/package subdirectories, never a whole-drive search. */
async function findNativeWindowsRuntime(root: string, depth = 0): Promise<string[]> {
  if (depth > 7 || !(await IOUtils.exists(root))) return [];
  const results: string[] = [];
  for (const child of await IOUtils.getChildren(root).catch(() => [] as string[])) {
    const name = PathUtils.filename(child);
    if (name.toLowerCase() === 'codex.exe') results.push(child);
    else if (
      /^(app|bin|resources|app\.asar\.unpacked|node_modules|@openai|codex[^/\\]*|vendor|[^/\\]*windows[^/\\]*|[^/\\]*mingw[^/\\]*|[^/\\]*msvc[^/\\]*)$/i.test(
        name
      )
    ) {
      if ((await IOUtils.stat(child)).type === 'directory') results.push(...(await findNativeWindowsRuntime(child, depth + 1)));
    }
  }
  return results;
}

export async function discoverCandidates(): Promise<RuntimeCandidate[]> {
  const candidates: RuntimeCandidate[] = [];
  const env = subprocess().getEnvironment();
  if (Zotero.isMac) {
    const roots = ['/Applications', ...(env.HOME ? [PathUtils.join(env.HOME, 'Applications')] : [])];
    for (const root of roots)
      for (const app of ['Codex.app', 'ChatGPT.app']) {
        candidates.push({ path: PathUtils.join(root, app, 'Contents', 'Resources', 'codex'), source: 'desktop' });
      }
  } else if (Zotero.isWin) {
    // Discover both MSIX and regular installations using installed-app metadata.
    const powershell = PathUtils.join(env.SystemRoot || env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const query =
      "$ErrorActionPreference='SilentlyContinue'; $locations=@(Get-AppxPackage | Where-Object { $_.Name -match 'OpenAI|ChatGPT|Codex' } | ForEach-Object { $_.InstallLocation }); foreach($key in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')) { $locations+=@(Get-ItemProperty $key | Where-Object { $_.DisplayName -match '^(ChatGPT|Codex)( |$)' } | ForEach-Object { $_.InstallLocation }) }; ConvertTo-Json -Compress -InputObject @($locations | Where-Object { $_ } | Select-Object -Unique)";
    try {
      const locations = JSON.parse(await runLocal(powershell, ['-NoProfile', '-NonInteractive', '-Command', query]));
      for (const location of Array.isArray(locations) ? locations : []) {
        if (typeof location !== 'string' || !PathUtils.isAbsolute(location)) continue;
        for (const path of await findNativeWindowsRuntime(location)) candidates.push({ path, source: 'desktop' });
      }
    } catch {
      /* System CLI detection remains available if app metadata is inaccessible. */
    }
  } else {
    throw new Error('Codex 订阅接入目前仅支持 macOS 和 Windows。');
  }
  try {
    const path: string = await subprocess().pathSearch('codex');
    if (Zotero.isWin && /\.(cmd|bat|ps1)$/i.test(path)) {
      // npm shims are not native executables. Resolve the package's vendored exe, without invoking a shell.
      const root = PathUtils.join(PathUtils.parent(path)!, 'node_modules', '@openai');
      for (const native of await findNativeWindowsRuntime(root)) candidates.push({ path: native, source: 'system' });
    } else candidates.push({ path, source: 'system' });
  } catch {
    /* Missing from the GUI application's PATH. Manual selection remains available. */
  }
  if (Zotero.isMac) {
    for (const path of ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']) candidates.push({ path, source: 'system' });
  }
  const manual = getPref('codex.runtimePath');
  if (manual) candidates.push({ path: manual, source: 'manual' });
  return candidates.filter((entry, index, all) => all.findIndex((other) => other.path === entry.path) === index);
}

class CodexRuntime {
  get sharedLogin(): boolean {
    return getPref('codex.authSource') === 'shared';
  }
  set sharedLogin(value: boolean) {
    setPref('codex.authSource', value ? 'shared' : 'private');
  }
  info?: RuntimeInfo;
  rpc?: CodexRpc;
  account?: CodexAccount;
  models: CodexModel[] = [];
  status = '尚未检测';
  diagnostics: string[] = [];
  readonly listeners = new Set<() => void>();
  private process?: any;
  private detecting?: Promise<RuntimeInfo | undefined>;
  private starting?: Promise<CodexRpc>;
  private stopped = false;
  private loginId?: string;
  private cancelPendingLogin?: () => void;
  get loginPending(): boolean {
    return !!this.cancelPendingLogin;
  }
  cancelLogin(): void {
    this.cancelPendingLogin?.();
  }
  private generation = 0;
  get accountKey(): string | undefined {
    return !this.loginPending && this.account?.type === 'chatgpt' ? this.account.email : undefined;
  }
  changed(): void {
    for (const listener of this.listeners) listener();
  }

  detect(): Promise<RuntimeInfo | undefined> {
    if (this.detecting) return this.detecting;
    this.detecting = (async () => {
      this.status = '正在检测运行时';
      this.diagnostics = [];
      this.changed();
      await prepareDirectories();
      for (const candidate of await discoverCandidates()) {
        if (this.stopped) return undefined;
        if (!(await IOUtils.exists(candidate.path))) continue;
        try {
          const version = await runLocal(candidate.path, ['--version']);
          const features = await runLocal(candidate.path, ['features', 'list']);
          const policy = runtimePolicy(version, features);
          const help = await runLocal(candidate.path, ['app-server', '--help']);
          if (!help.includes('generate-json-schema')) throw new Error('缺少 App Server 协议支持。');
          this.info = { ...candidate, version: version.trim(), policy };
          this.status = '运行时就绪';
          this.changed();
          return this.info;
        } catch (error) {
          this.diagnostics.push(`${candidate.source}: ${candidate.path} — ${(error as Error).message}`);
        }
      }
      this.info = undefined;
      this.status = '没有找到兼容的 Codex 运行时';
      this.changed();
      return undefined;
    })()
      .catch(() => {
        this.status = 'Codex 检测失败，请重新检测或手动选择';
        this.changed();
        return undefined;
      })
      .finally(() => {
        this.detecting = undefined;
      });
    return this.detecting;
  }

  async connect(): Promise<CodexRpc> {
    if (this.stopped) throw new Error('插件已关闭。');
    if (this.rpc) return this.rpc;
    if (this.starting) return this.starting;
    const generation = this.generation;
    this.starting = (async () => {
      const info = this.info || (await this.detect());
      if (!info) throw new Error(this.status);
      const network = await runtimeNetworkEnvironment();
      if (this.stopped || generation !== this.generation) throw new Error('连接已取消。');
      const process = await subprocess().call({
        command: info.path,
        arguments: ['app-server', ...policyArguments({ ...info.policy, ...(this.sharedLogin ? { cli_auth_credentials_store: 'auto' } : {}) })],
        environment: { ...environment(this.sharedLogin), ...network },
        stderr: 'pipe',
        workdir: PathUtils.join(codexDirectory(), 'workspace'),
      });
      this.process = process;
      const rpc = new CodexRpc((text) => process.stdin.write(text));
      // Drain stderr without putting runtime messages, credentials or document text in logs.
      void (async () => {
        while (await process.stderr.readString()) {
          /* drain */
        }
      })().catch(() => undefined);
      void (async () => {
        for (;;) {
          const chunk = await process.stdout.readString();
          if (!chunk) break;
          rpc.feed(chunk);
        }
      })()
        .catch(() => undefined)
        .finally(() => rpc.close());
      void process.wait().then(() => {
        rpc.close();
        if (this.rpc === rpc) {
          this.rpc = undefined;
          this.account = undefined;
          this.status = 'Codex 连接已断开';
          this.changed();
        }
      });
      try {
        const initialized = await rpc.request('initialize', {
          clientInfo: { name: 'zotero_ai_bar', title: 'Zotero AI Bar', version: pluginVersion },
          capabilities: { experimentalApi: true },
        });
        if (initialized.userAgent?.match(/^[^/]+\/([^\s]+)/)?.[1] !== info.version.replace(/^codex-cli\s+/, '')) {
          this.info = undefined;
          throw new Error('Codex 运行时已改变，请重新检测版本。');
        }
        await rpc.notify('initialized');
        if (this.stopped || generation !== this.generation) throw new Error('连接已取消。');
        this.rpc = rpc;
        rpc.listeners.add((message) => {
          if (message.method === 'client/disconnected' && this.rpc === rpc) {
            this.rpc = undefined;
            this.account = undefined;
            this.models = [];
            this.status = 'Codex 连接已断开';
            void process.kill(1000).catch(() => undefined);
            this.changed();
          }
          if (message.method === 'account/updated' && !this.loginPending)
            void this.refreshAccount().catch(() => {
              this.status = '请重新登录 Codex';
              this.changed();
            });
        });
        await this.refreshAccount();
        return rpc;
      } catch (error) {
        rpc.close();
        this.rpc = undefined;
        await process.kill(1000).catch(() => undefined);
        throw error;
      }
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async refreshAccount(isCurrent: () => boolean = () => true): Promise<void> {
    const rpc = this.rpc;
    if (!rpc) return;
    const result = await rpc.request('account/read', { refreshToken: false });
    if (this.rpc !== rpc || !isCurrent()) return;
    this.account = result.account || undefined;
    if (this.account?.type === 'chatgpt') {
      this.status = `已登录 ${this.account.email || ''} · ${this.account.planType || 'Codex'}`;
      const models: CodexModel[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await rpc.request('model/list', { cursor, limit: 100 });
        if (this.rpc !== rpc || !isCurrent()) return;
        if (!Array.isArray(page.data)) throw new Error('Codex 模型列表格式不兼容。');
        models.push(...page.data);
        cursor = page.nextCursor || undefined;
        if (cursor && cursors.has(cursor)) throw new Error('Codex 模型列表分页异常。');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      this.models = models;
    } else {
      this.models = [];
      this.status = this.account ? '当前为 API Key 模式，请改用 ChatGPT 登录' : '尚未登录 ChatGPT';
    }
    this.changed();
  }

  async login(timeoutMs = 180000): Promise<void> {
    if (this.loginPending) return;
    const rpc = await this.connect();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let completing = false;
      let early: any;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rpc.listeners.delete(listener);
        const id = this.loginId;
        this.loginId = undefined;
        this.cancelPendingLogin = undefined;
        if (error) {
          if (id) void rpc.request('account/login/cancel', { loginId: id }).catch(() => undefined);
          this.account = undefined;
          this.models = [];
          this.status = error.message;
          reject(error);
        } else resolve();
        this.changed();
      };
      const complete = async (params: any) => {
        if (settled || completing || params.loginId !== this.loginId) return;
        completing = true;
        if (!params.success) {
          finish(new Error('ChatGPT 登录失败，请重试。'));
          return;
        }
        try {
          await this.refreshAccount(() => !settled);
          if (settled) return;
          if (this.account?.type !== 'chatgpt' || !this.account.email) throw new Error('未能确认 ChatGPT 登录，请重试。');
          finish();
        } catch {
          finish(new Error('登录结果读取失败，请检查网络后重试。'));
        }
      };
      const listener = (message: import('./protocol').RpcMessage) => {
        if (message.method === 'client/disconnected') finish(new Error('登录期间 Codex 连接中断，请重试。'));
        if (message.method === 'account/login/completed') {
          if (!this.loginId) early = message.params;
          else void complete(message.params);
        }
      };
      const timer = setTimeout(() => finish(new Error('等待登录超时。若已关闭浏览器，可点击连接重新登录。')), timeoutMs);
      this.cancelPendingLogin = () => finish(new Error('已取消 ChatGPT 登录。'));
      this.status = '等待浏览器登录（最多 3 分钟），可随时取消';
      rpc.listeners.add(listener);
      this.changed();
      void rpc
        .request('account/login/start', { type: 'chatgpt' })
        .then((result) => {
          if (settled) {
            void rpc.request('account/login/cancel', { loginId: result.loginId }).catch(() => undefined);
            return;
          }
          this.loginId = result.loginId;
          const url = new URL(result.authUrl);
          if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname))
            throw new Error('Invalid login URL');
          Zotero.launchURL(url.href);
          if (early) void complete(early);
        })
        .catch(() => finish(new Error('无法打开 ChatGPT 登录，请检查网络后重试。')));
    });
  }

  /** Let Codex read its own existing credentials; never copy or parse token files. */
  async connectAccount(): Promise<void> {
    if (this.accountKey) {
      await this.refreshAccount();
      return;
    }
    await this.stop();
    this.sharedLogin = true;
    await this.connect();
    if (this.accountKey) return;
    await this.stop();
    this.sharedLogin = false;
    await this.connect();
    if (!this.accountKey) await this.login();
  }

  async logout(): Promise<void> {
    if (this.sharedLogin) {
      await this.stop();
      this.status = '已断开插件连接，桌面应用和 CLI 登录保持不变';
      this.changed();
      return;
    }
    const rpc = await this.connect();
    await rpc.request('account/logout');
    await this.stop();
    this.account = undefined;
    this.models = [];
    this.status = '已退出插件中的 Codex 登录';
    this.changed();
  }

  async stop(shutdown = false): Promise<void> {
    this.cancelLogin();
    this.generation++;
    this.stopped = shutdown;
    this.loginId = undefined;
    this.rpc?.close();
    this.rpc = undefined;
    const process = this.process;
    this.process = undefined;
    if (process) await process.kill(1000).catch(() => undefined);
    this.account = undefined;
    this.models = [];
    this.changed();
  }

  async selectPath(path: string): Promise<void> {
    await this.stop();
    setPref('codex.runtimePath', path);
    this.info = undefined;
    await this.detect();
  }
}

export const codexRuntime = new CodexRuntime();
