import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('switching the language', () => {
  let reload
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' })
    reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('changes the language where the page is, without reloading it, and keeps the choice', async () => {
    const { i18n, setLocale } = await import('src/boot/i18n')
    expect(i18n.global.locale).toBe('en')
    const before = i18n.global.t('labels.save')
    setLocale('es')
    expect(i18n.global.locale).toBe('es')
    expect(i18n.global.t('labels.save')).not.toBe(before)
    expect(localStorage.getItem('linea.locale')).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(reload).not.toHaveBeenCalled()
  })

  it('ignores a language it does not have and the one already in use', async () => {
    const { i18n, setLocale } = await import('src/boot/i18n')
    setLocale('fr')
    setLocale('en')
    expect(i18n.global.locale).toBe('en')
    expect(localStorage.getItem('linea.locale')).toBeNull()
  })
})
