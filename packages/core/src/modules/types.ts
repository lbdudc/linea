/** What a package (a module or a metamodel) is, in the registry. */
export type PackageKind = 'module' | 'metamodel'

/** The files of one version of one package. Paths are relative to the package root and use `/`. */
export interface PackageFiles {
  /** The bytes of a file, or `undefined` when there is none. */
  read: (args: { path: string }) => Promise<Uint8Array | undefined>
  /** Every file under `dir` (`''` is the whole package), recursively, as paths relative to the package root. */
  list: (args: { dir: string }) => Promise<string[]>
  /**
   * Optional: these files are about to be read, all of them. A source that has to fetch them can do it ahead and side by side instead of
   * one at a time as they are asked for. Not calling it only makes reading slower; nothing depends on it.
   */
  prefetch?: (paths: string[]) => void
}

/**
 * Where packages come from. linea-core never fetches anything itself: a source is given to it (the filesystem, memory, GitLab...).
 * A `location` is an opaque id such as `gitlab://host/group/project` or `file:modules/core`.
 */
export interface PackageSource {
  /** The published versions of a package, as plain `x.y.z` (a git tag `v1.2.3` is `1.2.3`). */
  listVersions: (args: { location: string }) => Promise<string[]>
  open: (args: { location: string, version: string }) => Promise<PackageFiles>
  /** An immutable id of that version (a commit sha), kept in the lockfile when there is one. */
  revision?: (args: { location: string, version: string }) => Promise<string | undefined>
}

/** `metamodel.json` */
export interface MetamodelManifest {
  readonly name: string
  readonly version: string
  readonly description?: string
  /** Packages that provide the grammars this one imports: location -> semver range. */
  readonly requires: Readonly<Record<string, string>>
}

/** `module.json` */
export interface ModuleManifest {
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly requires: {
    readonly modules: Readonly<Record<string, string>>
    readonly metamodels: Readonly<Record<string, string>>
  }
  /** Read-only models this module offers: metamodel (grammar) name -> path of the instance in the module. */
  readonly offers: Readonly<Record<string, string>>
}

/**
 * What an SPL is made of: a `plain` one has the feature metamodel only (its feature model, which the user does not see as a metamodel), a
 * `project` has the metamodels its user chose (the feature metamodel is always among them), and a `modular` one is made of modules, which
 * bring their own metamodels with them.
 */
export type SplKind = 'plain' | 'project' | 'modular'

/** `spl.json` */
export interface SplManifest {
  readonly name: string
  readonly version?: string
  readonly kind: SplKind
  /** The metamodels the SPL uses directly: location -> semver range. They always include the feature metamodel. */
  readonly metamodels: Readonly<Record<string, string>>
  /** The modules the SPL uses directly: location -> semver range. */
  readonly modules: Readonly<Record<string, string>>
}

export interface LockEntry {
  readonly kind: PackageKind
  readonly version: string
  readonly revision?: string
}

/** `linea.lock.json`: every package the SPL needs, transitively, pinned. */
export interface Lock {
  readonly lockVersion: 1
  readonly packages: Readonly<Record<string, LockEntry>>
}

export interface ResolvedModule {
  readonly kind: 'module'
  readonly location: string
  readonly version: string
  readonly revision?: string
  readonly manifest: ModuleManifest
  readonly files: PackageFiles
  /** Who asked for it: `spl` or `<location>@<version>`. */
  readonly requiredBy: readonly string[]
}

export interface ResolvedMetamodel {
  readonly kind: 'metamodel'
  readonly location: string
  readonly version: string
  readonly revision?: string
  readonly manifest: MetamodelManifest
  readonly files: PackageFiles
  readonly requiredBy: readonly string[]
}

/** The closure of an SPL's modules. Both lists have dependencies before dependants. */
export interface ResolvedSpl {
  readonly spl: SplManifest
  readonly modules: readonly ResolvedModule[]
  readonly metamodels: readonly ResolvedMetamodel[]
  readonly lock: Lock
}

export interface Diagnostic {
  readonly severity: 'error' | 'warning'
  /** A package location, `spl`, or `product`. */
  readonly package: string
  readonly file?: string
  readonly message: string
}

/** One registered package: the catalog says it exists; the package itself says what it is (`.linea/module.json`, `metamodel.json`). */
export interface RegistryEntry {
  readonly kind: PackageKind
  /** `gitlab:group/x`, `github:owner/repo`, `file:...` */
  readonly location: string
  readonly name: string
  readonly description?: string
  /** ISO date */
  readonly addedAt: string
  readonly addedBy?: string
}

/** `registry.json`: location -> entry. */
export interface RegistryIndex {
  readonly registryVersion: 1
  readonly packages: Readonly<Record<string, Omit<RegistryEntry, 'location'>>>
}
