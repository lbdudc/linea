import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('the view of the home', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('starts on everything', async () => {
    const { homeView } = await import('stores/homeView')
    expect(homeView.view).toBe('all')
  })

  it('remembers the choice for the next visit', async () => {
    const first = await import('stores/homeView')
    first.setHomeView('panel')
    expect(localStorage.getItem('linea-home-view')).toBe('panel')

    vi.resetModules()
    const second = await import('stores/homeView')
    expect(second.homeView.view).toBe('panel')
  })

  it('ignores a value that is not a view, saved or typed', async () => {
    localStorage.setItem('linea-home-view', 'sideways')
    const { homeView, setHomeView } = await import('stores/homeView')
    expect(homeView.view).toBe('all')
    setHomeView('sideways')
    expect(homeView.view).toBe('all')
  })
})
