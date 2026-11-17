import { createI18n } from 'vue-i18n'
import messages from 'src/i18n'

const STORAGE_KEY = 'linea.locale'

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'gl', name: 'Galego' },
]
const SUPPORTED = LANGUAGES.map(l => l.code)

const ignoreUnavailableStorage = () => {}

const browserLocale = () => {
  const preferred = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language])
  for (const tag of preferred) {
    const code = String(tag ?? '').toLowerCase().split('-')[0]
    if (SUPPORTED.includes(code)) return code
  }
  return 'en'
}

const readStoredLocale = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && SUPPORTED.includes(v)) return v
  } catch {
    ignoreUnavailableStorage()
  }
  return browserLocale()
}

const i18n = createI18n({
  legacy: true,
  // plugins written with the composition API (`useI18n`) use the same messages
  allowComposition: true,
  globalInjection: true,
  locale: readStoredLocale(),
  fallbackLocale: 'en',
  messages
})

// The production build replaces the word `global` with `globalThis` (`define` in vite.config.mjs), vue-i18n's own `get global()` among it: the
// instance then has `globalThis` and no `global`, and everything that asks it (`i18n.global.t`, what the plugins do) breaks there and not in
// development. The word is spelled in pieces here because the replacement would rewrite it in a string too.
const GLOBAL = ['glo', 'bal'].join('')
if (!i18n[GLOBAL] && i18n.globalThis) Object.defineProperty(i18n, GLOBAL, { get: () => i18n.globalThis, enumerable: true })

const announceLanguage = (code) => {
  if (typeof document !== 'undefined') document.documentElement.lang = code
}
announceLanguage(i18n.global.locale)

// The locale is reactive: the pages that are open translate again where they are, with the forms, dialogs and the live connection as they were.
const setLocale = (code) => {
  if (!SUPPORTED.includes(code) || code === i18n.global.locale) return
  try { localStorage.setItem(STORAGE_KEY, code) } catch { ignoreUnavailableStorage() }
  i18n.global.locale = code
  announceLanguage(code)
}

export function installI18n (app) {
  app.use(i18n)
}

export { i18n, setLocale, LANGUAGES }
