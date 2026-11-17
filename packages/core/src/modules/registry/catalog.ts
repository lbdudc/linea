import semver from 'semver'
import { ModuleResolutionError } from '../../errors.js'
import { MODULE_MANIFEST_PATH, emptyRegistryIndex, parseRegistryIndex, serializeRegistryIndex } from '../packages/manifests.js'
import type { PackageKind, PackageSource, RegistryEntry, RegistryIndex } from '../types.js'
import { createMetamodelRegistry, createModuleRegistry, type PackageRegistry } from './registry.js'

/**
 * Which packages a LINEA installation lists. A catalog only SAYS what is registered; it neither fetches packages (that is a
 * `PackageSource`) nor decides what may be resolved: an SPL can still require a location that is not in it.
 * Modules and metamodels share one catalog, each entry with its kind.
 */
export interface PackageCatalog {
  list: (args?: { kind?: PackageKind }) => Promise<RegistryEntry[]>
  get: (args: { location: string }) => Promise<RegistryEntry | undefined>
  /** Adds the entry, or replaces the one at its location. */
  add: (args: { entry: RegistryEntry }) => Promise<void>
  /** Does nothing when the location is not registered. */
  remove: (args: { location: string }) => Promise<void>
}

const entriesOf = (index: RegistryIndex): RegistryEntry[] =>
  Object.entries(index.packages)
    .map(([location, entry]) => ({ location, ...entry }))
    .sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0))

const catalogOver = ({ load, save }: { load: () => Promise<RegistryIndex>, save: (index: RegistryIndex, message: string) => Promise<void> }): PackageCatalog => ({
  list: async ({ kind } = {}) => entriesOf(await load()).filter((entry) => kind === undefined || entry.kind === kind),
  get: async ({ location }) => entriesOf(await load()).find((entry) => entry.location === location),
  add: async ({ entry: { location, ...rest } }) => {
    const index = await load()
    await save({ registryVersion: 1, packages: { ...index.packages, [location]: rest } }, `Register ${location}`)
  },
  remove: async ({ location }) => {
    const index = await load()
    if (index.packages[location] === undefined) return
    const packages = Object.fromEntries(Object.entries(index.packages).filter(([key]) => key !== location))
    await save({ registryVersion: 1, packages }, `Unregister ${location}`)
  }
})

/** A catalog held in memory: for tests, and for a server that keeps the catalog somewhere else and loads it whole. */
export const createMemoryCatalog = ({ index }: { index?: RegistryIndex } = {}): PackageCatalog => {
  let current = index ?? emptyRegistryIndex()
  return catalogOver({
    load: () => Promise.resolve(current),
    save: (next) => {
      current = next
      return Promise.resolve()
    }
  })
}

/**
 * A catalog kept in ONE text file (`registry.json`). `read` gives its content, or `undefined` when there is none yet (an empty
 * catalog); `write` stores the new content. Where the file lives (a folder, a git repository) is up to the caller.
 */
export const createFileCatalog = ({ read, write }: {
  read: () => Promise<string | undefined>
  write: (args: { content: string, message: string }) => Promise<void>
}): PackageCatalog => {
  return catalogOver({
    load: async () => {
      const content = await read()
      return content === undefined ? emptyRegistryIndex() : parseRegistryIndex({ content })
    },
    save: async (index, message) => {
      const before = await read()
      const after = serializeRegistryIndex({ index })
      if (before !== after) await write({ content: after, message })
    }
  })
}

/**
 * Registers a package after reading it: its latest version must have a valid manifest of the registry's kind, which gives the
 * entry its name and description. A location already registered as the other kind is refused (`resolveSpl` refuses it too).
 */
export const registerPackage = async ({ catalog, registry, location, addedBy, now = () => new Date() }: {
  catalog: PackageCatalog
  registry: PackageRegistry<{ name: string, version: string, description?: string }>
  location: string
  addedBy?: string
  now?: () => Date
}): Promise<RegistryEntry> => {
  const existing = await catalog.get({ location })
  if (existing !== undefined && existing.kind !== registry.kind) {
    throw new ModuleResolutionError(`${location} is already registered as a ${existing.kind}, not a ${registry.kind}.`)
  }
  const latest = semver.rsort(await registry.versions({ location }))[0]
  if (latest === undefined) {
    throw new ModuleResolutionError(`${location} has no published version (a tag such as v1.0.0), so it cannot be registered.`)
  }
  const { manifest } = await registry.load({ location, version: latest })
  const entry: RegistryEntry = {
    kind: registry.kind,
    location,
    name: manifest.name,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    addedAt: existing?.addedAt ?? now().toISOString(),
    ...(addedBy === undefined ? {} : { addedBy: existing?.addedBy ?? addedBy })
  }
  await catalog.add({ entry })
  return entry
}

/**
 * Registers a location without being told what it is: a package says so with its manifest (`module.json` or `metamodel.json`) at its
 * latest version. One without a published version is refused like in `registerPackage`.
 */
export const registerLocation = async ({ catalog, source, location, addedBy, now }: {
  catalog: PackageCatalog
  source: PackageSource
  location: string
  addedBy?: string
  now?: () => Date
}): Promise<RegistryEntry> => {
  const latest = semver.rsort(await source.listVersions({ location }))[0]
  let isModule = true // with no version to read, the module registry gives the error ("no published version")
  if (latest !== undefined) {
    const files = await source.open({ location, version: latest })
    isModule = (await files.read({ path: MODULE_MANIFEST_PATH })) !== undefined || (await files.read({ path: 'metamodel.json' })) === undefined
  }
  const registry = isModule ? createModuleRegistry({ source }) : createMetamodelRegistry({ source })
  return registerPackage({ catalog, registry, location, ...(addedBy === undefined ? {} : { addedBy }), ...(now === undefined ? {} : { now }) })
}
