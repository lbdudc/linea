import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ModuleCheckError } from '../../errors.js'
import { deriveProduct, deriveProductToZip } from '../../derivation/derive.js'
import type { ProductSpec } from '../../product/spec.js'
import type { MetamodelEngine } from '../metamodels/engine.js'
import { writePlatform } from '../spl/platform.js'
import type { Diagnostic, PackageFiles, ResolvedSpl } from '../types.js'
import { checkProduct } from './check.js'

interface Scratch {
  readonly lineDir: string
  readonly spec: ProductSpec
  readonly diagnostics: readonly Diagnostic[]
  readonly dispose: () => void
}

/** Which phase of deriving a modular product is running, in order. */
export type DerivationPhase = 'check' | 'platform' | 'derive'

/** Checks the product and composes the platform of its SPL in a scratch directory, ready to derive from. */
const prepareDerivation = async ({
  resolved,
  spl,
  spec,
  models,
  createEngine,
  onProgress
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  spec: ProductSpec
  models: Record<string, string>
  createEngine: () => MetamodelEngine
  onProgress?: (phase: DerivationPhase) => void | Promise<void>
}): Promise<Scratch> => {
  await onProgress?.('check')
  const report = await checkProduct({ resolved, spl, models, createEngine, loadCode: true })
  if (!report.ok) {
    const errors = report.diagnostics.filter(({ severity }) => severity === 'error')
    throw new ModuleCheckError(
      `The product does not fit its SPL:\n- ${errors.map(({ package: from, file, message }) => `${from}${file === undefined ? '' : ` ${file}`}: ${message}`).join('\n- ')}`,
      report.diagnostics
    )
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-spl-'))
  const dispose = (): void => { fs.rmSync(scratch, { recursive: true, force: true }) }
  try {
    await onProgress?.('platform')
    const { lineDir } = writePlatform({ plan: report.configuration.plan, lineDir: scratch })
    // the features of the product are its feature selection's: the feature metamodel works out what the feature model implies
    const features = (report.models as { features?: string[] } | undefined)?.features
    return { lineDir, spec: { ...spec, ...(features === undefined ? {} : { features }), models: report.models, modelsByMetamodel: report.modelsByMetamodel }, diagnostics: report.diagnostics, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

/**
 * Derives a product of a modular SPL: the platform is composed from the modules in a scratch directory, the product's models are checked
 * and merged, and the usual derivation runs with them as `spec.models` (what the transformations of the modules read).
 * Throws `ModuleCheckError` (with the diagnostics) when the product does not fit its SPL.
 */
export const deriveModularProduct = async ({
  resolved,
  spl,
  spec,
  models,
  createEngine,
  outputDir,
  onProgress
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  spec: ProductSpec
  models: Record<string, string>
  createEngine: () => MetamodelEngine
  outputDir: string
  onProgress?: (phase: DerivationPhase) => void | Promise<void>
}): Promise<{ outputDir: string, diagnostics: readonly Diagnostic[] }> => {
  const prepared = await prepareDerivation({ resolved, spl, spec, models, createEngine, onProgress })
  try {
    await onProgress?.('derive')
    const result = await deriveProduct({ lineDir: prepared.lineDir, spec: prepared.spec, outputDir })
    return { outputDir: result.outputDir, diagnostics: prepared.diagnostics }
  } finally {
    prepared.dispose()
  }
}

/** Like `deriveModularProduct`, but the product comes back as a zip. */
export const deriveModularProductToZip = async ({
  resolved,
  spl,
  spec,
  models,
  createEngine
}: {
  resolved: ResolvedSpl
  spl?: PackageFiles
  spec: ProductSpec
  models: Record<string, string>
  createEngine: () => MetamodelEngine
}): Promise<Buffer> => {
  const prepared = await prepareDerivation({ resolved, spl, spec, models, createEngine })
  try {
    return await deriveProductToZip({ lineDir: prepared.lineDir, spec: prepared.spec })
  } finally {
    prepared.dispose()
  }
}
