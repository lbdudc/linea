import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadPyodide } from 'pyodide'
import { executeFlamapyOperation } from '@lbdudc/flamapy.js/lib/python-utils.js'
import type { PyodideLike } from '@lbdudc/flamapy.js'
import { resolveAsset } from '../assets.js'
import { AnalysisRuntimeError, InvalidArgumentError } from '../errors.js'

type SolvingType = 'basic' | 'pysat' | 'pysat_diagnosis' | 'bdd'

interface PyodideHandle {
  FS: unknown
  runPythonAsync: (code: string) => Promise<unknown>
  loadPackage: (names: string | string[], options?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }) => Promise<unknown>
}

declare const analysisRuntimeBrand: unique symbol

export interface AnalysisRuntime {
  readonly [analysisRuntimeBrand]: 'linea-core/AnalysisRuntime'
}

interface RuntimeState {
  pyodide: PyodideHandle
  queue: Promise<void>
  disposed: boolean
}

const toState = (runtime: AnalysisRuntime): RuntimeState =>
  runtime as unknown as RuntimeState

const toRuntime = (state: RuntimeState): AnalysisRuntime =>
  state as unknown as AnalysisRuntime

const vendoredWheelsDir = (): string => resolveAsset({ segments: ['analysis', 'wheels'] })

const REQUIRED_WHEELS = ['micropip-0.6.0-py3-none-any.whl', 'packaging-23.2-py3-none-any.whl']

const flamapyLibDir = (): string => {
  const require = createRequire(import.meta.url)
  return path.dirname(require.resolve('@lbdudc/flamapy.js/lib/python-utils.js'))
}

/** Pyodide's own chatter is not for the output of a program that uses this. */
const silent = (): void => { /* nothing */ }

const pyodideIndexDir = (): string => {
  const require = createRequire(import.meta.url)
  return path.dirname(require.resolve('pyodide/package.json'))
}

export interface AnalysisRuntimeOptions {
  wheelsDir?: string
}

export const createAnalysisRuntime = async ({
  wheelsDir = vendoredWheelsDir()
}: AnalysisRuntimeOptions = {}): Promise<AnalysisRuntime> => {
  if (typeof wheelsDir !== 'string' || wheelsDir.trim() === '') {
    throw new InvalidArgumentError('"wheelsDir" must be a non-empty path when provided.')
  }
  if (!fs.existsSync(wheelsDir)) {
    throw new AnalysisRuntimeError(
      `Vendored wheels directory not found: ${wheelsDir}. The package build must copy src/analysis/wheels/ into dist/.`
    )
  }
  const missing = REQUIRED_WHEELS.filter(
    (wheel) => !fs.existsSync(path.join(wheelsDir, wheel))
  )
  if (missing.length > 0) {
    throw new AnalysisRuntimeError(
      `Vendored wheels missing from ${wheelsDir}: ${missing.join(', ')}. ` +
      'Without them pyodide would silently download them from cdn.jsdelivr.net, breaking ADR-002.'
    )
  }

  const libDir = flamapyLibDir()
  let pyodide: PyodideHandle
  try {
    pyodide = await loadPyodide({
      indexURL: pyodideIndexDir(),
      packageCacheDir: wheelsDir,
      // what pyodide says while it loads packages is not for the output of a program that uses this (a CLI's --json)
      stdout: silent,
      stderr: silent
    })
    const vfs = pyodide.FS as {
      mkdirTree: (dir: string) => void
      mount: (fs: unknown, options: { root: string }, mountpoint: string) => void
      filesystems: { NODEFS: unknown }
    }
    vfs.mkdirTree('/mnt')
    vfs.mount(vfs.filesystems.NODEFS, { root: libDir }, '/mnt')
    await pyodide.loadPackage('micropip', { messageCallback: silent, errorCallback: silent })
    await pyodide.runPythonAsync(fs.readFileSync(path.join(libDir, 'py', 'packages.py'), 'utf8'))
    await pyodide.runPythonAsync('await install_packages()')
  } catch (error) {
    throw new AnalysisRuntimeError(
      `Could not start the feature model analysis runtime: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }

  const state: RuntimeState = { pyodide, queue: Promise.resolve(), disposed: false }

  const CANARY_UVL = 'features\n    Root\n        mandatory\n            A\n            B\n'
  let canary: unknown
  try {
    canary = await runOperation(state, 'core_features', CANARY_UVL, 'basic')
  } catch (error) {
    throw new AnalysisRuntimeError(
      `The analysis runtime started but its canary operation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
  if (!Array.isArray(canary) || canary.length === 0) {
    throw new AnalysisRuntimeError(
      'The analysis runtime started but returned no result for its canary operation. ' +
      'This is the signature of a Pyodide bootstrap that failed silently — most likely the ' +
      'vendored micropip/packaging wheels are missing, so flamapy never installed (ADR-021).'
    )
  }

  return toRuntime(state)
}

export const disposeAnalysisRuntime = ({ runtime }: { runtime: AnalysisRuntime }): void => {
  if (runtime === null || typeof runtime !== 'object') {
    throw new InvalidArgumentError('"runtime" must be a value returned by createAnalysisRuntime().')
  }
  const state = toState(runtime)
  state.disposed = true
}

const toJs = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const proxy = value as { toJs?: (options: { dicts: boolean }) => unknown, destroy?: () => void }
  if (typeof proxy.toJs !== 'function') return value
  const converted = proxy.toJs({ dicts: true })
  proxy.destroy?.()
  return converted
}

export const runOperation = async (
  state: RuntimeState,
  operation: string,
  uvl: string,
  type: SolvingType
): Promise<unknown> => {
  if (state.disposed) {
    throw new AnalysisRuntimeError('This analysis runtime has already been disposed.')
  }
  const run = state.queue.then(async () =>
    toJs(await executeFlamapyOperation(
      state.pyodide as unknown as PyodideLike,
      operation,
      uvl,
      [],
      {},
      type
    ))
  )
  state.queue = run.then(() => undefined, () => undefined)
  return await run
}

export const useRuntime = (runtime: AnalysisRuntime): RuntimeState => {
  if (runtime === null || typeof runtime !== 'object') {
    throw new InvalidArgumentError('"runtime" must be a value returned by createAnalysisRuntime().')
  }
  const state = toState(runtime)
  if (state.disposed) {
    throw new AnalysisRuntimeError('This analysis runtime has already been disposed.')
  }
  return state
}
