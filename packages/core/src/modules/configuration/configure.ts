import { UvlParseError } from '../../errors.js'
import { featuresOf, parseUvl, printUvl, type FeatureModelTree } from '../../feature-model/uvl.js'
import { toDiagnostics, type MetamodelEngine, type MetamodelInfo } from '../metamodels/engine.js'
import { readPackageText } from '../packages/source.js'
import { planPlatform, type PlatformPlan } from '../spl/platform.js'
import type { Diagnostic, PackageFiles, ResolvedSpl } from '../types.js'
import { FEATURE_MODEL_GRAMMAR } from './constants.js'
import { rootFeatureName } from './names.js'

/** A model of a level above 0: what the final models are made from. */
export interface ConfigurationModel {
  readonly metamodel: string
  readonly level: number
  readonly text: string
  /** Where the SPL keeps it (`models/<metamodel>.<extension>`). The composed feature model of a modular SPL is not a file. */
  readonly file: string
  /** Whether the SPL has the file: a model of a metamodel the SPL gained is made new (the smallest valid one) until it is saved. */
  readonly stored: boolean
}

/** The models of the levels above 0 of an SPL, ready to be offered to its products, and the platform composed with them. */
export interface Configuration {
  /** Highest level first. */
  readonly models: readonly ConfigurationModel[]
  /** The feature model the products choose from: the SPL's own, with the ones of its modules grafted in. */
  readonly featureModel?: FeatureModelTree
  /** The same, as UVL: what flamapy analyzes and the derivation engine reads. */
  readonly featureModelUvl: string
  readonly plan: PlatformPlan
}

/** `models/<metamodel>.<extension>`: where an SPL keeps its model of a metamodel. */
const configurationPath = ({ info }: { info: Pick<MetamodelInfo, 'name' | 'extension'> }): string => `models/${info.name}.${info.extension}`

/**
 * Gives the engine the models of the levels above 0 of an SPL, to offer to its products, read-only: for each such metamodel (highest
 * level first, each checked with the ones above it offered), the SPL's own model of it from `models/<metamodel>.<extension>` (the feature
 * model made new when there is none). The feature models of the SPL's modules are then grafted under the root of the SPL's own, and that
 * composed feature model is what is offered. What is wrong with any of it is added to `diagnostics`.
 *
 * Afterwards the engine has no models of its own (`setInstances({})`): the caller sets the product's.
 */
export const configure = async ({
  engine,
  resolved,
  spl,
  metamodels,
  offered,
  diagnostics,
  loadCode = true
}: {
  engine: MetamodelEngine
  resolved: ResolvedSpl
  /** The files of the SPL. */
  spl?: PackageFiles
  metamodels: readonly MetamodelInfo[]
  /** What the engine already offers: the models of the modules. */
  offered: readonly { origin: string, metamodel: string, text: string }[]
  diagnostics: Diagnostic[]
  /** `false` for a check, where the code of the modules is only listed (see `planPlatform`). */
  loadCode?: boolean
}): Promise<Configuration> => {
  const upper = metamodels.filter((info) => info.level > 0).sort((a, b) => b.level - a.level)
  const contributed = [...offered]
  const models: ConfigurationModel[] = []
  let own: FeatureModelTree | undefined

  const fail = (file: string, message: string): void => { diagnostics.push({ severity: 'error', package: 'spl', file, message }) }

  for (const info of upper) {
    const file = configurationPath({ info })
    let text = spl === undefined ? undefined : await readPackageText({ files: spl, path: file })
    const stored = text !== undefined
    if (text === undefined) {
      if (info.name === FEATURE_MODEL_GRAMMAR) {
        // an SPL that has no feature model yet has an empty one, named after it
        const name = rootFeatureName({ name: resolved.spl.name })
        text = (await engine.importJson({ featureModel: { name, root: { name, groups: [] }, constraints: [] } })).texts[info.name]
      } else {
        // any other metamodel of a level above 0 starts from what it says is its smallest valid model, until the SPL saves one
        await engine.setContributed(contributed)
        text = (await engine.createInstance(info.name)).text
      }
      if (text === undefined) { fail(file, `There is no model of "${info.name}".`); continue }
    }
    await engine.setContributed(contributed)
    const states = await engine.setInstances({ [info.name]: text })
    for (const state of states) diagnostics.push(...toDiagnostics(state.problems, { package: 'spl', file }))
    if (info.name === FEATURE_MODEL_GRAMMAR) {
      // (a model that does not parse has no JSON: what is wrong with it is already in the diagnostics)
      const json = (await engine.toJson(info.name).catch(() => undefined)) as { featureModel?: FeatureModelTree } | undefined
      own = json?.featureModel
    }
    models.push({ metamodel: info.name, level: info.level, text, file, stored })
    contributed.push({ origin: `level-${info.level}`, metamodel: info.name, text })
  }

  // the SPL's own feature model is the root and what it declares itself; what its modules declare is grafted in
  const plan = await planPlatform({ resolved, spl, loadCode, ...(own === undefined ? {} : { ownFeatureModel: printUvl({ tree: own }) }) })
  diagnostics.push(...plan.diagnostics)

  let featureModel = own
  if (own !== undefined && resolved.modules.length > 0 && plan.featureModel !== '') {
    try {
      featureModel = parseUvl({ content: plan.featureModel })
      const composed = (await engine.importJson({ featureModel })).texts[FEATURE_MODEL_GRAMMAR]
      if (composed === undefined) fail('models/featuremodel', 'The composed feature model could not be made.')
      else {
        const at = contributed.findIndex((item) => item.metamodel === FEATURE_MODEL_GRAMMAR && item.origin.startsWith('level-'))
        contributed[at] = { ...contributed[at]!, text: composed }
        const index = models.findIndex((model) => model.metamodel === FEATURE_MODEL_GRAMMAR)
        models[index] = { ...models[index]!, text: composed }
      }
    } catch (error) {
      if (!(error instanceof UvlParseError)) throw error
      fail('models/featuremodel', `The merged feature model is not valid: ${error.message}`)
    }
  }

  // what is offered, with its problems (the feature model of the modules is checked here: a feature declared twice, a constraint on a missing one)
  if (contributed.length > 0) {
    for (const state of await engine.setContributed(contributed)) {
      if (!state.origin.startsWith('level-')) continue
      const model = models.find((candidate) => candidate.metamodel === state.metamodel)
      diagnostics.push(...toDiagnostics(state.problems, { package: 'spl', ...(model === undefined ? {} : { file: model.file }) }))
    }
  }
  await engine.setInstances({})

  if (upper.every((info) => info.name !== FEATURE_MODEL_GRAMMAR)) {
    diagnostics.push({ severity: 'error', package: 'spl', message: 'The SPL has no feature metamodel: add "featuremodel" to its metamodels.' })
  }

  return {
    models,
    ...(featureModel === undefined ? {} : { featureModel }),
    featureModelUvl: featureModel === undefined ? '' : printUvl({ tree: featureModel }),
    plan
  }
}

/** The names of the features of a configuration's feature model. */
export const featureNames = ({ configuration }: { configuration: Pick<Configuration, 'featureModel'> }): string[] =>
  configuration.featureModel === undefined ? [] : featuresOf({ tree: configuration.featureModel }).map((feature) => feature.name)
