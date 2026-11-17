import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  estimateFeatureCount,
  InvalidArgumentError,
  normalizeUvl
} from '../../src/index.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/models')
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

const ORACLE = {
  'simple.uvl': { raw: 6, normalized: 7 },
  'gema.uvl': { raw: 178, normalized: 179 },
  'messy.uvl': { raw: 2, normalized: 2 }
} as const

describe('normalizeUvl', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeUvl({ uvl: 'a\r\nb\rc' })).toBe('a\nb\nc')
  })

  it('expands tabs to TAB STOPS of 4, not to 4 spaces each', () => {
    expect(normalizeUvl({ uvl: 'a\tb' })).toBe('a   b')
    expect(normalizeUvl({ uvl: 'ab\tc' })).toBe('ab  c')
    expect(normalizeUvl({ uvl: 'abc\td' })).toBe('abc d')
    expect(normalizeUvl({ uvl: 'abcd\te' })).toBe('abcd    e')
  })

  it('strips the document before expanding, like text.strip() in Python', () => {
    expect(normalizeUvl({ uvl: '\tx' })).toBe('x')
    expect(normalizeUvl({ uvl: '  \tq' })).toBe('q')
    expect(normalizeUvl({ uvl: '\t\t\tvoid' })).toBe('void')
    expect(normalizeUvl({ uvl: 'features\r\n\tShop\r\n' })).toBe('features\n    Shop')
  })

  it('matches normalize_uvl byte for byte on the messy fixture', () => {
    expect(normalizeUvl({ uvl: read('messy.uvl') })).toBe(
      'features\n    Shop\n        mandatory\n            Catalog'
    )
  })

  it('is idempotent', () => {
    const once = normalizeUvl({ uvl: read('gema.uvl') })
    expect(normalizeUvl({ uvl: once })).toBe(once)
  })

  it('leaves an already normalised document untouched', () => {
    const clean = 'features\n    Shop\n        mandatory\n            Catalog'
    expect(normalizeUvl({ uvl: clean })).toBe(clean)
  })
})

describe('estimateFeatureCount', () => {
  it.each(Object.keys(ORACLE) as (keyof typeof ORACLE)[])(
    'matches main.py:estimate_feature_count on %s (raw and normalised)',
    (fixture) => {
      const raw = read(fixture)
      expect(estimateFeatureCount({ uvl: raw })).toBe(ORACLE[fixture].raw)
      expect(estimateFeatureCount({ uvl: normalizeUvl({ uvl: raw }) }))
        .toBe(ORACLE[fixture].normalized)
    }
  )

  it('agrees with the real feature count once the document is normalised', () => {
    expect(estimateFeatureCount({ uvl: normalizeUvl({ uvl: read('gema.uvl') }) })).toBe(179)
  })

  it('ignores comments and everything under `constraints`', () => {
    const uvl = [
      'features',
      '    Root',
      '        mandatory',
      '            A',
      '    // a comment',
      '    # another comment',
      'constraints',
      '    A => Root',
      '    B => Root'
    ].join('\n')
    expect(estimateFeatureCount({ uvl: uvl })).toBe(2)
  })

  it('does not count group keywords', () => {
    const uvl = 'features\n    Root\n        mandatory\n            A\n        optional\n            B'
    expect(estimateFeatureCount({ uvl: uvl })).toBe(3)
  })

  it('returns 0 for an empty document', () => {
    expect(estimateFeatureCount({ uvl: '' })).toBe(0)
  })
})

describe('argument validation', () => {
  it('rejects a non-string instead of silently returning a neutral value', () => {
    expect(() => normalizeUvl({ uvl: 42 as unknown as string })).toThrow(InvalidArgumentError)
    expect(() => normalizeUvl({ uvl: null as unknown as string })).toThrow(InvalidArgumentError)
    expect(() => normalizeUvl({ uvl: undefined as unknown as string })).toThrow(InvalidArgumentError)
    expect(() => estimateFeatureCount({ uvl: 42 as unknown as string })).toThrow(InvalidArgumentError)
    expect(() => estimateFeatureCount({ uvl: null as unknown as string })).toThrow(InvalidArgumentError)
  })

  it('still accepts the empty string as a valid, featureless document', () => {
    expect(normalizeUvl({ uvl: '' })).toBe('')
    expect(estimateFeatureCount({ uvl: '' })).toBe(0)
  })
})
