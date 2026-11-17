import { describe, expect, it } from 'vitest'
import { buildEngineSpec, InvalidArgumentError, type ProductSpec } from '../../src/index.js'

describe('buildEngineSpec (ported from generatePipeline.test.js:22-66)', () => {
  it('returns spec unchanged when no sensor.parsed field', () => {
    const spec = { basicData: { name: 'P', version: '1.0.0' }, features: ['A'] }
    expect(buildEngineSpec({ spec })).toBe(spec)
  })

  it('returns spec unchanged when parsed.features is absent', () => {
    const spec = { sensor: { parsed: { data: { basicData: { x: 1 } } } } }
    expect(buildEngineSpec({ spec })).toBe(spec)
  })

  it('returns spec unchanged when parsed.data.basicData is absent', () => {
    const spec = { sensor: { parsed: { features: ['A'] } } }
    expect(buildEngineSpec({ spec })).toBe(spec)
  })

  it('wraps into sensor shortcut shape when both parsed fields exist', () => {
    const spec = {
      basicData: { database: { host: 'db' }, version: '2.0.0' },
      sensor: {
        parsed: {
          features: ['A', 'B'],
          data: { basicData: { x: 1 }, extra: 'z' }
        }
      }
    }
    const result = buildEngineSpec({ spec }) as {
      features: string[]
      data: { basicData: Record<string, unknown>, extra: unknown }
    }
    expect(result.features).toEqual(['A', 'B'])
    expect(result.data.basicData.database).toEqual({ host: 'db' })
    expect(result.data.basicData.version).toBe('2.0.0')
    expect(result.data.basicData.x).toBe(1)
    expect(result.data.extra).toBe('z')
  })

  it('defaults database to {} when spec.basicData.database is absent', () => {
    const spec = {
      sensor: {
        parsed: {
          features: ['A'],
          data: { basicData: {}, extra: null }
        }
      }
    }
    const result = buildEngineSpec({ spec }) as { data: { basicData: Record<string, unknown> } }
    expect(result.data.basicData.database).toEqual({})
  })
})

describe('buildEngineSpec — linea-core additions', () => {
  it('does not mutate the input spec', () => {
    const spec: ProductSpec = {
      basicData: { version: '1.0.0' },
      sensor: { parsed: { features: ['A'], data: { basicData: { x: 1 } } } }
    }
    const snapshot = JSON.stringify(spec)
    buildEngineSpec({ spec })
    expect(JSON.stringify(spec)).toBe(snapshot)
  })

  it('reproduces `||` semantics, not `??`, for database', () => {
    const spec = {
      basicData: { database: '' as unknown as Record<string, unknown> },
      sensor: { parsed: { features: ['A'], data: { basicData: {} } } }
    }
    const result = buildEngineSpec({ spec }) as { data: { basicData: Record<string, unknown> } }
    expect(result.data.basicData.database).toEqual({})
  })

  it('leaves version undefined when the spec has no basicData', () => {
    const spec = { sensor: { parsed: { features: ['A'], data: { basicData: {} } } } }
    const result = buildEngineSpec({ spec }) as { data: { basicData: Record<string, unknown> } }
    expect(result.data.basicData.version).toBeUndefined()
  })

  it('ignores a sensor.parsed that is not an object', () => {
    const spec = { sensor: { parsed: 'nope' } } as unknown as ProductSpec
    expect(buildEngineSpec({ spec })).toBe(spec)
  })

  it('rejects a non-object spec', () => {
    expect(() => buildEngineSpec({ spec: null as unknown as ProductSpec }))
      .toThrow(InvalidArgumentError)
  })
})
