import { describe, it, expect } from 'vitest'
import { nameOfLocation, relativeReference, resolveReference } from 'components/modules/locations'

describe('resolveReference', () => {
  it.each([
    ['gitlab:registry/modules/um', '../core', 'gitlab:registry/modules/core'],
    ['gitlab:registry/modules/um', '../../metamodels/datamodel', 'gitlab:registry/metamodels/datamodel'],
    ['file:modules/um', '../core', 'file:modules/core'],
    ['gitlab:registry/modules/um', 'gitlab:other/x', 'gitlab:other/x'],
  ])('%s + %s', (from, reference, expected) => {
    expect(resolveReference(from, reference)).toBe(expected)
  })
})

describe('relativeReference', () => {
  it.each([
    ['gitlab:registry/modules/um', 'gitlab:registry/modules/core', '../core'],
    ['gitlab:registry/modules/um', 'gitlab:registry/metamodels/datamodel', '../../metamodels/datamodel'],
    ['gitlab:registry/modules/um', 'gitlab:other/x', 'gitlab:other/x'],
    ['gitlab:a/b', 'file:a/c', 'file:a/c'],
  ])('%s -> %s', (from, to, expected) => {
    expect(relativeReference(from, to)).toBe(expected)
  })

  it('is the inverse of resolveReference', () => {
    const from = 'gitlab:registry/modules/um'
    for (const to of ['gitlab:registry/modules/core', 'gitlab:registry/metamodels/datamodel', 'gitlab:elsewhere/pkg']) {
      expect(resolveReference(from, relativeReference(from, to))).toBe(to)
    }
  })
})

describe('nameOfLocation', () => {
  it('is the last part', () => {
    expect(nameOfLocation('gitlab:registry/metamodels/datamodel')).toBe('datamodel')
    expect(nameOfLocation('file:modules/core')).toBe('core')
  })
})
