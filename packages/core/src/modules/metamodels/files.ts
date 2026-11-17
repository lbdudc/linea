import { readPackageText } from '../packages/source.js'
import { METAMODEL_FOLDERS, metamodelPath, type MetamodelFileKind } from './layout.js'
import type { ResolvedMetamodel, ResolvedSpl } from '../types.js'

const SCRIPT_KINDS = ['constraints', 'spec', 'import', 'scope'] as const

export type ScriptKind = (typeof SCRIPT_KINDS)[number]

export interface MetamodelFile {
  readonly grammar: string
  /** path of the grammar in the package */
  readonly file: string
  readonly text: string
  readonly level: number
  readonly scripts: Partial<Record<ScriptKind, string>>
  /** the views of its instances that the metamodel brings (`visualizations/<grammar>.js`). Code for the page that edits the models, never run by the engine */
  readonly visualizations?: string
}

const LEVEL_COMMENT = /^\s*\/\/\s*@level\s+(\d+)\s*$/m

const parseLevel = ({ text }: { text: string }): number => Number(LEVEL_COMMENT.exec(text)?.[1] ?? 0)

type Files = Pick<ResolvedMetamodel, 'files'>['files']

/** The text of a file of a grammar, in its folder of the package; `undefined` when it has none. */
export const readMetamodelText = ({ files, kind, grammar }: { files: Files, kind: MetamodelFileKind, grammar: string }): Promise<string | undefined> =>
  readPackageText({ files, path: metamodelPath({ kind, grammar }) })

/** The grammars a metamodel package provides: every `grammars/<name>.langium`, with the scripts that belong to each. */
export const readMetamodelFiles = async ({ pkg }: { pkg: Pick<ResolvedMetamodel, 'files'> }): Promise<MetamodelFile[]> => {
  const { files } = pkg
  const folder = `${METAMODEL_FOLDERS.grammar}/`
  const names = new Map<string, string>()
  for (const file of await files.list({ dir: METAMODEL_FOLDERS.grammar })) {
    if (file.startsWith(folder) && !file.slice(folder.length).includes('/') && file.endsWith('.langium')) names.set(file.slice(folder.length, -'.langium'.length), file)
  }
  files.prefetch?.([...names.values(), ...[...names.keys()].flatMap((grammar) => [
    ...SCRIPT_KINDS.map((kind) => metamodelPath({ kind, grammar })),
    metamodelPath({ kind: 'visualizations', grammar })
  ])])

  const found: MetamodelFile[] = []
  for (const [grammar, file] of names) {
    const scripts: Partial<Record<ScriptKind, string>> = {}
    for (const kind of SCRIPT_KINDS) {
      const code = await readMetamodelText({ files, kind, grammar })
      if (code !== undefined) scripts[kind] = code
    }
    const visualizations = await readMetamodelText({ files, kind: 'visualizations', grammar })
    const text = (await readPackageText({ files, path: file })) ?? ''
    found.push({ grammar, file, text, level: parseLevel({ text }), scripts, ...(visualizations === undefined ? {} : { visualizations }) })
  }
  return found.sort((a, b) => a.grammar.localeCompare(b.grammar))
}

/** Everything a metamodel engine needs to know the metamodels of an SPL: grammars and the scripts of each, by grammar name. */
export interface MetamodelBundle {
  readonly grammars: Record<string, string>
  readonly constraints: Record<string, string>
  readonly specs: Record<string, string>
  readonly imports: Record<string, string>
  readonly scopes: Record<string, string>
  /** by grammar name: what the metamodel brings to draw its instances with (page code, so it is not part of what an engine is given) */
  readonly visualizations: Record<string, string>
}

const BUNDLE_KEYS: Record<ScriptKind, Exclude<keyof MetamodelBundle, 'grammars'>> = {
  constraints: 'constraints',
  spec: 'specs',
  import: 'imports',
  scope: 'scopes'
}

/** The grammars and scripts of the metamodels an SPL resolved to, to load into an engine somewhere else (a browser, say). */
export const readMetamodelBundle = async ({ resolved }: { resolved: ResolvedSpl }): Promise<MetamodelBundle> => {
  const bundle: MetamodelBundle = { grammars: {}, constraints: {}, specs: {}, imports: {}, scopes: {}, visualizations: {} }
  for (const pkg of resolved.metamodels) {
    for (const { grammar, text, scripts, visualizations } of await readMetamodelFiles({ pkg })) {
      bundle.grammars[grammar] = text
      if (visualizations !== undefined) bundle.visualizations[grammar] = visualizations
      for (const kind of SCRIPT_KINDS) {
        const code = scripts[kind]
        if (code !== undefined) bundle[BUNDLE_KEYS[kind]][grammar] = code
      }
    }
  }
  return bundle
}
