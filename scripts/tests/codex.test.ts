import { assert } from 'chai';
import path from 'node:path';
import { runtimePolicy, policyArguments, contextFingerprint, sanitizeCodexBinding, isCodexVersionSupported } from '../../src/modules/codex/policy';
import { CodexRpc } from '../../src/modules/codex/protocol';
import { codexRuntime, discoverCandidates, preferredUserHome } from '../../src/modules/codex/runtime';
import { askUserSchema } from '../../src/utils/agentSchemas';

const features = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'view_image',
  'browser_use',
  'computer_use',
  'multi_agent',
  'hooks',
  'image_generation',
  'code_mode',
  'code_mode_host',
]
  .map((name) => `${name} stable true`)
  .join('\n');

describe('Codex components', function () {
  describe('ask_user schema', function () {
    it('accepts Codex-style structured options with controlled free text', function () {
      const parsed = askUserSchema.parse({
        questions: [
          {
            question: 'Choose a scope',
            options: [
              { label: 'Current item', description: 'Only use the open Zotero item.' },
              { label: 'Library', description: 'Search the whole Zotero library.' },
            ],
            isOther: true,
          },
        ],
      });
      assert.equal(parsed.questions[0].options?.[0].label, 'Current item');
      assert.isTrue(parsed.questions[0].isOther);
    });

    it('accepts null options for a free-text-only question', function () {
      const parsed = askUserSchema.parse({
        questions: [{ question: 'What topic should I search?', options: null }],
      });
      assert.isNull(parsed.questions[0].options);
      assert.isTrue(parsed.questions[0].isOther);
    });

    it('rejects legacy string options and too few structured choices', function () {
      assert.throws(() =>
        askUserSchema.parse({
          questions: [{ question: 'Choose', options: ['One', 'Two'], isOther: false }],
        })
      );
      assert.throws(() =>
        askUserSchema.parse({
          questions: [{ question: 'Choose', options: [{ label: 'One', description: 'Only one.' }], isOther: false }],
        })
      );
    });
  });

  describe('Codex platform environment', function () {
    it('prefers USERPROFILE over an unrelated HOME on Windows', function () {
      const environment = {
        HOME: 'C:\\Users\\Example\\AppData\\Roaming\\SPB_Data',
        USERPROFILE: 'C:\\Users\\Example',
      };
      assert.equal(preferredUserHome(environment, true), 'C:\\Users\\Example');
      assert.equal(preferredUserHome(environment, false), 'C:\\Users\\Example\\AppData\\Roaming\\SPB_Data');
    });

    it('keeps the other home variable as a platform fallback', function () {
      assert.equal(preferredUserHome({ HOME: '/Users/example' }, true), '/Users/example');
      assert.equal(preferredUserHome({ USERPROFILE: 'C:\\Users\\Example' }, false), 'C:\\Users\\Example');
    });
  });

  describe('Codex permission policy', function () {
    it('enables only the Code Mode bridge needed by Agent tools', function () {
      const policy = runtimePolicy('codex-cli 0.154.0-alpha.6.2\n', features);
      for (const line of features.split('\n')) {
        const name = line.split(' ')[0];
        assert.strictEqual(policy[`features.${name}`], name === 'code_mode' || name === 'code_mode_host');
      }
      assert.equal(policy.web_search, 'live');
      assert.equal(policy.sandbox_mode, 'read-only');
      assert.equal(policy.cli_auth_credentials_store, 'file');
      assert.include(policyArguments(policy), 'features.shell_tool=false');
      assert.include(policyArguments(policy), 'features.code_mode=true');
      assert.include(policyArguments(policy), 'features.code_mode_host=true');
    });

    it('accepts versions at or above the audited minimum and rejects older versions', function () {
      assert.isTrue(isCodexVersionSupported('codex-cli 0.154.0-alpha.6.2'));
      assert.isTrue(isCodexVersionSupported('codex-cli 0.155.0-alpha.9.2'));
      assert.isTrue(isCodexVersionSupported('codex-cli 0.155.1'));
      assert.isTrue(isCodexVersionSupported('codex-cli 0.160.0'));
      assert.isFalse(isCodexVersionSupported('codex-cli 0.154.0-alpha.6.1'));
      assert.isFalse(isCodexVersionSupported('codex-cli 0.153.9'));
      assert.throws(() => runtimePolicy('codex-cli 0.153.9', features), /最低支持版本/);
    });

    it('fails closed on malformed or incomplete capabilities', function () {
      assert.throws(() => runtimePolicy('codex-cli 0.154.0-alpha.6.2', ''), /不完整/);
      assert.throws(() => runtimePolicy('codex-cli 0.154.0-alpha.6.2', features + '\nINVALID$ stable true'), /格式/);
    });

    it('sanitizes persisted bindings and detects edited histories', function () {
      const value = { threadId: 'thread_1', account: 'user@example.org', model: 'model', mode: 'agent', context: 'abc', token: 'must-not-persist' };
      assert.notProperty(sanitizeCodexBinding(value), 'token');
      assert.isUndefined(sanitizeCodexBinding({ ...value, threadId: '../other' }));
      assert.equal(contextFingerprint(['a']), contextFingerprint(['a']));
      assert.notEqual(contextFingerprint(['a']), contextFingerprint(['b']));
    });
  });

  describe('Codex JSON-RPC transport', function () {
    it('handles split frames, CRLF, notifications and out-of-order responses', async function () {
      const written: any[] = [];
      const rpc = new CodexRpc(async (line) => {
        written.push(JSON.parse(line));
      });
      const first = rpc.request('first');
      const second = rpc.request('second');
      let notified = false;
      rpc.listeners.add((msg) => {
        if (msg.method === 'notice') notified = true;
      });
      rpc.feed('{"id":2,"res');
      rpc.feed('ult":"二"}\r\n{"method":"notice"}\n{"id":1,"result":"一"}\n');
      assert.equal(await first, '一');
      assert.equal(await second, '二');
      assert.isTrue(notified);
      assert.deepEqual(
        written.map((m) => m.id),
        [1, 2]
      );
      rpc.close();
    });

    it('rejects unknown server operations without executing them', async function () {
      const written: any[] = [];
      const rpc = new CodexRpc(async (line) => {
        written.push(JSON.parse(line));
      });
      rpc.feed('{"id":"server-1","method":"item/fileChange/requestApproval","params":{}}\n');
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(written[0].error.code, -32601);
      rpc.close();
    });

    it('returns dynamic tool responses using the server request ID', async function () {
      const written: any[] = [];
      const rpc = new CodexRpc(async (line) => {
        written.push(JSON.parse(line));
      });
      rpc.onRequest = async () => ({ success: true, contentItems: [{ type: 'inputText', text: 'done' }] });
      rpc.feed('{"id":"call-1","method":"item/tool/call","params":{}}\n');
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(written[0].id, 'call-1');
      assert.isTrue(written[0].result.success);
      rpc.close();
    });

    it('rejects pending requests on disconnection and never retries them', async function () {
      let writes = 0;
      const rpc = new CodexRpc(async () => {
        writes++;
      });
      const result = rpc.request('turn/start').catch((error) => error);
      rpc.close();
      assert.instanceOf(await result, Error);
      assert.equal(writes, 1);
    });

    it('times out requests and ignores late responses', async function () {
      const rpc = new CodexRpc(async () => {});
      const error = await rpc.request('slow', {}, 5).catch((error) => error);
      assert.match(error.message, /超时/);
      rpc.feed('{"id":1,"result":{}}\n');
      rpc.close();
    });

    it('closes on malformed JSON without exposing response bodies', async function () {
      const rpc = new CodexRpc(async () => {});
      const result = rpc.request('account/read').catch((error) => error);
      rpc.feed('secret-token-is-not-json\n');
      assert.notInclude((await result).message, 'secret-token');
    });
  });

  describe('Codex desktop-first runtime discovery (OS adapters)', function () {
    const g = globalThis as any;
    const names = ['Zotero', 'ChromeUtils', 'IOUtils', 'PathUtils', 'Cc', 'Ci'];
    let originals: any;
    let paths: Record<string, string[]>;
    let output: string;
    let system: string;
    let manual: string;
    let environment: Record<string, string>;

    beforeEach(function () {
      originals = Object.fromEntries(names.map((name) => [name, g[name]]));
      paths = {};
      output = '[]';
      system = '/usr/local/bin/codex';
      manual = '';
      environment = { HOME: '/Users/Example User', PATH: '/usr/local/bin', SystemRoot: 'C:\\Windows' };
      g.Zotero = { isMac: true, isWin: false, Prefs: { get: () => manual } };
      g.PathUtils = {
        join: path.posix.join,
        parent: path.posix.dirname,
        filename: path.posix.basename,
        isAbsolute: path.posix.isAbsolute,
        profileDir: '/test-profile',
      };
      g.IOUtils = {
        exists: async (p: string) => p in paths,
        getChildren: async (p: string) => paths[p] || [],
        stat: async () => ({ type: 'directory' }),
        makeDirectory: async () => {},
      };
      g.ChromeUtils = {
        importESModule: () => ({
          Subprocess: {
            getEnvironment: () => environment,
            pathSearch: async () => {
              if (!system) throw new Error('missing');
              return system;
            },
            call: async ({ command }: { command: string }) => {
              if (!system && /(?:^|[\\/])codex(?:\.exe)?$/i.test(command) && !(command in paths)) throw new Error('missing');
              let read = false;
              return {
                stdout: {
                  readString: async () => {
                    if (read) return '';
                    read = true;
                    return output;
                  },
                },
                stderr: { readString: async () => '' },
                wait: async () => ({ exitCode: 0 }),
                kill: async () => {},
              };
            },
          },
        }),
      };
    });

    afterEach(async function () {
      await codexRuntime.stop();
      codexRuntime.info = undefined;
      for (const name of names) {
        if (originals[name] === undefined) delete g[name];
        else g[name] = originals[name];
      }
    });

    it('checks both Mac apps before PATH, including paths containing spaces', async function () {
      const candidates = await discoverCandidates();
      assert.equal(candidates[0].path, '/Applications/Codex.app/Contents/Resources/codex');
      assert.equal(candidates[1].path, '/Applications/ChatGPT.app/Contents/Resources/codex');
      assert.include(candidates[2].path, 'Example User');
      assert.equal(candidates.at(-1)?.source, 'system');
    });

    it('keeps manual selection after desktop and system candidates', async function () {
      manual = '/custom folder/codex';
      assert.equal((await discoverCandidates()).at(-1)?.path, manual);
    });

    it('handles no installation without starting an app-server', async function () {
      system = '';
      const result = await codexRuntime.detect();
      assert.isUndefined(result);
      assert.include(codexRuntime.status, '没有找到');
    });

    it('locates Windows apps from installation metadata before resolving npm CLI shims', async function () {
      g.Zotero.isMac = false;
      g.Zotero.isWin = true;
      g.PathUtils = {
        ...g.PathUtils,
        join: path.win32.join,
        parent: path.win32.dirname,
        filename: path.win32.basename,
        isAbsolute: path.win32.isAbsolute,
      };
      const root = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1';
      output = JSON.stringify([root]);
      const resources = path.win32.join(root, 'resources');
      paths[root] = [resources];
      paths[resources] = [path.win32.join(resources, 'codex.exe')];
      system = 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\codex.cmd';
      const npmRoot = path.win32.join(path.win32.dirname(system), 'node_modules', '@openai');
      paths[npmRoot] = [path.win32.join(npmRoot, 'codex.exe')];
      const candidates = await discoverCandidates();
      assert.deepEqual(
        candidates.map((c) => c.source),
        ['desktop', 'system']
      );
      assert.isTrue(candidates.every((c) => c.path.endsWith('.exe')));
    });

    it('asks for Codex CLI when only the protected Microsoft Store app is available', async function () {
      g.Zotero.isMac = false;
      g.Zotero.isWin = true;
      g.PathUtils = {
        ...g.PathUtils,
        join: path.win32.join,
        parent: path.win32.dirname,
        filename: path.win32.basename,
        isAbsolute: path.win32.isAbsolute,
      };
      output = JSON.stringify(['C:\\Program Files\\WindowsApps\\OpenAI.Codex_1']);
      system = '';
      const result = await codexRuntime.detect();
      assert.isUndefined(result);
      assert.include(codexRuntime.status, '微软商店版 ChatGPT');
      assert.include(codexRuntime.status, 'Codex CLI');
    });

    it('does not let an old npm shim hide a newer cached Windows runtime later in PATH', async function () {
      g.Zotero.isMac = false;
      g.Zotero.isWin = true;
      g.PathUtils = {
        ...g.PathUtils,
        join: path.win32.join,
        parent: path.win32.dirname,
        filename: path.win32.basename,
        isAbsolute: path.win32.isAbsolute,
      };
      const npm = 'C:\\Users\\Test User\\AppData\\Roaming\\npm';
      const cached = 'C:\\Users\\Test User\\AppData\\Local\\OpenAI\\Codex\\bin\\audited';
      const cachedBinary = path.win32.join(cached, 'codex.exe');
      const shim = path.win32.join(npm, 'codex.ps1');
      environment = {
        PATH: [npm, cached].join(';'),
        USERPROFILE: 'C:\\Users\\Test User',
        LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local',
        APPDATA: 'C:\\Users\\Test User\\AppData\\Roaming',
        SystemRoot: 'C:\\Windows',
      };
      system = shim;
      const stagedRoot = path.win32.join('C:\\Users\\Test User\\AppData\\Local', 'OpenAI', 'Codex', 'bin');
      paths[stagedRoot] = [cached];
      paths[cached] = [cachedBinary];
      paths[cachedBinary] = [];
      paths[shim] = [];
      const candidates = await discoverCandidates();
      assert.include(
        candidates.map((candidate) => candidate.path),
        cachedBinary
      );
      assert.equal(candidates.find((candidate) => candidate.path === cachedBinary)?.source, 'desktop');
    });

    function updatedWindowsRuntime(options: { failSpawn?: boolean; incompatible?: boolean; failInitialize?: boolean } = {}) {
      g.Zotero.isMac = false;
      g.Zotero.isWin = true;
      g.PathUtils = {
        ...g.PathUtils,
        join: path.win32.join,
        parent: path.win32.dirname,
        filename: path.win32.basename,
        isAbsolute: path.win32.isAbsolute,
      };
      environment.HTTPS_PROXY = 'http://127.0.0.1:8080';
      g.Ci = { nsIProtocolProxyService: {} };
      g.Cc = { '@mozilla.org/network/protocol-proxy-service;1': { getService: () => ({ proxyConfigType: 5 }) } };
      const oldBinary = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_old\\app\\resources\\codex.exe';
      const root = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_new';
      const newBinary = path.win32.join(root, 'app', 'resources', 'codex.exe');
      paths[newBinary] = [];
      system = '';
      const version = 'codex-cli 0.154.0-alpha.6.2';
      codexRuntime.info = { path: oldBinary, source: 'desktop', version, policy: runtimePolicy(version, features) };
      const launches: string[] = [];
      let metadataQueries = 0;
      g.ChromeUtils.importESModule = () => ({
        Subprocess: {
          getEnvironment: () => environment,
          pathSearch: async () => {
            throw new Error('missing');
          },
          call: async ({ command, arguments: args }: { command: string; arguments: string[] }) => {
            if (args[0] === 'app-server' && args[1] !== '--help') {
              launches.push(command);
              if (command === oldBinary || options.failSpawn) throw new Error('File does not exist, or is not executable');
              let read: ((text: string) => void) | undefined;
              let exited: (result: { exitCode: number }) => void;
              const wait = new Promise<{ exitCode: number }>((resolve) => {
                exited = resolve;
              });
              return {
                stdout: {
                  readString: () =>
                    new Promise<string>((resolve) => {
                      read = resolve;
                    }),
                },
                stderr: { readString: async () => '' },
                stdin: {
                  write: async (text: string) => {
                    const message = JSON.parse(text);
                    if (message.id === undefined) return;
                    const response =
                      message.method === 'initialize'
                        ? options.failInitialize
                          ? { error: { code: -1, message: 'initialize failed' } }
                          : { result: { userAgent: 'codex/0.154.0-alpha.6.2' } }
                        : { result: { account: null } };
                    read?.(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...response }) + '\n');
                  },
                },
                wait: () => wait,
                kill: async () => {
                  read?.('');
                  exited({ exitCode: 0 });
                },
              };
            }
            if (command.endsWith('powershell.exe')) metadataQueries++;
            const text = command.endsWith('powershell.exe')
              ? JSON.stringify([root])
              : args[0] === '--version'
                ? version
                : args[0] === 'features'
                  ? options.incompatible
                    ? ''
                    : features
                  : 'generate-json-schema';
            let read = false;
            return {
              stdout: {
                readString: async () => {
                  if (read) return '';
                  read = true;
                  return text;
                },
              },
              stderr: { readString: async () => '' },
              wait: async () => ({ exitCode: 0 }),
              kill: async () => {},
            };
          },
        },
      });
      return { launches, oldBinary, newBinary, metadataQueries: () => metadataQueries };
    }

    it('rediscovers and connects after a desktop update removes the cached executable', async function () {
      const fixture = updatedWindowsRuntime();
      await codexRuntime.connect();
      assert.deepEqual(fixture.launches, [fixture.oldBinary, fixture.newBinary]);
      assert.equal(codexRuntime.info?.path, fixture.newBinary);
      assert.equal(fixture.metadataQueries(), 1);
      assert.isDefined(codexRuntime.rpc);
    });

    it('limits spawn recovery to one retry and clears a failed runtime', async function () {
      const fixture = updatedWindowsRuntime({ failSpawn: true });
      const error = await codexRuntime.connect().then(
        () => undefined,
        (error: Error) => error
      );
      assert.include(error?.message || '', 'not executable');
      assert.deepEqual(fixture.launches, [fixture.oldBinary, fixture.newBinary]);
      assert.equal(fixture.metadataQueries(), 1);
      assert.isUndefined(codexRuntime.info);
    });

    it('does not launch an updated runtime that fails policy validation', async function () {
      const fixture = updatedWindowsRuntime({ incompatible: true });
      const error = await codexRuntime.connect().then(
        () => undefined,
        (error: Error) => error
      );
      assert.include(error?.message || '', '安全检查');
      assert.deepEqual(fixture.launches, [fixture.oldBinary]);
      assert.isUndefined(codexRuntime.info);
    });

    it('does not repeat RPC initialization when the recovered process returns an error', async function () {
      const fixture = updatedWindowsRuntime({ failInitialize: true });
      const error = await codexRuntime.connect().then(
        () => undefined,
        (error: Error) => error
      );
      assert.include(error?.message || '', 'Codex -1');
      assert.deepEqual(fixture.launches, [fixture.oldBinary, fixture.newBinary]);
      assert.equal(fixture.metadataQueries(), 1);
      assert.isUndefined(codexRuntime.rpc);
    });
  });
});
