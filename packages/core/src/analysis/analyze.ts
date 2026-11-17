import { ANALYSIS_THRESHOLDS } from '../constants.js'
import { InvalidArgumentError } from '../errors.js'
import { estimateFeatureCount, normalizeUvl } from './uvl-text.js'
import {
  createAnalysisRuntime,
  disposeAnalysisRuntime,
  runOperation,
  useRuntime,
  type AnalysisRuntime
} from './runtime.js'

export type AnalysisMode = 'SAT' | 'BDD'

export const ANALYSIS_METRICS = ['satisfiable', 'deadFeatures', 'falseOptionalFeatures'] as const

export type AnalysisMetric = (typeof ANALYSIS_METRICS)[number]

export interface FeatureModelAnalysis {
  coreFeatures: unknown
  averageBranchingFactor: unknown
  maxDepth: unknown
  estimatedConfigurations: unknown
  leafNumber: unknown
  leafFeatures: unknown
  atomicSets: unknown
  satisfiable: unknown
  deadFeatures: unknown
  falseOptionalFeatures: unknown
  _featureCount: number
  _modelSize: string
  _solveMode: AnalysisMode
  _skipped: string[]
  _elapsedMs: number
}

export interface FeatureModelBddAnalysis {
  configurations: unknown
  configsNumber: unknown
  configDistribution: unknown
  featureInclusionProb: unknown
  homogeneity: unknown
  variability: unknown
  uniqueFeatures: unknown
  variantFeatures: unknown
  _skipped: string[]
  _elapsedMs: number
}

export type MetricAnalysis = Partial<Record<AnalysisMetric, unknown>> & { _solveMode: AnalysisMode }

const BDD_FIELDS = [
  'configsNumber', 'configDistribution', 'featureInclusionProb',
  'homogeneity', 'variability', 'uniqueFeatures', 'variantFeatures'
] as const

const modelSizeOf = (featureCount: number): string => {
  if (featureCount < 50) return 'small'
  if (featureCount < 100) return 'medium'
  if (featureCount < 250) return 'large'
  return 'very_large'
}

const prepareUvl = (uvl: unknown): string => {
  if (typeof uvl !== 'string') {
    throw new InvalidArgumentError('"uvl" must be a string.')
  }
  const normalised = normalizeUvl({ uvl })
  if (!normalised.startsWith('features')) {
    throw new InvalidArgumentError(
      'The UVL document must start with "features". Got: ' +
      `${JSON.stringify(normalised.slice(0, 40))}`
    )
  }
  return normalised
}

const assertMode = (mode: unknown): AnalysisMode => {
  if (mode === undefined) return 'BDD'
  if (mode !== 'SAT' && mode !== 'BDD') {
    throw new InvalidArgumentError(`"mode" must be "SAT" or "BDD", got ${JSON.stringify(mode)}.`)
  }
  return mode
}

const safe = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    return await run()
  } catch {
    return null
  }
}

const withRuntime = async <T>(
  runtime: AnalysisRuntime | undefined,
  body: (provided: AnalysisRuntime) => Promise<T>
): Promise<T> => {
  if (runtime !== undefined) return await body(runtime)
  const owned = await createAnalysisRuntime()
  try {
    return await body(owned)
  } finally {
    disposeAnalysisRuntime({ runtime: owned })
  }
}

export const analyzeFeatureModel = async ({
  uvl,
  mode,
  runtime
}: {
  uvl: string
  mode?: AnalysisMode
  runtime?: AnalysisRuntime
}): Promise<FeatureModelAnalysis> => {
  const document = prepareUvl(uvl)
  const solveMode = assertMode(mode)
  const started = Date.now()
  const featureCount = estimateFeatureCount({ uvl: document })

  return await withRuntime(runtime, async (provided) => {
    const state = useRuntime(provided)
    const basic = async (operation: string): Promise<unknown> =>
      await safe(async () => await runOperation(state, operation, document, 'basic'))
    const pysat = async (operation: string): Promise<unknown> =>
      await safe(async () => await runOperation(state, operation, document, 'pysat'))

    return {
      coreFeatures: await basic('core_features'),
      averageBranchingFactor: await basic('average_branching_factor'),
      maxDepth: await basic('max_depth'),
      estimatedConfigurations: await basic('estimated_number_of_configurations'),
      leafNumber: await basic('count_leafs'),
      leafFeatures: await basic('leaf_features'),
      atomicSets: await basic('atomic_sets'),
      satisfiable: await pysat('Satisfiable'),
      deadFeatures: await pysat('DeadFeatures'),
      falseOptionalFeatures: await pysat('FalseOptionalFeatures'),
      _featureCount: featureCount,
      _modelSize: modelSizeOf(featureCount),
      _solveMode: solveMode,
      _skipped: [],
      _elapsedMs: Date.now() - started
    }
  })
}

export const analyzeFeatureModelBdd = async ({
  uvl,
  runtime
}: {
  uvl: string
  runtime?: AnalysisRuntime
}): Promise<FeatureModelBddAnalysis> => {
  const document = prepareUvl(uvl)
  const started = Date.now()
  const featureCount = estimateFeatureCount({ uvl: document })
  const skipped: string[] = []

  if (featureCount >= ANALYSIS_THRESHOLDS.skipBdd) {
    skipped.push('configurations', ...BDD_FIELDS)
    return {
      configurations: null,
      configsNumber: null,
      configDistribution: null,
      featureInclusionProb: null,
      homogeneity: null,
      variability: null,
      uniqueFeatures: null,
      variantFeatures: null,
      _skipped: skipped,
      _elapsedMs: Date.now() - started
    }
  }

  return await withRuntime(runtime, async (provided) => {
    const state = useRuntime(provided)

    let configurations: unknown = null
    if (featureCount <= ANALYSIS_THRESHOLDS.skipEnumeration) {
      configurations = await safe(async () =>
        await runOperation(state, 'configurations', document, 'basic'))
    } else {
      skipped.push('configurations')
    }

    const bdd = async (operation: string): Promise<unknown> =>
      await safe(async () => await runOperation(state, operation, document, 'bdd'))

    return {
      configurations,
      configsNumber: await bdd('ConfigurationsNumber'),
      configDistribution: await bdd('ProductDistribution'),
      featureInclusionProb: await bdd('FeatureInclusionProbability'),
      homogeneity: await bdd('Homogeneity'),
      variability: await bdd('Variability'),
      uniqueFeatures: await bdd('UniqueFeatures'),
      variantFeatures: await bdd('VariantFeatures'),
      _skipped: skipped,
      _elapsedMs: Date.now() - started
    }
  })
}

export const analyzeMetric = async ({
  uvl,
  metric,
  mode,
  runtime
}: {
  uvl: string
  metric: AnalysisMetric
  mode?: AnalysisMode
  runtime?: AnalysisRuntime
}): Promise<MetricAnalysis> => {
  const document = prepareUvl(uvl)
  const requestedMode = assertMode(mode)
  if (!(ANALYSIS_METRICS as readonly string[]).includes(metric)) {
    throw new InvalidArgumentError(
      `Unknown metric ${JSON.stringify(metric)}. Supported: ${ANALYSIS_METRICS.join(', ')}.`
    )
  }

  return await withRuntime(runtime, async (provided) => {
    const state = useRuntime(provided)

    if (metric === 'satisfiable') {
      const solver = requestedMode === 'SAT' ? 'pysat' : 'bdd'
      return {
        satisfiable: await safe(async () =>
          await runOperation(state, 'Satisfiable', document, solver)),
        _solveMode: requestedMode
      }
    }

    const operation = metric === 'deadFeatures' ? 'DeadFeatures' : 'FalseOptionalFeatures'
    return {
      [metric]: await safe(async () =>
        await runOperation(state, operation, document, 'pysat')),
      _solveMode: 'SAT' as const
    }
  })
}
