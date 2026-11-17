import path from 'node:path'
import { ModuleManifestError } from '../../errors.js'
import type { MetamodelManifest, ModuleManifest, PackageKind } from '../types.js'

const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/i

/**
 * What a manifest says another package is, as the location it denotes.
 *
 * An absolute location (`gitlab:group/project`, `file:modules/core`) stands for itself. A reference that starts with `../` (or `./`) is
 * relative to the package that makes it, taken as a folder: `../common` in `gitlab:registry/basic` is `gitlab:registry/common`. That is
 * what lets a set of packages that need each other be published in any group (or kept in any folder) without editing their manifests.
 */
export const resolveReference = ({ from, reference }: { from: string, reference: string }): string => {
  if (!reference.startsWith('./') && !reference.startsWith('../')) return reference
  const match = SCHEME.exec(from)
  if (match === null) {
    throw new ModuleManifestError(`"${from}" is not a location, so "${reference}" cannot be relative to it.`)
  }
  const [, scheme, base] = match as unknown as [string, string, string]
  const resolved = path.posix.join(base, reference).replace(/\/+$/, '')
  if (resolved.startsWith('..') || resolved === '.' || resolved === '') {
    throw new ModuleManifestError(`"${reference}" in ${from} points outside the place its packages live.`)
  }
  return `${scheme}:${resolved}`
}

/** The packages a package requires, each as an absolute location with the range that is asked for. */
export const absoluteRequires = ({
  kind,
  location,
  manifest
}: {
  kind: PackageKind
  location: string
  manifest: ModuleManifest | MetamodelManifest
}): { modules: Record<string, string>, metamodels: Record<string, string> } => {
  const absolute = (record: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(Object.entries(record).map(([reference, range]) => [resolveReference({ from: location, reference }), range]))
  if (kind === 'module') {
    const { requires } = manifest as ModuleManifest
    return { modules: absolute(requires.modules), metamodels: absolute(requires.metamodels) }
  }
  return { modules: {}, metamodels: absolute((manifest as MetamodelManifest).requires) }
}
