import process from 'node:process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const { build } = createRequire(import.meta.resolve('zotero-plugin-scaffold'))('esbuild');
// Run from the repository root. Load the generated scripts through Zotero's Run JavaScript window.
const directory = resolve(process.argv[2] ?? '.scaffold/acceptance');
await mkdir(directory, { recursive: true });

const scripts = {
  'live.ts': 'native-tests.js',
  'extra.ts': 'extra-tests.js',
  'edges.ts': 'edge-tests.js',
  'ui-fixes.ts': 'ui-fixes-v1.js',
  'reader-ui.ts': 'reader-ui-v1.js',
};
for (const [source, output] of Object.entries(scripts)) {
  await build({
    entryPoints: [`scripts/acceptance/${source}`],
    outfile: `${directory}/${output}`,
    bundle: true,
    format: 'iife',
    target: 'firefox115',
    define: { __env__: '"production"', __acceptanceOutputDirectory__: JSON.stringify(directory) },
    banner: { js: '(() => { const addon = Zotero.ZAIBar; const ztoolkit = addon.data.ztoolkit;' },
    footer: { js: '})();' },
  });
}
process.stdout.write(`${directory}\n`);
