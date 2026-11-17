import { ModuleResolutionError } from '../../errors.js'
import {
  METAMODEL_MANIFEST_PATH,
  MODULE_MANIFEST_PATH,
  parseMetamodelManifest,
  parseModuleManifest
} from '../packages/manifests.js'
import { readPackageText } from '../packages/source.js'
import type { MetamodelManifest, ModuleManifest, PackageFiles, PackageKind, PackageSource } from '../types.js'

/** One version of a package, read and checked: its manifest is valid and says the version it was published under. */
export interface LoadedPackage<Manifest> {
  readonly location: string
  readonly version: string
  readonly files: PackageFiles
  readonly manifest: Manifest
  /** An immutable id of that version (a commit sha), when the host gives one. */
  readonly revision?: string
}

/**
 * Where the packages of ONE kind come from. The module registry and the metamodel registry are separate pieces: each knows what its
 * kind looks like (the manifest file, how it is read) and nothing about the other. Both are built on a `PackageSource`, which only
 * knows how to reach a host (GitLab, GitHub, a folder...).
 */
export interface PackageRegistry<Manifest> {
  readonly kind: PackageKind
  /** The published versions of a package, as plain `x.y.z`. */
  versions: (args: { location: string }) => Promise<string[]>
  load: (args: { location: string, version: string }) => Promise<LoadedPackage<Manifest>>
}

const createRegistry = <Manifest extends { readonly version: string }>({
  kind,
  manifestPath,
  parse,
  source
}: {
  kind: PackageKind
  manifestPath: string
  parse: (args: { content: string }) => Manifest
  source: PackageSource
}): PackageRegistry<Manifest> => ({
    kind,
    versions: ({ location }) => source.listVersions({ location }),
    load: async ({ location, version }) => {
      let files: PackageFiles
      try {
        files = await source.open({ location, version })
      } catch (error) {
        throw new ModuleResolutionError(`Could not download ${kind} ${location}@${version}: ${(error as Error).message}`, { cause: error })
      }
      const content = await readPackageText({ files, path: manifestPath })
      if (content === undefined) {
        throw new ModuleResolutionError(`${location}@${version} has no ${manifestPath}: it is not a ${kind}.`)
      }
      let manifest: Manifest
      try {
        manifest = parse({ content })
      } catch (error) {
        throw new ModuleResolutionError(`${location}@${version}: ${(error as Error).message}`, { cause: error })
      }
      if (manifest.version !== version) {
        throw new ModuleResolutionError(
          `${location}: the version ${version} (its tag) declares version ${manifest.version} in ${manifestPath}.`
        )
      }
      const revision = await source.revision?.({ location, version })
      return { location, version, files, manifest, ...(revision === undefined ? {} : { revision }) }
    }
  })

/** The modules of a registry: `module.json` at the root of each package. */
export const createModuleRegistry = ({ source }: { source: PackageSource }): PackageRegistry<ModuleManifest> =>
  createRegistry({ kind: 'module', manifestPath: MODULE_MANIFEST_PATH, parse: parseModuleManifest, source })

/** The metamodels of a registry: `metamodel.json` and the grammars at the root of each package. */
export const createMetamodelRegistry = ({ source }: { source: PackageSource }): PackageRegistry<MetamodelManifest> =>
  createRegistry({ kind: 'metamodel', manifestPath: METAMODEL_MANIFEST_PATH, parse: parseMetamodelManifest, source })
