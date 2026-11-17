const RECENT_KEY = 'linea.search.recent'
const RECENT_MAX = 6
const USAGE_KEY = 'linea.search.usage'
const USAGE_MAX = 120
const PINNED_KEY = 'linea.search.pinned'
export const PINNED_MAX = 3
const USAGE_BONUS_CAP = 24
const ACTIONS_MODE_CAP = 60

const readList = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

export const GROUP_ORDER = ['pinned', 'recent', 'actions', 'pages', 'lines', 'products', 'modules', 'metamodels']

export function fuzzyScore(query, text) {
  const q = String(query ?? '').trim().toLowerCase()
  const t = String(text ?? '').toLowerCase()
  if (!q) return 0
  if (!t) return -1
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  const at = t.indexOf(q)
  if (at >= 0) return 600 - at - t.length / 10
  let from = 0
  let gaps = 0
  for (const char of q) {
    const found = t.indexOf(char, from)
    if (found < 0) return -1
    gaps += found - from
    from = found + 1
  }
  return 200 - gaps - t.length / 10
}

const SUBSTRING_FLOOR = 400

const usageBonus = (entry, usage) => Math.min(usage[entry.usageKey ?? entry.id] ?? 0, USAGE_BONUS_CAP)

const bestScore = (query, entry) => {
  const title = fuzzyScore(query, entry.title)
  const others = [entry.caption, ...(entry.keywords ?? [])].map((text) => fuzzyScore(query, text)).filter((score) => score >= SUBSTRING_FLOOR)
  const best = Math.max(title, ...others)
  return best < 0 ? -1 : best + (title === best ? 50 : 0) + (entry.boost ?? 0)
}

export function searchEntries(entries, rawQuery, { recent = [], perGroup = 6, groups = null, usage = {}, pinned = [] } = {}) {
  let query = String(rawQuery ?? '').trim()
  let only = null
  if (query.startsWith('>')) {
    only = 'actions'
    query = query.slice(1).trim()
    perGroup = Math.max(perGroup, ACTIONS_MODE_CAP)
  }
  const pool = (only ? entries.filter((entry) => entry.group === only) : entries).filter((entry) => !groups || groups.includes(entry.group))

  if (!query) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const lift = (ids, group) => (only || groups ? [] : ids.map((id) => byId.get(id)).filter(Boolean).map((entry) => ({ ...entry, group, origin: entry.group })))
    const pins = lift(pinned, 'pinned')
    const recents = lift(recent, 'recent').filter((entry) => !pins.some((pin) => pin.id === entry.id))
    const lifted = new Set([...pins, ...recents].map((entry) => entry.id))
    const rest = pool.filter((entry) => !lifted.has(entry.id)).map((entry, index) => ({ entry, index }))
      .sort((a, b) => (usage[b.entry.usageKey ?? b.entry.id] ?? 0) - (usage[a.entry.usageKey ?? a.entry.id] ?? 0) || a.index - b.index)
      .map(({ entry }) => entry)
    return [...pins, ...recents, ...limitPerGroup(rest, perGroup)]
  }

  let scored = pool
    .map((entry) => ({ entry, score: bestScore(query, entry) }))
    .filter((item) => item.score >= 0)
    .map((item) => ({ ...item, score: item.score + usageBonus(item.entry, usage) }))
    .sort((a, b) => b.score - a.score)
  if (scored.some((item) => item.score >= SUBSTRING_FLOOR)) scored = scored.filter((item) => item.score >= SUBSTRING_FLOOR)
  const best = {}
  for (const { entry, score } of scored) best[entry.group] = Math.max(best[entry.group] ?? -1, score)
  return limitPerGroup(scored.map((item) => item.entry), perGroup, best)
}

function limitPerGroup(entries, perGroup, best = null) {
  const counts = {}
  const kept = entries.filter((entry) => {
    counts[entry.group] = (counts[entry.group] ?? 0) + 1
    return counts[entry.group] <= perGroup
  })
  const rank = (group) => (best ? -(best[group] ?? 0) : GROUP_ORDER.indexOf(group))
  return kept.sort((a, b) => (a.group === b.group ? 0 : rank(a.group) - rank(b.group) || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)))
}

export const readRecent = () => readList(RECENT_KEY)

export function rememberRecent(id) {
  const next = [id, ...readRecent().filter((existing) => existing !== id)].slice(0, RECENT_MAX)
  writeJson(RECENT_KEY, next)
  return next
}

export function readUsage() {
  try {
    const value = JSON.parse(localStorage.getItem(USAGE_KEY))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, count]) => Number.isFinite(count) && count > 0))
  } catch {
    return {}
  }
}

export function recordUsage(key) {
  const usage = readUsage()
  usage[key] = (usage[key] ?? 0) + 1
  const next = Object.fromEntries(Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, USAGE_MAX))
  writeJson(USAGE_KEY, next)
  return next
}

export const readPinned = () => readList(PINNED_KEY).slice(0, PINNED_MAX)

export function togglePinned(id) {
  const current = readPinned()
  if (current.includes(id)) {
    const next = current.filter((existing) => existing !== id)
    writeJson(PINNED_KEY, next)
    return { pinned: next, full: false }
  }
  if (current.length >= PINNED_MAX) return { pinned: current, full: true }
  const next = [...current, id]
  writeJson(PINNED_KEY, next)
  return { pinned: next, full: false }
}

export function highlightParts(text, rawQuery) {
  const value = String(text ?? '')
  const query = String(rawQuery ?? '').trim().replace(/^>\s*/, '').toLowerCase()
  const plain = [{ text: value, match: false }]
  if (!query || !value) return plain
  const lower = value.toLowerCase()
  const marks = new Array(value.length).fill(false)
  const at = lower.indexOf(query)
  if (at >= 0) {
    marks.fill(true, at, at + query.length)
  } else {
    let from = 0
    for (const char of query) {
      const found = lower.indexOf(char, from)
      if (found < 0) return plain
      marks[found] = true
      from = found + 1
    }
  }
  const parts = []
  for (let i = 0; i < value.length; i++) {
    const last = parts[parts.length - 1]
    if (last && last.match === marks[i]) last.text += value[i]
    else parts.push({ text: value[i], match: marks[i] })
  }
  return parts
}

export function countByGroup(entries) {
  const counts = {}
  for (const entry of entries) {
    const kind = entry.origin ?? entry.group
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  return counts
}
