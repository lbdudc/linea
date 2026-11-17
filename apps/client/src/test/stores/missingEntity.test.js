import { describe, expect, it } from 'vitest'
import { clearMissing, isForbiddenEntityResponse, isMissingEntityResponse, markMissing, missingEntity } from '../../stores/missingEntity.js'

describe('isMissingEntityResponse', () => {
  const route = { params: { id: '000000000000000000000000' } }

  it('is true for the 404 of the resource the page is about', () => {
    expect(isMissingEntityResponse({ status: 404, url: '/products/000000000000000000000000' }, route)).toBe(true)
    expect(isMissingEntityResponse({ status: 404, url: '/lines/000000000000000000000000?x=1' }, route)).toBe(true)
  })

  it('is false for another status, another id, or a page without an id', () => {
    expect(isMissingEntityResponse({ status: 500, url: '/products/000000000000000000000000' }, route)).toBe(false)
    expect(isMissingEntityResponse({ status: 404, url: '/products/111111111111111111111111' }, route)).toBe(false)
    expect(isMissingEntityResponse({ status: 404, url: '/products/000000000000000000000000' }, { params: {} })).toBe(false)
  })
})

describe('missingEntity', () => {
  it('remembers the path that is missing until it is cleared', () => {
    markMissing('/lines/zzz')
    expect(missingEntity.path).toBe('/lines/zzz')
    clearMissing()
    expect(missingEntity.path).toBeNull()
  })
})

describe('isForbiddenEntityResponse', () => {
  const route = { params: { id: '000000000000000000000000' } }

  it('is true for the 403 of the resource the page is about', () => {
    expect(isForbiddenEntityResponse({ status: 403, url: '/lines/000000000000000000000000' }, route)).toBe(true)
  })

  it('is false for another status or another id', () => {
    expect(isForbiddenEntityResponse({ status: 404, url: '/lines/000000000000000000000000' }, route)).toBe(false)
    expect(isForbiddenEntityResponse({ status: 403, url: '/lines/111111111111111111111111' }, route)).toBe(false)
  })
})

describe('missingEntity kind', () => {
  it('keeps the kind with the path and goes back to not found when cleared', () => {
    markMissing('/lines/zzz', 'forbidden')
    expect(missingEntity.kind).toBe('forbidden')
    clearMissing()
    expect(missingEntity.kind).toBe('not_found')
  })
})
