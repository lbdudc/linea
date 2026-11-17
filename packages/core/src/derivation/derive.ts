import type { ProductSpec as EngineProductSpec } from 'spl-js-engine'
import { InvalidArgumentError } from '../errors.js'
import { ensureDir } from '../fs/workspace.js'
import { buildEngineSpec } from '../product/engine-spec.js'
import type { ProductSpec } from '../product/spec.js'
import { createEngine, rethrowDerivationError, type DerivationStage } from './engine.js'

const toEngineSpec = (spec: ProductSpec): EngineProductSpec =>
  buildEngineSpec({ spec }) as unknown as EngineProductSpec

const assertLineDir = (lineDir: unknown): string => {
  if (typeof lineDir !== 'string' || lineDir.trim() === '') {
    throw new InvalidArgumentError('"lineDir" must be a non-empty path.')
  }
  return lineDir
}

const assertSpec = (spec: unknown): ProductSpec => {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new InvalidArgumentError('"spec" must be an object.')
  }
  return spec as ProductSpec
}

export const deriveProduct = async ({
  lineDir,
  spec,
  outputDir
}: {
  lineDir: string
  spec: ProductSpec
  outputDir: string
}): Promise<{ outputDir: string }> => {
  assertLineDir(lineDir)
  const checkedSpec = assertSpec(spec)
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new InvalidArgumentError('"outputDir" must be a non-empty path.')
  }

  const target = ensureDir({ dirPath: outputDir })

  let stage: DerivationStage = 'setup'
  try {
    const engine = await createEngine(lineDir)
    stage = 'generate'
    await engine.generateProduct(target, toEngineSpec(checkedSpec))
  } catch (error) {
    rethrowDerivationError(error, stage)
  }

  return { outputDir: target }
}

interface EngineZip {
  files: Record<string, { name: string, dir: boolean }>
  generateAsync: (options: { type: 'nodebuffer' }) => Promise<Buffer>
}

const withPortableNames = (archive: EngineZip): EngineZip => {
  for (const name of Object.keys(archive.files)) {
    if (!name.includes('\\')) continue
    const portable = name.replace(/\\/g, '/')
    const entry = archive.files[name]
    delete archive.files[name]
    if (entry === undefined || (entry.dir && portable in archive.files)) continue
    entry.name = portable
    archive.files[portable] = entry
  }
  return archive
}

export const deriveProductToZip = async ({
  lineDir,
  spec
}: {
  lineDir: string
  spec: ProductSpec
}): Promise<Buffer> => {
  assertLineDir(lineDir)
  const checkedSpec = assertSpec(spec)

  let stage: DerivationStage = 'setup'
  try {
    const engine = await createEngine(lineDir)
    stage = 'generate'
    const zip = await engine.generateZip(toEngineSpec(checkedSpec))
    return await withPortableNames(zip as EngineZip).generateAsync({ type: 'nodebuffer' })
  } catch (error) {
    return rethrowDerivationError(error, stage)
  }
}
