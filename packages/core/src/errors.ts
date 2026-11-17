import type { Diagnostic } from './modules/types.js'

export type LineaCoreErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UVL_PARSE_ERROR'
  | 'FEATURE_SELECTION_INVALID'
  | 'LINE_PLATFORM_NOT_FOUND'
  | 'FEATURE_MODEL_EMPTY'
  | 'INVALID_PRODUCT_SPEC'
  | 'PRODUCTS_INDEX_ERROR'
  | 'ANALYSIS_RUNTIME_ERROR'
  | 'MODULE_MANIFEST_INVALID'
  | 'MODULE_RESOLUTION_FAILED'
  | 'MODULE_CHECK_FAILED'
  | 'TEMPLATE_ERROR'

export class LineaCoreError extends Error {
  readonly code: LineaCoreErrorCode

  constructor (code: LineaCoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export class InvalidArgumentError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('INVALID_ARGUMENT', message, options)
  }
}

export class UvlParseError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('UVL_PARSE_ERROR', message, options)
  }
}

export class FeatureSelectionInvalidError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('FEATURE_SELECTION_INVALID', message, options)
  }
}

export class LinePlatformNotFoundError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('LINE_PLATFORM_NOT_FOUND', message, options)
  }
}

/** A template of the annotated code threw while the product was derived: the platform is there, one of its files is broken for this product. */
export class TemplateError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('TEMPLATE_ERROR', message, options)
  }
}

export class FeatureModelEmptyError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('FEATURE_MODEL_EMPTY', message, options)
  }
}

export class InvalidProductSpecError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('INVALID_PRODUCT_SPEC', message, options)
  }
}

export class ProductsIndexError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('PRODUCTS_INDEX_ERROR', message, options)
  }
}

export class AnalysisRuntimeError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('ANALYSIS_RUNTIME_ERROR', message, options)
  }
}

export class ModuleManifestError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('MODULE_MANIFEST_INVALID', message, options)
  }
}

export class ModuleResolutionError extends LineaCoreError {
  constructor (message: string, options?: ErrorOptions) {
    super('MODULE_RESOLUTION_FAILED', message, options)
  }
}

export class ModuleCheckError extends LineaCoreError {
  readonly diagnostics: readonly Diagnostic[]

  constructor (
    message: string,
    diagnostics: readonly Diagnostic[],
    options?: ErrorOptions
  ) {
    super('MODULE_CHECK_FAILED', message, options)
    this.diagnostics = diagnostics
  }
}
