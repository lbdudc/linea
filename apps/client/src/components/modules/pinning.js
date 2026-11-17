// Pinning and updating the version of a package a line uses: what is asked of the server, and how a change is shown.

/** The part of a line's manifest a package of this kind is in: the modules of a modular line, the metamodels of a project. */
export const fieldOf = (kind) => (kind === 'module' ? 'modules' : 'metamodels')

/** `pin`: exactly that version; `compatible`: that version and the compatible ones above it. */
export const rangeFor = (version, mode) => (mode === 'pin' ? version : `^${version}`)

/** The ranges of a line with `location` asked for as `range`: what is saved when the version changes. */
export const withPackageRange = (ranges, location, range) => ({ ...ranges, [location]: range })

/** Whether a range names one version (a pin) rather than a span of them. */
export const isPin = (range) => typeof range === 'string' && /^=?\d+\.\d+\.\d+$/.test(range.trim())

/** Versions newest first (`1.10.0` after `1.9.0`), whatever order they come in. */
export const newestFirst = (versions) => {
  const parts = (v) => v.split('.').map((n) => parseInt(n, 10) || 0)
  return [...versions].sort((a, b) => {
    const [x, y] = [parts(a), parts(b)]
    for (let i = 0; i < 3; i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
    return 0
  })
}

/** What changes between two resolutions (`[{ location, name, kind, version }]`): packages added, removed, and moved to another version. */
export const diffPackages = (before = [], after = []) => {
  const was = new Map(before.map((p) => [p.location, p]))
  const now = new Map(after.map((p) => [p.location, p]))
  const added = after.filter((p) => !was.has(p.location))
  const removed = before.filter((p) => !now.has(p.location))
  const changed = after
    .filter((p) => was.has(p.location) && was.get(p.location).version !== p.version)
    .map((p) => ({ ...p, from: was.get(p.location).version, to: p.version }))
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length }
}

/** The lines of a feature model that are only in one of the two (indentation counts: it is the tree). */
export const diffLines = (before = '', after = '') => {
  const lines = (text) => text.split('\n').filter((l) => l.trim())
  const [a, b] = [lines(before), lines(after)]
  const [inA, inB] = [new Set(a), new Set(b)]
  return { removed: a.filter((l) => !inB.has(l)), added: b.filter((l) => !inA.has(l)) }
}
