import { configure, type Configuration } from '../configuration/configure.js'
import { hasErrors } from '../diagnostics.js'
import { prepareEngine } from '../metamodels/prepare.js'
import type { MetamodelEngine, MetamodelInfo } from '../metamodels/engine.js'
import type { Diagnostic, PackageFiles, ResolvedSpl } from '../types.js'
import { planPlatform } from './platform.js'

export interface SplCheckReport {
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly metamodels: readonly MetamodelInfo[]
  /** The feature model the products choose from (UVL): the SPL's own with the ones of its modules grafted in. */
  readonly featureModel: string
  /** The models of the levels above 0 (the feature model), and the platform composed with them. Not there when `configuration` was `false`. */
  readonly configuration?: Configuration
}

/**
 * Whether the packages of an SPL fit together: metamodels that compose, offered models that are valid together, the SPL's own models of the
 * levels above 0 (its feature model) and the feature models of its modules, and code that can be merged. Nothing is thrown for a problem of
 * the packages: they are all in the report, each with the package (and file) at fault.
 */
export const checkSpl = async ({
  resolved,
  spl,
  createEngine,
  configuration = true
}: {
  resolved: ResolvedSpl
  /** The files of the SPL itself (`models/...`, `src/platform/...`), when it has any. */
  spl?: PackageFiles
  createEngine: () => MetamodelEngine
  /** `false` to check packages on their own, with no SPL around them (no feature model is asked for). */
  configuration?: boolean
}): Promise<SplCheckReport> => {
  const { engine, metamodels, diagnostics, contributed } = await prepareEngine({ resolved, createEngine })
  if (!configuration) {
    // a check does not write the code anywhere: it is listed, and only what decides something is read
    const plan = await planPlatform({ resolved, spl, loadCode: false })
    diagnostics.push(...plan.diagnostics)
    return { ok: !hasErrors(diagnostics), diagnostics, metamodels, featureModel: plan.featureModel }
  }
  const composed = await configure({ engine, resolved, spl, metamodels, offered: contributed, diagnostics, loadCode: false })
  return { ok: !hasErrors(diagnostics), diagnostics, metamodels, featureModel: composed.featureModelUvl, configuration: composed }
}
