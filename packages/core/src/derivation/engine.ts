import fs from 'node:fs'
import { DerivationEngine, type DerivationEngineConfig } from 'spl-js-engine'
import { PLATFORM_PATHS } from '../constants.js'
import { FeatureModelEmptyError, FeatureSelectionInvalidError, LinePlatformNotFoundError, TemplateError } from '../errors.js'
import { describeSelectionFailure, isFeatureSelectionError } from './selection-error.js'
import { fileExists, readTextFile, resolveLinePaths } from '../fs/workspace.js'

/** The feature model the derivation engine reads: the one composed from the SPL's feature model and its modules' (UVL). */
const resolveEngineModel = (lineDir: string): string => {
  const paths = resolveLinePaths({ lineDir })
  if (!fileExists({ filePath: paths.model })) {
    throw new LinePlatformNotFoundError(`No feature model in "${lineDir}": expected "${PLATFORM_PATHS.model}".`)
  }
  return paths.model
}

interface DerivationEngineHandle {
  generateProduct: (outputDir: string, spec: unknown) => Promise<unknown>
  generateZip: (spec: unknown) => Promise<unknown>
}

export const createEngine = async (lineDir: string): Promise<DerivationEngineHandle> => {
  const paths = resolveLinePaths({ lineDir })
  const featureModel = resolveEngineModel(lineDir)

  if (!fs.existsSync(paths.code)) {
    throw new LinePlatformNotFoundError(
      `No annotated code in "${lineDir}": expected "${PLATFORM_PATHS.code}".`
    )
  }

  const config = JSON.parse(readTextFile({ filePath: paths.config })) as DerivationEngineConfig
  const extraJs = readTextFile({ filePath: paths.extraJs })
  const transformation = readTextFile({ filePath: paths.transformation })

  const engine = await new DerivationEngine(
    paths.code, featureModel, config, extraJs, transformation
  )
  namingFailedTemplates(engine as unknown as EngineWithInput)
  return engine as unknown as DerivationEngineHandle
}

type CodeFileCallback = (filePath: string, ...rest: unknown[]) => unknown
export interface EngineWithInput { input?: { forEachCodeFile?: (cb: CodeFileCallback) => unknown } }

const named = new WeakSet<Error>()

export const namingFailedTemplates = (engine: EngineWithInput): void => {
  const input = engine.input
  const forEach = input?.forEachCodeFile
  if (!input || typeof forEach !== 'function') return
  input.forEachCodeFile = (cb) => forEach.call(input, (filePath: string, ...rest: unknown[]) => {
    try {
      return cb(filePath, ...rest)
    } catch (error) {
      if (error instanceof Error && !named.has(error)) {
        named.add(error)
        error.message = `${error.message} (${String(filePath).split('\\').join('/')})`
      }
      throw error
    }
  })
}

const ROOT_WITHOUT_FEATURES = 'abstract feature cannot be leaf'

/** `setup`: building the engine from the platform files; `generate`: running the templates for a product. */
export type DerivationStage = 'setup' | 'generate'

export const rethrowDerivationError = (error: unknown, stage: DerivationStage = 'setup'): never => {
  if (error === ROOT_WITHOUT_FEATURES) {
    throw new FeatureModelEmptyError('error_messages.feature_model_empty', { cause: error })
  }
  if (isFeatureSelectionError(error)) {
    throw new FeatureSelectionInvalidError(describeSelectionFailure(error).message, { cause: error })
  }
  if (error instanceof LinePlatformNotFoundError) throw error
  if (error instanceof ReferenceError) {
    throw new LinePlatformNotFoundError('error_messages.missing_function_error', { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  // anything else that came out of the templates while generating (a TypeError on a missing section, a bad
  // expression...): the platform exists, so it is not "platform not found" -- report the template failure it is
  if (stage === 'generate') throw new TemplateError(message, { cause: error })
  throw new LinePlatformNotFoundError(message, { cause: error })
}
