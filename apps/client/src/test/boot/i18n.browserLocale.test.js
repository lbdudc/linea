import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const localeFor = async (languages) => {
  vi.resetModules()
  vi.stubGlobal('navigator', { languages, language: languages[0] })
  const { i18n } = await import('src/boot/i18n')
  return i18n.global.locale
}

describe('the first language', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('is the first supported language the browser prefers', async () => {
    expect(await localeFor(['fr-FR', 'gl-ES', 'en'])).toBe('gl')
    expect(await localeFor(['es-MX'])).toBe('es')
  })

  it('is English when the browser prefers none of them', async () => {
    expect(await localeFor(['fr-FR', 'de'])).toBe('en')
  })

  it('is the one that was chosen before, whatever the browser says', async () => {
    localStorage.setItem('linea.locale', 'gl')
    expect(await localeFor(['en-US'])).toBe('gl')
  })
})
