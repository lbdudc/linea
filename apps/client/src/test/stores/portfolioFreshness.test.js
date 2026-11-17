import { describe, it, expect, vi, afterEach } from 'vitest'
import { changesPortfolio, portfolioFreshness } from 'stores/portfolioFreshness'

describe('changesPortfolio', () => {
  it('counts the writes that create, change or remove a line or a product', () => {
    expect(changesPortfolio({ method: 'post', url: '/lines' })).toBe(true)
    expect(changesPortfolio({ method: 'delete', url: '/lines/abc' })).toBe(true)
    expect(changesPortfolio({ method: 'post', url: '/products' })).toBe(true)
    expect(changesPortfolio({ method: 'patch', url: '/products/abc' })).toBe(true)
    expect(changesPortfolio({ method: 'post', url: '/products/abc/generate' })).toBe(true)
    expect(changesPortfolio({ method: 'put', url: '/lines/abc/modules' })).toBe(true)
  })

  it('does not count reads, questions asked with a body, or the models of a product', () => {
    expect(changesPortfolio({ method: 'get', url: '/lines/enrolled' })).toBe(false)
    expect(changesPortfolio({ method: 'post', url: '/lines/analyze' })).toBe(false)
    expect(changesPortfolio({ method: 'post', url: '/lines/modules/preview' })).toBe(false)
    expect(changesPortfolio({ method: 'post', url: '/lines/abc/modules/check' })).toBe(false)
    expect(changesPortfolio({ method: 'put', url: '/products/abc/models/datamodel' })).toBe(false)
    expect(changesPortfolio({ method: 'put', url: '/products/abc/layouts' })).toBe(false)
    expect(changesPortfolio({ method: 'post', url: '/users/login/gitlab' })).toBe(false)
  })
})

describe('portfolioFreshness', () => {
  afterEach(() => {
    vi.useRealTimers()
    portfolioFreshness.listen(null)
  })

  it('is fresh for a while after a load, and not after a change', () => {
    portfolioFreshness.loaded()
    expect(portfolioFreshness.isFresh(60_000)).toBe(true)
    portfolioFreshness.changed()
    expect(portfolioFreshness.isFresh(60_000)).toBe(false)
  })

  it('tells its listener once when several changes follow each other', () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    portfolioFreshness.listen(reload)
    portfolioFreshness.changed()
    portfolioFreshness.changed()
    portfolioFreshness.changed()
    vi.advanceTimersByTime(1000)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
