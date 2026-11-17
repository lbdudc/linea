/**
 * Code insertion points (CIP). A module can leave `/*→ name ←*\/` markers in a `*.cipmain.*` file; other modules provide `*.cip.*`
 * files of the same path in which the code for a marker sits between two markers of that name. Splicing happens before the templates
 * are evaluated and does not depend on the features, so it is done when the platform is composed.
 *
 * The splicing itself is spl-js-engine's (`spliceCip`, the one its derivation uses for components), so a platform composed here is
 * the one the engine builds. What is here is what the engine does not know: which of linea's paths are main files and fragments.
 */

import { spliceCip } from 'spl-js-engine'
import type { ResolvedModule } from '../types.js'

export const CIP_DEFAULT_START = '/*→'
export const CIP_DEFAULT_END = '←*/'

const CIPMAIN_MARK = '.cipmain'
const CIP_MARK = '.cip'

/** Whether a path is the main file of a code insertion point (`x.cipmain.vue`), or a fragment for one (`x.cip.vue`). */
export const cipKind = ({ file }: { file: string }): 'main' | 'fragment' | undefined => {
  const name = file.slice(file.lastIndexOf('/') + 1)
  if (name.includes(CIPMAIN_MARK + '.')) return 'main'
  if (name.includes(CIP_MARK + '.')) return 'fragment'
  return undefined
}

/** `a/_x.cipmain.vue` and `a/_x.cip.vue` both give the path of the file they make: `a/_x.vue`. */
export const cipTarget = ({ file }: { file: string }): string => file.replace(CIPMAIN_MARK + '.', '.').replace(CIP_MARK + '.', '.')

/** The path of the fragment for a main file (`a/_x.cipmain.vue` → `a/_x.cip.vue`). */
export const cipFragmentPath = ({ main }: { main: string }): string => main.replace(CIPMAIN_MARK + '.', CIP_MARK + '.')

export interface CipFragment {
  from: string
  path: string
  text: string
  points: string[]
  unclosed: string[]
}

export interface CipComposition {
  target: string
  main?: { from: string, path: string, text: string }
  fragments: CipFragment[]
  points: { name: string, providers: string[] }[]
  unfilled: string[]
  orphans: { name: string, from: string }[]
  spliced?: string
}

export interface CipReport {
  start: string
  end: string
  compositions: CipComposition[]
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The names of the markers of a text, in order, repeated as they are. */
export const cipMarkers = ({ text, start = CIP_DEFAULT_START, end = CIP_DEFAULT_END }: { text: string, start?: string, end?: string }): string[] => (
  [...text.matchAll(new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, 'g'))].map((match) => (match[1] ?? '').trim())
)

const blocksOf = (markers: string[]): { points: string[], unclosed: string[] } => {
  const counts = new Map<string, number>()
  for (const name of markers) counts.set(name, (counts.get(name) ?? 0) + 1)
  return {
    points: [...counts].filter(([, count]) => count >= 2).map(([name]) => name),
    unclosed: [...counts].filter(([, count]) => count % 2 === 1).map(([name]) => name),
  }
}

const CONFIG_DIR = '.linea/config'
const CODE_DIR = 'code'

/**
 * Who fills what in the code insertion points of some modules: for each file they make, its main file, its fragments in the order they
 * are spliced, which markers nobody fills, which blocks no marker asks for, and the text that comes out.
 */
export const describeCips = async ({ modules }: { modules: readonly ResolvedModule[] }): Promise<CipReport> => {
  const decoder = new TextDecoder()
  let start = CIP_DEFAULT_START
  let end = CIP_DEFAULT_END
  const mains = new Map<string, { from: string, path: string, text: string }>()
  const fragments = new Map<string, { from: string, path: string, text: string }[]>()

  for (const module of modules) {
    const config = await module.files.read({ path: `${CONFIG_DIR}/config.json` })
    if (config !== undefined) {
      try {
        const { delimiters } = JSON.parse(decoder.decode(config)) as { delimiters?: { extension?: string[], start?: string, end?: string }[] }
        const own = delimiters?.find((delimiter) => delimiter.extension?.includes('cip'))
        if (own?.start !== undefined && own.end !== undefined) {
          start = own.start
          end = own.end
        }
      } catch {
        // a configuration that cannot be read is reported by the check of the platform
      }
    }
    const listed = [...await module.files.list({ dir: CODE_DIR }), ...await module.files.list({ dir: CONFIG_DIR })]
    for (const path of listed) {
      const kind = cipKind({ file: path })
      if (kind === undefined) continue
      const content = await module.files.read({ path })
      if (content === undefined) continue
      const entry = { from: module.location, path, text: decoder.decode(content) }
      const target = cipTarget({ file: path })
      if (kind === 'main') mains.set(target, entry)
      else fragments.set(target, [...(fragments.get(target) ?? []), entry])
    }
  }

  const compositions = [...new Set([...mains.keys(), ...fragments.keys()])].sort().map((target): CipComposition => {
    const main = mains.get(target)
    const parts = (fragments.get(target) ?? []).map((fragment) => ({ ...fragment, ...blocksOf(cipMarkers({ text: fragment.text, start, end })) }))
    const names = main === undefined ? [] : [...new Set(cipMarkers({ text: main.text, start, end }))]
    const points = names.map((name) => ({ name, providers: parts.filter((part) => part.points.includes(name)).map((part) => part.from) }))
    return {
      target,
      ...(main === undefined ? {} : { main, spliced: spliceCip({ main: main.text, fragments: parts.map((part) => part.text), start, end }) }),
      fragments: parts,
      points,
      unfilled: points.filter((point) => point.providers.length === 0).map((point) => point.name),
      orphans: main === undefined ? [] : parts.flatMap((part) => part.points.filter((name) => !names.includes(name)).map((name) => ({ name, from: part.from }))),
    }
  })
  return { start, end, compositions }
}
