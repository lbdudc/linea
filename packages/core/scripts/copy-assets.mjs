/**
 * Copies packaged assets from `src/` into `dist/` after `tsc` runs.
 *
 * Rule: anything under `src/` that TypeScript does not compile is an asset.
 * That covers the line templates (`src/line/templates/**`) which land in a later
 * batch, and keeps the build from having to enumerate them one by one.
 *
 * Relative paths are preserved, so `src/a/b.json` becomes `dist/a/b.json` and
 * `src/assets.ts:resolveAsset()` resolves identically from source and from dist.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const DIST = path.join(ROOT, 'dist')

/** Files TypeScript owns; everything else under `src/` is an asset. */
const COMPILED = /\.(ts|tsx|mts|cts)$/

/** Directories never worth walking. */
const SKIP_DIRS = new Set(['node_modules'])

/**
 * Lists asset files under `dir`, as paths relative to `dir`.
 * Exported so the build rule itself can be unit-tested.
 *
 * @param {string} dir Directory to walk.
 * @returns {string[]} Relative paths, using forward slashes, sorted.
 */
export function collectAssets (dir) {
  if (!fs.existsSync(dir)) return []
  const found = []
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(current, entry.name), relative)
      } else if (entry.isFile() && !COMPILED.test(entry.name)) {
        found.push(relative)
      }
    }
  }
  walk(dir, '')
  return found.sort()
}

/**
 * Mirrors the assets of `from` into `to`.
 *
 * @param {string} from Source directory.
 * @param {string} to Destination directory.
 * @returns {string[]} The relative paths copied.
 */
export function copyAssets (from, to) {
  const assets = collectAssets(from)
  for (const relative of assets) {
    const destination = path.join(to, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(from, relative), destination)
  }
  return assets
}

const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const copied = copyAssets(SRC, DIST)
  console.log(`copy-assets: ${copied.length} asset(s) copied to dist/`)
}
