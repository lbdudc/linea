import { configure, type Configuration } from '../configuration/configure.js'
import { hasErrors } from '../diagnostics.js'
import type { EngineProblem, MetamodelEngine, MetamodelInfo } from '../metamodels/engine.js'
import { prepareEngine } from '../metamodels/prepare.js'
import type { Diagnostic, PackageFiles, ResolvedSpl } from '../types.js'

export interface ProductCheckReport {
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
  /** The metamodels the product has to give a model of: the ones whose models are final (level 0). */
  readonly metamodels: readonly MetamodelInfo[]
  /** The product's models merged into one JSON document (what the derivation gets as `models`); only when everything is valid. */
  readonly models?: unknown
  /** The JSON of each model on its own (`modelsByMetamodel`): its metamodel's mapping when it has one, else the plain tree of the model. */
  readonly modelsByMetamodel?: Record<string, unknown>
  /** The SPL's models of the levels above (its feature model) and the platform composed with them. */
  readonly configuration: Configuration
}

const problemsOf = (problems: readonly EngineProblem[], file: string): Diagnostic[] =>
  problems
    .filter(({ severity }) => severity === 'error' || severity === 'warning')
    .map((problem) => ({
      severity: problem.severity === 'error' ? 'error' as const : 'warning' as const,
      package: 'product',
      file,
      message: `${problem.startLine + 1}:${problem.startColumn + 1} ${problem.message}`
    }))

/**
 * Whether a product is right for its SPL: one model of each metamodel with final models (and no others), all valid together, against what
 * the modules offer and against the SPL's models of the levels above: its feature selection is checked against its feature model by the
 * feature metamodel itself. `models` is metamodel name -> text of the model.
 */
export const checkProduct = async ({
  resolved,
  spl,
  models,
  createEngine,
  loadCode = false
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  models: Record<string, string>
  createEngine: () => MetamodelEngine
  /** `true` when the platform composed in the report (`configuration.plan`) is going to be written: it then has the code of the modules, not only the list of it. */
  loadCode?: boolean
}): Promise<ProductCheckReport> => {
  const { engine, metamodels: all, diagnostics, contributed } = await prepareEngine({ resolved, createEngine })
  // what cannot be composed cannot be derived, so it counts against the product too
  const configuration = await configure({ engine, resolved, spl, metamodels: all, offered: contributed, diagnostics, loadCode })
  const metamodels = all.filter((info) => info.level === 0)
  const byName = new Map(metamodels.map((info) => [info.name, info]))

  for (const info of metamodels) {
    if (models[info.name] === undefined) {
      diagnostics.push({ severity: 'error', package: 'product', file: `.linea/models/${info.name}.${info.extension}`, message: `There is no model of "${info.name}".` })
    }
  }
  for (const name of Object.keys(models)) {
    if (!byName.has(name)) {
      diagnostics.push({ severity: 'error', package: 'product', file: `.linea/models/${name}`, message: `"${name}" is not a metamodel of the products of this SPL.` })
    }
  }

  let merged: unknown
  let byMetamodel: Record<string, unknown> | undefined
  if (!hasErrors(diagnostics)) {
    const states = await engine.setInstances(Object.fromEntries(Object.entries(models).filter(([name]) => byName.has(name))))
    for (const state of states) {
      const info = byName.get(state.metamodel)
      diagnostics.push(...problemsOf(state.problems, `.linea/models/${state.metamodel}.${info?.extension ?? ''}`))
    }
    const built = await engine.build(resolved.spl.name)
    // the problems of each model are already listed: what is left is what only the whole shows
    if (!hasErrors(diagnostics)) {
      for (const message of built.errors) diagnostics.push({ severity: 'error', package: 'product', message })
    }
    if (built.ok) {
      merged = built.model?.spec
      byMetamodel = Object.fromEntries((built.model?.instances ?? []).map((instance) => [instance.metamodel, instance.spec]))
    }
  }

  const ok = !hasErrors(diagnostics)
  return {
    ok,
    diagnostics,
    metamodels,
    configuration,
    ...(ok && merged !== undefined ? { models: merged, modelsByMetamodel: byMetamodel } : {})
  }
}
