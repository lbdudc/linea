// v2: direct message-tree lookup, no vue-i18n composer indirection.
import messages from 'src/i18n'
import { i18n } from 'src/boot/i18n'

const STORAGE_KEY = 'linea.locale'
const SUPPORTED = ['en', 'es', 'gl']
const DEFAULT_LOCALE = 'es'
const FALLBACK_LOCALE = 'en'

const currentLocale = () => {
  const fromI18n =
    typeof i18n?.global?.locale === 'object'
      ? i18n.global.locale.value
      : i18n?.global?.locale
  if (SUPPORTED.includes(fromI18n)) return fromI18n
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (SUPPORTED.includes(stored)) return stored
  } catch { /* ignore */ }
  return DEFAULT_LOCALE
}

// Walk a locale bag by a dotted key. Returns the leaf string, or null.
const lookup = (loc, key) => {
  const bag = messages?.[loc]
  if (!bag) return null
  const segments = String(key).split('.')
  let node = bag
  for (const seg of segments) {
    if (node == null || typeof node !== 'object') return null
    node = node[seg]
  }
  return typeof node === 'string' ? node : null
}

const interpolate = (str, params) =>
  params && typeof params === 'object'
    ? str.replace(/\{(\w+)\}/g, (_, name) => (params[name] != null ? String(params[name]) : ''))
    : str

// vue-i18n plural syntax: "one | many". We pick the second form for count > 1.
const pickPlural = (raw, count) => {
  if (!raw.includes('|')) return raw
  const forms = raw.split('|').map((s) => s.trim())
  return count === 1 ? (forms[0] ?? raw) : (forms[1] ?? forms[0] ?? raw)
}

// Direct message-tree translate. Bypasses vue-i18n's composer, which under
// legacy mode + our chunk-loading order can return the raw key. Reads the
// exact same `messages` bundle that `createI18n` was seeded with, so it's
// always in sync with `$t()` in templates.
export const t = (key, params) => {
  const loc = currentLocale()
  const raw = lookup(loc, key) ?? lookup(FALLBACK_LOCALE, key)
  if (raw == null) return key
  // If the message has a plural bar but no explicit count, prefer the singular
  // form — leaking the "one | many" literal to the UI looks worse than picking
  // one side of it.
  const count = params && typeof params.n === 'number' ? params.n : null
  const picked = raw.includes('|')
    ? pickPlural(raw, count == null ? 1 : count)
    : raw
  return interpolate(picked, params)
}

// Pluralized translate — mirrors vue-i18n's `$tc(key, count, params)`.
export const tc = (key, count, params) =>
  t(key, { ...(params ?? {}), n: count })

// Guarded locale switch used by the language menus.
export const setLocale = (code) => {
  if (!SUPPORTED.includes(code)) return
  if (i18n?.global) {
    if (typeof i18n.global.locale === 'object') i18n.global.locale.value = code
    else i18n.global.locale = code
  }
}
