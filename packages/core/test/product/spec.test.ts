import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertProductSpec,
  DEFAULT_LANGUAGES,
  DEFAULT_SRID,
  incrementVersion,
  InvalidArgumentError,
  InvalidProductSpecError,
  normalizeProductSpec,
  validateProductSpec,
  type ProductSpec
} from '../../src/index.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/specs')
const readSpec = (name: string): ProductSpec =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as ProductSpec

describe('validateProductSpec', () => {
  it('accepts a minimal valid spec', () => {
    expect(validateProductSpec({ spec: readSpec('minimal.json') }))
      .toEqual({ valid: true, errors: [] })
  })

  it('accepts a fully populated spec', () => {
    expect(validateProductSpec({ spec: readSpec('full.json') }))
      .toEqual({ valid: true, errors: [] })
  })

  it('never throws, whatever it is given', () => {
    for (const spec of [null, undefined, 42, 'x', [], {}, { basicData: 1 }]) {
      expect(() => validateProductSpec({ spec })).not.toThrow()
    }
  })

  it('rejects a non-object spec with the monolith i18n key', () => {
    const result = validateProductSpec({ spec: null })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([{
      path: 'spec',
      code: 'SPEC_NOT_OBJECT',
      messageKey: 'error_messages.spec_object_validation'
    }])
  })

  it('rejects a missing basicData with the monolith i18n key', () => {
    const result = validateProductSpec({ spec: { features: [] } })
    expect(result.errors).toEqual([{
      path: 'spec.basicData',
      code: 'BASIC_DATA_NOT_OBJECT',
      messageKey: 'error_messages.basicData_object_validation'
    }])
  })

  it('rejects an empty name with basicData_name_validation', () => {
    const result = validateProductSpec({ spec: { basicData: { name: '', version: '1.0.0' } } })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'spec.basicData.name',
      code: 'NAME_REQUIRED',
      messageKey: 'error_messages.basicData_name_validation'
    })
  })

  it('rejects names outside NAME_PATTERN with invalid_name_characters', () => {
    for (const name of ['my product', 'my/product', 'ñ', 'a b', 'x:y']) {
      const result = validateProductSpec({ spec: { basicData: { name, version: '1.0.0' } } })
      expect(result.valid, name).toBe(false)
      expect(result.errors, name).toContainEqual({
        path: 'spec.basicData.name',
        code: 'NAME_INVALID_CHARACTERS',
        messageKey: 'error_messages.invalid_name_characters'
      })
    }
  })

  it('accepts the names NAME_PATTERN allows', () => {
    for (const name of ['product', 'my-product', 'my_product', 'my.product', 'P1']) {
      const result = validateProductSpec({ spec: { basicData: { name, version: '1.0.0' } } })
      expect(result.valid, name).toBe(true)
    }
  })

  it('rejects versions that are not x.y.z with basicData_version_format', () => {
    for (const version of ['1.0', '1', 'v1.0.0', '1.0.0-beta', '', undefined, 100]) {
      const result = validateProductSpec({ spec: { basicData: { name: 'P', version } } })
      expect(result.valid, String(version)).toBe(false)
      expect(result.errors, String(version)).toContainEqual({
        path: 'spec.basicData.version',
        code: 'VERSION_FORMAT',
        messageKey: 'error_messages.basicData_version_format'
      })
    }
  })

  it('reports several problems at once', () => {
    const result = validateProductSpec({ spec: { basicData: { name: 'bad name', version: 'x' } } })
    expect(result.errors.map((e) => e.code)).toEqual(['NAME_INVALID_CHARACTERS', 'VERSION_FORMAT'])
  })

  it('checks the shapes the Mongoose schema used to enforce', () => {
    const base = { name: 'P', version: '1.0.0' }
    expect(validateProductSpec({ spec: { basicData: { ...base, languages: 'en' } } })
      .errors.map((e) => e.code)).toEqual(['LANGUAGES_NOT_STRING_ARRAY'])
    expect(validateProductSpec({ spec: { basicData: { ...base, SRID: 4326 } } })
      .errors.map((e) => e.code)).toEqual(['SRID_NOT_STRING'])
    expect(validateProductSpec({ spec: { basicData: base, features: 42 } })
      .errors.map((e) => e.code)).toEqual(['FEATURES_INVALID_SHAPE'])
    expect(validateProductSpec({ spec: { basicData: base, statics: {} } })
      .errors.map((e) => e.code)).toEqual(['STATICS_NOT_ARRAY'])
  })

  it('accepts both historical shapes of features', () => {
    const base = { name: 'P', version: '1.0.0' }
    expect(validateProductSpec({ spec: { basicData: base, features: ['A'] } }).valid).toBe(true)
    expect(validateProductSpec({ spec: { basicData: base, features: { A: true } } }).valid).toBe(true)
  })
})

describe('assertProductSpec', () => {
  it('returns the spec unchanged when valid', () => {
    const spec = readSpec('minimal.json')
    expect(assertProductSpec({ spec })).toBe(spec)
  })

  it('throws InvalidProductSpecError with the stable code', () => {
    try {
      assertProductSpec({ spec: { basicData: { name: 'bad name', version: 'x' } } })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidProductSpecError)
      expect((error as InvalidProductSpecError).code).toBe('INVALID_PRODUCT_SPEC')
    }
  })

  it('lists every problem, i18n keys included, in the message', () => {
    try {
      assertProductSpec({ spec: { basicData: { name: 'bad name', version: 'x' } } })
      expect.unreachable('should have thrown')
    } catch (error) {
      const { message } = error as Error
      expect(message).toContain('spec.basicData.name')
      expect(message).toContain('error_messages.invalid_name_characters')
      expect(message).toContain('spec.basicData.version')
      expect(message).toContain('error_messages.basicData_version_format')
    }
  })
})

describe('normalizeProductSpec', () => {
  it('applies exactly the defaults of entities/product.js and saveProductVersion', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P' } } })
    expect(normalized.basicData).toEqual({
      name: 'P',
      version: '0.0.0',
      database: {},
      extra: {},
      testEnvironment: { image: '', command: '' },
      languages: ['en', 'es', 'gl'],
      SRID: '4326'
    })
    expect(normalized.dataModel).toEqual({ cells: [] })
    expect(normalized.features).toEqual([])
    expect(normalized.statics).toEqual([])
    expect(normalized.sensor).toEqual({ dsl: '', parsed: null })
  })

  it('uses the exported default constants', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P' } } })
    expect(normalized.basicData?.languages).toEqual([...DEFAULT_LANGUAGES])
    expect(normalized.basicData?.SRID).toBe(DEFAULT_SRID)
  })

  it('keeps values that are already set', () => {
    const normalized = normalizeProductSpec({
      spec: {
        basicData: {
          name: 'P',
          version: '2.3.4',
          languages: ['gl'],
          SRID: '25829',
          database: { host: 'db' },
          extra: { a: 1 },
          testEnvironment: { image: 'node:20', command: 'npm test' }
        },
        dataModel: { cells: [{ id: 1 }] },
        features: ['A'],
        statics: ['s']
      }
    })
    expect(normalized.basicData?.version).toBe('2.3.4')
    expect(normalized.basicData?.languages).toEqual(['gl'])
    expect(normalized.basicData?.SRID).toBe('25829')
    expect(normalized.basicData?.database).toEqual({ host: 'db' })
    expect(normalized.basicData?.testEnvironment).toEqual({ image: 'node:20', command: 'npm test' })
    expect(normalized.dataModel?.cells).toEqual([{ id: 1 }])
    expect(normalized.features).toEqual(['A'])
    expect(normalized.statics).toEqual(['s'])
  })

  it('KEEPS an empty languages array, because [] is truthy for `||`', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P', languages: [] } } })
    expect(normalized.basicData?.languages).toEqual([])
  })

  it('fills languages only when the field is absent or not an array', () => {
    expect(normalizeProductSpec({ spec: { basicData: { name: 'P' } } }).basicData?.languages)
      .toEqual(['en', 'es', 'gl'])
    expect(normalizeProductSpec({
      spec: { basicData: { name: 'P', languages: 'en' as unknown as string[] } }
    }).basicData?.languages).toEqual(['en', 'es', 'gl'])
  })

  it('falls back on an empty SRID string, because \'\' IS falsy for `||`', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P', SRID: '' } } })
    expect(normalized.basicData?.SRID).toBe('4326')
  })

  it('preserves the object-map shape of features', () => {
    const normalized = normalizeProductSpec({
      spec: { basicData: { name: 'P' }, features: { A: true, B: false } }
    })
    expect(normalized.features).toEqual({ A: true, B: false })
  })

  it('does not mutate the input and does not share references', () => {
    const spec: ProductSpec = { basicData: { name: 'P' }, features: ['A'] }
    const snapshot = JSON.stringify(spec)
    const normalized = normalizeProductSpec({ spec })
    expect(JSON.stringify(spec)).toBe(snapshot)
    expect(normalized).not.toBe(spec)
    expect(normalized.features).not.toBe(spec.features)
  })

  it('does NOT invent a createdAt timestamp', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P' } } })
    expect(normalized.basicData).not.toHaveProperty('createdAt')
  })

  it('keeps unknown top-level fields untouched', () => {
    const normalized = normalizeProductSpec({
      spec: { basicData: { name: 'P' }, customField: 'keep me' }
    })
    expect(normalized.customField).toBe('keep me')
  })

  it('rejects a non-object spec', () => {
    expect(() => normalizeProductSpec({ spec: null as unknown as ProductSpec }))
      .toThrow(InvalidArgumentError)
  })

  it('fills a completely empty spec', () => {
    const normalized = normalizeProductSpec({ spec: {} })
    expect(normalized.basicData?.name).toBe('')
    expect(normalized.basicData?.version).toBe('0.0.0')
    expect(normalized.dataModel).toEqual({ cells: [] })
    expect(normalized.sensor).toEqual({ dsl: '', parsed: null })
  })

  it('repairs fields whose type is wrong instead of trusting them', () => {
    const spec = {
      basicData: {
        name: 'P',
        version: 42,
        database: 'nope',
        extra: [],
        testEnvironment: 'nope'
      },
      dataModel: 'nope',
      statics: 'nope',
      sensor: 'nope'
    } as unknown as ProductSpec
    const normalized = normalizeProductSpec({ spec })
    expect(normalized.basicData?.version).toBe('0.0.0')
    expect(normalized.basicData?.database).toEqual({})
    expect(normalized.basicData?.extra).toEqual({})
    expect(normalized.basicData?.testEnvironment).toEqual({ image: '', command: '' })
    expect(normalized.dataModel).toEqual({ cells: [] })
    expect(normalized.statics).toEqual([])
    expect(normalized.sensor).toEqual({ dsl: '', parsed: null })
  })

  it('keeps a populated sensor payload', () => {
    const parsed = { features: ['A'], data: { basicData: { x: 1 } } }
    const normalized = normalizeProductSpec({
      spec: { basicData: { name: 'P' }, sensor: { dsl: 'sensor X', parsed } }
    })
    expect(normalized.sensor).toEqual({ dsl: 'sensor X', parsed })
  })

  it('completes a partially filled testEnvironment', () => {
    const normalized = normalizeProductSpec({
      spec: { basicData: { name: 'P', testEnvironment: { image: 'node:20' } } }
    })
    expect(normalized.basicData?.testEnvironment).toEqual({ image: 'node:20', command: '' })
  })

  it('produces a spec that validates, given a valid name', () => {
    const normalized = normalizeProductSpec({ spec: { basicData: { name: 'P' } } })
    expect(validateProductSpec({ spec: normalized }).valid).toBe(true)
  })
})

describe('incrementVersion', () => {
  it('matches the acceptance examples', () => {
    expect(incrementVersion({ version: '1.2.3', index: 1 })).toBe('1.3.0')
    expect(incrementVersion({ version: '1.2.3', index: 2 })).toBe('1.2.4')
  })

  it('zeroes every component to the right of the bumped one', () => {
    expect(incrementVersion({ version: '1.2.3', index: 0 })).toBe('2.0.0')
    expect(incrementVersion({ version: '0.0.0', index: 0 })).toBe('1.0.0')
    expect(incrementVersion({ version: '9.9.9', index: 2 })).toBe('9.9.10')
  })

  it('does not roll over: 1.9.9 minor bump is 1.10.0', () => {
    expect(incrementVersion({ version: '1.9.9', index: 1 })).toBe('1.10.0')
  })

  it('rejects versions that are not x.y.z instead of yielding NaN', () => {
    for (const version of ['abc', '1.2', '1.2.3.4', '', 'v1.0.0']) {
      expect(() => incrementVersion({ version, index: 1 }), version)
        .toThrow(InvalidArgumentError)
    }
    expect(() => incrementVersion({ version: null as unknown as string, index: 1 }))
      .toThrow(InvalidArgumentError)
  })

  it('rejects an out-of-range or non-integer index', () => {
    for (const index of [-1, 3, 1.5, NaN]) {
      expect(() => incrementVersion({ version: '1.0.0', index }), String(index))
        .toThrow(InvalidArgumentError)
    }
  })
})
