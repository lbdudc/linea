import { describe, it, expect, beforeEach } from 'vitest'
import { afterLoginTarget, rememberReturnTo } from 'src/utils/returnTo'

describe('returnTo', () => {
  beforeEach(() => sessionStorage.clear())

  it('prefers the requested path, then the one kept across the round trip, then home', () => {
    expect(afterLoginTarget('/products')).toBe('/products')
    expect(afterLoginTarget(undefined)).toBe('/')
    sessionStorage.setItem('linea:returnTo', '/lines/1')
    expect(afterLoginTarget(undefined)).toBe('/lines/1')
  })

  it('keeps an in-app path across the OAuth round trip, once, and refuses what is not of this origin', () => {
    rememberReturnTo('/lines/1?tab=history')
    expect(afterLoginTarget(undefined)).toBe('/lines/1?tab=history')
    expect(afterLoginTarget(undefined)).toBe('/')
    rememberReturnTo('//evil.example/x')
    rememberReturnTo('https://evil.example')
    expect(afterLoginTarget(undefined)).toBe('/')
  })
})
