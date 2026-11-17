import type { Diagnostic } from '../types.js'

/** What linea-core needs of a metamodel engine (bango's `Bango` fits): the engine is given to it, so linea-core does not depend on bango. */
export interface EngineProblem {
  readonly severity: string
  readonly message: string
  readonly startLine: number
  readonly startColumn: number
}

export interface EngineGrammarInfo {
  readonly name: string
  readonly extension?: string
  /** The level of its models (`// @level n` in the grammar; 0, the final ones, without it). Engines that have no levels leave it out. */
  readonly level?: number
  readonly imports: readonly string[]
  readonly requires: readonly string[]
  readonly description?: string
  readonly problems: readonly EngineProblem[]
}

export interface EngineContributedState {
  readonly origin: string
  readonly metamodel: string
  readonly available: boolean
  readonly problems: readonly EngineProblem[]
}

export interface EngineInstanceState {
  readonly metamodel: string
  readonly available: boolean
  readonly problems: readonly EngineProblem[]
}

export interface MetamodelEngine {
  setGrammar: (name: string, text: string) => Promise<void>
  setConstraints: (metamodel: string, code: string) => Promise<void>
  setSpec: (metamodel: string, code: string) => Promise<void>
  setImport: (metamodel: string, code: string) => Promise<void>
  setScope: (metamodel: string, code: string) => Promise<void>
  listMetamodels: () => Promise<readonly EngineGrammarInfo[]>
  compose: (selection: string[]) => Promise<{
    readonly problems: readonly { readonly message: string }[]
    readonly grammars: readonly EngineGrammarInfo[]
    readonly renames: readonly { readonly file: string, readonly original: string, readonly renamed: string, readonly keeper: string }[]
  }>
  setContributed: (items: { origin: string, metamodel: string, text: string }[]) => Promise<readonly EngineContributedState[]>
  setInstances: (texts: Record<string, string>) => Promise<readonly EngineInstanceState[]>
  createInstance: (metamodel: string) => Promise<{ readonly text: string }>
  /** The JSON of the model of a metamodel, by the metamodel's own mapping (what the platform reads). */
  toJson(metamodel: string): Promise<unknown>
  /** Models made from the JSON of a whole project, by the import mappings of the metamodels that have one. */
  importJson(json: unknown): Promise<{ readonly texts: Readonly<Record<string, string>>, readonly errors: readonly string[] }>
  build: (project: string) => Promise<{
    readonly ok: boolean
    readonly errors: readonly string[]
    readonly warnings: readonly string[]
    readonly model?: {
      readonly spec: unknown
      readonly instances: readonly { readonly metamodel: string, readonly spec: unknown }[]
    }
  }>
}

/** A metamodel a product has to give a model of. */
export interface MetamodelInfo {
  readonly name: string
  readonly extension: string
  /** The level of its models: 0 for the ones a product has, more for the ones its models are made from (the SPL's feature model is level 1). */
  readonly level: number
  readonly description?: string
  /** The metamodels it needs a model of too. */
  readonly requires: readonly string[]
  /** Location of the package that defines it. */
  readonly package: string
}

const where = (problem: EngineProblem): string => `${problem.startLine + 1}:${problem.startColumn + 1} ${problem.message}`

export const toDiagnostics = (
  problems: readonly EngineProblem[],
  context: { package: string, file?: string }
): Diagnostic[] =>
  problems
    .filter(({ severity }) => severity === 'error' || severity === 'warning')
    .map((problem) => ({
      severity: problem.severity === 'error' ? 'error' as const : 'warning' as const,
      package: context.package,
      ...(context.file === undefined ? {} : { file: context.file }),
      message: where(problem)
    }))
