/**
 * SPLs made of modules. From the bottom up:
 *   packages/    what a package is (manifests, locations) and where its files come from (a `PackageSource`)
 *   registry/    one registry per kind (modules, metamodels) over a source, and a router that sends each location to its host
 *   resolution/  from the modules an SPL lists to every package it needs, pinned by a lockfile
 *   metamodels/  loading the metamodels of an SPL into a metamodel engine (bango) and the models the modules offer
 *   configuration/ the SPL's models of the levels above 0 (its feature model, a model of bango's feature metamodel) and the platform composed with them
 *   spl/         the SPL as a whole: its feature model and code composed from the modules, and its check
 *   products/    a product of such an SPL: its models, its check and its derivation
 */
export * from './packages/index.js'
export * from './registry/index.js'
export * from './resolution/index.js'
export * from './metamodels/index.js'
export * from './configuration/index.js'
export * from './spl/index.js'
export * from './products/index.js'
export type {
  SplKind,
  PackageKind,
  PackageFiles,
  PackageSource,
  MetamodelManifest,
  ModuleManifest,
  SplManifest,
  Lock,
  LockEntry,
  ResolvedModule,
  ResolvedMetamodel,
  ResolvedSpl,
  Diagnostic,
  RegistryEntry,
  RegistryIndex
} from './types.js'
