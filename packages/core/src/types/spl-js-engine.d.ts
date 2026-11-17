
declare module 'spl-js-engine' {
  export interface Feature {
    name: string
    type: string
    features: Feature[]
  }

  export class FeatureModel {
    constructor (name: string)
    name: string
    featureList: Feature[]
    get (featureName: string): Feature
    exists (featureName: string): boolean
    toString (): string
    validateFeatureModel (): void
    completeFeatureSelection (namesOfSelectedFeatures: string[]): string[]
    toXml (): string
    toUVL (): string
    toJson (): unknown
    static fromXml (xml: string): FeatureModel
    static fromUVL (uvl: string, components?: unknown): FeatureModel
    static fromJson (json: unknown): FeatureModel
  }

  export interface ProductSpec {
    features?: string[]
    data?: Record<string, unknown>
    [key: string]: unknown
  }

  export interface DerivationEngineDelimiter {
    extension: string[]
    start: string
    end: string
  }

  export interface DerivationEngineConfig {
    ignore?: string[]
    delimiters?: DerivationEngineDelimiter[]
  }

  export interface DerivationEngineInstance {
    generateProduct (outputPath: string, product?: ProductSpec): Promise<void>
    generateZip (product?: ProductSpec, opts?: { verbose?: boolean }): Promise<unknown>
    analyseAnnotations (): unknown
    featureModel: FeatureModel
  }

  export type DerivationEngineConstructor = new (
    codePath: string,
    featureModel: string,
    config: DerivationEngineConfig,
    extraJS?: string,
    modelTransformation?: string,
    verbose?: boolean
  ) => Promise<DerivationEngineInstance>

  export const DerivationEngine: DerivationEngineConstructor

  /**
   * Splices the code of the `fragments` (`*.cip.*` files) into the markers of `main` (a `*.cipmain.*` file). The delimiters are
   * the engine's default ones when omitted.
   */
  export function spliceCip (options: { main: string, fragments: readonly string[], start?: string, end?: string }): string

  export function readFile (path: string): string
  export function readJsonFromFile (path: string): unknown
}

declare module 'spl-js-engine/src/feature-model/feature-selection-error.js' {
  export default class FeatureSelectionError {
    constructor (message: string, featureSelection?: string[], previousException?: unknown)
    message: string
    featureSelection?: string[]
    featureName?: string
    featureType?: string
    errorType?: string
    toString (): string
  }
}
