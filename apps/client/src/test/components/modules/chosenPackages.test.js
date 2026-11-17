import { describe, it, expect } from 'vitest'
import { rangeOf, toMap, toggled, withRange, withMissing, nameIn } from 'components/modules/chosenPackages'

const catalog = [
  { location: 'gitlab:registry/modules/core', name: 'core', latest: '1.2.0' },
  { location: 'gitlab:registry/modules/draft' },
]

describe('chosenPackages', () => {
  it('chooses from the latest version up, or any when there is none', () => {
    expect(rangeOf(catalog[0])).toBe('^1.2.0')
    expect(rangeOf(catalog[1])).toBe('*')
    expect(rangeOf(undefined)).toBe('*')
  })

  it('puts a package in the choice, and takes it out the second time', () => {
    const once = toggled([], catalog[0])
    expect(once).toEqual([{ location: catalog[0].location, range: '^1.2.0' }])
    expect(toggled(once, catalog[0])).toEqual([])
  })

  it('changes the range of one package only', () => {
    const chosen = [{ location: 'a', range: '^1.0.0' }, { location: 'b', range: '^2.0.0' }]
    expect(withRange(chosen, 'b', '~2.1.0')).toEqual([{ location: 'a', range: '^1.0.0' }, { location: 'b', range: '~2.1.0' }])
  })

  it('adds what is missing with the default range of each, and a star for what the catalog does not know', () => {
    const missing = [{ location: catalog[0].location }, { location: 'gitlab:other/x' }]
    expect(withMissing([], missing, catalog).map((m) => m.range)).toEqual(['^1.2.0', '*'])
  })

  it('sends a choice as location to range, blank ranges as a star', () => {
    expect(toMap([{ location: 'a', range: ' ^1.0.0 ' }, { location: 'b', range: '  ' }])).toEqual({ a: '^1.0.0', b: '*' })
  })

  it('names a package by the catalog, or by the last part of its location', () => {
    expect(nameIn(catalog, catalog[0].location)).toBe('core')
    expect(nameIn(catalog, 'gitlab:registry/modules/draft')).toBe('draft')
  })
})
