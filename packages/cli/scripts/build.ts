// Bundle the CLI for distribution. Run with `bun run scripts/build.ts`.
// Produces dist/index.js, runnable with `bun dist/index.js` from any folder (it carries the Solid transform with it, which
// running from source gets from `bunfig.toml` of the folder you are in).
import fs from 'node:fs';
import path from 'node:path';
import solidPlugin from '@opentui/solid/bun-plugin';

const result = await Bun.build({
  // the analysis worker is a file of its own: a thread starts from a file, not from a chunk
  entrypoints: ['./src/index.tsx', './src/core/analysisWorker.ts'],
  root: './src',
  target: 'bun',
  outdir: './dist',
  // the window (renderer, native library) and each part of the CLI are loaded when used: `--version` and `help` stay fast
  splitting: true,
  plugins: [solidPlugin],
  // @opentui/core resolves a platform-specific native addon at runtime; keep it
  // external so the bundler doesn't try to resolve every platform's package.
  external: ['@opentui/core'],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// linea-core reads its templates relative to where it runs (`assetsRoot()`): in a bundle that is dist/. Whatever it ships that is not
// code (src/line/templates/**) goes next to the bundle with the same relative paths, by the rule linea-core's own build uses.
const core = path.dirname(Bun.resolveSync('@lbdudc/linea-core/package.json', process.cwd()));
const from = fs.existsSync(path.join(core, 'src')) ? path.join(core, 'src') : path.join(core, 'dist');
const COMPILED = /\.(ts|tsx|mts|cts|js|mjs|cjs|map)$/;
let copied = 0;
const walk = (dir: string, prefix: string): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(path.join(dir, entry.name), relative);
    } else if (entry.isFile() && (!COMPILED.test(entry.name) || relative.startsWith('line/templates/'))) {
      const to = path.join('dist', relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(dir, entry.name), to);
      copied++;
    }
  }
};
walk(from, '');

console.log(`Built dist/index.js (+ ${copied} asset file(s) of linea-core)`);
