// A line diff of two texts, and the changes between two sets of modules: what the history of a line shows between two versions.

// The table of the common subsequence is quadratic: a pair of texts bigger than this is compared as a whole instead.
const MAX_CELLS = 4_000_000

/**
 * The lines of `after` against the ones of `before`, in order: `[{ type: 'same' | 'add' | 'del', text }]`.
 * Longest common subsequence, with the common head and tail cut off first so the usual small edit of a long model is cheap.
 */
export function diffLines(before = '', after = '') {
  const a = before === '' ? [] : String(before).replace(/\r\n/g, '\n').split('\n')
  const b = after === '' ? [] : String(after).replace(/\r\n/g, '\n').split('\n')

  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const ma = a.slice(head, a.length - tail)
  const mb = b.slice(head, b.length - tail)

  const out = a.slice(0, head).map((text) => ({ type: 'same', text }))

  if (ma.length * mb.length > MAX_CELLS) {
    out.push(...ma.map((text) => ({ type: 'del', text })), ...mb.map((text) => ({ type: 'add', text })))
    for (const text of a.slice(a.length - tail)) out.push({ type: 'same', text })
    return out
  }

  // table of the length of the common subsequence of the suffixes
  const n = ma.length
  const m = mb.length
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = ma[i] === mb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (ma[i] === mb[j]) { out.push({ type: 'same', text: ma[i] }); i++; j++ }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ type: 'del', text: ma[i] }); i++ }
    else { out.push({ type: 'add', text: mb[j] }); j++ }
  }
  while (i < n) out.push({ type: 'del', text: ma[i++] })
  while (j < m) out.push({ type: 'add', text: mb[j++] })

  for (const text of a.slice(a.length - tail)) out.push({ type: 'same', text })
  return out
}

/** The changed lines with `context` unchanged ones around them, as hunks: `[{ lines }]`; `[]` when nothing changed. */
export function hunksOf(diff, context = 3) {
  const keep = new Array(diff.length).fill(false)
  diff.forEach((line, index) => {
    if (line.type === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k++) keep[k] = true
  })
  const hunks = []
  let current = null
  diff.forEach((line, index) => {
    if (!keep[index]) { current = null; return }
    if (!current) { current = { lines: [] }; hunks.push(current) }
    current.lines.push(line)
  })
  return hunks
}

/** The changed lines with `context` unchanged ones around them; `{ type: 'gap', skipped }` rows stand for what was left out. */
export function withContext(lines, context = 2) {
  const keep = new Array(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.type === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true
  })
  const out = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) { out.push({ type: 'gap', skipped }); skipped = 0 }
      out.push(line)
    } else skipped++
  })
  if (skipped && out.length) out.push({ type: 'gap', skipped })
  return out
}

/** `{ added, removed }` lines of a diff. */
export function countChanges(diff) {
  let added = 0
  let removed = 0
  for (const line of diff) {
    if (line.type === 'add') added++
    else if (line.type === 'del') removed++
  }
  return { added, removed }
}

/**
 * What changed in the modules a line uses directly (`{ location: range }`): the ones added, the ones removed and the ones whose
 * accepted versions changed.
 */
export function diffModules(before, after) {
  const was = before ?? {}
  const is = after ?? {}
  const added = Object.keys(is).filter((k) => !(k in was)).sort().map((location) => ({ location, range: is[location] }))
  const removed = Object.keys(was).filter((k) => !(k in is)).sort().map((location) => ({ location, range: was[location] }))
  const changed = Object.keys(is)
    .filter((k) => k in was && was[k] !== is[k])
    .sort()
    .map((location) => ({ location, from: was[location], to: is[location] }))
  return { added, removed, changed, any: added.length + removed.length + changed.length > 0 }
}

/** The short name of a module location (`gitlab:registry/user-management` is `user-management`). */
export const moduleName = (location) => String(location).replace(/^[a-z]+:/, '').split('/').pop()

/**
 * What the packages a version resolved to did between two versions: `[{ location, name, kind, from, to, status }]`, with `status` one of
 * `add`, `del`, `chg` (another version) and `same`. Either side may be `null` (a version that did not keep its packages).
 */
export function diffPackages(before, after) {
  const was = new Map((before ?? []).map((p) => [p.location, p]))
  const is = new Map((after ?? []).map((p) => [p.location, p]))
  const rows = [...new Set([...was.keys(), ...is.keys()])].map((location) => {
    const a = was.get(location)
    const b = is.get(location)
    const status = !a ? 'add' : !b ? 'del' : a.version !== b.version ? 'chg' : 'same'
    return { location, name: (b ?? a).name ?? moduleName(location), kind: (b ?? a).kind, from: a?.version ?? null, to: b?.version ?? null, status }
  })
  return rows.sort((x, y) => x.name.localeCompare(y.name))
}
