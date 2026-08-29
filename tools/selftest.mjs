// Builds the in-browser verification page into dist/. Not part of the shipped site:
// nothing links to it, it is excluded from the sitemap, and `npm run build` alone
// does not produce it.
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
mkdirSync(OUT, { recursive: true });

const page = (name) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}: running</title>
<style>body{background:#1E2A38;color:#FAF8F4;font:13px/1.5 ui-monospace,Consolas,monospace;padding:20px;margin:0}
pre{white-space:pre-wrap;margin:0}</style></head>
<body><pre id="out"></pre><script type="module" src="/${name}.js"></script></body></html>
`;

for (const name of ['selftest', 'tools-selftest', 'ocr-probe']) {
  await esbuild.build({
    entryPoints: [join(ROOT, `src/test/${name}.ts`)],
    bundle: true, format: 'esm', target: ['es2022'],
    outfile: join(OUT, `${name}.js`), logLevel: 'warning',
  });
  writeFileSync(join(OUT, `${name}.html`), page(name));
}

console.log('selftests built -> dist/selftest.html, dist/tools-selftest.html');
