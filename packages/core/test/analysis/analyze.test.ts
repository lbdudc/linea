import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ANALYSIS_METRICS,
  ANALYSIS_THRESHOLDS,
  AnalysisRuntimeError,
  analyzeFeatureModel,
  analyzeFeatureModelBdd,
  analyzeMetric,
  createAnalysisRuntime,
  disposeAnalysisRuntime,
  InvalidArgumentError,
  type AnalysisMetric,
  type AnalysisRuntime
} from '../../src/index.js'

let runtime: AnalysisRuntime

let spentRuntime: AnalysisRuntime

beforeAll(async () => {
  runtime = await createAnalysisRuntime()
  spentRuntime = await createAnalysisRuntime()
  disposeAnalysisRuntime({ runtime: spentRuntime })
}, 180_000)

afterAll(() => {
  if (runtime !== undefined) disposeAnalysisRuntime({ runtime })
})

const makeUvl = (targetFeatures: number, root = 'M'): string => {
  const lines = ['features', `    ${root}`, '        mandatory']
  let produced = 1
  let group = 0
  while (produced < targetFeatures) {
    lines.push(`            G${group}`)
    produced += 1
    if (produced < targetFeatures) {
      lines.push('                optional')
      lines.push(`                    G${group}_O`)
      produced += 1
    }
    group += 1
  }
  return lines.join('\n') + '\n'
}

const SMALL_UVL = 'features\n    Shop\n        mandatory\n            Catalog\n        optional\n            Payment\n'

const ANALYZE_KEYS = [
  'coreFeatures', 'averageBranchingFactor', 'maxDepth', 'estimatedConfigurations',
  'leafNumber', 'leafFeatures', 'atomicSets', 'satisfiable', 'deadFeatures',
  'falseOptionalFeatures', '_featureCount', '_modelSize', '_solveMode', '_skipped', '_elapsedMs'
]

const BDD_KEYS = [
  'configurations', 'configsNumber', 'configDistribution', 'featureInclusionProb',
  'homogeneity', 'variability', 'uniqueFeatures', 'variantFeatures', '_skipped', '_elapsedMs'
]

describe('analyzeFeatureModel', () => {
  it('returns every key of main.py /analyze, with nothing skipped', async () => {
    const result = await analyzeFeatureModel({ uvl: SMALL_UVL, runtime })
    expect(Object.keys(result).sort()).toEqual([...ANALYZE_KEYS].sort())
    expect(result._skipped).toEqual([])
  }, 60_000)

  it('computes real structural and SAT metrics, never undefined', async () => {
    const result = await analyzeFeatureModel({ uvl: SMALL_UVL, runtime })
    for (const key of ANALYZE_KEYS) {
      expect(result[key as keyof typeof result], key).not.toBeUndefined()
    }
    expect(result.coreFeatures).toEqual(expect.arrayContaining(['Shop', 'Catalog']))
    expect(result.satisfiable).toBe(true)
    expect(result.deadFeatures).toEqual([])
  }, 60_000)

  it('reports feature count and model size like main.py', async () => {
    const result = await analyzeFeatureModel({ uvl: SMALL_UVL, runtime })
    expect(result._featureCount).toBe(3)
    expect(result._modelSize).toBe('small')
  }, 60_000)

  it('echoes the requested mode without changing what it computes', async () => {
    const sat = await analyzeFeatureModel({ uvl: SMALL_UVL, mode: 'SAT', runtime })
    const bdd = await analyzeFeatureModel({ uvl: SMALL_UVL, mode: 'BDD', runtime })
    expect(sat._solveMode).toBe('SAT')
    expect(bdd._solveMode).toBe('BDD')
    expect(sat.satisfiable).toBe(bdd.satisfiable)
  }, 60_000)

  it('defaults the mode to BDD', async () => {
    expect((await analyzeFeatureModel({ uvl: SMALL_UVL, runtime }))._solveMode).toBe('BDD')
  }, 60_000)

  it('returns null for a metric that fails, without breaking the response', async () => {
    const result = await analyzeFeatureModel({ uvl: 'features\n    Lonely\n', runtime })
    expect(Object.keys(result).sort()).toEqual([...ANALYZE_KEYS].sort())
    for (const key of ANALYZE_KEYS) {
      expect(result[key as keyof typeof result], key).not.toBeUndefined()
    }
  }, 60_000)

  it('rejects a document that does not start with "features"', async () => {
    await expect(analyzeFeatureModel({ uvl: 'not a model', runtime }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(analyzeFeatureModel({ uvl: '', runtime }))
      .rejects.toThrow(InvalidArgumentError)
  })

  it('rejects a non-string document and an unknown mode', async () => {
    await expect(analyzeFeatureModel({ uvl: 42 as unknown as string, runtime }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(analyzeFeatureModel({
      uvl: SMALL_UVL,
      mode: 'QUANTUM' as unknown as 'SAT',
      runtime
    })).rejects.toThrow(InvalidArgumentError)
  })
})

describe('analyzeFeatureModelBdd', () => {
  it('returns every key of main.py /analyze/bdd for a small model', async () => {
    const result = await analyzeFeatureModelBdd({ uvl: SMALL_UVL, runtime })
    expect(Object.keys(result).sort()).toEqual([...BDD_KEYS].sort())
    expect(result._skipped).toEqual([])
    expect(result.configurations).not.toBeNull()
  }, 120_000)

  it('skips every BDD field above the SKIP_BDD threshold', async () => {
    const big = makeUvl(ANALYSIS_THRESHOLDS.skipBdd + 20)
    const result = await analyzeFeatureModelBdd({ uvl: big, runtime })
    for (const key of BDD_KEYS.filter((k) => !k.startsWith('_'))) {
      expect(result[key as keyof typeof result], key).toBeNull()
    }
    expect(result._skipped).toEqual([
      'configurations', 'configsNumber', 'configDistribution', 'featureInclusionProb',
      'homogeneity', 'variability', 'uniqueFeatures', 'variantFeatures'
    ])
  }, 60_000)

  it('skips only enumeration between the two thresholds', async () => {
    const medium = makeUvl(ANALYSIS_THRESHOLDS.skipEnumeration + 10)
    const result = await analyzeFeatureModelBdd({ uvl: medium, runtime })
    expect(result._skipped).toEqual(['configurations'])
    expect(result.configurations).toBeNull()
  }, 120_000)

  it('does not even touch the runtime for an oversized model', async () => {
    const result = await analyzeFeatureModelBdd({
      uvl: makeUvl(ANALYSIS_THRESHOLDS.skipBdd + 5),
      runtime: spentRuntime
    })
    expect(result._skipped.length).toBe(8)
  }, 120_000)

  it('rejects a malformed document', async () => {
    await expect(analyzeFeatureModelBdd({ uvl: 'nope', runtime }))
      .rejects.toThrow(InvalidArgumentError)
  })
})

describe('analyzeMetric', () => {
  it('computes satisfiable with the requested solver', async () => {
    const sat = await analyzeMetric({ uvl: SMALL_UVL, metric: 'satisfiable', mode: 'SAT', runtime })
    expect(sat).toEqual({ satisfiable: true, _solveMode: 'SAT' })
    const bdd = await analyzeMetric({ uvl: SMALL_UVL, metric: 'satisfiable', mode: 'BDD', runtime })
    expect(bdd._solveMode).toBe('BDD')
    expect(bdd.satisfiable).toBe(true)
  }, 120_000)

  it('always reports SAT for the PySAT-only metrics', async () => {
    for (const metric of ['deadFeatures', 'falseOptionalFeatures'] as const) {
      const result = await analyzeMetric({ uvl: SMALL_UVL, metric, mode: 'BDD', runtime })
      expect(result._solveMode, metric).toBe('SAT')
      expect(result[metric], metric).toEqual([])
    }
  }, 60_000)

  it('accepts exactly the three documented metrics', () => {
    expect([...ANALYSIS_METRICS]).toEqual(['satisfiable', 'deadFeatures', 'falseOptionalFeatures'])
  })

  it('rejects any other metric', async () => {
    for (const metric of ['coreFeatures', 'maxDepth', '', 'Satisfiable']) {
      await expect(
        analyzeMetric({ uvl: SMALL_UVL, metric: metric as AnalysisMetric, runtime }),
        metric
      ).rejects.toThrow(InvalidArgumentError)
    }
  })
})

describe('runtime handle', () => {
  it('serialises concurrent operations on the same runtime', async () => {
    const other = 'features\n    Other\n        mandatory\n            Alpha\n            Beta\n'
    const [a, b, c] = await Promise.all([
      analyzeFeatureModel({ uvl: SMALL_UVL, runtime }),
      analyzeFeatureModel({ uvl: other, runtime }),
      analyzeFeatureModel({ uvl: SMALL_UVL, runtime })
    ])
    expect(a.coreFeatures).toEqual(expect.arrayContaining(['Shop', 'Catalog']))
    expect(b.coreFeatures).toEqual(expect.arrayContaining(['Other', 'Alpha', 'Beta']))
    expect(c.coreFeatures).toEqual(a.coreFeatures)
    expect(b.coreFeatures).not.toEqual(a.coreFeatures)
  }, 120_000)

  it('keeps working after one operation fails', async () => {
    await expect(analyzeFeatureModel({ uvl: 'bad', runtime })).rejects.toThrow()
    const result = await analyzeFeatureModel({ uvl: SMALL_UVL, runtime })
    expect(result.satisfiable).toBe(true)
  }, 60_000)

  it('refuses to work once disposed, and disposing twice is fine', async () => {
    expect(() => disposeAnalysisRuntime({ runtime: spentRuntime })).not.toThrow()
    await expect(analyzeFeatureModel({ uvl: SMALL_UVL, runtime: spentRuntime }))
      .rejects.toThrow(AnalysisRuntimeError)
  }, 120_000)

  it('rejects something that is not a runtime', async () => {
    expect(() => disposeAnalysisRuntime({ runtime: null as unknown as AnalysisRuntime }))
      .toThrow(InvalidArgumentError)
    await expect(analyzeFeatureModel({
      uvl: SMALL_UVL,
      runtime: 'nope' as unknown as AnalysisRuntime
    })).rejects.toThrow(InvalidArgumentError)
  })

  it('reports the model size bands of main.py', async () => {
    const medium = await analyzeFeatureModel({ uvl: makeUvl(60), runtime })
    expect(medium._modelSize).toBe('medium')
    expect(medium._featureCount).toBeGreaterThanOrEqual(50)
    expect(medium._featureCount).toBeLessThan(100)
  }, 180_000)

})
