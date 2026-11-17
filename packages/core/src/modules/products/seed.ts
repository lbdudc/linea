import { configure, type Configuration } from '../configuration/configure.js'
import { FEATURE_SELECTION_GRAMMAR } from '../configuration/constants.js'
import { defaultSelection, selectionText } from '../configuration/selection.js'
import type { MetamodelEngine, MetamodelInfo } from '../metamodels/engine.js'
import { prepareEngine } from '../metamodels/prepare.js'
import type { Diagnostic, PackageFiles, ResolvedSpl } from '../types.js'

/**
 * The first text of each model of a product: what the metamodel says is the smallest valid one. For a new product, so it starts with
 * a file for every metamodel with final models (level 0); the SPL's models of the levels above are offered while they are made, so a
 * feature selection starts out as a selection of the SPL's feature model.
 */
export const seedProductModels = async ({
  resolved,
  spl,
  createEngine
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  createEngine: () => MetamodelEngine
}): Promise<{ models: Record<string, string>, metamodels: readonly MetamodelInfo[], diagnostics: readonly Diagnostic[], configuration: Configuration }> => {
  const { engine, metamodels: all, diagnostics, contributed } = await prepareEngine({ resolved, createEngine })
  const configuration = await configure({ engine, resolved, spl, metamodels: all, offered: contributed, diagnostics, loadCode: false })
  const metamodels = all.filter((info) => info.level === 0)
  const models: Record<string, string> = {}
  for (const info of metamodels) models[info.name] = (await engine.createInstance(info.name)).text
  // a new product starts from the smallest selection its feature model accepts, so it is not born invalid
  if (configuration.featureModel !== undefined && models[FEATURE_SELECTION_GRAMMAR] !== undefined) {
    models[FEATURE_SELECTION_GRAMMAR] = selectionText({ model: configuration.featureModel.name, features: defaultSelection({ tree: configuration.featureModel }) })
  }
  return { models, metamodels, diagnostics, configuration }
}
