import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bango } from '@lbdudc/bango'
import {
  parseUvl,
  checkSelections,
  prepareEngine,
  createFsFiles,
  createFsPackageSource,
  parseSplManifest,
  readPackageText,
  resolveSpl,
  type MetamodelEngine,
  type PackageSource,
  type ResolvedSpl
} from '../../src/index.js'

export const MODULAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/modular')

export const createEngine = (): MetamodelEngine => new Bango()

export const fsSource = (): PackageSource => createFsPackageSource({ root: MODULAR })

export const splFiles = (): PackageFiles => createFsFiles({ dir: path.join(MODULAR, 'spl') })

export const resolveFixture = async (): Promise<ResolvedSpl> => {
  const content = await readPackageText({ files: splFiles(), path: 'spl.json' })
  return resolveSpl({ spl: parseSplManifest({ content: content! }), source: fsSource() })
}

export const PRODUCT_MODELS = {
  basic: 'basic shop\n',
  featureselection: 'selection of GisApps {\n  select Profile\n}\n',
  datamodel: 'datamodel shop\n\nentity Order {\n  property code: String pk\n  relation account -> UM_User\n}\n'
}

import fs from 'node:fs'
import { createMemoryPackageSource, type MemoryPackages, type PackageFiles, type SplManifest } from '../../src/index.js'

const readTree = (dir: string, prefix = ''): Record<string, string> => {
  const files: Record<string, string> = {}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) Object.assign(files, readTree(path.join(dir, entry.name), `${prefix}${entry.name}/`))
    else files[`${prefix}${entry.name}`] = fs.readFileSync(path.join(dir, entry.name), 'utf8')
  }
  return files
}

/** The fixture packages and SPL as plain data, to be changed by a test (locations are the same `file:` ones). */
export interface Fixture {
  packages: MemoryPackages
  spl: Record<string, string>
}

export const loadFixture = (): Fixture => {
  const packages: MemoryPackages = {}
  for (const kind of ['metamodels', 'modules']) {
    for (const name of fs.readdirSync(path.join(MODULAR, kind))) {
      const files = readTree(path.join(MODULAR, kind, name))
      const manifest = JSON.parse(files['.linea/module.json'] ?? files['metamodel.json'] ?? '{}') as { version: string }
      packages[`file:${kind}/${name}`] = { [manifest.version]: files }
    }
  }
  return { packages, spl: readTree(path.join(MODULAR, 'spl')) }
}

/** The files of the one version a fixture package has. */
export const filesOf = (fixture: Fixture, location: string): Record<string, string | Uint8Array> =>
  Object.values(fixture.packages[location] ?? {})[0]!

export const memoryFiles = async (files: Record<string, string>): Promise<PackageFiles> =>
  createMemoryPackageSource({ packages: { spl: { '0.0.0': files } } }).open({ location: 'spl', version: '0.0.0' })

export const resolveFixtureData = async (fixture: Fixture): Promise<{ resolved: ResolvedSpl, spl: PackageFiles }> => {
  const spl = JSON.parse(fixture.spl['spl.json']!) as SplManifest
  const source = createMemoryPackageSource({ packages: fixture.packages })
  return { resolved: await resolveSpl({ spl, source }), spl: await memoryFiles(fixture.spl) }
}

/**
 * What the feature metamodel says of a selection of features from a feature model (UVL): whether it is valid, with what it is completed.
 * (The check is bango's: the SPL's feature model is offered to the selection, as it is to a product.)
 */
export const selectionVerdict = async ({ featureModel, features }: { featureModel: string, features: string[] }): Promise<{ valid: boolean, problems: readonly string[], completed: readonly string[] }> => {
  const { engine } = await prepareEngine({ resolved: await resolveFixture(), createEngine })
  const [verdict] = await checkSelections({ engine, tree: parseUvl({ content: featureModel }), selections: [features] })
  return verdict!
}
