import FeatureSelectionError from 'spl-js-engine/src/feature-model/feature-selection-error.js'

export interface SelectionFailure {
  readonly message: string
  readonly errorType: string | null
}

/** Whether the derivation engine refused a product because its feature selection does not fit the feature model. */
export const isFeatureSelectionError = (error: unknown): boolean =>
  error instanceof FeatureSelectionError

export const describeSelectionFailure = (error: unknown): SelectionFailure => {
  if (error instanceof FeatureSelectionError) {
    return { message: error.message, errorType: error.errorType ?? null }
  }
  if (error instanceof Error) {
    return { message: error.message, errorType: null }
  }
  return { message: String(error), errorType: null }
}
