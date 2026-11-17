import fs from 'node:fs'
import path from 'node:path'
import { NAME_PATTERN } from '../constants.js'
import { LineaCoreError, ModuleCheckError, InvalidArgumentError } from '../errors.js'
import { writeTextFile } from '../fs/workspace.js'
import { type MetamodelInfo } from '../modules/metamodels/engine.js'
import { metamodelPath } from '../modules/metamodels/layout.js'
import { listOfferedModels, type OfferedModel } from '../modules/metamodels/offered.js'
import { LOCK_PATH, METAMODEL_MANIFEST_PATH, MODULE_MANIFEST_PATH, SPL_MANIFEST_PATH, parseLock, parseMetamodelManifest, parseModuleManifest, parseSplManifest, serializeLock, serializeSplManifest } from '../modules/packages/manifests.js'
import { createFsFiles, createFsPackageSource, createMemoryPackageSource, withOverlay } from '../modules/packages/source.js'
import { checkProduct } from '../modules/products/check.js'
import { deriveModularProduct, deriveModularProductToZip } from '../modules/products/derive.js'
import { seedProductModels } from '../modules/products/seed.js'
import { resolveSpl } from '../modules/resolution/resolve.js'
import { checkSpl } from '../modules/spl/check.js'
import { type PackageKind, type Diagnostic, type Lock, type PackageFiles, type PackageSource, type ResolvedSpl, type SplManifest } from '../modules/types.js'
import { type ProductSpec } from '../product/spec.js'
import { excludeFromGit } from './gitExclude.js'
import { createEngine, packageSourceOf } from './host.js'
import { createLocalLine, COMPOSED_MODEL_PATH, type LocalLine } from './local.js'
import { rootFeatureName } from '../modules/configuration/names.js'

/**
 * LOCAL mode of a line made of modules. A workspace holds `modules/<name>/` and `metamodels/<name>/` next to the lines; a package
 * is a folder with one version (the one its manifest declares), located as `file:modules/<name>`. A product keeps its models in
 * `<product>/models/<metamodel>.<extension>`.
 */


const DIRS: Record<PackageKind, string> = { module: 'modules', metamodel: 'metamodels' }
const MANIFESTS: Record<PackageKind, string> = { module: MODULE_MANIFEST_PATH, metamodel: METAMODEL_MANIFEST_PATH }

export interface LocalPackage {
  kind: PackageKind
  name: string
  version: string
  location: string
  dir: string
  description: string
}

export const locationOf = (kind: PackageKind, name: string): string => `file:${DIRS[kind]}/${name}`

/** A line made of modules: its `spl.json` says so (every line has one: the kind of SPL it is, and what it is made of). */
export function isModularLine(lineDir: string): boolean {
  try {
    return parseSplManifest({ content: fs.readFileSync(path.join(lineDir, SPL_MANIFEST_PATH), 'utf8') }).kind === 'modular'
  } catch {
    return false
  }
}

export function listLocalPackages(workdir: string): LocalPackage[] {
  const found: LocalPackage[] = []
  for (const kind of ['module', 'metamodel'] as const) {
    const root = path.join(workdir, DIRS[kind])
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = path.join(root, entry.name)
      try {
        const content = fs.readFileSync(path.join(dir, MANIFESTS[kind]), 'utf8')
        const manifest = kind === 'module' ? parseModuleManifest({ content }) : parseMetamodelManifest({ content })
        found.push({
          kind,
          name: entry.name,
          version: manifest.version,
          location: locationOf(kind, entry.name),
          dir,
          description: manifest.description ?? '',
        })
      } catch {
        // a folder that is not a (valid) package is not listed
      }
    }
  }
  return found
}

export function createLocalPackage(opts: { workdir: string; kind: PackageKind; name: string; description?: string }): LocalPackage {
  const { workdir, kind, name, description } = opts
  if (!NAME_PATTERN.test(name)) throw new InvalidArgumentError(`"${name}" is not a valid name: use letters, digits, "_", "-" and "." only.`)
  const dir = path.join(workdir, DIRS[kind], name)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new InvalidArgumentError(`"${dir}" already exists and is not empty.`)

  const manifest =
    kind === 'module'
      ? { name, version: '0.1.0', ...(description ? { description } : {}), requires: { modules: {}, metamodels: {} }, offers: {} }
      : { name, version: '0.1.0', ...(description ? { description } : {}), requires: {} }
  writeTextFile({ filePath: path.join(dir, MANIFESTS[kind]), content: `${JSON.stringify(manifest, null, 2)}\n` })
  if (kind === 'module') {
    writeTextFile({ filePath: path.join(dir, '.linea', 'model.uvl'), content: `features\n\t${rootFeatureName({ name, fallback: 'Root' })}\n` })
  } else {
    const rule = rootFeatureName({ name, fallback: 'Root' })
    writeTextFile({
      filePath: path.join(dir, metamodelPath({ kind: 'grammar', grammar: name })),
      content: [
        `grammar ${rule}`,
        '',
        `// ${description ?? `${rule}: describe what this metamodel models`}`,
        `entry ${rule}Model: '${name.toLowerCase()}' name=ID? (items+=Item)*;`,
        '',
        "Item: 'item' name=ID;",
        '',
        'terminal ID: /[_a-zA-Z][\\w_-]*/;',
        'hidden terminal WS: /\\s+/;',
        '',
      ].join('\n'),
    })
  }
  return { kind, name, version: '0.1.0', location: locationOf(kind, name), dir, description: description ?? '' }
}

export function createLocalModularLine(opts: { workdir: string; name: string }): LocalLine {
  return createLocalLine({ workdir: opts.workdir, name: opts.name, kind: 'modular' })
}

/**
 * The feature model the modules of a line compose, kept in the line folder so the plain (synchronous) product operations can validate
 * a feature selection against it. It is refreshed whenever the modules are set or checked; generating always composes anew.
 */
function cacheComposedModel(lineDir: string, featureModel: string): void {
  if (!featureModel) return
  writeTextFile({ filePath: path.join(lineDir, COMPOSED_MODEL_PATH), content: featureModel })
  // a cache of this machine, not part of the SPL: a clone of it must not send it with its changes
  excludeFromGit(lineDir, '.linea/composed-model.uvl')
}

function readSpl(lineDir: string): { spl: SplManifest; lock?: Lock } {
  const splPath = path.join(lineDir, SPL_MANIFEST_PATH)
  if (!fs.existsSync(splPath)) throw new InvalidArgumentError(`"${lineDir}" is not a line made of modules (no ${SPL_MANIFEST_PATH}).`)
  const spl = parseSplManifest({ content: fs.readFileSync(splPath, 'utf8') })
  const lockPath = path.join(lineDir, LOCK_PATH)
  let lock: Lock | undefined
  try {
    lock = fs.existsSync(lockPath) ? parseLock({ content: fs.readFileSync(lockPath, 'utf8') }) : undefined
  } catch {
    lock = undefined // a lock that cannot be read is made again
  }
  return { spl, lock }
}

export interface LocalContext {
  resolved: ResolvedSpl
  spl: SplManifest
  files: PackageFiles
}

/** The packages of a line, resolved against the workspace (and pinned by the line's lockfile where it still fits). */
async function resolveLocalContext(workdir: string, lineDir: string, modules?: Record<string, string>): Promise<LocalContext> {
  const { spl: saved, lock } = readSpl(lineDir)
  const spl: SplManifest = modules ? { ...saved, modules } : saved
  const resolved = await resolveSpl({ spl, source: packageSourceOf(createFsPackageSource({ root: workdir })), lock })
  return { resolved, spl, files: createFsFiles({ dir: lineDir }) }
}

export interface LocalModulesView {
  modules: Record<string, string>
  packages: { kind: PackageKind, name: string, version: string, location: string, requiredBy: readonly string[] }[]
  featureModelName: string
}

export async function getLocalLineModules(workdir: string, lineDir: string): Promise<LocalModulesView> {
  const { resolved, spl } = await resolveLocalContext(workdir, lineDir)
  return {
    modules: { ...spl.modules },
    packages: [...resolved.modules, ...resolved.metamodels].map((p) => ({
      kind: p.kind,
      name: p.manifest.name,
      version: p.version,
      location: p.location,
      requiredBy: p.requiredBy,
    })),
    featureModelName: spl.name,
  }
}

export async function checkLocalLine(workdir: string, lineDir: string, modules?: Record<string, string>): Promise<{ resolved: ResolvedSpl, report: Awaited<ReturnType<typeof checkSpl>> }> {
  const { resolved, files } = await resolveLocalContext(workdir, lineDir, modules)
  const report = await checkSpl({ resolved, spl: files, createEngine })
  if (!modules && report.featureModel) cacheComposedModel(lineDir, report.featureModel)
  return { resolved, report }
}

/** Sets the modules of a line: resolves and checks them, and writes `spl.json` and the lockfile. Throws `ModuleCheckError` when they do not fit. */
export async function setLocalLineModules(workdir: string, lineDir: string, modules: Record<string, string>): Promise<{ resolved: ResolvedSpl, report: Awaited<ReturnType<typeof checkSpl>> }> {
  const { resolved, report } = await checkLocalLine(workdir, lineDir, modules)
  if (!report.ok) throw new ModuleCheckError(`The modules do not fit together`, report.diagnostics)
  const { spl } = readSpl(lineDir)
  writeTextFile({ filePath: path.join(lineDir, SPL_MANIFEST_PATH), content: serializeSplManifest({ spl: { ...spl, modules } }) })
  writeTextFile({ filePath: path.join(lineDir, LOCK_PATH), content: serializeLock({ lock: resolved.lock }) })
  cacheComposedModel(lineDir, report.featureModel)
  return { resolved, report }
}

// ---------------------------------------------------------------- products

const MODELS_DIR = path.join('.linea', 'models')

export function readLocalProductModels(productDir: string): Record<string, string> {
  const dir = path.join(productDir, MODELS_DIR)
  const models: Record<string, string> = {}
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) models[entry.name.replace(/\.[^.]+$/, '')] = fs.readFileSync(path.join(dir, entry.name), 'utf8')
    }
  } catch {
    // no models yet
  }
  return models
}

export interface LocalProductModels {
  metamodels: readonly MetamodelInfo[]
  models: Record<string, string>
  offered: OfferedModel[]
  diagnostics: readonly Diagnostic[]
  ok: boolean
}

export async function checkLocalProductModels(workdir: string, lineDir: string, productDir: string): Promise<LocalProductModels> {
  const { resolved, files } = await resolveLocalContext(workdir, lineDir)
  const models = readLocalProductModels(productDir)
  const report = await checkProduct({ resolved, spl: files, models, createEngine })
  return {
    metamodels: report.metamodels,
    models,
    offered: await listOfferedModels({ resolved }),
    diagnostics: report.diagnostics,
    ok: report.ok,
  }
}

/** Writes the smallest valid model of each metamodel into a new product of a modular line (does nothing for a plain line). */
export async function seedLocalProductModels(workdir: string, lineDir: string, productDir: string): Promise<string[]> {
  const { resolved, files } = await resolveLocalContext(workdir, lineDir)
  const seeded = await seedProductModels({ resolved, spl: files, createEngine })
  const written: string[] = []
  for (const info of seeded.metamodels) {
    const file = path.join(productDir, MODELS_DIR, `${info.name}.${info.extension}`)
    writeTextFile({ filePath: file, content: seeded.models[info.name] ?? '' })
    written.push(path.relative(productDir, file))
  }
  return written
}

export async function deriveLocalModularProduct(workdir: string, lineDir: string, productDir: string, spec: ProductSpec, outputDir = productDir): ReturnType<typeof deriveModularProduct> {
  const { resolved, files } = await resolveLocalContext(workdir, lineDir)
  return deriveModularProduct({
    resolved,
    spl: files,
    spec,
    models: readLocalProductModels(productDir),
    createEngine,
    outputDir,
  })
}

export async function deriveLocalModularProductZip(workdir: string, lineDir: string, productDir: string, spec: ProductSpec): ReturnType<typeof deriveModularProductToZip> {
  const { resolved, files } = await resolveLocalContext(workdir, lineDir)
  return deriveModularProductToZip({
    resolved,
    spl: files,
    spec,
    models: readLocalProductModels(productDir),
    createEngine,
  })
}

// ---------------------------------------------------------------- one package

const CHECK_LOCATION = 'memory:check'

export interface LocalPackageCheck {
  ok: boolean
  diagnostics: readonly Diagnostic[]
  /** what it brings in with it, dependencies first */
  resolved: { modules: number, metamodels: number }
}

/**
 * Checks a package of the workspace on its own, as the registry does before it publishes it: what it needs is resolved, and everything
 * is composed. A metamodel is only ever used through a module, so it is checked through one made up for the purpose.
 */
export async function checkLocalPackage(workdir: string, kind: PackageKind, name: string): Promise<LocalPackageCheck> {
  const location = locationOf(kind, name)
  const pkg = listLocalPackages(workdir).find((p) => p.kind === kind && p.name === name)
  if (!pkg) throw new InvalidArgumentError(`No ${kind} "${name}" in ${path.join(workdir, DIRS[kind])}`)

  let source: PackageSource = packageSourceOf(createFsPackageSource({ root: workdir }))
  let spl: SplManifest = { name: 'check', version: '0.0.0', kind: 'modular', metamodels: {}, modules: { [location]: `^${pkg.version}` } }
  if (kind === 'metamodel') {
    const overlay = createMemoryPackageSource({
      packages: {
        [CHECK_LOCATION]: {
          '0.0.0': { '.linea/module.json': JSON.stringify({ name: 'check', version: '0.0.0', requires: { metamodels: { [location]: `^${pkg.version}` } } }) },
        },
      },
    })
    source = withOverlay({ base: source, overlay, locations: new Set([CHECK_LOCATION]) })
    spl = { name: 'check', version: '0.0.0', kind: 'modular', metamodels: {}, modules: { [CHECK_LOCATION]: '0.0.0' } }
  }
  try {
    const resolved = await resolveSpl({ spl, source })
    const report = await checkSpl({ resolved, createEngine, configuration: false })
    return { ok: report.ok, diagnostics: report.diagnostics, resolved: { modules: resolved.modules.length, metamodels: resolved.metamodels.length } }
  } catch (e) {
    if (e instanceof ModuleCheckError) return { ok: false, diagnostics: e.diagnostics, resolved: { modules: 0, metamodels: 0 } }
    if (!(e instanceof LineaCoreError)) throw e
    return { ok: false, diagnostics: [{ severity: 'error', package: location, message: e.message }], resolved: { modules: 0, metamodels: 0 } }
  }
}

export interface LockChange {
  location: string
  from?: string
  to?: string
}

/**
 * Takes the newest versions the ranges of an SPL allow, and pins them: the lockfile is made again (for one module and what it brought,
 * with `only`). Nothing is written when the result does not check out. Returns what changed.
 */
export async function updateLocalLineLock(workdir: string, lineDir: string, only?: string): Promise<{ changes: LockChange[]; resolved: ResolvedSpl }> {
  const { spl, lock } = readSpl(lineDir)
  let keep: Lock | undefined
  if (only && lock) {
    const matches = (location: string) => location === only || location === locationOf('module', only) || location.endsWith(`/${only}`) || location.endsWith(`:${only}`)
    if (!Object.keys(lock.packages).some(matches)) throw new InvalidArgumentError(`"${only}" is not in the lockfile of this SPL`)
    keep = { ...lock, packages: Object.fromEntries(Object.entries(lock.packages).filter(([location]) => !matches(location))) }
  }
  const resolved = await resolveSpl({ spl, source: packageSourceOf(createFsPackageSource({ root: workdir })), lock: keep })
  const report = await checkSpl({ resolved, spl: createFsFiles({ dir: lineDir }), createEngine })
  if (!report.ok) throw new ModuleCheckError('The newest versions do not fit together', report.diagnostics)

  const before = lock?.packages ?? {}
  const after = resolved.lock.packages
  const changes: LockChange[] = []
  for (const location of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const from = before[location]?.version
    const to = after[location]?.version
    if (from !== to) changes.push({ location, ...(from ? { from } : {}), ...(to ? { to } : {}) })
  }
  writeTextFile({ filePath: path.join(lineDir, LOCK_PATH), content: serializeLock({ lock: resolved.lock }) })
  cacheComposedModel(lineDir, report.featureModel)
  return { changes, resolved }
}
