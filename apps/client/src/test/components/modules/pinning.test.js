import { describe, it, expect } from 'vitest'
import { fieldOf, rangeFor, withPackageRange, isPin, newestFirst, diffPackages, diffLines } from 'components/modules/pinning'
import { listPathOf, pathOf, kindOfSegment } from 'components/modules/packageRoutes'

describe('pinning', () => {
  it('knows where each kind is in a manifest', () => {
    expect(fieldOf('module')).toBe('modules')
    expect(fieldOf('metamodel')).toBe('metamodels')
  })

  it('asks for exactly a version, or for it and the compatible ones', () => {
    expect(rangeFor('1.2.0', 'pin')).toBe('1.2.0')
    expect(rangeFor('1.2.0', 'compatible')).toBe('^1.2.0')
    expect(isPin('1.2.0')).toBe(true)
    expect(isPin('^1.2.0')).toBe(false)
  })

  it('changes one range and keeps the rest', () => {
    const ranges = { a: '^1.0.0', b: '*' }
    expect(withPackageRange(ranges, 'a', '^2.0.0')).toEqual({ a: '^2.0.0', b: '*' })
    expect(ranges.a).toBe('^1.0.0')
  })

  it('orders versions by number, not by text', () => {
    expect(newestFirst(['1.9.0', '1.10.0', '0.2.0'])).toEqual(['1.10.0', '1.9.0', '0.2.0'])
  })

  it('tells what moves between two resolutions', () => {
    const before = [{ location: 'a', name: 'a', version: '1.0.0' }, { location: 'b', name: 'b', version: '1.0.0' }]
    const after = [{ location: 'a', name: 'a', version: '1.1.0' }, { location: 'c', name: 'c', version: '0.1.0' }]
    const diff = diffPackages(before, after)
    expect(diff.changed).toEqual([expect.objectContaining({ location: 'a', from: '1.0.0', to: '1.1.0' })])
    expect(diff.added.map((p) => p.location)).toEqual(['c'])
    expect(diff.removed.map((p) => p.location)).toEqual(['b'])
    expect(diffPackages(before, before).same).toBe(true)
  })

  it('tells the lines of a feature model that were added or removed', () => {
    expect(diffLines('f\n  A\n  B\n', 'f\n  A\n  C\n')).toEqual({ removed: ['  B'], added: ['  C'] })
  })
})

describe('packageRoutes', () => {
  it('gives each kind its own pages', () => {
    expect(listPathOf('module')).toBe('/packages/modules')
    expect(listPathOf('metamodel')).toBe('/packages/metamodels')
    expect(pathOf('metamodel', 7)).toBe('/packages/metamodels/7')
    expect(kindOfSegment('metamodels')).toBe('metamodel')
    expect(kindOfSegment('modules')).toBe('module')
  })
})
