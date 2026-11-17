/**
 * Compiles the PUBLISHED declarations the way a strict consumer would.
 *
 * `npm run typecheck` structurally cannot catch this: it checks the SOURCES,
 * where our ambient declarations under `src/types/` are in scope. Those are
 * never published, so a type coming from a dependency that ships none —
 * `spl-js-engine`, `@lbdudc/flamapy.js` — leaves a dangling reference in the
 * emitted `.d.ts` and breaks anyone building with `skipLibCheck: false`. Which
 * is exactly how linea-server and linea-cli are meant to build.
 *
 * Every emitted declaration is compiled, not just the closure of `index.d.ts`,
 * so a leak is caught while it is still latent instead of on the distant day
 * something public happens to expose it — the failure mode would be a TS7016 in
 * a file nobody touched.
 *
 * A JS script rather than an inline npm script because command substitution
 * does not survive npm on both Windows and the Linux CI runner.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'

const declarations = (dir) => {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...declarations(full))
    else if (entry.name.endsWith('.d.ts')) found.push(full)
  }
  return found
}

if (!fs.existsSync(DIST)) {
  console.error(`No ${DIST}/ to check. Run "npm run build" first.`)
  process.exit(1)
}

const files = declarations(DIST)
if (files.length === 0) {
  // A silent pass here would be the worst outcome: the check would look green
  // while verifying nothing.
  console.error(`No .d.ts files under ${DIST}/. The build did not emit declarations.`)
  process.exit(1)
}

console.log(`check:consumer — compiling ${files.length} declaration file(s) with skipLibCheck: false`)

// Run tsc's own entry point with this Node, rather than going through `npx`:
// on Windows `execFileSync` cannot spawn `npx.cmd` without a shell (EINVAL
// since Node 20), and involving a shell would mean quoting 26 paths correctly
// on two platforms.
const require = createRequire(import.meta.url)
const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')

try {
  execFileSync(
    process.execPath,
    [
      tsc, '--noEmit', '--strict',
      '--skipLibCheck', 'false',
      '--module', 'nodenext',
      '--moduleResolution', 'nodenext',
      ...files
    ],
    { stdio: 'inherit' }
  )
} catch {
  console.error(
    '\nA published declaration does not compile on its own.\n' +
    'Most likely a type from a dependency without declarations leaked into an\n' +
    'exported signature. Fix it the way src/analysis/runtime.ts and\n' +
    'src/derivation/engine.ts do: declare a local structural type instead.'
  )
  process.exit(1)
}

console.log('check:consumer OK')
