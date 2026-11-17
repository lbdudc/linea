import fs from 'node:fs'
import path from 'node:path'
import { InvalidArgumentError } from '../errors.js'
import { incrementVersion } from '../product/version.js'
import type { ProductSpec } from '../product/spec.js'
import type { PackageKind } from '../modules/types.js'
import { METAMODEL_MANIFEST_PATH, MODULE_MANIFEST_PATH } from '../modules/packages/manifests.js'
import { listLocalLines, readLocalProductSpec, updateLocalProduct } from './local.js'
import type { LocalPackage } from './modular.js'

/** What people do to the things of a workspace, as one call each (the commands that do it only say it in words). */

export type VersionPart = 'major' | 'minor' | 'patch'

const MANIFESTS: Record<PackageKind, string> = { module: MODULE_MANIFEST_PATH, metamodel: METAMODEL_MANIFEST_PATH }
const PARTS: Record<VersionPart, number> = { major: 0, minor: 1, patch: 2 }

/** The version after `version`, raising `part` of it. */
export function nextVersion (version: string, part: string): string {
  if (!(part in PARTS)) throw new InvalidArgumentError(`Bump "patch", "minor" or "major", not "${part}".`)
  return incrementVersion({ version, index: PARTS[part as VersionPart] })
}

/** Raises the version in the manifest of a package of the workspace. Returns the version it had and has now. */
export function bumpPackageVersion (opts: { dir: string, kind: PackageKind, part: string }): { from: string, to: string } {
  const file = path.join(opts.dir, MANIFESTS[opts.kind])
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: string }
  const to = nextVersion(manifest.version, opts.part)
  fs.writeFileSync(file, `${JSON.stringify({ ...manifest, version: to }, null, 2)}\n`)
  return { from: manifest.version, to }
}

/** Which SPLs of the workspace use a package of the workspace directly (the modules they name in `spl.json`). */
export function splsUsing (opts: { workdir: string, pkg: Pick<LocalPackage, 'kind' | 'location'> }): string[] {
  if (opts.pkg.kind !== 'module') return []
  return listLocalLines(opts.workdir)
    .filter((l) => {
      try {
        const spl = JSON.parse(fs.readFileSync(path.join(l.dir, 'spl.json'), 'utf8')) as { modules?: Record<string, string> }
        return Boolean(spl.modules && opts.pkg.location in spl.modules)
      } catch {
        return false
      }
    })
    .map((l) => l.name)
}

/**
 * Adds and removes features of a product's selection. A change that changes nothing (adding what is selected, removing nothing) is not
 * saved, so the product's version does not move. Removing a feature the product does not select is an error.
 */
export function changeProductFeatures (opts: { lineDir: string, name: string, add?: readonly string[], remove?: readonly string[] }): { features: string[], changed: boolean, spec: ProductSpec } {
  const spec = readLocalProductSpec(path.join(opts.lineDir, opts.name))
  const current = ((spec as { features?: string[] }).features ?? []).slice()
  const remove = new Set(opts.remove ?? [])
  const absent = [...remove].filter((f) => !current.includes(f))
  if (absent.length) throw new InvalidArgumentError(`${opts.name} does not select ${absent.join(', ')}.`)
  const features = [...new Set([...current.filter((f) => !remove.has(f)), ...(opts.add ?? [])])]
  const changed = features.length !== current.length || features.some((f, i) => f !== current[i])
  if (!changed) return { features, changed, spec }
  const { spec: saved } = updateLocalProduct({ lineDir: opts.lineDir, name: opts.name, spec: { ...spec, features } })
  return { features, changed, spec: saved }
}
