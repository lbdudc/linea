import { absoluteRequires } from '../packages/location.js'
import type { LoadedPackage, PackageRegistry } from '../registry/registry.js'
import type { Lock, MetamodelManifest, ModuleManifest, SplManifest } from '../types.js'
import { resolveClosure, type Closure, type Wanted } from './closure.js'

/**
 * The module resolver: the modules an SPL lists and, transitively, the modules those require. It only talks to the module registry, and
 * knows nothing of metamodels.
 */
export const resolveModules = ({
  spl,
  registry,
  lock
}: {
  spl: SplManifest
  registry: PackageRegistry<ModuleManifest>
  lock?: Lock
}): Promise<Closure<ModuleManifest>> =>
  resolveClosure({
    roots: Object.fromEntries(Object.entries(spl.modules).map(([location, range]) => [location, [{ range, by: 'spl' }]])),
    registry,
    requires: (pkg) => absoluteRequires({ kind: 'module', location: pkg.location, manifest: pkg.manifest }).modules,
    lock
  })

/**
 * The metamodel resolver: the metamodels the modules declare and, transitively, the ones their grammars import. It only talks to the
 * metamodel registry, and is given the modules that were resolved (it does not choose them).
 */
export const resolveMetamodels = ({
  spl,
  modules,
  registry,
  lock
}: {
  /** The SPL itself: the metamodels it lists directly are roots too. */
  spl?: SplManifest
  modules: readonly LoadedPackage<ModuleManifest>[]
  registry: PackageRegistry<MetamodelManifest>
  lock?: Lock
}): Promise<Closure<MetamodelManifest>> => {
  const roots: Record<string, Wanted[]> = {}
  for (const [location, range] of Object.entries(spl?.metamodels ?? {})) roots[location] = [{ range, by: 'spl' }]
  for (const module of modules) {
    const who = `${module.location}@${module.version}`
    for (const [location, range] of Object.entries(absoluteRequires({ kind: 'module', location: module.location, manifest: module.manifest }).metamodels)) {
      roots[location] = [...(roots[location] ?? []), { range, by: who }]
    }
  }
  return resolveClosure({
    roots,
    registry,
    requires: (pkg) => absoluteRequires({ kind: 'metamodel', location: pkg.location, manifest: pkg.manifest }).metamodels,
    lock
  })
}
