import { computed } from 'vue'
import { isDarkState } from './useTheme'

const TOKEN_MAP = {
  dark: {
    success: '--status-ok', warning: '--status-warn', serious: '--status-serious', error: '--status-bad',
    primary: '--p-primary-color', fill: '--p-highlight-background',
    neutral: '--p-content-border-color', text: '--p-text-muted-color', grid: '--p-content-border-color',
    surface: '--p-content-background',
  },
  light: {
    success: '--status-ok', warning: '--status-warn', serious: '--status-serious', error: '--status-bad',
    primary: '--p-primary-color', fill: '--p-highlight-background',
    neutral: '--p-content-border-color', text: '--p-text-dim-color', grid: '--p-content-border-color',
    surface: '--p-content-background',
  },
}

function readTokens(map) {
  const styles = getComputedStyle(document.documentElement)
  const out = {}
  for (const [key, varName] of Object.entries(map)) {
    out[key] = styles.getPropertyValue(varName).trim()
  }
  return out
}

export function useChartTheme() {
  const c = computed(() => readTokens(isDarkState.value ? TOKEN_MAP.dark : TOKEN_MAP.light))

  return { c }
}
