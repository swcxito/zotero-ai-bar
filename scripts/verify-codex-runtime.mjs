// Offline integration test: real Codex engine and production policy, local mock model only.
// No ChatGPT credentials, subscription usage, real document data or model API calls.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import console from 'node:console';

const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
async function loadSource(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { runtimePolicy, policyArguments, disableConfiguredMcp } = await loadSource('src/modules/codex/policy.ts');
const { CodexRpc } = await loadSource('src/modules/codex/protocol.ts');
const binary = process.argv[2] ? resolve(process.argv[2]) : '/Applications/ChatGPT.app/Contents/Resources/codex';
const directory = await mkdtemp(join(tmpdir(), 'zaibar-codex-integration-'));
const marker = join(directory, 'unexpected-mcp-start');
// Deliberately configure an unwanted server. Production overrides must prevent even its startup.
await writeFile(
  join(directory, 'config.toml'),
  `[mcp_servers.unwanted]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["-e", ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`)}]\n`
);
const environment = {
  PATH: process.env.PATH,
  HOME: directory,
  CODEX_HOME: directory,
  TMPDIR: tmpdir(),
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, USERPROFILE: directory, TEMP: directory } : {}),
};
const version = execFileSync(binary, ['--version'], { encoding: 'utf8', env: environment });
const features = execFileSync(binary, ['features', 'list'], { encoding: 'utf8', env: environment });
const policy = runtimePolicy(version, features);
const allowedFunctions = new Set(['request_user_input', 'wait', 'zotero_read']);
const allowedCustomTools = new Set(['exec']);
const observed = new Set();
let requests = 0;
let serverFailure;
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    requests++;
    for (const tool of body.tools) {
      observed.add(tool.name || tool.type);
      if (tool.type === 'function') assert.ok(allowedFunctions.has(tool.name), `Unexpected native function: ${tool.name}`);
      else if (tool.type === 'custom') assert.ok(allowedCustomTools.has(tool.name), `Unexpected Code Mode tool: ${tool.name}`);
      else assert.equal(tool.type, 'web_search', `Unexpected hosted tool: ${tool.type}`);
    }
    assert.ok(body.tools.some((tool) => tool.name === 'zotero_read'));
    assert.ok(body.tools.some((tool) => tool.type === 'web_search'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const responseId = `resp_${requests}`;
    const event = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
    event({ type: 'response.created', response: { id: responseId } });
    const item =
      requests === 1
        ? { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'zotero_read', arguments: '{"itemId":42}' }
        : { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Offline probe OK.' }] };
    event({ type: 'response.output_item.added', output_index: 0, item });
    if (requests > 1) event({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Offline probe OK.' });
    event({ type: 'response.output_item.done', output_index: 0, item });
    event({
      type: 'response.completed',
      response: { id: responseId, status: 'completed', output: [item], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
    });
    res.end();
  } catch (error) {
    serverFailure = error;
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/v1`;
const child = spawn(
  binary,
  [
    'app-server',
    ...policyArguments({
      ...policy,
      model_provider: 'offline_probe',
      'model_providers.offline_probe.name': 'Offline integration test',
      'model_providers.offline_probe.base_url': url,
      'model_providers.offline_probe.wire_api': 'responses',
      'model_providers.offline_probe.requires_openai_auth': false,
      'model_providers.offline_probe.request_max_retries': 0,
      'model_providers.offline_probe.stream_max_retries': 0,
    }),
  ],
  { cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'] }
);
const rpc = new CodexRpc((text) => new Promise((resolve, reject) => child.stdin.write(text, (error) => (error ? reject(error) : resolve()))));
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => rpc.feed(chunk));
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});
child.on('exit', () => rpc.close());
let toolCalls = 0;
rpc.onRequest = async (message) => {
  assert.equal(message.method, 'item/tool/call');
  assert.equal(message.params.tool, 'zotero_read');
  assert.deepEqual(message.params.arguments, { itemId: 42 });
  toolCalls++;
  return { success: true, contentItems: [{ type: 'inputText', text: 'Synthetic attachment text.' }] };
};
let timer;
try {
  const init = await rpc.request(
    'initialize',
    { clientInfo: { name: 'zaibar_offline_test', version: '1' }, capabilities: { experimentalApi: true } },
    5000
  );
  assert.ok(init.userAgent.includes(version.trim().replace('codex-cli ', '')));
  await rpc.notify('initialized');
  const configProbe = await rpc.request('config/read', { includeLayers: false });
  assert.equal(
    await access(marker).then(
      () => true,
      () => false
    ),
    false
  );
  // This also validates that the OpenAI-specific production overrides can be parsed without any credentials.
  const account = await rpc.request('account/read', { refreshToken: false });
  assert.equal(account.account, null);
  const thread = await rpc.request('thread/start', {
    model: 'gpt-5.1-codex',
    modelProvider: 'offline_probe',
    cwd: directory,
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    config: disableConfiguredMcp(configProbe.config),
    dynamicTools: [
      {
        name: 'zotero_read',
        description: 'Synthetic test only',
        inputSchema: { type: 'object', properties: { itemId: { type: 'integer' } }, required: ['itemId'], additionalProperties: false },
      },
    ],
  });
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Integration test timed out')), 15000);
    rpc.listeners.add((message) => {
      if (message.method === 'client/disconnected') reject(new Error(`Runtime disconnected: ${stderr.slice(0, 1000)}`));
      if (message.method === 'turn/completed')
        message.params.turn.status === 'completed' ? resolve() : reject(new Error(JSON.stringify(message.params.turn.error)));
    });
  });
  void done.catch(() => {});
  await rpc.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Offline protocol test, synthetic data only.' }] });
  await done;
  if (serverFailure) throw serverFailure;
  assert.equal(toolCalls, 1);
  assert.equal(requests, 2);
  assert.equal(
    await access(marker).then(
      () => true,
      () => false
    ),
    false,
    'Unwanted MCP process must not start'
  );
  console.log(
    JSON.stringify(
      { version: version.trim(), passed: true, modelRequests: requests, dynamicToolCalls: toolCalls, tools: [...observed], credentialsUsed: false },
      null,
      2
    )
  );
} catch (error) {
  console.error(error.message);
  if (serverFailure) console.error(serverFailure.message);
  console.error('Observed tools:', [...observed]);
  console.error(
    'Unwanted MCP started:',
    await access(marker).then(
      () => true,
      () => false
    )
  );
  console.error(stderr.slice(0, 3000));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  rpc.close();
  child.kill('SIGTERM');
  server.closeAllConnections();
  server.close();
}
