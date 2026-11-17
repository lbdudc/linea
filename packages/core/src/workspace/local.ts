import fs from 'node:fs'
import path from 'node:path'
import { readOrigin } from './origin.js'
import { rootFeatureName } from '../modules/configuration/names.js'
import { analyzeFeatureModel, analyzeFeatureModelBdd, analyzeMetric, type AnalysisMode, type AnalysisMetric, type FeatureModelAnalysis, type FeatureModelBddAnalysis, type MetricAnalysis } from '../analysis/analyze.js'
import { createAnalysisRuntime, disposeAnalysisRuntime } from '../analysis/runtime.js'
import { readTextFile, writeTextFile, resolveLinePaths } from '../fs/workspace.js'
import { writeLineScaffold } from '../line/scaffold.js'
import { serializeLock, LOCK_PATH, SPL_MANIFEST_PATH, parseSplManifest } from '../modules/packages/manifests.js'
import { type SplKind } from '../modules/types.js'
import { validateProductSpec, assertProductSpec, normalizeProductSpec, type ProductSpec } from '../product/spec.js'
import { incrementVersion } from '../product/version.js'
import { readProductsIndex, writeProductsIndex, addProductToIndex, removeProductFromIndex, renameProductInIndex, emptyProductsIndex, type ProductsIndexEntry } from '../products-index/products-index.js'
import { InvalidArgumentError, InvalidProductSpecError } from '../errors.js'

export interface LocalLine {
  name: string
  dir: string
}

export const COMPOSED_MODEL_PATH = path.join('.linea', 'composed-model.uvl')

/** Every line has an `spl.json` (the kind of SPL it is, and what it is made of). */
export function hasSplManifest(lineDir: string): boolean {
  return fs.existsSync(path.join(lineDir, SPL_MANIFEST_PATH))
}

/** What kind of SPL a line is: plain, project (metamodels of the user's choice) or modular (made of modules). */
export function localLineKind(lineDir: string): SplKind {
  return parseSplManifest({ content: fs.readFileSync(path.join(lineDir, SPL_MANIFEST_PATH), 'utf8') }).kind
}

/**
 * The feature model of a line as UVL, the one its products choose from: the line's own with the ones of its modules grafted in. It is made by
 * the feature metamodel (bango) when the line is checked, and kept in `.linea/composed-model.uvl`; checking the line, setting its modules and saving the feature
 * model refresh it.
 */
function readLineFeatureModel(lineDir: string): { path: string; content: string } {
  const composed = path.join(lineDir, COMPOSED_MODEL_PATH)
  if (!fs.existsSync(composed)) throw new InvalidArgumentError(`"${lineDir}" has no composed feature model yet: check the line first.`)
  return { path: composed, content: fs.readFileSync(composed, 'utf8') }
}

export function isLocalLineDir(dir: string): boolean {
  try {
    return hasSplManifest(dir) || fs.statSync(resolveLinePaths({ lineDir: dir }).platform).isDirectory()
  } catch {
    return false
  }
}

export function listLocalLines(workdir: string): LocalLine[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(workdir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: path.join(workdir, e.name) }))
    .filter((l) => isLocalLineDir(l.dir))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function resolveLocalLine(workdir: string, target: string): LocalLine {
  const asPath = path.resolve(target)
  if (isLocalLineDir(asPath)) return { name: path.basename(asPath), dir: asPath }

  const all = listLocalLines(workdir)
  const match = all.find((l) => l.name.toLowerCase() === target.toLowerCase())
  if (match) return match
  throw new InvalidArgumentError(
    `No local line named "${target}" in ${workdir}.`,
  )
}

/**
 * A new line of any kind: its `spl.json`, its feature model (a model of the feature metamodel), and, unless it is modular, the platform its
 * products are derived with. The workspace has the feature metamodel as `metamodels/featuremodel`. The lockfile is made when the line is
 * first checked.
 */
export function createLocalLine(opts: { workdir: string; name: string; kind?: SplKind; metamodels?: Record<string, string>; modules?: Record<string, string> }): LocalLine {
  const dir = path.join(opts.workdir, opts.name)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new InvalidArgumentError(`"${dir}" already exists and is not empty — pick another name.`)
  }
  const { dir: written } = writeLineScaffold({
    dir,
    name: opts.name,
    kind: opts.kind ?? 'plain',
    ...(opts.metamodels ? { metamodels: opts.metamodels } : {}),
    ...(opts.modules ? { modules: opts.modules } : {}),
    featureMetamodel: 'file:metamodels/featuremodel',
  })
  writeTextFile({ filePath: path.join(written, LOCK_PATH), content: serializeLock({ lock: { lockVersion: 1, packages: {} } }) })
  writeProductsIndex({ lineDir: written, index: emptyProductsIndex() })
  // until the line is checked, the feature model is its root alone
  writeTextFile({ filePath: path.join(written, COMPOSED_MODEL_PATH), content: `features\n\t${rootFeatureName({ name: opts.name })}\n` })
  return { name: opts.name, dir: written }
}

export function deleteLocalLine(lineDir: string): void {
  if (!isLocalLineDir(lineDir)) {
    throw new InvalidArgumentError(
      `"${lineDir}" doesn't look like a local SPL (no src/platform found there) — refusing to delete it. ` +
        'If this came from an active SPL, it may be a stale id from a different mode.',
    )
  }
  fs.rmSync(lineDir, { recursive: true, force: true })
}

export function localProductDir(lineDir: string, name: string): string {
  return path.join(lineDir, name)
}

/**
 * The products of an SPL: the ones its index lists, and the ones that are there as folders with a spec (a product cloned from LINEA is
 * a folder of its own inside the SPL's, and the SPL's index does not know of it).
 */
export function listLocalProducts(lineDir: string): ProductsIndexEntry[] {
  const listed = readProductsIndex({ lineDir }).productos
  const found: ProductsIndexEntry[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(lineDir, { withFileTypes: true })
  } catch {
    /* no folder, no products */
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || listed.some((p) => p.name === e.name)) continue
    try {
      const spec = readLocalProductSpec(path.join(lineDir, e.name))
      found.push({ name: e.name, repositorio: '', ...(spec.basicData?.version ? { version: spec.basicData.version } : {}) })
    } catch {
      // no spec: a product LINEA has not generated yet is still one, if that is where the folder came from
      if (readOrigin(path.join(lineDir, e.name))?.kind === 'product') found.push({ name: e.name, repositorio: '' })
    }
  }
  return [...listed, ...found.sort((a, b) => a.name.localeCompare(b.name))]
}

const SPEC_REL_PATH = path.join('.linea', 'spec.json')

export function readLocalProductSpec(productDir: string): ProductSpec {
  const specPath = path.join(productDir, SPEC_REL_PATH)
  let raw: string
  try {
    raw = readTextFile({ filePath: specPath })
  } catch {
    throw new InvalidArgumentError(`No spec found at ${specPath}.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new InvalidArgumentError(`${specPath} is not valid JSON: ${(e as Error).message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !('spec' in parsed)) {
    throw new InvalidArgumentError(`${specPath} is missing a "spec" object (corrupt or wrong format).`)
  }
  return (parsed as { spec: ProductSpec }).spec
}

export function writeLocalProductSpec(productDir: string, spec: ProductSpec): void {
  const specPath = path.join(productDir, SPEC_REL_PATH)
  writeTextFile({ filePath: specPath, content: `${JSON.stringify({ spec }, null, 2)}\n` })
}

export function createLocalProduct(opts: { lineDir: string; spec: unknown }): {
  name: string
  dir: string
  spec: ProductSpec
} {
  const validation = validateProductSpec({ spec: opts.spec })
  if (!validation.valid) {
    const detail = validation.errors.map((e) => `  • ${e.path}: ${e.messageKey}`).join('\n')
    throw new InvalidProductSpecError(`Invalid product spec:\n${detail}`)
  }
  const normalized = normalizeProductSpec({ spec: opts.spec as ProductSpec })
  const name = normalized.basicData!.name!

  const dir = localProductDir(opts.lineDir, name)
  if (fs.existsSync(dir)) {
    throw new InvalidArgumentError(`A local product named "${name}" already exists at ${dir}.`)
  }

  writeLocalProductSpec(dir, normalized)
  const index = addProductToIndex({
    index: readProductsIndex({ lineDir: opts.lineDir }),
    product: { name, repositorio: name, version: normalized.basicData!.version },
  })
  writeProductsIndex({ lineDir: opts.lineDir, index })

  return { name, dir, spec: normalized }
}

export function bumpLocalProductVersion(lineDir: string, name: string, version: string): void {
  const index = readProductsIndex({ lineDir })
  const exists = index.productos.some((e) => e.name === name)
  const next = exists
    ? { productos: index.productos.map((e) => (e.name === name ? { ...e, version } : e)) }
    : addProductToIndex({ index, product: { name, repositorio: name, version } })
  writeProductsIndex({ lineDir, index: next })
}

export function readLocalModelAsUvl(lineDir: string): string {
  return readLineFeatureModel(lineDir).content
}

export async function analyzeLocalFeatureModelBdd(lineDir: string): Promise<FeatureModelBddAnalysis> {
  const uvl = readLocalModelAsUvl(lineDir)
  const runtime = await createAnalysisRuntime()
  try {
    return await analyzeFeatureModelBdd({ uvl, runtime })
  } finally {
    disposeAnalysisRuntime({ runtime })
  }
}

export async function analyzeLocalMetric(
  lineDir: string,
  metric: AnalysisMetric,
  mode: AnalysisMode,
): Promise<MetricAnalysis> {
  const uvl = readLocalModelAsUvl(lineDir)
  const runtime = await createAnalysisRuntime()
  try {
    return await analyzeMetric({ uvl, metric, mode, runtime })
  } finally {
    disposeAnalysisRuntime({ runtime })
  }
}

export async function analyzeLocalFeatureModel(
  lineDir: string,
  mode: AnalysisMode,
): Promise<FeatureModelAnalysis> {
  const uvl = readLocalModelAsUvl(lineDir)
  const runtime = await createAnalysisRuntime()
  try {
    return await analyzeFeatureModel({ uvl, mode, runtime })
  } finally {
    disposeAnalysisRuntime({ runtime })
  }
}

export async function deriveLocalProductPreview(opts: {
  lineDir: string
  spec: ProductSpec
  outputDir: string
}): Promise<{ outputDir: string }> {
  const productDir = localProductDir(opts.lineDir, (opts.spec.basicData?.name ?? ''))
  return (await import('./modular.js')).deriveLocalModularProduct(path.dirname(opts.lineDir), opts.lineDir, productDir, opts.spec, opts.outputDir)
}

export async function generateLocalProduct(
  lineDir: string,
  name: string,
): Promise<{ outputDir: string; version: string }> {
  const dir = localProductDir(lineDir, name)
  const spec = readLocalProductSpec(dir)
  const version = incrementVersion({ version: spec.basicData!.version!, index: 2 })
  const nextSpec: ProductSpec = { ...spec, basicData: { ...spec.basicData, version } }
  const { outputDir } = await (await import('./modular.js')).deriveLocalModularProduct(path.dirname(lineDir), lineDir, dir, nextSpec)
  writeLocalProductSpec(dir, nextSpec)
  bumpLocalProductVersion(lineDir, name, version)
  return { outputDir, version }
}

export function updateLocalProduct(opts: { lineDir: string; name: string; spec: unknown }): {
  spec: ProductSpec
} {
  const dir = localProductDir(opts.lineDir, opts.name)
  readLocalProductSpec(dir)

  const checked = assertProductSpec({ spec: opts.spec as ProductSpec })
  const normalized = normalizeProductSpec({ spec: checked })
  const submittedName = normalized.basicData!.name!
  if (submittedName !== opts.name) {
    throw new InvalidArgumentError(
      `/update can't rename a local product ("${submittedName}" != "${opts.name}") — use /rename for that. ` +
        `Keep spec.basicData.name as "${opts.name}" here.`,
    )
  }

  const version = incrementVersion({ version: normalized.basicData!.version!, index: 1 })
  const nextSpec: ProductSpec = { ...normalized, basicData: { ...normalized.basicData, version } }
  writeLocalProductSpec(dir, nextSpec)
  bumpLocalProductVersion(opts.lineDir, opts.name, version)
  return { spec: nextSpec }
}

export function deleteLocalProduct(lineDir: string, name: string): void {
  const dir = localProductDir(lineDir, name)
  if (!fs.existsSync(dir)) {
    throw new InvalidArgumentError(`No local product named "${name}" at ${dir}.`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
  const index = removeProductFromIndex({ index: readProductsIndex({ lineDir }), name })
  writeProductsIndex({ lineDir, index })
}

export function renameLocalProduct(lineDir: string, from: string, to: string): { dir: string } {
  const fromDir = localProductDir(lineDir, from)
  const toDir = localProductDir(lineDir, to)
  if (!fs.existsSync(fromDir)) {
    throw new InvalidArgumentError(`No local product named "${from}" at ${fromDir}.`)
  }
  if (fs.existsSync(toDir)) {
    throw new InvalidArgumentError(`A local product named "${to}" already exists at ${toDir}.`)
  }
  const renamed = renameProductInIndex({ index: readProductsIndex({ lineDir }), from, to })
  const nextIndex = {
    productos: renamed.productos.map((e) => (e.name === to ? { ...e, repositorio: to } : e)),
  }

  fs.renameSync(fromDir, toDir)
  const spec = readLocalProductSpec(toDir)
  writeLocalProductSpec(toDir, { ...spec, basicData: { ...spec.basicData, name: to } })
  writeProductsIndex({ lineDir, index: nextIndex })

  return { dir: toDir }
}

/** Whether a product's models are valid for its line: its feature selection against the line's feature model, and the rest of its models. */
export async function healthLocalProduct(
  lineDir: string,
  name: string,
): Promise<{ valid: boolean; error: string | null; errorType: string | null }> {
  const { checkLocalProductModels } = await import('./modular.js')
  const report = await checkLocalProductModels(path.dirname(lineDir), lineDir, localProductDir(lineDir, name))
  const first = report.diagnostics.find((d) => d.severity === 'error')
  return { valid: report.ok, error: first ? `${first.file ?? first.package}: ${first.message}` : null, errorType: first ? 'models' : null }
}

export async function deriveLocalProductZip(lineDir: string, spec: ProductSpec): Promise<Buffer> {
  const name = (spec.basicData?.name ?? '')
  return (await import('./modular.js')).deriveLocalModularProductZip(path.dirname(lineDir), lineDir, localProductDir(lineDir, name), spec)
}

export { incrementVersion }
