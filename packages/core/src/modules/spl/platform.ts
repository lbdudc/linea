import fs from 'node:fs'
import path from 'node:path'
import { PLATFORM_PATHS } from '../../constants.js'
import { ensureDir } from '../../fs/workspace.js'
import { isPlainObject } from '../../internal/guards.js'
import { DEFAULT_PLATFORM_CONFIG } from '../../line/scaffold.js'
import { buildExtraJs, buildTransformationJs } from '../../line/platform-files.js'
import { readPackageText } from '../packages/source.js'
import { rootFeatureName } from '../configuration/names.js'
import { spliceCip } from 'spl-js-engine'
import { CIP_DEFAULT_END, CIP_DEFAULT_START, cipFragmentPath, cipKind, cipTarget } from './cip.js'
import { featureNamesOfSections, featuresOfConstraint, graftModules, parseUvlSections, type UvlSections } from './feature-model.js'
import type { Diagnostic, PackageFiles, ResolvedModule, ResolvedSpl } from '../types.js'

const CODE_DIR = 'src/platform/code'
const MODULE_CODE_DIR = 'code'
// what every module is asked for, one by one, when it is added: named up front so a source that fetches can do it side by side
const MODULE_FILES = ['.linea/model.uvl', '.linea/config/config.json', ...['extra', 'transformation'].flatMap((name) => [`.linea/config/${name}.js`, `.linea/config/${name}.cipmain.js`, `.linea/config/${name}.cip.js`])]
// reads that are all needed, made this many at a time
const READ_CONCURRENCY = 8

const readAll = async <T>(items: readonly T[], read: (item: T) => Promise<Uint8Array | undefined>): Promise<(Uint8Array | undefined)[]> => {
  const results = new Array<Uint8Array | undefined>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) results[index] = await read(items[index] as T)
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker))
  return results
}

interface Delimiter {
  extension: string[]
  start: string
  end: string
}

interface PlatformConfig {
  ignore: string[]
  delimiters: Delimiter[]
}

/** Everything a derivation needs, composed from the modules of an SPL, before it is written anywhere. */
export interface PlatformPlan {
  /** Merged UVL feature model. */
  readonly featureModel: string
  readonly config: PlatformConfig
  readonly extraJs: string
  readonly transformation: string
  /** Code files, as paths relative to the line directory (`src/platform/code/...`). */
  readonly files: ReadonlyMap<string, { readonly content: Uint8Array, readonly from: string }>
  readonly diagnostics: readonly Diagnostic[]
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

const delimiterKey = (delimiter: Delimiter): string => [...delimiter.extension].sort().join(',')

const parseConfig = (content: string, where: string, file: string, diagnostics: Diagnostic[]): Partial<PlatformConfig> => {
  try {
    const raw: unknown = JSON.parse(content)
    if (!isPlainObject(raw)) throw new Error('it is not an object')
    return {
      ...(Array.isArray(raw.ignore) ? { ignore: raw.ignore.filter((value): value is string => typeof value === 'string') } : {}),
      ...(Array.isArray(raw.delimiters) ? { delimiters: raw.delimiters as Delimiter[] } : {})
    }
  } catch (error) {
    diagnostics.push({ severity: 'error', package: where, file, message: `${file} is not valid: ${(error as Error).message}` })
    return {}
  }
}

const copyConfig = (): PlatformConfig => ({
  ignore: [...DEFAULT_PLATFORM_CONFIG.ignore],
  delimiters: DEFAULT_PLATFORM_CONFIG.delimiters.map((delimiter) => ({ ...delimiter, extension: [...delimiter.extension] }))
})

/**
 * Composes the platform of an SPL: the feature models of its modules grafted under its root, their code laid over each other, their
 * helper functions and transformations chained after the core ones. What the SPL has of its own (`src/platform/...`) comes last, so it wins.
 * Problems (a file two modules both provide, a feature name used twice...) are returned, not thrown.
 */
export const planPlatform = async ({
  resolved,
  spl,
  ownFeatureModel,
  loadCode = true
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  /** The SPL's own feature model, as UVL (its model of the feature metamodel): the modules' are grafted under its root. Without it, the root alone. */
  ownFeatureModel?: string
  /**
   * `false` for a check, where the code is not written anywhere: the code of a package is only listed, and a file is read when its bytes
   * decide something (a file that two packages both provide, and the files of a code insertion point). The diagnostics are the same;
   * `files` then holds those files with no content (`from` says who provides each). A derivation needs `true`, the default.
   */
  loadCode?: boolean
}): Promise<PlatformPlan> => {
  const diagnostics: Diagnostic[] = []
  const config = copyConfig()
  const delimiterOwner = new Map<string, string>(config.delimiters.map((delimiter) => [delimiterKey(delimiter), 'linea']))
  const extra: string[] = [buildExtraJs()]
  const transformation: string[] = [buildTransformationJs()]
  const files = new Map<string, { content: Uint8Array, from: string }>()
  const sections: UvlSections[] = []
  const featureOwner = new Map<string, string>()
  const constraintsOf: { owner: string, file: string, sections: UvlSections }[] = []

  const mergeConfig = (partial: Partial<PlatformConfig>, owner: string, override: boolean): void => {
    for (const ignored of partial.ignore ?? []) if (!config.ignore.includes(ignored)) config.ignore.push(ignored)
    for (const delimiter of partial.delimiters ?? []) {
      const key = delimiterKey(delimiter)
      const index = config.delimiters.findIndex((existing) => delimiterKey(existing) === key)
      if (index < 0) {
        config.delimiters.push(delimiter)
        delimiterOwner.set(key, owner)
        continue
      }
      const existing = config.delimiters[index]!
      if (existing.start === delimiter.start && existing.end === delimiter.end) continue
      if (override) {
        config.delimiters[index] = delimiter
        delimiterOwner.set(key, owner)
      } else {
        diagnostics.push({
          severity: 'error',
          package: owner,
          file: '.linea/config/config.json',
          message: `The delimiters for ${key} (${delimiter.start} ... ${delimiter.end}) clash with those of ${delimiterOwner.get(key) ?? 'linea'} (${existing.start} ... ${existing.end}).`
        })
      }
    }
  }

  // code insertion points: the main files and the fragments are not code of the product, they are spliced into one file when all packages are in
  const cipMains = new Map<string, { content: Uint8Array, from: string }>()
  const cipFragments = new Map<string, { content: string, from: string }[]>()
  const decoder = new TextDecoder()
  const addFragment = (key: string, content: string, from: string): void => {
    const list = cipFragments.get(key)
    if (list === undefined) cipFragments.set(key, [{ content, from }])
    else list.push({ content, from })
  }

  interface CodeEntry {
    files: PackageFiles
    file: string
    dir: string
    destination: string
    owner: string
    override: boolean
  }

  const applyCode = ({ file, dir, destination, owner, override }: CodeEntry, content: Uint8Array): void => {
    const kind = cipKind({ file: destination })
    if (kind === 'main') {
      const existingMain = cipMains.get(destination)
      if (existingMain !== undefined && !override && !sameBytes(existingMain.content, content)) {
        diagnostics.push({
          severity: 'error',
          package: owner,
          file: `${dir}/${file.slice(dir.length + 1)}`,
          message: `${destination.slice(CODE_DIR.length + 1)} is also provided by ${existingMain.from}, with other content.`
        })
        return
      }
      cipMains.set(destination, { content, from: owner })
      return
    }
    if (kind === 'fragment') {
      addFragment(destination, decoder.decode(content), owner)
      return
    }
    const existing = files.get(destination)
    if (existing !== undefined && !override && !sameBytes(existing.content, content)) {
      diagnostics.push({
        severity: 'error',
        package: owner,
        file: `${dir}/${file.slice(dir.length + 1)}`,
        message: `${destination.slice(CODE_DIR.length + 1)} is also provided by ${existing.from}, with other content.`
      })
      return
    }
    files.set(destination, { content, from: owner })
  }

  // without `loadCode` the files are only listed here, in the order they would have been read, and settled once everything is listed
  const deferred: CodeEntry[] = []

  const addCode = async (files_: PackageFiles, dir: string, target: string, owner: string, override: boolean): Promise<void> => {
    const listed = await files_.list({ dir })
    if (loadCode) files_.prefetch?.(listed)
    for (const file of listed) {
      const entry: CodeEntry = { files: files_, file, dir, destination: `${target}/${file.slice(dir.length + 1)}`, owner, override }
      if (!loadCode) {
        deferred.push(entry)
        continue
      }
      const content = await files_.read({ path: file })
      if (content === undefined) continue
      applyCode(entry, content)
    }
  }

  const settleCode = async (): Promise<void> => {
    const providers = new Map<string, number>()
    for (const { destination } of deferred) providers.set(destination, (providers.get(destination) ?? 0) + 1)
    // a plain file that one package alone provides cannot clash with anything: its bytes are not needed to know that
    const alone = (entry: CodeEntry): boolean => cipKind({ file: entry.destination }) === undefined && providers.get(entry.destination) === 1
    const needed = deferred.filter((entry) => !alone(entry))
    // what is needed is read side by side, and applied in the order it was listed: the report does not depend on which read came first
    const contents = new Map<CodeEntry, Uint8Array | undefined>()
    const bytes = await readAll(needed, (entry) => entry.files.read({ path: entry.file }))
    needed.forEach((entry, index) => contents.set(entry, bytes[index]))
    for (const entry of deferred) {
      if (alone(entry)) {
        files.set(entry.destination, { content: new Uint8Array(0), from: entry.owner })
        continue
      }
      const content = contents.get(entry)
      if (content === undefined) continue
      applyCode(entry, content)
    }
    deferred.length = 0
  }

  const readSections = async (files_: PackageFiles, filePath: string, owner: string): Promise<UvlSections | undefined> => {
    const content = await readPackageText({ files: files_, path: filePath })
    if (content === undefined) return undefined
    return sectionsOf(content, filePath, owner)
  }

  const sectionsOf = (content: string, filePath: string, owner: string): UvlSections => {
    const parsed = parseUvlSections({ content })
    constraintsOf.push({ owner, file: filePath, sections: parsed })
    for (const name of featureNamesOfSections({ features: parsed.features })) {
      const other = featureOwner.get(name)
      if (other !== undefined && other !== owner) {
        diagnostics.push({ severity: 'error', package: owner, file: filePath, message: `The feature "${name}" is also declared by ${other}.` })
      } else featureOwner.set(name, owner)
    }
    return parsed
  }

  // `extra.js` and `transformation.js` of a module can be a code insertion point too (`extra.cipmain.js` filled by `extra.cip.js` of others)
  const rootJs = { extra: [] as { text: string, main: boolean }[], transformation: [] as { text: string, main: boolean }[] }
  const rootFragments = { extra: [] as string[], transformation: [] as string[] }

  const addModule = async (module: ResolvedModule): Promise<void> => {
    const owner = module.location
    const model = await readSections(module.files, '.linea/model.uvl', owner)
    if (model !== undefined) sections.push(model)
    const moduleConfig = await readPackageText({ files: module.files, path: '.linea/config/config.json' })
    if (moduleConfig !== undefined) mergeConfig(parseConfig(moduleConfig, owner, '.linea/config/config.json', diagnostics), owner, false)
    for (const name of ['extra', 'transformation'] as const) {
      const plain = await readPackageText({ files: module.files, path: `.linea/config/${name}.js` })
      const main = plain === undefined ? await readPackageText({ files: module.files, path: `.linea/config/${name}.cipmain.js` }) : undefined
      const fragment = await readPackageText({ files: module.files, path: `.linea/config/${name}.cip.js` })
      if (plain !== undefined) rootJs[name].push({ text: plain, main: false })
      else if (main !== undefined) rootJs[name].push({ text: main, main: true })
      if (fragment !== undefined) rootFragments[name].push(fragment)
    }
    await addCode(module.files, MODULE_CODE_DIR, CODE_DIR, owner, false)
  }
  for (const module of resolved.modules) module.files.prefetch?.(MODULE_FILES)
  for (const module of resolved.modules) await addModule(module)
  const cipDelimiter = config.delimiters.find((delimiter) => delimiter.extension.includes('cip'))
  const cipDelimiters = { start: cipDelimiter?.start ?? CIP_DEFAULT_START, end: cipDelimiter?.end ?? CIP_DEFAULT_END }
  for (const name of ['extra', 'transformation'] as const) {
    const target = name === 'extra' ? extra : transformation
    for (const { text, main } of rootJs[name]) {
      target.push(main ? spliceCip({ main: text, fragments: rootFragments[name], ...cipDelimiters }) : text)
    }
  }

  const own: UvlSections | undefined = ownFeatureModel === undefined ? undefined : sectionsOf(ownFeatureModel, 'models/featuremodel', 'spl')
  if (spl !== undefined) {
    const ownConfig = await readPackageText({ files: spl, path: PLATFORM_PATHS.config })
    if (ownConfig !== undefined) mergeConfig(parseConfig(ownConfig, 'spl', PLATFORM_PATHS.config, diagnostics), 'spl', true)
    const ownExtra = await readPackageText({ files: spl, path: PLATFORM_PATHS.extraJs })
    if (ownExtra !== undefined) extra.push(ownExtra)
    const ownTransformation = await readPackageText({ files: spl, path: PLATFORM_PATHS.transformation })
    if (ownTransformation !== undefined) transformation.push(ownTransformation)
    await addCode(spl, PLATFORM_PATHS.code, CODE_DIR, 'spl', true)
  }
  await settleCode()

  const encoder = new TextEncoder()
  for (const [main, { content, from }] of cipMains) {
    const key = cipFragmentPath({ main })
    const spliced = spliceCip({
      main: decoder.decode(content),
      fragments: (cipFragments.get(key) ?? []).map((fragment) => fragment.content),
      ...cipDelimiters
    })
    // an empty result is no file, as for any other template
    if (spliced.trim() === '') continue
    const destination = cipTarget({ file: main })
    const existing = files.get(destination)
    if (existing !== undefined) {
      diagnostics.push({
        severity: 'error',
        package: from,
        file: destination.slice(CODE_DIR.length + 1),
        message: `${destination.slice(CODE_DIR.length + 1)} is made from a code insertion point, and also provided by ${existing.from}.`
      })
      continue
    }
    files.set(destination, { content: encoder.encode(spliced), from })
  }

  // a constraint can tie features of different packages together, but every feature it names has to be declared by one of them
  for (const { owner, file, sections: declared } of constraintsOf) {
    for (const { text } of declared.constraints) {
      for (const name of featuresOfConstraint({ text })) {
        if (!featureOwner.has(name)) {
          diagnostics.push({ severity: 'error', package: owner, file, message: `The constraint "${text}" names the feature "${name}", which no module or the SPL declares.` })
        }
      }
    }
  }

  const root = own ?? { preamble: [], features: [{ level: 1, text: rootFeatureName({ name: resolved.spl.name }) }], constraints: [] }
  let featureModel: string
  try {
    featureModel = graftModules({ spl: root, modules: sections })
  } catch (error) {
    diagnostics.push({ severity: 'error', package: 'spl', file: PLATFORM_PATHS.model, message: (error as Error).message })
    featureModel = ''
  }

  return {
    featureModel,
    config,
    extraJs: extra.join('\n\n'),
    transformation: transformation.join('\n\n'),
    files,
    diagnostics
  }
}

/** Writes a platform plan under `lineDir` as an ordinary line (`src/platform/...`), so the usual derivation runs on it. */
export const writePlatform = ({ plan, lineDir }: { plan: PlatformPlan, lineDir: string }): { lineDir: string } => {
  const root = ensureDir({ dirPath: lineDir })
  const write = (relative: string, content: string | Uint8Array): void => {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  write(PLATFORM_PATHS.model, plan.featureModel)
  write(PLATFORM_PATHS.config, JSON.stringify(plan.config, null, 2) + '\n')
  write(PLATFORM_PATHS.extraJs, plan.extraJs + '\n')
  write(PLATFORM_PATHS.transformation, plan.transformation + '\n')
  fs.mkdirSync(path.join(root, PLATFORM_PATHS.code), { recursive: true })
  for (const [relative, { content }] of plan.files) write(relative, content)
  return { lineDir: root }
}
