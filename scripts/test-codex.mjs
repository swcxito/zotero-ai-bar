import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Mocha from 'mocha';
import process from 'node:process';

const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
const directory = await mkdtemp(join(tmpdir(), 'zaibar-codex-tests-'));
await build({
  entryPoints: ['scripts/tests/codex.test.ts', 'scripts/tests/backend.test.ts', 'test/chatHistoryStore.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: directory,
  outbase: '.',
  logLevel: 'warning',
  plugins: [
    {
      name: 'backend-host-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\/runtime|\.\.\/(chatUI|agentTools))$/ }, (args) => {
          if (args.importer.replaceAll('\\', '/').endsWith('/codex/backend.ts')) return { path: resolve('scripts/tests/backend-fixture.ts') };
        });
      },
    },
  ],
});
const mocha = new Mocha({ timeout: 5000 });
mocha.addFile(join(directory, 'scripts/tests/codex.test.js'));
mocha.addFile(join(directory, 'scripts/tests/backend.test.js'));
mocha.addFile(join(directory, 'test/chatHistoryStore.test.js'));
// mkdtemp is outside the ESM package, so the generated CommonJS .js files are loadable.
mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
