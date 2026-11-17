import { describe, expect, it } from 'vitest'
import {
  analyzeFeatureModel,
  AnalysisRuntimeError,
  createAnalysisRuntime
} from '../../src/index.js'

const SMALL_UVL = [
  'features',
  '    Shop',
  '        mandatory',
  '            Catalog',
  '        optional',
  '            Payment'
].join('\n')

describe('analysis runtime bootstrap', () => {
  it('fails loudly when the vendored wheels directory does not exist', async () => {
    await expect(createAnalysisRuntime({ wheelsDir: '/definitely/not/here' }))
      .rejects.toThrow(AnalysisRuntimeError)
  })

  it('gives the runtime error a stable code', async () => {
    try {
      await createAnalysisRuntime({ wheelsDir: '/definitely/not/here' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as AnalysisRuntimeError).code).toBe('ANALYSIS_RUNTIME_ERROR')
    }
  })

  it('rejects a wheelsDir that is not a usable path', async () => {
    await expect(createAnalysisRuntime({ wheelsDir: '   ' }))
      .rejects.toThrow()
  })

})

describe('implicit runtime', () => {
  it('works without an explicit runtime, creating a private one', async () => {
    const result = await analyzeFeatureModel({ uvl: SMALL_UVL })
    expect(result.satisfiable).toBe(true)
  }, 180_000)
})
