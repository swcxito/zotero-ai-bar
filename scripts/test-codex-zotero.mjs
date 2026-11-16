// Scaffold's Test runner always uses .scaffold/test/{profile,data}, never the user's profile.
// Disable its broad kill command: only its own child process may be terminated.
import process from 'node:process';
import { createServer } from 'node:http';

// Loopback fixtures exercise Zotero's real HTTP transport without external services.
const attempts = new Map();
const fixtureServer = createServer((request, response) => {
  const path = request.url;
  const count = (attempts.get(path) ?? 0) + 1;
  attempts.set(path, count);
  response.setHeader('Content-Type', 'application/json');
  if (path === '/stalled' || path === '/cancel' || (path === '/retry' && count === 1)) {
    response.writeHead(200);
    response.flushHeaders();
    response.write('{"message":');
  } else {
    response.end(JSON.stringify({ message: { items: [] }, attempts: count }));
  }
});
await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
fixtureServer.unref();
process.env.ZAIBAR_TEST_HTTP_ORIGIN = `http://127.0.0.1:${fixtureServer.address().port}`;
process.env.ZOTERO_PLUGIN_KILL_COMMAND = process.platform === 'win32' ? 'cmd /c exit 0' : 'true';
process.env.NODE_ENV = 'test';
const { Config, Test } = await import('zotero-plugin-scaffold');
const nativeTestSuites = {
  '--perf': ['scripts/zotero-perf'],
  '--history': ['scripts/zotero-history'],
  '--selection': ['scripts/zotero-selection'],
  '--live': ['scripts/zotero-live'],
  '--all': ['scripts/zotero-tests', 'scripts/zotero-selection', 'scripts/zotero-history', 'test'],
};
const suite = Object.keys(nativeTestSuites).find((flag) => process.argv.includes(flag));
const entries = nativeTestSuites[suite] ?? ['scripts/zotero-tests'];
const context = await Config.loadConfig({
  test: {
    entries,
    watch: false,
    mocha: { timeout: process.argv.includes('--perf') ? 180000 : process.argv.includes('--live') ? 90000 : 30000 },
  },
  server: { startArgs: ['-no-remote'] },
});
const runner = new Test(context);
process.on('SIGINT', () => runner.exit('SIGINT'));
await runner.run();
