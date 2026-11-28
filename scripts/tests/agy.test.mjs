import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers/promises';

// Node globals; the shared ESLint config targets Zotero code. `addon` is the stub installed below.
const { AbortController, DOMException } = globalThis;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = (name) => readFile(resolve(root, `src/modules/agy/${name}.ts`), 'utf8');
const protocolUrl = dataUrl(stripTypeScriptTypes(await source('protocol')));
const {
  AGY_AGENT_SYSTEM_PROMPT,
  AGY_PROVIDER_ID,
  AGY_SYSTEM_PROMPT,
  AGY_TOOL_SERVER,
  REQUIRED_AGY_ACP_FLAGS,
  AgyAcpClient,
  agyAcpArguments,
  agyDenyPermissionResult,
  agyEffort,
  agyEnvironment,
  agyMcpReply,
  agyModelFamily,
  agyModelSelection,
  agyModelsFromSessionNew,
  agyPermissionResult,
  agyTierFromSessionNew,
  buildAgyPrompt,
  constantTimeEqual,
  ensureLoopbackNoProxy,
  redactAgyError,
  resolveAgySessionModel,
} = await import(protocolUrl);

// Shape returned by the official Antigravity CLI 1.5.18 (`agy acp --stdio` session/new).
const sessionNewPayload = {
  sessionId: 'sess-1',
  models: {
    currentModelId: 'gemini-4-neon-high',
    availableModels: [
      { modelId: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' },
      { modelId: 'gemini-4-neon-xhigh', name: 'Gemini 4 Neon (XHigh)' },
      { modelId: 'gemini-4-neon-medium', name: 'Gemini 4 Neon (Medium)' },
      { modelId: 'gemini-4-neon-low', name: 'Gemini 4 Neon (Low)' },
      { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { modelId: 'claude-opus-5-5-low', name: 'Claude Opus 5.5 (Low)' },
      { modelId: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 (High)' },
      { modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
      { modelId: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' },
    ],
  },
  configOptions: [
    {
      id: 'model',
      options: [
        { value: 'gemini-4-neon', name: 'Gemini 4 Neon' },
        { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
        { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
        { value: 'gemini-pro-orchestrator-neon', name: 'Orchestrator (Neon)' },
      ],
    },
  ],
  _meta: {
    antigravity: {
      tier: { name: 'Google AI Pro', id: 'g1-pro-tier' },
    },
  },
};

const line = (event) => JSON.stringify(event) + '\n';

test('routes explicit translation model independently of the active model', () => {
  const active = { providerId: AGY_PROVIDER_ID, modelId: 'gemini-4-neon' };
  assert.equal(agyModelSelection(undefined, active), 'gemini-4-neon');
  assert.equal(agyModelSelection('openai::gpt', active), undefined);
  assert.equal(agyModelSelection(`${AGY_PROVIDER_ID}::gemini-3.8-flash`, { providerId: 'openai', modelId: 'gpt' }), 'gemini-3.8-flash');
});

test('isolates environment and launch arguments without exposing API keys', () => {
  const args = agyAcpArguments();
  assert.ok(!args.includes(''));
  assert.equal(args[0], 'acp');
  assert.ok(args.includes('--stdio'));
  assert.ok(args.includes('--include-default-customizations=false'));
  assert.ok(args.includes('--sandbox'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  const env = agyEnvironment({
    HOME: '/user',
    PATH: '/bin',
    HTTPS_PROXY: 'http://proxy',
    GEMINI_API_KEY: 'secret-gemini-key',
    GOOGLE_API_KEY: 'secret-google-key',
    GOOGLE_APPLICATION_CREDENTIALS: '/secret/sa.json',
    OPENAI_API_KEY: 'sk-secret',
  });
  assert.deepEqual(env, { HOME: '/user', PATH: '/bin', HTTPS_PROXY: 'http://proxy' });
  assert.deepEqual(ensureLoopbackNoProxy({ HOME: '/user' }), { HOME: '/user' });
  assert.equal(ensureLoopbackNoProxy({ HTTPS_PROXY: 'http://proxy:7890', no_proxy: 'example.com' }).NO_PROXY, 'example.com,127.0.0.1,localhost');
});

test('redacts tokens and secrets from error text', () => {
  const safe = redactAgyError('Bearer tok-123 ya29.abc-DEF AIzaSyD123456789012345678901234 sk-secret api_key=foo refresh_token=bar');
  assert.doesNotMatch(safe, /tok-123|ya29\.abc|AIzaSyD|sk-secret|=foo|=bar/);
});

test('builds ACP prompt blocks for history, images and translation while blocking local file paths', () => {
  const blocks = buildAgyPrompt([
    { role: 'system', content: 'Explain equations accurately.' },
    { role: 'assistant', content: 'Earlier answer' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Explain this figure' },
        { type: 'image', image: 'data:image/png;base64,YQ==' },
      ],
    },
  ]);
  assert.equal(blocks.at(-1).type, 'image');
  assert.equal(blocks.at(-1).mimeType, 'image/png');
  assert.equal(blocks.at(-1).data, 'YQ==');
  assert.match(JSON.stringify(blocks), /Earlier answer/);
  assert.throws(() => buildAgyPrompt([{ role: 'user', content: [{ type: 'image', image: 'C:\\private.png' }] }]), /Reattach/);
  assert.throws(() => buildAgyPrompt([{ role: 'user', content: 'x'.repeat(10 * 1024 * 1024) }]), /too large/);

  const translationBlocks = buildAgyPrompt([{ role: 'user', content: 'Translate contrastive learning.' }], true);
  for (const field of ['textType', 'translatedText', 'originalText', 'fullForm', 'otherMeanings'])
    assert.ok(translationBlocks[0].text.includes(field));
});

test('groups ACP models and effort variants from session/new and resolves concrete model ids', () => {
  const models = agyModelsFromSessionNew(sessionNewPayload);
  assert.deepEqual(
    models.map((m) => [m.id, m.name, m.efforts, m.defaultModelId]),
    [
      ['gemini-4-neon', 'Gemini 4 Neon', ['low', 'medium', 'high', 'xhigh'], 'gemini-4-neon-high'],
      ['gemini-3.8-flash', 'Gemini 3.8 Flash', ['low', 'high'], 'gemini-3.8-flash-high'],
      ['claude-opus-5-5', 'Claude Opus 5.5', ['low', 'high'], 'claude-opus-5-5-high'],
      ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)', [], 'gpt-oss-120b-medium'],
      ['gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', [], 'gemini-pro-orchestrator-neon'],
    ]
  );
  assert.equal(agyTierFromSessionNew(sessionNewPayload), 'Google AI Pro');
  assert.equal(agyEffort(['low', 'high'], 'high'), 'high');
  assert.equal(agyEffort(['low', 'high'], 'xhigh'), undefined);
  assert.equal(resolveAgySessionModel('gemini-4-neon', 'xhigh', models), 'gemini-4-neon-xhigh');
  assert.equal(resolveAgySessionModel('gemini-4-neon', 'none', models), 'gemini-4-neon-high');
  assert.equal(resolveAgySessionModel('gemini-3.8-flash', 'medium', models), 'gemini-3.8-flash-high');
  assert.equal(resolveAgySessionModel('gpt-oss-120b-medium', 'high', models), 'gpt-oss-120b-medium');
  assert.throws(() => resolveAgySessionModel('unknown-model', undefined, models), /unavailable/);
  assert.throws(() => resolveAgySessionModel('bad model', undefined, models), /Invalid/);
  assert.equal(agyModelFamily('gemini-4-neon'), 'gemini');
  assert.equal(agyModelFamily('claude-opus-5-5'), 'claude-opus');
  assert.equal(agyModelFamily('gpt-oss-120b-medium'), 'gpt');

  const withoutConfig = agyModelsFromSessionNew({ models: sessionNewPayload.models });
  assert.equal(withoutConfig.find((m) => m.id === 'gemini-4-neon')?.efforts.length, 4);
  assert.deepEqual(withoutConfig.find((m) => m.id === 'gpt-oss-120b-medium')?.efforts, []);
});

test('denies all built-in tools and only permits allowlisted Zotero MCP tools in Agent mode', () => {
  const options = [
    { optionId: 'allow', kind: 'allow_once' },
    { optionId: 'deny', kind: 'reject_once' },
  ];
  assert.deepEqual(agyDenyPermissionResult({ toolCall: { name: 'mcp_zotero_read' }, options }), {
    outcome: { outcome: 'selected', optionId: 'deny' },
  });
  const allowed = new Set(['mcp_zotero_read']);
  assert.deepEqual(agyPermissionResult({ toolCall: { name: 'mcp_zotero_read' }, options }, allowed), {
    outcome: { outcome: 'selected', optionId: 'allow' },
  });
  assert.deepEqual(agyPermissionResult({ toolCall: { name: 'read_file' }, options }, allowed), {
    outcome: { outcome: 'selected', optionId: 'deny' },
  });
  assert.deepEqual(agyPermissionResult({ toolCall: { name: 'run_command' }, options: [{ optionId: 'allow', kind: 'allow_once' }] }, allowed), {
    outcome: { outcome: 'cancelled' },
  });
});

test('handles MCP JSON-RPC handshake, tool listing and tool calls, rejecting unlisted tools', async () => {
  const calls = [];
  const server = {
    tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }],
    call: async (name, args, toolUseId) => {
      calls.push([name, args, toolUseId]);
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  assert.equal(AGY_TOOL_SERVER, 'zotero');
  assert.match(AGY_AGENT_SYSTEM_PROMPT, /mcp_zotero_<name>/);
  const init = await agyMcpReply({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, server);
  assert.deepEqual(init.result.serverInfo, { name: 'zotero', version: '1.0.0' });
  assert.equal(await agyMcpReply({ jsonrpc: '2.0', method: 'notifications/initialized' }, server), undefined);
  assert.deepEqual((await agyMcpReply({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, server)).result.tools, server.tools);
  const called = await agyMcpReply(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read', arguments: { itemId: 5 }, _meta: { progressToken: 'tok-5' } } },
    server
  );
  assert.deepEqual(called.result, { content: [{ type: 'text', text: 'ok' }] });
  assert.deepEqual(calls, [['read', { itemId: 5 }, 'tok-5']]);
  const unknown = await agyMcpReply({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'Bash', arguments: {} } }, server);
  assert.equal(unknown.result.isError, true);
  assert.equal(calls.length, 1);
  assert.equal((await agyMcpReply({ jsonrpc: '2.0', id: 5, method: 'server/discover' }, server)).error.code, -32601);
});

test('constantTimeEqual compares bearer tokens strictly', () => {
  assert.equal(constantTimeEqual('Bearer secret', 'Bearer secret'), true);
  assert.equal(constantTimeEqual('Bearer secret', 'Bearer other!'), false);
  assert.equal(constantTimeEqual('a', 'ab'), false);
});

test('AgyAcpClient parses split JSON lines, dispatches server requests and rejects malformed frames', async () => {
  const writes = [];
  const client = new AgyAcpClient(async (text) => {
    writes.push(text);
  });
  client.onRequest = async (msg) => agyDenyPermissionResult(msg.params);

  const pending = client.request('initialize', { protocolVersion: 1 });
  const frame =
    line({
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: { options: [{ optionId: 'deny', kind: 'reject_once' }] },
    }) + line({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  for (let i = 0; i < frame.length; i += 9) client.feed(frame.slice(i, i + 9));
  assert.deepEqual(await pending, { ok: true });
  await setImmediate();
  const permReply = JSON.parse(writes.find((w) => w.includes('perm-1')));
  assert.deepEqual(permReply.result, { outcome: { outcome: 'selected', optionId: 'deny' } });

  const failPending = client.request('session/new', {});
  client.feed('not-json\n');
  await assert.rejects(failPending, /invalid ACP JSON/);
});

test('all new TypeScript modules parse', async () => {
  for (const name of ['protocol', 'runtime', 'backend', 'settings', 'tools', 'mcpServer']) assert.ok(stripTypeScriptTypes(await source(name)));
});

// Runtime tests with mocked Gecko Subprocess and loopback MCP server.
let calls;
let prefs;
let serverInfo;
let sessionNewResponse;
let promptBehavior;
let stopCount;
let mcpServerCalls;
let mcpClosedCount;
globalThis.PathUtils = { profileDir: '/profile', join: (...parts) => parts.join('/'), isAbsolute: (p) => p.startsWith('/') };
globalThis.IOUtils = { makeDirectory: async () => {}, exists: async () => true };
globalThis.Zotero = { isWin: false, isMac: false };
globalThis.Ci = {};
globalThis.Cc = { '@mozilla.org/network/protocol-proxy-service;1': { getService: () => ({ proxyConfigType: 5 }) } };
globalThis.__agyPrefs = {
  get: (key) => prefs[key],
  set: (key, value) => {
    prefs[key] = value;
  },
};
globalThis.__agyMcpFactory = (toolServer) => {
  mcpServerCalls.push(toolServer);
  return {
    url: 'http://127.0.0.1:45678/mcp',
    token: 'turn-secret',
    close() {
      mcpClosedCount++;
    },
  };
};
globalThis.ChromeUtils = {
  importESModule: () => ({
    Subprocess: {
      getEnvironment: () => ({ HOME: '/user', HTTPS_PROXY: 'http://proxy', GEMINI_API_KEY: 'must-not-leak' }),
      call: async (options) => {
        calls.push(options);
        const args = options.arguments;
        const isHelp = args.includes('--help');
        options.writes = [];
        const queue = [];
        // Real `agy acp --help` (Go flag package) prints usage to stderr with exit code 0.
        const errQueue = isHelp ? [REQUIRED_AGY_ACP_FLAGS.join(' ')] : [];
        let wake;
        let closed = false;
        const push = (chunk) => {
          queue.push(chunk);
          if (wake) {
            const fn = wake;
            wake = undefined;
            fn();
          }
        };
        const end = () => {
          closed = true;
          if (wake) {
            const fn = wake;
            wake = undefined;
            fn();
          }
        };
        if (isHelp) closed = true;

        const child = {
          stdin: {
            write: async (text) => {
              options.writes.push(text);
              const msg = JSON.parse(text.trim());
              if (msg.method === 'initialize') {
                push(line({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: serverInfo } }));
              } else if (msg.method === 'session/new') {
                if (sessionNewResponse instanceof Error) {
                  push(line({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: sessionNewResponse.message } }));
                } else {
                  push(line({ jsonrpc: '2.0', id: msg.id, result: sessionNewResponse }));
                  push(
                    line({
                      jsonrpc: '2.0',
                      method: 'session/update',
                      params: { sessionId: sessionNewResponse.sessionId, update: { sessionUpdate: 'usage_update', used: 0, size: 1048576 } },
                    })
                  );
                }
              } else if (msg.method === 'session/set_model') {
                options.selectedModel = msg.params?.modelId;
                push(line({ jsonrpc: '2.0', id: msg.id, result: {} }));
              } else if (msg.method === 'session/prompt') {
                promptBehavior(msg, push, options);
              } else if (msg.method === 'session/close') {
                push(line({ jsonrpc: '2.0', id: msg.id, result: {} }));
              }
            },
            close: async () => {
              options.stdinClosed = true;
            },
          },
          stdout: {
            readString: async () => {
              while (!queue.length && !closed) await new Promise((r) => (wake = r));
              return queue.shift() || '';
            },
          },
          stderr: { readString: async () => errQueue.shift() || '' },
          wait: async () => ({ exitCode: 0 }),
          kill: async () => {
            stopCount++;
            end();
          },
        };
        return child;
      },
    },
  }),
};

let runtimeCode = stripTypeScriptTypes(await source('runtime'));
runtimeCode = runtimeCode.replace(
  /import \{ getPref, setPref \} from '[^']+';/,
  'const getPref = globalThis.__agyPrefs.get; const setPref = globalThis.__agyPrefs.set;'
);
runtimeCode = runtimeCode.replace("from './protocol'", `from '${protocolUrl}'`);
runtimeCode = runtimeCode.replace(/import \{ startAgyMcpServer[^;]+;/, 'const startAgyMcpServer = (...a) => globalThis.__agyMcpFactory(...a);');
const runtime = await import(dataUrl(runtimeCode));

beforeEach(() => {
  calls = [];
  prefs = {};
  stopCount = 0;
  mcpServerCalls = [];
  mcpClosedCount = 0;
  serverInfo = { name: 'Antigravity ACP Server', version: '1.5.18' };
  sessionNewResponse = sessionNewPayload;
  promptBehavior = (msg, push) => {
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Zotero' } },
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        id: msg.id,
        result: { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      })
    );
  };
});

test('checkAgy validates binary identity, tier, models and strips API keys', async () => {
  const info = await runtime.checkAgy();
  assert.equal(info.version, '1.5.18');
  assert.equal(info.plan, 'Google AI Pro');
  assert.equal(info.models.length, 5);
  assert.equal(info.contextWindow, 1048576);
  const acpCall = calls.find((c) => c.arguments.includes('--stdio'));
  assert.ok(!('GEMINI_API_KEY' in acpCall.environment));
  assert.equal(acpCall.environment.NO_PROXY, '127.0.0.1,localhost');
  assert.equal(acpCall.workdir, '/profile/zaibar/agy/workspace');

  serverInfo = { name: 'Some Other Binary', version: '0.1' };
  await assert.rejects(runtime.checkAgy(), /not recognized as official Antigravity/);

  serverInfo = { name: 'Antigravity ACP Server', version: '1.5.18' };
  sessionNewResponse = new Error('unauthenticated: login required');
  await assert.rejects(runtime.checkAgy(), /not signed in/);
});

test('runAgy streams text, sets resolved model variant, denies tool permissions and cleans up', async () => {
  promptBehavior = (msg, push) => {
    push(
      line({
        jsonrpc: '2.0',
        id: 'perm-read-1',
        method: 'session/request_permission',
        params: {
          sessionId: msg.params.sessionId,
          toolCall: { name: 'read_file' },
          options: [
            { optionId: 'allow', kind: 'allow_once' },
            { optionId: 'deny', kind: 'reject_once' },
          ],
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Safe answer' } },
        },
      })
    );
    push(line({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } } }));
  };

  const updates = [];
  const res = await runtime.runAgy('gemini-4-neon', [{ type: 'text', text: 'hi' }], undefined, async (t) => updates.push(t), 'xhigh');
  assert.equal(res.text, 'Safe answer');
  assert.deepEqual(updates, ['Safe answer']);
  assert.equal(mcpServerCalls.length, 0);
  const acpCall = calls.at(-1);
  assert.equal(acpCall.selectedModel, 'gemini-4-neon-xhigh');
  assert.match(
    acpCall.writes.find((w) => w.includes('session/new')),
    new RegExp(AGY_SYSTEM_PROMPT.slice(0, 30))
  );
  const permReply = JSON.parse(acpCall.writes.find((w) => w.includes('perm-read-1')));
  assert.deepEqual(permReply.result, { outcome: { outcome: 'selected', optionId: 'deny' } });
  assert.equal(stopCount, 1);

  // If denying a restricted built-in tool aborts the turn with empty text, report the blocked tool clearly.
  promptBehavior = (msg, push) => {
    push(
      line({
        jsonrpc: '2.0',
        id: 'perm-cmd-1',
        method: 'session/request_permission',
        params: {
          sessionId: msg.params.sessionId,
          toolCall: { name: 'run_command' },
          options: [{ optionId: 'deny', kind: 'reject_once' }],
        },
      })
    );
    push(line({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 0, totalTokens: 8 } } }));
  };
  await assert.rejects(
    runtime.runAgy('gemini-4-neon', [{ type: 'text', text: 'list library' }], undefined, async () => {}),
    /restricted local tool "run_command"/
  );
});

test('runAgy Agent mode starts loopback MCP, allows only Zotero tools, splits segments and closes MCP', async () => {
  promptBehavior = (msg, push) => {
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Checking paper.' } },
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'tool_call', toolCallId: 'call_1', name: 'mcp_zotero_read', status: 'in_progress' },
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        id: 'perm-zotero',
        method: 'session/request_permission',
        params: {
          sessionId: msg.params.sessionId,
          toolCall: { name: 'mcp_zotero_read' },
          options: [
            { optionId: 'allow', kind: 'allow_once' },
            { optionId: 'deny', kind: 'reject_once' },
          ],
        },
      })
    );
    push(
      line({
        jsonrpc: '2.0',
        id: 'perm-shell',
        method: 'session/request_permission',
        params: {
          sessionId: msg.params.sessionId,
          toolCall: { name: 'run_command' },
          options: [
            { optionId: 'allow', kind: 'allow_once' },
            { optionId: 'deny', kind: 'reject_once' },
          ],
        },
      })
    );
    void mcpServerCalls
      .at(-1)
      .call('read', { itemId: 1 }, 'u1')
      .then(() => {
        push(
          line({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: msg.params.sessionId,
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } },
            },
          })
        );
        push(line({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } } }));
      });
  };

  const server = {
    tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }],
    call: async () => ({ content: [{ type: 'text', text: 'page text' }] }),
  };
  const segments = [];
  const res = await runtime.runAgy(
    'gemini-4-neon',
    [{ type: 'text', text: 'find it' }],
    undefined,
    async (_full, seg) => segments.push(seg),
    'high',
    server
  );
  assert.equal(mcpServerCalls.length, 1);
  assert.equal(mcpClosedCount, 1);
  assert.equal(res.text, 'Checking paper.\n\nDone.');
  assert.equal(res.segment, 'Done.');
  assert.deepEqual(segments, ['Checking paper.', 'Done.']);
  const acpCall = calls.at(-1);
  const newReq = JSON.parse(acpCall.writes.find((w) => w.includes('session/new')));
  assert.deepEqual(newReq.params.mcpServers, [
    { type: 'http', name: 'zotero', url: 'http://127.0.0.1:45678/mcp', headers: [{ name: 'Authorization', value: 'Bearer turn-secret' }] },
  ]);
  assert.equal(JSON.parse(acpCall.writes.find((w) => w.includes('perm-zotero'))).result.outcome.optionId, 'allow');
  assert.equal(JSON.parse(acpCall.writes.find((w) => w.includes('perm-shell'))).result.outcome.optionId, 'deny');
});

test('cancellation sends session/cancel, kills stalled child and never starts if already aborted', async () => {
  const already = new AbortController();
  already.abort();
  await assert.rejects(
    runtime.runAgy('gemini-4-neon', [{ type: 'text', text: 'hi' }], already.signal, async () => {}),
    { name: 'AbortError' }
  );
  assert.equal(calls.length, 0);

  const controller = new AbortController();
  promptBehavior = (msg, push) => {
    push(
      line({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: msg.params.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } },
        },
      })
    );
  };
  const updates = [];
  const pending = runtime.runAgy('gemini-4-neon', [{ type: 'text', text: 'hi' }], controller.signal, async (t) => {
    updates.push(t);
    controller.abort();
  });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(updates, ['partial']);
  assert.ok(calls.at(-1).writes.some((w) => w.includes('session/cancel')));
  assert.ok(stopCount >= 1);
});

// Backend-to-UI contract tests.
let uiEvents = [];
let fakeResponse;
let capturedModel;
let capturedPrompt;
let capturedEffort;
globalThis.addon = { data: { userProviderConfigV2: { active: { providerId: AGY_PROVIDER_ID, modelId: 'gemini-4-neon' } } } };
globalThis.__agyBackendFixture = {
  prefs: { 'translate.thinkingDepth': 'minimum' },
  refreshes: [],
  efforts: { 'gemini-4-neon': ['low', 'medium', 'high', 'xhigh'], 'gpt-oss-120b-medium': [] },
  toolHooks: [],
  run: async (model, prompt, signal, onText, effort, server) => {
    capturedModel = model;
    capturedPrompt = prompt;
    capturedEffort = effort;
    globalThis.__agyBackendFixture.server = server;
    if (globalThis.__agyBackendFixture.agentRun) return globalThis.__agyBackendFixture.agentRun(onText);
    if (fakeResponse instanceof Error) throw fakeResponse;
    await onText(fakeResponse.text, fakeResponse.text);
    return { segment: fakeResponse.text, ...fakeResponse };
  },
  tools: (_session, _signal, _messages, beforeTool) => {
    globalThis.__agyBackendFixture.toolHooks.push(beforeTool);
    return { tools: [{ name: 'read' }], call: async () => ({ content: [] }) };
  },
  start: () => uiEvents.push('start'),
  update: async (data) => uiEvents.push(['update', data.fullText, data.segmentText, data.force]),
  end: (_session, usage, aborted) => uiEvents.push(['end', usage, aborted]),
  error: (data) => uiEvents.push(['error', data.error]),
  translation: (_session, value) => uiEvents.push(['translation', value]),
  normalize: (value) => (value?.textType && value?.translatedText ? value : undefined),
};

let backendCode = stripTypeScriptTypes(await source('backend'));
backendCode = backendCode.replace(
  /import \{ normalizeTranslationResultCandidate[^;]+;/,
  'const normalizeTranslationResultCandidate = globalThis.__agyBackendFixture.normalize;'
);
backendCode = backendCode.replace(
  /import \{ onLLMStreamStartV2[^;]+;/,
  'const { start: onLLMStreamStartV2, update: onLLMStreamUpdateV2, end: onLLMStreamEndV2, error: onLLMStreamErrorV2, translation: onTranslationResultV2 } = globalThis.__agyBackendFixture;'
);
backendCode = backendCode.replace("from './protocol'", `from '${protocolUrl}'`);
backendCode = backendCode.replace(/import \{ runAgy \} from '[^']+';/, 'const runAgy = globalThis.__agyBackendFixture.run;');
backendCode = backendCode.replace(/import \{ getPref \} from '[^']+';/, 'const getPref = (key) => globalThis.__agyBackendFixture.prefs[key];');
backendCode = backendCode.replace(
  /import \{ agyEfforts, refreshAgyModels \} from '[^']+';/,
  'const agyEfforts = (id) => globalThis.__agyBackendFixture.efforts[id] ?? []; const refreshAgyModels = async (...a) => { globalThis.__agyBackendFixture.refreshes.push(a); };'
);
backendCode = backendCode.replace(
  /import \{ zoteroAgyToolServer \} from '[^']+';/,
  'const zoteroAgyToolServer = (...a) => globalThis.__agyBackendFixture.tools(...a);'
);
const { streamAgy } = await import(dataUrl(backendCode));

const makeSession = (mode = 'normal', extra = {}) => ({
  pending: { abortController: new AbortController() },
  effectiveChatMode: mode,
  thinkingEffort: 'none',
  ...extra,
});

beforeEach(() => {
  uiEvents = [];
  capturedModel = undefined;
  capturedPrompt = undefined;
  capturedEffort = undefined;
  globalThis.__agyBackendFixture.prefs['translate.thinkingDepth'] = 'minimum';
  globalThis.__agyBackendFixture.refreshes = [];
  globalThis.__agyBackendFixture.toolHooks = [];
  globalThis.__agyBackendFixture.agentRun = undefined;
  fakeResponse = {
    text: 'answer',
    usage: { inputTokens: 2, cachedReadTokens: 3, outputTokens: 4, totalTokens: 9 },
    contextWindow: 1048576,
    path: '/bin/agy',
    version: '1.5.18',
  };
});

test('backend renders streamed text, reports usage and triggers version refresh', async () => {
  await streamAgy([{ role: 'user', content: 'question' }], makeSession('full-text'));
  assert.equal(capturedModel, 'gemini-4-neon');
  assert.match(JSON.stringify(capturedPrompt), /question/);
  assert.deepEqual(uiEvents.at(-1), ['end', { promptTokens: 5, completionTokens: 4, totalTokens: 9 }, undefined]);
  assert.deepEqual(globalThis.__agyBackendFixture.refreshes, [['1.5.18']]);
});

test('backend Agent mode flushes pre-tool text before tool card and renders post-tool text below it', async () => {
  const fixture = globalThis.__agyBackendFixture;
  fixture.agentRun = async (onText) => {
    await onText('Searching library.', 'Searching library.');
    await fixture.toolHooks.at(-1)();
    await fixture.toolHooks.at(-1)();
    await onText('Searching library.', '');
    await onText('Searching library.\n\nFound 2 papers.', 'Found 2 papers.');
    return { text: 'Searching library.\n\nFound 2 papers.', segment: 'Found 2 papers.', path: '/bin/agy', version: '1.5.18' };
  };
  await streamAgy([{ role: 'user', content: 'find it' }], makeSession('agent'));
  assert.ok(fixture.server?.tools.length);
  const updates = uiEvents.filter((e) => e[0] === 'update');
  assert.deepEqual(
    updates.filter((u) => u[3] && u[2] === 'Searching library.'),
    [['update', 'Searching library.', 'Searching library.', true]]
  );
  assert.deepEqual(updates.at(-1), ['update', 'Searching library.\n\nFound 2 papers.', 'Found 2 papers.', true]);
  assert.equal(uiEvents.at(-1)[0], 'end');

  fixture.agentRun = undefined;
  await streamAgy([{ role: 'user', content: 'q' }], makeSession('normal'));
  assert.equal(fixture.server, undefined);
});

test('translation model override parses fenced JSON without streaming JSON into chat', async () => {
  fakeResponse = { text: '```json\n{"textType":"text","translatedText":"对比学习"}\n```', version: '1.5.18' };
  await streamAgy([{ role: 'user', content: 'contrastive learning' }], makeSession(), {
    modelKey: `${AGY_PROVIDER_ID}::gpt-oss-120b-medium`,
    selectedText: 'contrastive learning',
  });
  assert.equal(capturedModel, 'gpt-oss-120b-medium');
  assert.equal(capturedEffort, undefined);
  assert.ok(uiEvents.some((e) => e[0] === 'translation'));
  assert.ok(!uiEvents.some((e) => e[0] === 'update'));
});

test('effort selection follows chat and translation preferences', async () => {
  await streamAgy([{ role: 'user', content: 'q' }], makeSession('normal', { agyThinkingEffort: 'xhigh' }));
  assert.equal(capturedEffort, 'xhigh');
  await streamAgy([{ role: 'user', content: 'q' }], makeSession('normal', { thinkingEffort: 'medium' }));
  assert.equal(capturedEffort, 'medium');
  await streamAgy([{ role: 'user', content: 'q' }], makeSession('normal', { agyThinkingEffort: 'max' }));
  assert.equal(capturedEffort, undefined);

  fakeResponse = { text: '{"textType":"text","translatedText":"ok"}', version: '1.5.18' };
  await streamAgy([{ role: 'user', content: 'w' }], makeSession('normal', { agyThinkingEffort: 'xhigh' }), {
    modelKey: `${AGY_PROVIDER_ID}::gemini-4-neon`,
    selectedText: 'w',
  });
  assert.equal(capturedEffort, 'low');
  globalThis.__agyBackendFixture.prefs['translate.thinkingDepth'] = 'follow-chat';
  await streamAgy([{ role: 'user', content: 'w' }], makeSession('normal', { agyThinkingEffort: 'xhigh' }), {
    modelKey: `${AGY_PROVIDER_ID}::gemini-4-neon`,
    selectedText: 'w',
  });
  assert.equal(capturedEffort, 'xhigh');
});

test('backend cancellation and invalid translation error reporting', async () => {
  fakeResponse = new DOMException('Cancelled', 'AbortError');
  await streamAgy([{ role: 'user', content: 'q' }], makeSession());
  assert.deepEqual(uiEvents.at(-1), ['end', undefined, true]);

  uiEvents = [];
  fakeResponse = { text: 'not JSON', version: '1.5.18' };
  await streamAgy([{ role: 'user', content: 'w' }], makeSession(), { selectedText: 'w' });
  assert.equal(uiEvents.at(-1)[0], 'error');
  assert.ok(!uiEvents.some((e) => e[0] === 'end'));
});

// Tool server tests.
let toolEvents;
let addPaperRuns;
globalThis.__agyToolFixture = {
  definitions: {
    read: {
      description: 'Read item',
      inputSchema: { parse: (v) => ({ itemId: Number(v.itemId) }) },
      execute: async ({ itemId }) => ({ text: `item-${itemId}` }),
    },
    capture_page: {
      description: 'Capture page',
      inputSchema: { parse: (v) => v },
      execute: async () => ({ page: 1, dataUrl: 'data:image/png;base64,YQ==' }),
    },
    add_paper: {
      description: 'Add paper',
      inputSchema: { parse: (v) => v },
      execute: async (v) => ({ added: ++addPaperRuns, doi: v.doi }),
    },
  },
  asSchema: () => ({ jsonSchema: { type: 'object' } }),
  start: (_s, info) => toolEvents.push(['start', info.toolName]),
  end: (_s, info) => toolEvents.push(['end', info.toolName]),
  translation: (_s, v) => toolEvents.push(['translation', v]),
};
let toolsCode = stripTypeScriptTypes(await source('tools'));
toolsCode = toolsCode.replace(/import \{ asSchema[^;]+;/, 'const asSchema = globalThis.__agyToolFixture.asSchema;');
toolsCode = toolsCode.replace(
  /import \{ getSharedToolDefinitions \} from '[^']+';/,
  'const getSharedToolDefinitions = () => globalThis.__agyToolFixture.definitions;'
);
toolsCode = toolsCode.replace(
  /import \{ onToolCallEndV2[^;]+;/,
  'const { start: onToolCallStartV2, end: onToolCallEndV2, translation: onTranslationResultV2 } = globalThis.__agyToolFixture;'
);
const { zoteroAgyToolServer } = await import(dataUrl(toolsCode));

test('zoteroAgyToolServer validates args, returns capture_page images, deduplicates add_paper and enforces cap', async () => {
  toolEvents = [];
  addPaperRuns = 0;
  const server = zoteroAgyToolServer({ kind: 'article' }, undefined, []);
  const r1 = await server.call('read', { itemId: 7 }, 't1');
  assert.deepEqual(JSON.parse(r1.content[0].text), { text: 'item-7' });
  const rImg = await server.call('capture_page', {}, 't2');
  assert.equal(rImg.content[1].type, 'image');
  assert.equal(rImg.content[1].mimeType, 'image/png');
  await Promise.all([server.call('add_paper', { doi: '10.1/x' }, 't3'), server.call('add_paper', { doi: '10.1/x' }, 't4')]);
  assert.equal(addPaperRuns, 1);
  assert.deepEqual(toolEvents, [
    ['start', 'read'],
    ['end', 'read'],
    ['start', 'capture_page'],
    ['end', 'capture_page'],
    ['start', 'add_paper'],
    ['end', 'add_paper'],
  ]);
});

// Settings state tests.
let savedConfig;
let checkCalls = 0;
globalThis.__agySettingsFixture = {
  save: async (config) => {
    savedConfig = config;
  },
  stop: async () => {},
  get: (key) => prefs[key],
  set: (key, value) => {
    prefs[key] = value;
  },
  check: async () => {
    checkCalls++;
    return { path: '/bin/agy', version: '1.5.19', plan: 'Google AI Pro', models: agyModelsFromSessionNew(sessionNewPayload), contextWindow: 1048576 };
  },
};
let settingsCode = stripTypeScriptTypes(await source('settings'));
settingsCode = settingsCode.replace(/import \{ (getString|createSubscriptionRuntimeSettings) \} from '[^']+';/g, '');
settingsCode = settingsCode.replace(
  /import \{ (analyzeModelName, getModelIconPath|CardModelRow, setCardModelName|InlineButton|Icons) \} from '[^']+';/g,
  ''
);
settingsCode = settingsCode.replace(/import \{ saveV2Config[^;]+;/, 'const saveV2Config = globalThis.__agySettingsFixture.save;');
settingsCode = settingsCode.replace(
  /import \{ getPref, setPref \} from '[^']+';/,
  'const { get: getPref, set: setPref } = globalThis.__agySettingsFixture;'
);
settingsCode = settingsCode.replace("from './protocol'", `from '${protocolUrl}'`);
settingsCode = settingsCode.replace(
  /import \{ checkAgy, stopAgy \} from '[^']+';/,
  'const stopAgy = globalThis.__agySettingsFixture.stop; const checkAgy = (...a) => globalThis.__agySettingsFixture.check(...a);'
);
const settings = await import(dataUrl(settingsCode));

test('enabling, refreshing and removing Antigravity preserves other providers and active state', async () => {
  const other = { providerId: 'openai', id: 'gpt', name: 'GPT', enabled: true };
  globalThis.addon.data.userProviderConfigV2 = {
    active: { providerId: 'openai', modelId: 'gpt' },
    addedProviders: { openai: { id: 'openai' } },
    addedModels: [other],
    env: { openai: { API_KEY: 'existing-key' } },
  };
  const models = agyModelsFromSessionNew(sessionNewPayload);
  await settings.publishAgyModels(models, 1048576);
  assert.equal(savedConfig.addedModels.length, 6);
  const neon = savedConfig.addedModels.find((m) => m.id === 'gemini-4-neon');
  assert.equal(neon.family, 'gemini');
  assert.deepEqual(neon.reasoningEfforts, ['low', 'medium', 'high', 'xhigh']);
  assert.equal(neon.limit.context, 1048576);
  neon.enabled = false;
  await settings.publishAgyModels(models, 1048576);
  assert.equal(savedConfig.addedModels.find((m) => m.id === 'gemini-4-neon').enabled, false);

  globalThis.addon.data.userProviderConfigV2 = savedConfig;
  assert.deepEqual(settings.agyEfforts('gemini-4-neon'), ['low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(settings.agyEfforts('gpt-oss-120b-medium'), []);

  checkCalls = 0;
  prefs['agy.modelsVersion'] = '1.5.18';
  await Promise.all([settings.refreshAgyModels('1.5.19'), settings.refreshAgyModels('1.5.19')]);
  assert.equal(checkCalls, 1);
  assert.equal(prefs['agy.modelsVersion'], '1.5.19');
  await settings.refreshAgyModels('1.5.19');
  assert.equal(checkCalls, 1);

  savedConfig.active = { providerId: AGY_PROVIDER_ID, modelId: 'gemini-4-neon' };
  await settings.disconnectAgy();
  assert.deepEqual(savedConfig.addedModels, [other]);
  assert.equal(savedConfig.active, undefined);
  assert.equal(savedConfig.env.openai.API_KEY, 'existing-key');
  assert.equal(prefs['llm.modelId'], '');
});
