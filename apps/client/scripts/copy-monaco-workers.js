// Copies the prebuilt monaco-editor web workers into public/ so the dev server
// and the production build can serve them as static assets.
//
// Runs from the `postinstall` hook, so it must not assume anything beyond a
// bare Node runtime: no shell builtins, no `cp`/`mkdir`, no dev-only CLI such
// as shx (a prod / `--omit=dev` install skips devDependencies but still runs
// postinstall).
const fs = require('node:fs');
const path = require('node:path');

const destDir = path.join(__dirname, '..', 'public', 'monaco-workers');

let srcDir;
try {
  // Resolve the package's main entry (dist/index.js) and step over to the
  // sibling workers/ dir. Can't resolve "…/package.json" directly — the package
  // ships an `exports` map that doesn't expose it.
  srcDir = path.join(path.dirname(require.resolve('monaco-editor-workers')), 'workers');
} catch {
  console.warn('[copy-monaco-workers] monaco-editor-workers is not installed — skipping');
  process.exit(0);
}

if (!fs.existsSync(srcDir)) {
  console.warn(`[copy-monaco-workers] ${srcDir} not found — skipping`);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });

console.log(`[copy-monaco-workers] copied ${path.relative(process.cwd(), srcDir)} -> ${path.relative(process.cwd(), destDir)}`);
