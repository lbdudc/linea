import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const STORAGE_KEY = 'linea-theme'

async function mountThemeToggle(storedValue) {
  vi.resetModules()
  localStorage.clear()
  if (storedValue) localStorage.setItem(STORAGE_KEY, storedValue)
  document.documentElement.classList.remove('dark-theme', 'light-theme')

  const { default: ThemeToggle } = await import('components/common/ThemeToggle.vue')

  return mount(ThemeToggle, {
    global: {
      plugins: mountGlobalPlugins(),
    },
  })
}

describe('theme — mounting in light and dark (ThemeToggle.vue + useTheme.js)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark-theme', 'light-theme')
    localStorage.clear()
  })

  it('mounts in light theme: <html> carries .light-theme, not .dark-theme', async () => {
    await mountThemeToggle('light')

    expect(document.documentElement.classList.contains('light-theme')).toBe(true)
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false)
  })

  it('mounts in dark theme: <html> carries .dark-theme, not .light-theme', async () => {
    await mountThemeToggle('dark')

    expect(document.documentElement.classList.contains('dark-theme')).toBe(true)
    expect(document.documentElement.classList.contains('light-theme')).toBe(false)
  })

  it('clicking the button, starting from light, switches <html> to .dark-theme and persists it', async () => {
    const wrapper = await mountThemeToggle('light')

    await wrapper.find('button').trigger('click')

    expect(document.documentElement.classList.contains('dark-theme')).toBe(true)
    expect(document.documentElement.classList.contains('light-theme')).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('clicking the button, starting from dark, switches <html> to .light-theme and persists it', async () => {
    const wrapper = await mountThemeToggle('dark')

    await wrapper.find('button').trigger('click')

    expect(document.documentElement.classList.contains('light-theme')).toBe(true)
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })
})
