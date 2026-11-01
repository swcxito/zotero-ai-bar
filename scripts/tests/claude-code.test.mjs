import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const source = (name) => readFile(resolve(root, `src/modules/claudeCode/${name}.ts`), 'utf8');
const protocolUrl = dataUrl(stripTypeScriptTypes(await source('protocol')));
const {
  ClaudeStream, buildClaudeInput, claudeArguments, claudeDiscoveryArguments, claudeEnvironment, claudeCodeModelSelection, claudeCodeModels, claudeEffort,
  claudeModelsFromLine, CLAUDE_FALLBACK_MODELS, CLAUDE_INITIALIZE_REQUEST, REQUIRED_CLAUDE_FLAGS,
  claudeMcpReply, claudeInitializeRequest, claudeControlResponse, claudeControlError, CLAUDE_TOOL_SERVER,
} = await import(protocolUrl);
const messageStart = { type: 'stream_event', event: { type: 'message_start', message: {} } };
const mcpRequest = (id, message) => ({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'zotero', message } });
// Shape returned by the official CLI 2.1.168 for a Pro account (initialize control response).
const cliModels = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 4.6 · Best for everyday tasks', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'opus', displayName: 'Opus', description: 'Opus 4.8 · Most capable for complex work · ~2× usage vs Sonnet', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
];
const initializeResponse = (models) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'zaibar-models', response: { commands: [], models } } });
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const result = (text) => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 2 } });
const line = (event) => JSON.stringify(event) + '\n';

test('routes explicit translation model independently of the active model', () => {
  const active = { providerId: 'claude-code-local', modelId: 'sonnet' };
  assert.equal(claudeCodeModelSelection(undefined, active), 'sonnet');
  assert.equal(claudeCodeModelSelection('openai::gpt', active), undefined);
  assert.equal(claudeCodeModelSelection('claude-code-local::opus', { providerId: 'openai', modelId: 'gpt' }), 'opus');
});

test('parses split JSON, Unicode and final lines without duplicating assistant snapshots', () => {
  const parser = new ClaudeStream();
  const stream = line(delta('你好')) + line({ type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } }) + JSON.stringify(result('你好'));
  for (let i = 0; i < stream.length; i += 7) parser.push(stream.slice(i, i + 7));
  assert.equal(parser.finish(0), '你好');
});

test('falls back to the final result when partial messages are absent', () => {
  const parser = new ClaudeStream();
  parser.push(line(result('answer')));
  assert.equal(parser.finish(0), 'answer');
});

test('rejects quota errors, malformed output, missing results and process failures', () => {
  assert.throws(() => new ClaudeStream().push(line({ type: 'result', is_error: true, result: 'Rate limit exceeded' })), /Rate limit/);
  assert.throws(() => new ClaudeStream().push('not json\n'), /invalid stream/);
  const parser = new ClaudeStream(); parser.push(line(delta('partial')));
  assert.throws(() => parser.finish(0), /without a final/);
  const failed = new ClaudeStream(); failed.push(line(result('text')));
  assert.throws(() => failed.finish(1), /code 1\. Check login/);
  assert.throws(() => new ClaudeStream().finish(1, 'Error: Invalid setting source\n'), /code 1: Error: Invalid setting source$/);
});

test('does not leak provider tokens in error text', () => {
  assert.throws(() => new ClaudeStream().push(line({ type: 'result', is_error: true, result: 'Bearer private-token sk-ant-secret' })), (error) => {
    assert.doesNotMatch(error.message, /private-token|sk-ant-secret/);
    return true;
  });
});

test('passes paper history and images over stdin with no local path reads', () => {
  const input = JSON.parse(buildClaudeInput([
    { role: 'system', content: 'Explain equations accurately.' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: [{ type: 'text', text: 'Explain this $x$' }, { type: 'image', image: 'data:image/png;base64,YQ==' }] },
  ]));
  assert.equal(input.message.role, 'user');
  assert.equal(input.message.content.at(-1).source.media_type, 'image/png');
  assert.match(JSON.stringify(input), /Earlier answer/);
  assert.throws(() => buildClaudeInput([{ role: 'user', content: [{ type: 'image', image: 'C:\\private.png' }] }]), /Reattach/);
  assert.throws(() => buildClaudeInput([{ role: 'user', content: 'x'.repeat(10 * 1024 * 1024) }]), /too large/);
});

test('isolates execution without disabling official subscription authentication', () => {
  const args = claudeArguments('sonnet');
  // Gecko's Windows Subprocess drops '' arguments, which shifts the next flag into the value.
  assert.ok(!args.includes(''));
  assert.ok(args.includes('--tools='));
  assert.ok(args.includes('--setting-sources='));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--bare'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.throws(() => claudeArguments('sonnet --bad'), /Invalid/);
  const env = claudeEnvironment({ HOME: '/user', PATH: '/bin', HTTPS_PROXY: 'http://proxy', ANTHROPIC_API_KEY: 'key', ANTHROPIC_BASE_URL: 'override', CLAUDE_CODE_OAUTH_TOKEN: 'token', CLAUDECODE: '1' });
  assert.deepEqual(env, { HOME: '/user', PATH: '/bin', HTTPS_PROXY: 'http://proxy' });
});

test('publishes the versions the CLI reports for each alias, without listing default twice', () => {
  const models = claudeCodeModels(cliModels);
  assert.deepEqual(models.map((m) => [m.id, m.name]), [['sonnet', 'Claude Sonnet 4.6'], ['opus', 'Claude Opus 4.8'], ['haiku', 'Claude Haiku 4.5']]);
  assert.deepEqual(models[1].efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(models[2].efforts, []);
  // A recommended default that is Opus collapses into the opus entry.
  assert.deepEqual(claudeCodeModels([{ ...cliModels[1], value: 'default' }, cliModels[1]]).map((m) => m.id), ['opus']);
  // Session overrides and unsafe ids are not account models.
  assert.deepEqual(claudeCodeModels([{ value: 'sonnet', displayName: 'sonnet', description: 'Custom model' }, { value: 'x y', description: 'Opus 9 · bad' }, cliModels[2]]).map((m) => m.id), ['haiku']);
  assert.equal(claudeCodeModels([{ value: 'sonnet[1m]', displayName: 'Sonnet (1M context)', description: 'Sonnet 4.6 with 1M context · Long sessions' }])[0].name, 'Claude Sonnet 4.6 with 1M context');
  assert.ok(claudeArguments('sonnet[1m]').includes('sonnet[1m]'));
  assert.equal(claudeCodeModels(undefined), CLAUDE_FALLBACK_MODELS);
  assert.equal(claudeCodeModels([]), CLAUDE_FALLBACK_MODELS);
});

test('reads only the initialize response from the stream', () => {
  assert.equal(claudeModelsFromLine(line({ type: 'system', subtype: 'init' })), undefined);
  assert.equal(claudeModelsFromLine('not json'), undefined);
  assert.equal(claudeModelsFromLine(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'other' } })), undefined);
  assert.equal(claudeModelsFromLine(initializeResponse(cliModels)).length, 3);
  assert.throws(() => claudeModelsFromLine(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'zaibar-models', error: 'nope' } })), /nope/);
  assert.deepEqual(JSON.parse(CLAUDE_INITIALIZE_REQUEST), { type: 'control_request', request_id: 'zaibar-models', request: { subtype: 'initialize' } });
});

test('sends only effort levels the model reports, otherwise leaves the CLI default', () => {
  const opus = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.equal(claudeEffort(opus, 'max'), 'max');
  assert.equal(claudeEffort(['low', 'medium', 'high', 'max'], 'xhigh'), undefined);
  assert.equal(claudeEffort(opus, 'none'), undefined);
  assert.equal(claudeEffort([], 'high'), undefined);
  assert.equal(claudeEffort(opus, undefined), undefined);
  const args = claudeArguments('opus', 'xhigh');
  assert.deepEqual(args.slice(0, 5), ['-p', '--model', 'opus', '--effort', 'xhigh']);
  assert.ok(!claudeArguments('haiku').includes('--effort'));
  assert.throws(() => claudeArguments('opus', 'high --bare'), /Invalid Claude effort/);
});

test('Agent mode adds only the in-process Zotero MCP server, pre-approved, with built-in tools still off', () => {
  const plain = claudeArguments('opus');
  const agent = claudeArguments('opus', 'high', true);
  assert.equal(plain[plain.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(!plain.includes('--allowedTools'));
  assert.deepEqual(JSON.parse(agent[agent.indexOf('--mcp-config') + 1]), { mcpServers: { zotero: { type: 'sdk', name: 'zotero' } } });
  assert.equal(agent[agent.indexOf('--allowedTools') + 1], 'mcp__zotero');
  for (const args of [plain, agent]) {
    assert.ok(args.includes('--tools=') && args.includes('--strict-mcp-config') && !args.includes(''));
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  }
  assert.match(agent[agent.indexOf('--system-prompt') + 1], /mcp__zotero__<name>/);
  assert.match(plain[plain.indexOf('--system-prompt') + 1], /You have no tools/);
  assert.equal(CLAUDE_TOOL_SERVER, 'zotero');
  assert.deepEqual(JSON.parse(claudeInitializeRequest('i', ['zotero'])).request, { subtype: 'initialize', sdkMcpServers: ['zotero'] });
  assert.deepEqual(JSON.parse(claudeControlResponse('r', { a: 1 })), { type: 'control_response', response: { subtype: 'success', request_id: 'r', response: { a: 1 } } });
  assert.equal(JSON.parse(claudeControlError('r', 'no')).response.subtype, 'error');
});

test('answers the MCP handshake, tool listing and tool calls the CLI sends (as observed from 2.1.302)', async () => {
  const calls = [];
  const server = {
    tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }],
    call: async (name, args, toolUseId) => { calls.push([name, args, toolUseId]); return { content: [{ type: 'text', text: 'ok' }] }; },
  };
  const init = await claudeMcpReply({ method: 'initialize', params: { protocolVersion: '2025-11-25' }, jsonrpc: '2.0', id: 0 }, server);
  assert.deepEqual(init, { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'zotero', version: '1.0.0' } } });
  assert.deepEqual(await claudeMcpReply({ jsonrpc: '2.0', method: 'notifications/initialized' }, server), { jsonrpc: '2.0', result: {}, id: 0 });
  assert.deepEqual((await claudeMcpReply({ method: 'tools/list', jsonrpc: '2.0', id: 1 }, server)).result.tools, server.tools);
  const called = await claudeMcpReply({ method: 'tools/call', params: { name: 'read', arguments: { itemId: 3 }, _meta: { 'claudecode/toolUseId': 'toolu_1' } }, jsonrpc: '2.0', id: 2 }, server);
  assert.deepEqual(called, { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } });
  assert.deepEqual(calls, [['read', { itemId: 3 }, 'toolu_1']]);
  const unknown = await claudeMcpReply({ method: 'tools/call', params: { name: 'Bash', arguments: {} }, jsonrpc: '2.0', id: 3 }, server);
  assert.equal(unknown.result.isError, true);
  assert.equal(calls.length, 1, 'tools outside the list never run');
  assert.equal((await claudeMcpReply({ method: 'resources/list', jsonrpc: '2.0', id: 4 }, server)).error.code, -32601);
});

test('keeps each assistant message of an agent turn as its own segment, not just the final result', () => {
  const parser = new ClaudeStream();
  const requests = [];
  parser.onControlRequest = (event) => requests.push(event.request_id);
  parser.push(line(messageStart) + line(delta('Let me search.')));
  assert.equal(parser.segment, 'Let me search.');
  parser.push(line(messageStart)); // tool-use message without text
  parser.push(line(mcpRequest('req-1', { method: 'tools/call', jsonrpc: '2.0', id: 2 })) + line({ type: 'control_response', response: {} }));
  parser.push(line(messageStart) + line(delta('Found it.')));
  assert.equal(parser.segment, 'Found it.');
  parser.push(line(result('Found it.')));
  assert.deepEqual(requests, ['req-1']);
  assert.equal(parser.finish(0), 'Let me search.\n\nFound it.');
});

test('discovery keeps request isolation but lets the account choose models', () => {
  const args = claudeDiscoveryArguments();
  assert.ok(!args.includes('--model'));
  assert.ok(!args.includes(''));
  assert.deepEqual(args.slice(1), claudeArguments('sonnet').slice(3));
});

test('translation includes the schema expected by AI Bar translation cards', () => {
  const input = buildClaudeInput([{ role: 'user', content: 'Translate contrastive learning into Chinese.' }], true);
  for (const field of ['textType', 'translatedText', 'originalText', 'fullForm', 'otherMeanings']) assert.ok(input.includes(field));
});

let calls;
let prefs;
let authMethod;
let output;
let stopCount;
let firstChunk;
let stall;
let earlyExit;
globalThis.PathUtils = { profileDir: '/profile', join: (...parts) => parts.join('/'), isAbsolute: (p) => p.startsWith('/') };
globalThis.IOUtils = { makeDirectory: async () => {}, exists: async () => true };
globalThis.Zotero = { isWin: false };
globalThis.Ci = {};
globalThis.Cc = { '@mozilla.org/network/protocol-proxy-service;1': { getService: () => ({ proxyConfigType: 5 }) } };
globalThis.__claudePrefs = { get: (key) => prefs[key], set: (key, value) => { prefs[key] = value; } };
globalThis.ChromeUtils = { importESModule: () => ({ Subprocess: {
  getEnvironment: () => ({ HOME: '/user', HTTPS_PROXY: 'http://proxy', ANTHROPIC_API_KEY: 'must-not-leak' }),
  call: async (options) => {
    calls.push(options);
    const args = options.arguments;
    let chunks = args.includes('--version') ? ['2.1.168 (Claude Code)']
      : args.includes('--help') ? [REQUIRED_CLAUDE_FLAGS.join(' ')]
      : args.includes('auth') ? [JSON.stringify({ loggedIn: true, authMethod, subscriptionType: 'pro' })]
      : [...output];
    const discovery = args.includes('-p') && !args.includes('--model');
    if (discovery) chunks = [initializeResponse(cliModels).slice(0, 40), initializeResponse(cliModels).slice(40) + '\n'];
    const inference = args.includes('-p') && !discovery;
    const exited = inference && earlyExit;
    if (exited) chunks = [];
    const stderr = exited ? [earlyExit] : [];
    const closed = async () => { throw new Error('File closed'); };
    let wake;
    let killed = false;
    // Agent turns: a { waitFor } chunk holds stdout until the host has written a matching line,
    // as the real CLI waits for a tool result before continuing.
    options.writes = [];
    const written = [];
    const waitForWrite = (text) => new Promise((resolve) => {
      const check = () => (options.writes.some((w) => w.includes(text)) ? resolve() : written.push(check));
      check();
    });
    const child = {
      stdin: exited ? { write: closed, close: closed } : {
        write: async (input) => {
          if (options.stdinClosed) throw new Error('File closed');
          options.input = input;
          options.writes.push(input);
          written.splice(0).forEach((check) => check());
        },
        close: async () => { options.stdinClosed = true; },
      },
      stdout: { readString: async () => {
        while (chunks.length && typeof chunks[0] === 'object') await waitForWrite(chunks.shift().waitFor);
        if (chunks.length) { const value = chunks.shift(); if (inference) firstChunk?.(); return value; }
        if (inference && stall && !killed) return new Promise((resolve) => { wake = resolve; });
        return '';
      } },
      stderr: { readString: async () => stderr.shift() || '' },
      wait: async () => ({ exitCode: exited ? 1 : 0 }),
      kill: async () => { killed = true; stopCount++; wake?.(''); },
    };
    return child;
  },
} }) };
let runtimeCode = stripTypeScriptTypes(await source('runtime'));
runtimeCode = runtimeCode.replace(/import \{ getPref, setPref \} from '[^']+';/, 'const getPref = globalThis.__claudePrefs.get; const setPref = globalThis.__claudePrefs.set;');
runtimeCode = runtimeCode.replace("from './protocol'", `from '${protocolUrl}'`);
const runtime = await import(dataUrl(runtimeCode));
beforeEach(() => {
  calls = []; prefs = {}; authMethod = 'claude.ai'; output = [line(delta('answer')), line(result('answer'))];
  stopCount = 0; stall = false; firstChunk = undefined; earlyExit = undefined;
});

test('detects actual Claude Pro auth status shape and rejects API-key sessions', async () => {
  const info = await runtime.checkClaudeCode();
  assert.equal(info.plan, 'pro');
  assert.equal(calls.length, 3);
  authMethod = 'api_key';
  await assert.rejects(runtime.checkClaudeCode(), /subscription/);
});

test('runs a streamed request with current history and cleans up the child', async () => {
  const updates = [];
  const answer = await runtime.runClaudeCode('sonnet', 'stdin-content\n', undefined, async (text) => updates.push(text));
  assert.equal(answer.text, 'answer');
  const request = calls.find((c) => c.arguments.includes('-p'));
  assert.equal(request.input, 'stdin-content\n');
  assert.ok(!('ANTHROPIC_API_KEY' in request.environment));
  assert.equal(request.workdir, '/profile/zaibar/claude-code/workspace');
  assert.deepEqual(updates, ['answer']);
  assert.equal(stopCount, 4);
});

test('cancellation kills a stalled child and prevents further rendering', async () => {
  const controller = new AbortController();
  output = [line(delta('partial'))]; stall = true;
  const updates = [];
  const pending = runtime.runClaudeCode('sonnet', 'input', controller.signal, async (text) => { updates.push(text); controller.abort(); });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(updates, ['partial']);
  assert.ok(stopCount >= 4);
});

test('already cancelled requests never start a process', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.runClaudeCode('sonnet', '', controller.signal, async () => {}), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('malformed stream fails without falling back to an API provider', async () => {
  output = ['invalid\n'];
  await assert.rejects(runtime.runClaudeCode('sonnet', 'input', undefined, async () => {}), /invalid stream/);
  assert.equal(calls.filter((c) => c.arguments.includes('-p')).length, 1);
});

test('early CLI exit reports stderr instead of the closed stdin pipe', async () => {
  earlyExit = 'Error processing --setting-sources: Invalid setting source\n';
  await assert.rejects(runtime.runClaudeCode('sonnet', 'input', undefined, async () => {}), (error) => {
    assert.match(error.message, /code 1: Error processing --setting-sources/);
    assert.doesNotMatch(error.message, /File closed/);
    return true;
  });
});

test('lists account models over stdin without a model request and stops the CLI', async () => {
  const models = await runtime.listClaudeCodeModels('/bin/claude');
  assert.deepEqual(models.map((m) => m.name), ['Claude Sonnet 4.6', 'Claude Opus 4.8', 'Claude Haiku 4.5']);
  const discovery = calls.at(-1);
  assert.ok(!discovery.arguments.includes('--model'));
  assert.equal(discovery.input, CLAUDE_INITIALIZE_REQUEST);
  assert.ok(!('ANTHROPIC_API_KEY' in discovery.environment));
  assert.equal(stopCount, 1);
});

test('Agent turn: declares the tool server, answers tool calls on stdin, and closes stdin after the result', async () => {
  const toolCall = mcpRequest('req-7', { method: 'tools/call', params: { name: 'read', arguments: { itemId: 1 }, _meta: { 'claudecode/toolUseId': 'toolu_7' } }, jsonrpc: '2.0', id: 2 });
  output = [line(messageStart) + line(delta('Checking.')), line(toolCall), { waitFor: '"request_id":"req-7"' }, line(messageStart) + line(delta('Done.')), line(result('Done.'))];
  const server = { tools: [{ name: 'read', description: 'Read', inputSchema: { type: 'object' } }], call: async () => ({ content: [{ type: 'text', text: 'page text' }] }) };
  const updates = [];
  const answer = await runtime.runClaudeCode('opus', 'stdin-content\n', undefined, async (text, segment) => updates.push(segment), undefined, server);
  assert.equal(answer.text, 'Checking.\n\nDone.');
  assert.equal(answer.segment, 'Done.');
  assert.deepEqual(updates.filter(Boolean), ['Checking.', 'Done.']);
  const request = calls.find((c) => c.arguments.includes('--model'));
  assert.equal(request.arguments[request.arguments.indexOf('--allowedTools') + 1], 'mcp__zotero');
  assert.deepEqual(JSON.parse(request.writes[0]).request, { subtype: 'initialize', sdkMcpServers: ['zotero'] });
  assert.equal(request.writes[1], 'stdin-content\n');
  const reply = JSON.parse(request.writes.find((w) => w.includes('req-7')));
  assert.deepEqual(reply.response, { subtype: 'success', request_id: 'req-7', response: { mcp_response: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'page text' }] } } } });
  assert.equal(request.stdinClosed, true);
});

test('Agent turn rejects control requests for other servers or purposes', async () => {
  output = [line({ type: 'control_request', request_id: 'perm-1', request: { subtype: 'can_use_tool', tool_name: 'Bash' } }), { waitFor: 'perm-1' }, line(delta('ok')), line(result('ok'))];
  const server = { tools: [], call: async () => assert.fail('must not run') };
  await runtime.runClaudeCode('opus', 'x\n', undefined, async () => {}, undefined, server);
  const reply = JSON.parse(calls.find((c) => c.arguments.includes('--model')).writes.find((w) => w.includes('perm-1')));
  assert.equal(reply.response.subtype, 'error');
});

test('all new TypeScript modules parse', async () => {
  for (const name of ['protocol', 'runtime', 'backend', 'settings', 'tools']) assert.ok(stripTypeScriptTypes(await source(name)));
});

// Exercise the backend-to-UI contract without needing a running Zotero window.
let uiEvents = [];
let fakeResponse;
let capturedModel;
let capturedInput;
let capturedEffort;
globalThis.addon = { data: { userProviderConfigV2: { active: { providerId: 'claude-code-local', modelId: 'sonnet' } } } };
globalThis.__claudeBackendFixture = {
  prefs: { 'translate.thinkingDepth': 'minimum' },
  refreshes: [],
  efforts: { sonnet: ['low', 'medium', 'high', 'max'], opus: ['low', 'medium', 'high', 'xhigh', 'max'], haiku: [] },
  toolHooks: [],
  run: async (model, input, signal, onText, effort, server) => {
    capturedModel = model; capturedInput = input; capturedEffort = effort; globalThis.__claudeBackendFixture.server = server;
    if (globalThis.__claudeBackendFixture.agentRun) return globalThis.__claudeBackendFixture.agentRun(onText);
    if (fakeResponse instanceof Error) throw fakeResponse;
    await onText(fakeResponse.text, fakeResponse.text);
    return { segment: fakeResponse.text, ...fakeResponse };
  },
  tools: (session, signal, messages, beforeTool) => {
    globalThis.__claudeBackendFixture.toolHooks.push(beforeTool);
    return { tools: [{ name: 'read' }], call: async () => ({ content: [] }) };
  },
  start: () => uiEvents.push('start'),
  update: async (data) => uiEvents.push(['update', data.fullText, data.segmentText, data.force]),
  end: (_session, usage, aborted) => uiEvents.push(['end', usage, aborted]),
  error: (data) => uiEvents.push(['error', data.error]),
  translation: (_session, value) => uiEvents.push(['translation', value]),
  normalize: (value) => value?.textType && value?.translatedText ? value : undefined,
};
let backendCode = stripTypeScriptTypes(await source('backend'));
backendCode = backendCode.replace(/import \{ normalizeTranslationResultCandidate[^;]+;/, 'const normalizeTranslationResultCandidate = globalThis.__claudeBackendFixture.normalize;');
backendCode = backendCode.replace(/import \{ onLLMStreamStartV2[^;]+;/,
  'const { start: onLLMStreamStartV2, update: onLLMStreamUpdateV2, end: onLLMStreamEndV2, error: onLLMStreamErrorV2, translation: onTranslationResultV2 } = globalThis.__claudeBackendFixture;');
backendCode = backendCode.replace("from './protocol'", `from '${protocolUrl}'`);
backendCode = backendCode.replace(/import \{ runClaudeCode \} from '[^']+';/, 'const runClaudeCode = globalThis.__claudeBackendFixture.run;');
backendCode = backendCode.replace(/import \{ getPref \} from '[^']+';/, 'const getPref = (key) => globalThis.__claudeBackendFixture.prefs[key];');
backendCode = backendCode.replace(/import \{ claudeCodeEfforts, refreshClaudeCodeModels \} from '[^']+';/,
  'const claudeCodeEfforts = (id) => globalThis.__claudeBackendFixture.efforts[id] ?? []; const refreshClaudeCodeModels = async (...a) => { globalThis.__claudeBackendFixture.refreshes.push(a); };');
backendCode = backendCode.replace(/import \{ zoteroToolServer \} from '[^']+';/, 'const zoteroToolServer = (...a) => globalThis.__claudeBackendFixture.tools(...a);');
const { streamClaudeCode } = await import(dataUrl(backendCode));
const session = (mode = 'normal', extra = {}) => ({ pending: { abortController: new AbortController() }, effectiveChatMode: mode, thinkingEffort: 'none', ...extra });
beforeEach(() => {
  uiEvents = []; capturedModel = undefined; capturedInput = undefined; capturedEffort = undefined;
  globalThis.__claudeBackendFixture.prefs['translate.thinkingDepth'] = 'minimum';
  fakeResponse = { text: 'answer', usage: { input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 }, path: '/bin/claude', version: '2.1.302' };
  globalThis.__claudeBackendFixture.refreshes = [];
});

test('backend renders final text and reports usage through the existing UI', async () => {
  await streamClaudeCode([{ role: 'user', content: 'question' }], session('full-text'));
  assert.equal(capturedModel, 'sonnet');
  assert.match(capturedInput, /question/);
  assert.deepEqual(uiEvents.at(-1), ['end', { promptTokens: 5, completionTokens: 4, totalTokens: 9 }, undefined]);
  assert.ok(uiEvents.some((event) => event[0] === 'update'));
  // Every successful reply lets the menu catch up with the CLI version that answered.
  assert.deepEqual(globalThis.__claudeBackendFixture.refreshes, [['/bin/claude', '2.1.302']]);
});

test('translation model override reaches the translation renderer without streaming JSON into chat', async () => {
  fakeResponse = { text: '```json\n{"textType":"text","translatedText":"对比学习"}\n```' };
  await streamClaudeCode([{ role: 'user', content: 'contrastive learning' }], session(), { modelKey: 'claude-code-local::haiku', selectedText: 'contrastive learning' });
  assert.equal(capturedModel, 'haiku');
  assert.ok(uiEvents.some((event) => event[0] === 'translation'));
  assert.ok(!uiEvents.some((event) => event[0] === 'update'));
});

test('chat effort reaches the CLI only when the selected model supports it', async () => {
  await streamClaudeCode([{ role: 'user', content: 'q' }], session('normal', { claudeThinkingEffort: 'max' }));
  assert.equal(capturedEffort, 'max');
  // The generic chat effort is used until a Claude-specific level is picked.
  await streamClaudeCode([{ role: 'user', content: 'q' }], session('normal', { thinkingEffort: 'high' }));
  assert.equal(capturedEffort, 'high');
  // Sonnet has no xhigh; Codex-only or "none" levels fall back to the CLI default.
  await streamClaudeCode([{ role: 'user', content: 'q' }], session('normal', { claudeThinkingEffort: 'xhigh' }));
  assert.equal(capturedEffort, undefined);
  await streamClaudeCode([{ role: 'user', content: 'q' }], session());
  assert.equal(capturedEffort, undefined);
  // A one-off override (e.g. retry with another effort) wins.
  const overridden = session('normal', { claudeThinkingEffort: 'low' });
  overridden.pending.thinkingEffortOverride = 'medium';
  await streamClaudeCode([{ role: 'user', content: 'q' }], overridden);
  assert.equal(capturedEffort, 'medium');
});

test('translation uses the lowest level unless it follows the chat, and Haiku sends none', async () => {
  fakeResponse = { text: '{"textType":"text","translatedText":"x"}' };
  const chat = session('normal', { claudeThinkingEffort: 'max' });
  await streamClaudeCode([{ role: 'user', content: 'w' }], chat, { modelKey: 'claude-code-local::opus', selectedText: 'w' });
  assert.equal(capturedEffort, 'low');
  globalThis.__claudeBackendFixture.prefs['translate.thinkingDepth'] = 'follow-chat';
  await streamClaudeCode([{ role: 'user', content: 'w' }], chat, { modelKey: 'claude-code-local::opus', selectedText: 'w' });
  assert.equal(capturedEffort, 'max');
  await streamClaudeCode([{ role: 'user', content: 'w' }], chat, { modelKey: 'claude-code-local::haiku', selectedText: 'w' });
  assert.equal(capturedEffort, undefined);
});

test('Agent mode runs with the Zotero tools and renders text after a tool below its card', async () => {
  const fixture = globalThis.__claudeBackendFixture;
  fixture.agentRun = async (onText) => {
    await onText('Checking the paper', 'Checking the paper');
    await onText('Checking the paper.', 'Checking the paper.'); // small delta, may be throttled by the UI
    await fixture.toolHooks.at(-1)(); // a tool call starts
    await fixture.toolHooks.at(-1)(); // a second, parallel call: nothing left to flush
    await onText('Checking the paper.', ''); // next message, no text yet
    await onText('Checking the paper.\n\nDone.', 'Done.');
    return { text: 'Checking the paper.\n\nDone.', segment: 'Done.', path: '/bin/claude', version: '2.1.302' };
  };
  try {
    await streamClaudeCode([{ role: 'user', content: 'find it' }], session('agent'));
    assert.ok(fixture.server?.tools.length, 'tool server passed to the CLI');
    const updates = uiEvents.filter((event) => event[0] === 'update');
    // Before the tool card: the full pre-tool text, forced, exactly once.
    assert.deepEqual(updates.filter((u) => u[3] && u[2] === 'Checking the paper.'), [['update', 'Checking the paper.', 'Checking the paper.', true]]);
    assert.ok(!updates.some((u) => u[2] === ''), 'an empty new message renders nothing');
    assert.deepEqual(updates.at(-1), ['update', 'Checking the paper.\n\nDone.', 'Done.', true]);
    assert.equal(uiEvents.at(-1)[0], 'end');
  } finally {
    fixture.agentRun = undefined;
  }
  // Normal mode and translations never get tools.
  await streamClaudeCode([{ role: 'user', content: 'q' }], session('normal'));
  assert.equal(fixture.server, undefined);
  fakeResponse = { text: '{"textType":"text","translatedText":"x"}' };
  await streamClaudeCode([{ role: 'user', content: 'w' }], session('agent'), { selectedText: 'w' });
  assert.equal(fixture.server, undefined);
});

test('backend cancellation uses aborted completion and leaves no success event', async () => {
  fakeResponse = new DOMException('Cancelled', 'AbortError');
  await streamClaudeCode([{ role: 'user', content: 'question' }], session());
  assert.deepEqual(uiEvents.at(-1), ['end', undefined, true]);
});

test('invalid translation is reported instead of saving an empty successful answer', async () => {
  fakeResponse = { text: 'not JSON' };
  await streamClaudeCode([{ role: 'user', content: 'word' }], session(), { selectedText: 'word' });
  assert.equal(uiEvents.at(-1)[0], 'error');
  assert.ok(!uiEvents.some((event) => event[0] === 'end'));
});

let savedConfig;
let listCalls = 0;
globalThis.__claudeSettingsFixture = {
  save: async (config) => { savedConfig = config; }, stop: async () => {},
  get: (key) => prefs[key], set: (key, value) => { prefs[key] = value; },
  list: async () => { listCalls++; return claudeCodeModels(cliModels); },
};
let settingsCode = stripTypeScriptTypes(await source('settings'));
settingsCode = settingsCode.replace(/import \{ saveV2Config[^;]+;/, 'const saveV2Config = globalThis.__claudeSettingsFixture.save;');
settingsCode = settingsCode.replace(/import \{ getPref, setPref \} from '[^']+';/, 'const { get: getPref, set: setPref } = globalThis.__claudeSettingsFixture;');
settingsCode = settingsCode.replace("from './protocol'", `from '${protocolUrl}'`);
settingsCode = settingsCode.replace(/import \{ checkClaudeCode, listClaudeCodeModels, stopClaudeCode \} from '[^']+';/,
  'const stopClaudeCode = globalThis.__claudeSettingsFixture.stop; const checkClaudeCode = async () => ({}); const listClaudeCodeModels = (...a) => globalThis.__claudeSettingsFixture.list(...a);');
const settings = await import(dataUrl(settingsCode));

test('enabling/removing Claude preserves other providers and clears stale active selection', async () => {
  const other = { providerId: 'openai', id: 'gpt', name: 'GPT', enabled: true };
  addon.data.userProviderConfigV2 = { active: { providerId: 'openai', modelId: 'gpt' }, addedProviders: { openai: { id: 'openai' } }, addedModels: [other], env: { openai: { API_KEY: 'existing-key' } } };
  await settings.publishClaudeCodeModels();
  assert.equal(savedConfig.addedModels.length, 4);
  assert.equal(savedConfig.addedModels[0], other);
  assert.equal(savedConfig.active.providerId, 'openai');
  savedConfig.addedModels.find((m) => m.id === 'haiku').enabled = false;
  await settings.publishClaudeCodeModels(claudeCodeModels(cliModels));
  assert.equal(savedConfig.addedModels.length, 4);
  const opus = savedConfig.addedModels.find((m) => m.id === 'opus');
  assert.equal(opus.name, 'Claude Opus 4.8');
  assert.equal(opus.family, 'claude-opus');
  assert.deepEqual(opus.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(savedConfig.addedModels.find((m) => m.id === 'haiku').enabled, false);
  addon.data.userProviderConfigV2 = savedConfig;
  assert.deepEqual(settings.claudeCodeEfforts('sonnet'), ['low', 'medium', 'high', 'max']);
  assert.deepEqual(settings.claudeCodeEfforts('haiku'), []);
  assert.deepEqual(settings.claudeCodeEfforts(), []); // active model is OpenAI
  savedConfig.active = { providerId: 'claude-code-local', modelId: 'opus' };
  assert.equal(settings.claudeCodeEfforts().at(-1), 'max');
  savedConfig.active = { providerId: 'claude-code-local', modelId: 'sonnet' };
  await settings.disconnectClaudeCode();
  assert.deepEqual(savedConfig.addedModels, [other]);
  assert.equal(savedConfig.active, undefined);
  assert.equal(savedConfig.env.openai.API_KEY, 'existing-key');
  assert.equal(prefs['llm.modelId'], '');
});

test('re-reads the model list only when the CLI version changes', async () => {
  listCalls = 0;
  addon.data.userProviderConfigV2 = { active: undefined, addedProviders: {}, addedModels: [], env: {} };
  await settings.refreshClaudeCodeModels('/bin/claude', '2.1.302');
  assert.equal(listCalls, 0, 'provider not enabled');
  await settings.publishClaudeCodeModels(); // enabled, with the old alias names
  prefs['claudeCode.modelsVersion'] = '2.1.168';
  // The first request after an upgrade refreshes; concurrent triggers share one read.
  await Promise.all([settings.refreshClaudeCodeModels('/bin/claude', '2.1.302'), settings.refreshClaudeCodeModels('/bin/claude', '2.1.302')]);
  assert.equal(listCalls, 1);
  assert.equal(prefs['claudeCode.modelsVersion'], '2.1.302');
  assert.equal(savedConfig.addedModels.find((m) => m.id === 'opus').name, 'Claude Opus 4.8');
  await settings.refreshClaudeCodeModels('/bin/claude', '2.1.302');
  assert.equal(listCalls, 1, 'same version: no extra CLI launch');
  // The model dialog forces a refresh; a failed read keeps the list and retries later.
  const list = globalThis.__claudeSettingsFixture.list;
  globalThis.__claudeSettingsFixture.list = async () => { listCalls++; throw new Error('timed out'); };
  prefs['claudeCode.modelsVersion'] = '2.1.168';
  await assert.rejects(settings.refreshClaudeCodeModels('/bin/claude', '2.1.302'), /timed out/);
  assert.equal(prefs['claudeCode.modelsVersion'], '2.1.168');
  assert.equal(savedConfig.addedModels.filter((m) => m.providerId === 'claude-code-local').length, 3);
  globalThis.__claudeSettingsFixture.list = list;
  await settings.refreshClaudeCodeModels('/bin/claude', '2.1.168', true);
  assert.equal(listCalls, 3);
});

// Agent tool server: the shared Zotero handlers with UI and Zotero access stubbed.
const toolEvents = [];
let executions = [];
const toolDef = (description, execute, parse = (x) => x) => ({ description, inputSchema: { parse, jsonSchema: { type: 'object', description } }, execute });
globalThis.__claudeToolsFixture = {
  definitions: () => ({
    read: toolDef('Read', async (input) => { executions.push(['read', input]); return { text: 'page' }; }, (x) => {
      if (typeof x.itemId !== 'number') throw new Error('itemId must be a number');
      return x;
    }),
    ask_user: toolDef('Ask', async () => [{ question: 'q', selectedOptions: ['A'] }]),
    translate: toolDef('Translate', async (input) => input),
    capture_page: toolDef('Capture', async () => ({ pageNumber: 2, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })),
    add_paper: toolDef('Add', async (input) => { executions.push(['add_paper', input]); return { added: true }; }),
  }),
  asSchema: (schema) => ({ jsonSchema: schema.jsonSchema }),
  start: (_session, ui) => toolEvents.push(['start', ui.toolName, ui.toolCallId]),
  end: (_session, ui) => toolEvents.push(['end', ui.toolName, ui.output?.error ? 'error' : 'ok']),
  translation: (_session, value) => toolEvents.push(['translation', value.translatedText]),
};
let toolsCode = stripTypeScriptTypes(await source('tools'));
toolsCode = toolsCode.replace(/import \{ asSchema[^;]+;/, 'const asSchema = (...a) => globalThis.__claudeToolsFixture.asSchema(...a);');
toolsCode = toolsCode.replace(/import \{ getSharedToolDefinitions \} from '[^']+';/, 'const getSharedToolDefinitions = () => globalThis.__claudeToolsFixture.definitions();');
toolsCode = toolsCode.replace(/import \{ onToolCallEndV2[^;]+;/,
  'const { start: onToolCallStartV2, end: onToolCallEndV2, translation: onTranslationResultV2 } = globalThis.__claudeToolsFixture;');
const tools = await import(dataUrl(toolsCode));

test('tool server lists the shared Zotero tools and validates arguments before running them', async () => {
  toolEvents.length = 0; executions = [];
  const flushes = [];
  const server = tools.zoteroToolServer({}, undefined, [], async () => flushes.push('flush'));
  assert.deepEqual(server.tools.map((t) => t.name), ['read', 'ask_user', 'translate', 'capture_page', 'add_paper']);
  assert.deepEqual(server.tools[0].inputSchema, { type: 'object', description: 'Read' });
  assert.deepEqual(await server.call('read', { itemId: 1 }, 'toolu_1'), { content: [{ type: 'text', text: '{"text":"page"}' }] });
  const bad = await server.call('read', { itemId: 'x' }, 'toolu_2');
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /must be a number/);
  assert.deepEqual(executions, [['read', { itemId: 1 }]]);
  assert.deepEqual(toolEvents, [['start', 'read', 'toolu_1'], ['end', 'read', 'ok'], ['start', 'read', 'toolu_2'], ['end', 'read', 'error']]);
  assert.equal(flushes.length, 2, 'text written so far is rendered before each tool card');
  assert.equal((await server.call('Bash', {}, 'x')).isError, true);
});

test('tool server: ask_user shows no tool box, translate shows its card, capture_page returns the image', async () => {
  toolEvents.length = 0;
  const server = tools.zoteroToolServer({}, undefined, []);
  assert.match((await server.call('ask_user', { questions: [] }, 'a')).content[0].text, /selectedOptions/);
  await server.call('translate', { translatedText: '对比学习' }, 't');
  const page = await server.call('capture_page', { pageNumber: 2 }, 'c');
  assert.deepEqual(page.content[1], { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });
  assert.ok(!page.content[0].text.includes('base64'), 'the image is not repeated as text');
  assert.deepEqual(toolEvents, [['start', 'translate', 't'], ['translation', '对比学习'], ['start', 'capture_page', 'c'], ['end', 'capture_page', 'ok']]);
});

test('tool server: an identical add_paper runs once, a turn is capped at 30 calls, cancelled turns run nothing', async () => {
  executions = [];
  const server = tools.zoteroToolServer({}, undefined, []);
  const paper = { doi: '10.1/x', title: 'T' };
  const [first, second] = await Promise.all([server.call('add_paper', paper, '1'), server.call('add_paper', { ...paper }, '2')]);
  assert.equal(first, second);
  assert.equal(executions.filter(([name]) => name === 'add_paper').length, 1);
  for (let i = 0; i < 29; i++) await server.call('read', { itemId: i }, `r${i}`);
  const over = await server.call('read', { itemId: 99 }, 'r99');
  assert.equal(over.isError, true);
  assert.match(over.content[0].text, /limit/);
  const controller = new AbortController();
  controller.abort();
  executions = [];
  assert.equal((await tools.zoteroToolServer({}, controller.signal, []).call('read', { itemId: 1 }, 'x')).isError, true);
  assert.deepEqual(executions, []);
});
