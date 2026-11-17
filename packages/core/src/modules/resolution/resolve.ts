import { ModuleResolutionError } from '../../errors.js'
import { absoluteRequires } from '../packages/location.js'
import { createMetamodelRegistry, createModuleRegistry, type PackageRegistry } from '../registry/registry.js'
import type {
  Lock,
  LockEntry,
  MetamodelManifest,
  ModuleManifest,
  PackageKind,
  PackageSource,
  ResolvedMetamodel,
  ResolvedModule,
  ResolvedSpl,
  SplManifest
} from '../types.js'
import { resolveMetamodels, resolveModules } from './resolvers.js'

/** A package whose download just started, reported as `resolveSpl` finds out which one and at which version. */
export interface ResolutionProgress {
  readonly kind: PackageKind
  readonly location: string
  readonly version: string
  /** The modules that declare this metamodel; none for a module, or for a metamodel only the SPL or another metamodel asks for. */
  readonly requiredBy: readonly string[]
}

const withProgress = <Manifest>(
  registry: PackageRegistry<Manifest>,
  onProgress?: (progress: ResolutionProgress) => void | Promise<void>,
  requiredBy: (location: string) => readonly string[] = () => []
): PackageRegistry<Manifest> =>
  onProgress === undefined ? registry : {
    ...registry,
    load: async (args) => {
      await onProgress({ kind: registry.kind, location: args.location, version: args.version, requiredBy: requiredBy(args.location) })
      return registry.load(args)
    }
  }

/**
 * The closure of the modules of an SPL: the transitive modules and metamodels, each at exactly one version.
 *
 * It is two resolutions, one per registry: the modules first (they decide which metamodels are needed), then the metamodels they need.
 * Every package is used once (a metamodel is composed by name, so two versions of one cannot live together): the version is the highest
 * one that satisfies the ranges of everyone who asks for it. `lock` (from a previous resolution) is kept wherever it still fits.
 *
 * Modules and metamodels come from the same `source` unless a registry is given for either. `onProgress` is told of each package as
 * its download starts (once per package, however many rounds the resolution takes to settle on its version).
 */
export const resolveSpl = async ({
  spl,
  source,
  lock,
  onProgress,
  moduleRegistry = createModuleRegistry({ source }),
  metamodelRegistry = createMetamodelRegistry({ source })
}: {
  spl: SplManifest
  source: PackageSource
  lock?: Lock
  onProgress?: (progress: ResolutionProgress) => void | Promise<void>
  moduleRegistry?: PackageRegistry<ModuleManifest>
  metamodelRegistry?: PackageRegistry<MetamodelManifest>
}): Promise<ResolvedSpl> => {
  const moduleClosure = await resolveModules({ spl, registry: withProgress(moduleRegistry, onProgress), lock })
  const loadedModules = moduleClosure.order.map((location) => moduleClosure.packages.get(location)!)
  const modulesUsing = (metamodel: string): string[] =>
    loadedModules
      .filter(({ location, manifest }) => metamodel in absoluteRequires({ kind: 'module', location, manifest }).metamodels)
      .map(({ location }) => location)
  const metamodelClosure = await resolveMetamodels({
    spl,
    modules: loadedModules,
    registry: withProgress(metamodelRegistry, onProgress, modulesUsing),
    lock
  })

  for (const location of metamodelClosure.order) {
    if (moduleClosure.packages.has(location)) throw new ModuleResolutionError(`${location} is required as a module and as a metamodel.`)
  }

  const requiredBy = (closure: { wanted: ReadonlyMap<string, readonly { by: string }[]> }, location: string): string[] =>
    (closure.wanted.get(location) ?? []).map(({ by }) => by)

  const modules: ResolvedModule[] = moduleClosure.order.map((location) => {
    const pkg = moduleClosure.packages.get(location)!
    return { kind: 'module', location, version: pkg.version, files: pkg.files, manifest: pkg.manifest, requiredBy: requiredBy(moduleClosure, location), ...(pkg.revision === undefined ? {} : { revision: pkg.revision }) }
  })
  const metamodels: ResolvedMetamodel[] = metamodelClosure.order.map((location) => {
    const pkg = metamodelClosure.packages.get(location)!
    return { kind: 'metamodel', location, version: pkg.version, files: pkg.files, manifest: pkg.manifest, requiredBy: requiredBy(metamodelClosure, location), ...(pkg.revision === undefined ? {} : { revision: pkg.revision }) }
  })

  const packages: Record<string, LockEntry> = {}
  for (const pkg of [...modules, ...metamodels]) {
    packages[pkg.location] = { kind: pkg.kind, version: pkg.version, ...(pkg.revision === undefined ? {} : { revision: pkg.revision }) }
  }
  return { spl, modules, metamodels, lock: { lockVersion: 1, packages } }
}

/** Whether a lock still describes what resolving the SPL would give (same packages, same versions). */
export const isLockCurrent = ({ lock, resolved }: { lock: Lock, resolved: ResolvedSpl }): boolean => {
  const a = Object.entries(lock.packages).map(([location, entry]) => `${location}@${entry.version}`).sort()
  const b = Object.entries(resolved.lock.packages).map(([location, entry]) => `${location}@${entry.version}`).sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}
