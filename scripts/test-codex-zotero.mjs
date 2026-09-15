// Scaffold's Test runner always uses .scaffold/test/{profile,data}, never the user's profile.
// Disable its broad kill command: only its own child process may be terminated.
import process from 'node:process';
process.env.ZOTERO_PLUGIN_KILL_COMMAND = process.platform === 'win32' ? 'cmd /c exit 0' : 'true';
process.env.NODE_ENV = 'test';
const { Config, Test } = await import('zotero-plugin-scaffold');
const context = await Config.loadConfig({
  test: {
    entries: process.argv.includes('--live')
      ? ['scripts/zotero-live']
      : process.argv.includes('--all')
        ? ['scripts/zotero-tests', 'test']
        : ['scripts/zotero-tests'],
    watch: false,
    mocha: { timeout: process.argv.includes('--live') ? 90000 : 30000 },
  },
  server: { startArgs: ['-no-remote'] },
});
const runner = new Test(context);
process.on('SIGINT', () => runner.exit('SIGINT'));
await runner.run();
