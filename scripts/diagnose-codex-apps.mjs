// Read-only account/app discovery. Does not start a model turn or edit any app.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';

const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
async function source(entry) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { runtimePolicy, policyArguments } = await source('src/modules/codex/policy.ts');
const { CodexRpc } = await source('src/modules/codex/protocol.ts');
const { appFeatures, listApps } = await source('src/modules/codex/apps.ts');
if (!process.argv[2]) throw new Error('Usage: node scripts/diagnose-codex-apps.mjs /absolute/path/to/codex.exe');
const binary = resolve(process.argv[2]);
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' });
const features = execFileSync(binary, ['features', 'list'], { encoding: 'utf8' });
const policy = runtimePolicy(version, features);
const child = spawn(binary, ['app-server', ...policyArguments({ ...policy, ...appFeatures(policy, true), 'apps._default.enabled': false, cli_auth_credentials_store: 'auto' })], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const rpc = new CodexRpc(async (text) => { child.stdin.write(text); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => rpc.feed(chunk));
child.stderr.resume();
child.on('error', () => rpc.close());
child.on('exit', () => rpc.close());
try {
  await rpc.request('initialize', { clientInfo: { name: 'zotero_ai_bar', title: 'Zotero AI Bar app discovery', version: '1.6.10' }, capabilities: { experimentalApi: true } });
  await rpc.notify('initialized');
  const { account } = await rpc.request('account/read', { refreshToken: false });
  console.log(JSON.stringify({ version: version.trim(), accountType: account?.type || 'notLoggedIn' }));
  if (account?.type === 'chatgpt') {
    const apps = await listApps(rpc, true);
    console.log(JSON.stringify(apps.map(({ id, name, isAccessible, isEnabled }) => ({ id, name, isAccessible, isEnabled })), null, 2));
  } else console.log('Sign in to Codex with ChatGPT, then retry. No credentials are read by this script.');
} finally {
  rpc.close();
  child.kill();
}
