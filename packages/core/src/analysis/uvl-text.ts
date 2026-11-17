import { InvalidArgumentError } from '../errors.js'

/**
 * What the flamapy analysis needs of the UVL text it is given. (The feature model itself is bango's: a model of the feature metamodel, which
 * `printUvl` writes as UVL; these only prepare that text for the analysis service.)
 */

const UVL_GROUP_KEYWORDS: ReadonlySet<string> = new Set([
  'mandatory',
  'optional',
  'alternative',
  'or',
  'features',
  'constraints'
])

const assertUvlString = (uvl: unknown, parameter: string): string => {
  if (typeof uvl !== 'string') {
    throw new InvalidArgumentError(`"${parameter}" must be a string.`)
  }
  return uvl
}

const expandTabs = (line: string, tabSize = 4): string => {
  let out = ''
  let column = 0
  for (const char of line) {
    if (char === '\t') {
      const width = tabSize - (column % tabSize)
      out += ' '.repeat(width)
      column += width
    } else {
      out += char
      column += 1
    }
  }
  return out
}

/** The UVL with its tabs as spaces and its line breaks unified, as the analysis service reads it. */
export const normalizeUvl = ({ uvl }: { uvl: string }): string => {
  const unified = assertUvlString(uvl, 'uvl').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return unified
    .split('\n')
    .map((line) => expandTabs(line, 4))
    .join('\n')
}

/** About how many features a UVL text declares: what decides how much of the analysis is worth asking for. */
export const estimateFeatureCount = ({ uvl }: { uvl: string }): number => {
  const document = assertUvlString(uvl, 'uvl')
  let inConstraints = false
  let count = 0
  for (const line of document.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue
    if (trimmed === 'constraints') {
      inConstraints = true
      continue
    }
    if (inConstraints) continue
    if (trimmed === 'features') continue
    const indent = line.length - line.trimStart().length
    if (indent >= 2) {
      const name = trimmed.split(/[\s{[]/)[0]
      if (name && !UVL_GROUP_KEYWORDS.has(name)) count += 1
    }
  }
  return count
}
