import { absoluteRequires } from '../packages/location.js'
import { readPackageText } from '../packages/source.js'
import type { Diagnostic, ResolvedMetamodel, ResolvedSpl, ResolvedModule } from '../types.js'
import { toDiagnostics, type EngineGrammarInfo, type MetamodelEngine, type MetamodelInfo } from './engine.js'
import { readMetamodelFiles } from './files.js'
import { metamodelPath } from './layout.js'

const loadMetamodelPackage = async ({
  engine,
  pkg,
  providers,
  levels,
  diagnostics
}: {
  engine: MetamodelEngine
  pkg: ResolvedMetamodel
  providers: Map<string, string>
  levels: Map<string, number>
  diagnostics: Diagnostic[]
}): Promise<void> => {
  const files = await readMetamodelFiles({ pkg })
  if (!files.some(({ grammar }) => grammar === pkg.manifest.name)) {
    diagnostics.push({
      severity: 'error',
      package: pkg.location,
      message: `The metamodel "${pkg.manifest.name}" has no ${metamodelPath({ kind: 'grammar', grammar: pkg.manifest.name })}.`
    })
  }
  for (const { grammar, file, text, level, scripts } of files) {
    const other = providers.get(grammar)
    if (other !== undefined) {
      diagnostics.push({ severity: 'error', package: pkg.location, file, message: `The grammar "${grammar}" is also provided by ${other}.` })
      continue
    }
    providers.set(grammar, pkg.location)
    levels.set(grammar, level)
    await engine.setGrammar(grammar, text)
    if (scripts.constraints !== undefined) await engine.setConstraints(grammar, scripts.constraints)
    if (scripts.spec !== undefined) await engine.setSpec(grammar, scripts.spec)
    if (scripts.import !== undefined) await engine.setImport(grammar, scripts.import)
    if (scripts.scope !== undefined) await engine.setScope(grammar, scripts.scope)
  }
}

/** The metamodels (grammars with an entry rule) that the packages in `closure` provide. */
const grammarsOf = (closure: ReadonlySet<string>, providers: ReadonlyMap<string, string>, infos: readonly EngineGrammarInfo[]): Set<string> =>
  new Set(infos.filter((info) => info.extension !== undefined && closure.has(providers.get(info.name) ?? '')).map((info) => info.name))

/** The packages a module needs, as locations: the metamodels it requires directly and everything those require. */
const metamodelClosure = (module: ResolvedModule, metamodels: readonly ResolvedMetamodel[]): Set<string> => {
  const byLocation = new Map(metamodels.map((pkg) => [pkg.location, pkg]))
  const closure = new Set<string>()
  const add = (location: string): void => {
    if (closure.has(location)) return
    closure.add(location)
    const pkg = byLocation.get(location)
    if (pkg !== undefined) for (const other of Object.keys(absoluteRequires({ kind: 'metamodel', location, manifest: pkg.manifest }).metamodels)) add(other)
  }
  for (const location of Object.keys(absoluteRequires({ kind: 'module', location: module.location, manifest: module.manifest }).metamodels)) add(location)
  return closure
}

/**
 * Loads the metamodels of an SPL into a fresh engine and composes them, then gives it the models the modules offer (read-only).
 * What is wrong with any of it is returned as diagnostics.
 */
export const prepareEngine = async ({
  resolved,
  createEngine
}: {
  resolved: ResolvedSpl
  createEngine: () => MetamodelEngine
}): Promise<{
  engine: MetamodelEngine
  metamodels: MetamodelInfo[]
  diagnostics: Diagnostic[]
  /** What the engine was given to offer, read-only: the models of the modules. The models of the SPL's levels are added to these. */
  contributed: { origin: string, metamodel: string, text: string }[]
}> => {
  const engine = createEngine()
  const diagnostics: Diagnostic[] = []
  const providers = new Map<string, string>()
  const levels = new Map<string, number>()
  for (const pkg of resolved.metamodels) await loadMetamodelPackage({ engine, pkg, providers, levels, diagnostics })

  const infos = await engine.listMetamodels()
  const packageOf = new Map(resolved.metamodels.map((pkg) => [pkg.location, pkg]))
  for (const info of infos) {
    const owner = providers.get(info.name) ?? ''
    diagnostics.push(...toDiagnostics(info.problems, { package: owner, file: metamodelPath({ kind: 'grammar', grammar: info.name }) }))
    const ownerPackage = packageOf.get(owner)
    const declared = ownerPackage === undefined ? [] : Object.keys(absoluteRequires({ kind: 'metamodel', location: owner, manifest: ownerPackage.manifest }).metamodels)
    for (const imported of info.imports) {
      const from = providers.get(imported)
      if (from !== undefined && from !== owner && !declared.includes(from)) {
        diagnostics.push({
          severity: 'error',
          package: owner,
          file: metamodelPath({ kind: 'grammar', grammar: info.name }),
          message: `It imports "${imported}", which ${from} provides, but ${from} is not in its "requires".`
        })
      }
    }
  }

  const entries = infos.filter((info) => info.extension !== undefined)
  const composition = await engine.compose(entries.map((info) => info.name))
  // what only composing shows: the scripts of a metamodel (constraints, JSON mappings...) are compiled with it
  const seen = new Set(diagnostics.map(({ package: from, file, message }) => `${from}|${file ?? ''}|${message}`))
  for (const info of composition.grammars) {
    const owner = providers.get(info.name) ?? ''
    for (const diagnostic of toDiagnostics(info.problems, { package: owner, file: metamodelPath({ kind: 'grammar', grammar: info.name }) })) {
      const key = `${diagnostic.package}|${diagnostic.file ?? ''}|${diagnostic.message}`
      if (!seen.has(key)) {
        seen.add(key)
        diagnostics.push(diagnostic)
      }
    }
  }
  for (const problem of composition.problems) diagnostics.push({ severity: 'error', package: 'spl', message: problem.message })
  for (const rename of composition.renames) {
    diagnostics.push({
      severity: 'warning',
      package: providers.get(rename.file) ?? 'spl',
      file: metamodelPath({ kind: 'grammar', grammar: rename.file }),
      message: `The type "${rename.original}" clashes with the one of ${rename.keeper}: it is called "${rename.renamed}" when they are used together.`
    })
  }

  // what each module offers
  const items: { origin: string, metamodel: string, text: string }[] = []
  const where_ = new Map<string, { location: string, file: string }>()
  const origins = new Map<string, string>()
  for (const module of resolved.modules) {
    const origin = module.manifest.name
    const earlier = origins.get(origin)
    if (earlier !== undefined) {
      diagnostics.push({ severity: 'error', package: module.location, message: `The module name "${origin}" is also used by ${earlier}.` })
      continue
    }
    origins.set(origin, module.location)
    const allowed = grammarsOf(metamodelClosure(module, resolved.metamodels), providers, infos)
    for (const [metamodel, file] of Object.entries(module.manifest.offers)) {
      if (!allowed.has(metamodel)) {
        diagnostics.push({
          severity: 'error',
          package: module.location,
          file: '.linea/module.json',
          message: `It offers a model of "${metamodel}", but none of the metamodels it requires provides it.`
        })
        continue
      }
      const text = await readPackageText({ files: module.files, path: file })
      if (text === undefined) {
        diagnostics.push({ severity: 'error', package: module.location, file, message: `The offered model ${file} does not exist.` })
        continue
      }
      items.push({ origin, metamodel, text })
      where_.set(`${origin}/${metamodel}`, { location: module.location, file })
    }
  }
  if (items.length > 0) {
    for (const state of await engine.setContributed(items)) {
      const source = where_.get(`${state.origin}/${state.metamodel}`)
      diagnostics.push(...toDiagnostics(state.problems, { package: source?.location ?? state.origin, ...(source === undefined ? {} : { file: source.file }) }))
    }
  }

  const metamodels = entries.map((info) => ({
    name: info.name,
    extension: info.extension!,
    level: levels.get(info.name) ?? 0,
    ...(info.description === undefined ? {} : { description: info.description }),
    requires: info.requires,
    package: providers.get(info.name) ?? ''
  }))
  return { engine, metamodels, diagnostics, contributed: items }
}
