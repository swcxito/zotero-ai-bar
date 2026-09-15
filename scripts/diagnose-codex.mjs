// Explicit opt-in subscription probe. Sends only a synthetic greeting, never documents or tokens.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';

if (!process.argv.includes('--live')) throw new Error('Requires --live; this probe uses a small amount of your Codex subscription.');
const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
async function source(entry) {
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { runtimePolicy, policyArguments, disableConfiguredMcp } = await source('src/modules/codex/policy.ts');
const { CodexRpc } = await source('src/modules/codex/protocol.ts');
const binary = '/Applications/ChatGPT.app/Contents/Resources/codex';
const directory = await mkdtemp(join(tmpdir(), 'zaibar-live-probe-'));
const env = { PATH: process.env.PATH, HOME: directory, CODEX_HOME: process.env.CODEX_HOME || join(homedir(), '.codex'), TMPDIR: tmpdir() };
const proxyIndex = process.argv.indexOf('--proxy');
if (proxyIndex !== -1) env.HTTPS_PROXY = process.argv[proxyIndex + 1];
const policy = {
  ...runtimePolicy(execFileSync(binary, ['--version'], { encoding: 'utf8' }), execFileSync(binary, ['features', 'list'], { encoding: 'utf8' })),
  cli_auth_credentials_store: 'auto',
};
const child = spawn(binary, ['app-server', ...policyArguments(policy)], { env, cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
const rpc = new CodexRpc((text) => new Promise((resolve, reject) => child.stdin.write(text, (error) => (error ? reject(error) : resolve()))));
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => rpc.feed(chunk));
child.stderr.on('data', () => {});
child.on('exit', () => rpc.close());
let timer;
let threadId;
let turnId;
try {
  await rpc.request('initialize', { clientInfo: { name: 'zotero_ai_bar', version: '1' }, capabilities: { experimentalApi: true } });
  await rpc.notify('initialized');
  const account = await rpc.request('account/read', { refreshToken: false });
  console.log('ChatGPT login available:', account.account?.type === 'chatgpt');
  if (account.account?.type !== 'chatgpt') throw new Error('No existing ChatGPT login; no login attempted.');
  const models = await rpc.request('model/list', { limit: 100 });
  const model = models.data.find((m) => /5\.6.*luna/i.test(m.model));
  if (!model) throw new Error('Requested 5.6 Luna model is not available.');
  console.log('Model:', model.model);
  const config = await rpc.request('config/read', { includeLayers: false });
  const thread = await rpc.request('thread/start', {
    model: model.model,
    modelProvider: 'openai',
    cwd: directory,
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    config: { ...policy, ...disableConfiguredMcp(config.config) },
    dynamicTools: [],
  });
  threadId = thread.thread.id;
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No completion after 45 seconds.')), 45000);
    rpc.listeners.add((message) => {
      const p = message.params || {};
      if (p.threadId !== threadId) return;
      if (message.method === 'turn/started') turnId = p.turn.id;
      if (message.method === 'error') console.log('Runtime error:', JSON.stringify(p.error?.codexErrorInfo), 'retry:', p.willRetry);
      if (message.method === 'item/agentMessage/delta') console.log('Received text delta:', p.delta?.length);
      if (message.method === 'turn/completed') {
        console.log('Turn status:', p.turn.status, 'error type:', JSON.stringify(p.turn.error?.codexErrorInfo));
        resolve();
      }
    });
  });
  void done.catch(() => {});
  await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply only OK.' }], effort: model.defaultReasoningEffort });
  console.log('Turn accepted');
  await done;
} finally {
  clearTimeout(timer);
  if (threadId && turnId) await rpc.request('turn/interrupt', { threadId, turnId }, 2000).catch(() => {});
  rpc.close();
  child.kill();
}
