import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_THRESHOLDS,
  DEFAULT_LANGUAGES,
  DEFAULT_SRID,
  NAME_PATTERN,
  PLATFORM_PATHS,
  PRODUCTS_INDEX_PATH,
  VERSION_PATTERN
} from '../src/index.js'

describe('PLATFORM_PATHS', () => {
  it('matches properties.yml paths.platform.* without the ./ prefix', () => {
    expect(PLATFORM_PATHS).toEqual({
      root: 'src/platform',
      code: 'src/platform/code',
      model: 'src/platform/model.uvl',
      config: 'src/platform/config.json',
      extraJs: 'src/platform/extra.js',
      transformation: 'src/platform/transformation.js'
    })
  })
})

describe('NAME_PATTERN', () => {
  it('accepts the characters commonValidators.js allows', () => {
    for (const name of ['line', 'my-line', 'my_line', 'my.line', 'Line123', 'a']) {
      expect(NAME_PATTERN.test(name), name).toBe(true)
    }
  })

  it('rejects spaces, slashes and other separators', () => {
    for (const name of ['my line', 'my/line', 'my\\line', 'my:line', '', 'ñ', 'a b']) {
      expect(NAME_PATTERN.test(name), JSON.stringify(name)).toBe(false)
    }
  })

  it('is anchored at both ends', () => {
    expect(NAME_PATTERN.test('good\nbad')).toBe(false)
  })
})

describe('VERSION_PATTERN', () => {
  it('accepts x.y.z', () => {
    for (const version of ['1.0.0', '0.0.1', '10.20.30']) {
      expect(VERSION_PATTERN.test(version), version).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const version of ['1.0', '1', 'v1.0.0', '1.0.0-beta', '1.0.0.0', '']) {
      expect(VERSION_PATTERN.test(version), JSON.stringify(version)).toBe(false)
    }
  })
})

describe('defaults', () => {
  it('mirrors entities/product.js', () => {
    expect(DEFAULT_LANGUAGES).toEqual(['en', 'es', 'gl'])
    expect(DEFAULT_SRID).toBe('4326')
  })

  it('keeps the product index at the repository root (ADR-011)', () => {
    expect(PRODUCTS_INDEX_PATH).toBe('products.json')
  })
})


describe('ANALYSIS_THRESHOLDS', () => {
  it('replicates SKIP_ENUM and SKIP_BDD from flamapy-server/main.py', () => {
    expect(ANALYSIS_THRESHOLDS.skipEnumeration).toBe(30)
    expect(ANALYSIS_THRESHOLDS.skipBdd).toBe(100)
  })
})
