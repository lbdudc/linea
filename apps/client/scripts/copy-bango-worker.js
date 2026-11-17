// Copies bango's prebuilt bundles (the engine worker with the chunk it imports, the worker client and the views) into public/bango/ so
// the dev server and the production build serve them as static files: a Worker needs a URL, and the bundles are self-contained ES
// modules that need no bundler. Runs from `postinstall`, `dev` and `build`, so it must not assume anything beyond a bare Node runtime.
const fs = require('node:fs');
const path = require('node:path');

const destDir = path.join(__dirname, '..', 'public', 'bango');

const resolve = (specifier) => {
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
};

const worker = resolve('@lbdudc/bango/engine/bundle/worker');
const client = resolve('@lbdudc/bango/core/bundle/client');
const renderer = resolve('@lbdudc/bango/renderer/bundle');
const studio = resolve('@lbdudc/bango/studio/bundle');
if (!worker || !client || !renderer || !studio) {
  console.warn('[copy-bango-worker] @lbdudc/bango is not installed — skipping');
  process.exit(0);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });

// the worker, and the chunk it imports (same folder)
for (const file of fs.readdirSync(path.dirname(worker))) {
  if (file.endsWith('.js')) fs.copyFileSync(path.join(path.dirname(worker), file), path.join(destDir, file));
}
fs.copyFileSync(client, path.join(destDir, 'client.js'));
// the metamodel studio: Monaco, the engine and the renderer are handed to it by the page, so it is a file of its own
fs.copyFileSync(studio, path.join(destDir, 'studio.js'));
// the views only try to load elkjs (a better diagram layout) and use their own layout when they cannot: a bare specifier does not
// resolve in a browser, so say so plainly instead of leaving a failed import in the console
fs.writeFileSync(path.join(destDir, 'renderer.js'), fs.readFileSync(renderer, 'utf8').replace('import("elkjs/lib/elk.bundled.js")', 'Promise.reject(new Error("elkjs is not bundled"))'));

console.log(`[copy-bango-worker] copied bango's bundles -> ${path.relative(process.cwd(), destDir)}`);
