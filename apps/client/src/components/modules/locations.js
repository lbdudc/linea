// Locations of packages (`gitlab:group/project`), and the references one package makes to another. The same rules as linea-core's
// `resolveReference`: an absolute location stands for itself, `../x` is relative to the package that says it, taken as a folder.

const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/i

const normalize = (segments) => {
  const out = []
  for (const part of segments) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

/** The location a reference denotes, seen from the package `from`. */
export const resolveReference = (from, reference) => {
  if (!reference.startsWith('./') && !reference.startsWith('../')) return reference
  const match = SCHEME.exec(from)
  if (!match) return reference
  return `${match[1]}:${normalize([...match[2].split('/'), ...reference.split('/')]).join('/')}`
}

/** How to write `to` in the manifest of `from`: by path when both are in the same place (so the packages work under any group). */
export const relativeReference = (from, to) => {
  const a = SCHEME.exec(from)
  const b = SCHEME.exec(to)
  if (!a || !b || a[1] !== b[1]) return to
  const fromParts = normalize(a[2].split('/'))
  const toParts = normalize(b[2].split('/'))
  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++
  // nothing in common: it is not in the same place
  if (common === 0) return to
  const up = fromParts.length - common
  return [...Array(up).fill('..'), ...toParts.slice(common)].join('/') || to
}

/** The last part of a location: what a package is called when nothing else says. */
export const nameOfLocation = (location) => location.replace(/^[a-z][a-z0-9+.-]*:/i, '').split('/').pop()
