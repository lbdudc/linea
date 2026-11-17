
declare module '@lbdudc/flamapy.js/lib/type.js' {
  export const TYPE_SOLVING: {
    readonly BASIC: 'basic'
    readonly PYSAT: 'pysat'
    readonly PYSATDIAGNOSIS: 'pysat_diagnosis'
    readonly BDD: 'bdd'
  }
}

declare module '@lbdudc/flamapy.js' {
  export type TypeSolving = 'basic' | 'pysat' | 'pysat_diagnosis' | 'bdd'

  export interface PyodideLike {
    FS: {
      mkdirTree: (path: string) => void
      mount: (fs: unknown, opts: { root: string }, mountpoint: string) => void
      filesystems: { NODEFS: unknown }
    }
    loadPackage: (names: string | string[]) => Promise<unknown>
    runPythonAsync: (code: string) => Promise<unknown>
  }
}

declare module '@lbdudc/flamapy.js/lib/python-utils.js' {
  import type { PyodideLike, TypeSolving } from '@lbdudc/flamapy.js'

  export function setupPyodide (): Promise<PyodideLike>
  export function pythonToJs (obj: unknown): unknown
  export function executeFlamapyOperation (
    pyodide: PyodideLike,
    operation: string,
    fileContent: string,
    args?: unknown[],
    kwarg?: Record<string, unknown>,
    type?: TypeSolving
  ): Promise<unknown>
}

declare module '@lbdudc/flamapy.js/lib/flamapy.js' {
  import type { PyodideLike, TypeSolving } from '@lbdudc/flamapy.js'

  export class Flamapy {
    constructor (filepathOrContent: string, options?: { DEBUG?: boolean })
    pyodide: PyodideLike | null
    initialize (): Promise<void>
    coreFeatures (): Promise<string[]>
    averageBranchingFactor (): Promise<number>
    maxDepth (): Promise<number>
    estimatedNumberOfConfigurations (): Promise<number>
    countLeafs (): Promise<number>
    leafFeatures (): Promise<string[]>
    atomicSets (): Promise<unknown[]>
    satisfiable (type?: TypeSolving): Promise<boolean>
    deadFeatures (type?: TypeSolving): Promise<string[]>
    falseOptionalFeatures (type?: TypeSolving): Promise<string[]>
  }
  export const TYPE_SOLVING: Record<string, string>
}
