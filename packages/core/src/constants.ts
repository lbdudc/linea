
export const PLATFORM_PATHS = {
  root: 'src/platform',
  code: 'src/platform/code',
  /** Written when a product is derived (the composed feature model, as UVL): an SPL keeps its feature model as a model of the feature metamodel. */
  model: 'src/platform/model.uvl',
  config: 'src/platform/config.json',
  extraJs: 'src/platform/extra.js',
  transformation: 'src/platform/transformation.js'
} as const

export const PRODUCTS_INDEX_PATH = 'products.json'

export const NAME_PATTERN = /^[a-zA-Z0-9_\-.]+$/

export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export const DEFAULT_LANGUAGES = ['en', 'es', 'gl'] as const

export const DEFAULT_SRID = '4326'

export const ANALYSIS_THRESHOLDS = {
  skipEnumeration: 30,
  skipBdd: 100
} as const
