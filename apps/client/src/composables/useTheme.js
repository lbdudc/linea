import { ref, computed } from 'vue'

const STORAGE_KEY = 'linea-theme'
let _initialized = false

function hasThemeClass() {
  return document.documentElement.classList.contains('dark-theme')
}

export const isDarkState = ref(hasThemeClass())

function applyThemeClass(isDark) {
  const root = document.documentElement
  root.classList.toggle('dark-theme', isDark)
  root.classList.toggle('light-theme', !isDark)
  isDarkState.value = isDark
}

export function useTheme() {
  if (!_initialized) {
    _initialized = true
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      applyThemeClass(stored === 'dark')
    }
  }

  const isDark = computed(() => isDarkState.value)

  const toggleTheme = () => {
    const next = !isDarkState.value
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light')
    applyThemeClass(next)
  }

  return { isDark, toggleTheme }
}
