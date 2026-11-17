export {
  PLATFORM_PATHS,
  PRODUCTS_INDEX_PATH,
  NAME_PATTERN,
  VERSION_PATTERN,
  DEFAULT_LANGUAGES,
  DEFAULT_SRID,
  ANALYSIS_THRESHOLDS
} from './constants.js'

export {
  LineaCoreError,
  InvalidArgumentError,
  UvlParseError,
  FeatureSelectionInvalidError,
  LinePlatformNotFoundError,
  FeatureModelEmptyError,
  InvalidProductSpecError,
  ProductsIndexError,
  AnalysisRuntimeError,
  ModuleManifestError,
  ModuleResolutionError,
  ModuleCheckError,
  TemplateError
} from './errors.js'
export type { LineaCoreErrorCode } from './errors.js'

export { normalizeUvl, estimateFeatureCount } from './analysis/uvl-text.js'
export { parseUvl, printUvl, uvlName, featuresOf } from './feature-model/uvl.js'
export type { FeatureModelTree, FeatureNode, FeatureGroup, GroupKind, Formula } from './feature-model/uvl.js'

export { validateProductSpec, assertProductSpec, normalizeProductSpec } from './product/spec.js'
export type {
  ProductSpec,
  ProductBasicData,
  ProductSpecError,
  ProductSpecErrorCode,
  ProductSpecValidation
} from './product/spec.js'
export { incrementVersion } from './product/version.js'
export { buildEngineSpec } from './product/engine-spec.js'
export type { EngineSpec } from './product/engine-spec.js'

export {
  emptyProductsIndex,
  parseProductsIndex,
  serializeProductsIndex,
  validateProductsIndex,
  addProductToIndex,
  renameProductInIndex,
  removeProductFromIndex,
  readProductsIndex,
  writeProductsIndex,
  reconcileProductsIndex
} from './products-index/products-index.js'
export type {
  ProductsIndex,
  ProductsIndexEntry,
  ProductsIndexProblem,
  ProductsIndexProblemCode,
  ProductsIndexValidation,
  ProductsIndexReconciliation
} from './products-index/products-index.js'

export {
  buildLineScaffold,
  buildSplManifest,
  emptyFeatureModel,
  FEATURE_MODEL_PATH,
  writeLineScaffold,
  DEFAULT_PLATFORM_CONFIG,
  DEFAULT_CODE_GITIGNORE
} from './line/scaffold.js'
export type { LineScaffoldInput } from './line/scaffold.js'
export { buildExtraJs, buildTransformationJs, getPipelineFiles, getSplPipelineFiles } from './line/platform-files.js'
export type { FileSpec, CiHost } from './line/platform-files.js'
export { planLineDeletion, planProductDeletion } from './line/deletion.js'
export type { DeletableLine, DeletableProduct, DeletionStep, HostDeletionTraits, HostId, LineDeletionPlan } from './line/deletion.js'
export { planLineRestoration, planProductRestoration } from './line/restoration.js'
export type { LineRestorationPlan, PendingItem, PendingProduct, RestorationStep } from './line/restoration.js'

export { createAnalysisRuntime, disposeAnalysisRuntime } from './analysis/runtime.js'
export type { AnalysisRuntime, AnalysisRuntimeOptions } from './analysis/runtime.js'
export {
  analyzeFeatureModel,
  analyzeFeatureModelBdd,
  analyzeMetric,
  ANALYSIS_METRICS
} from './analysis/analyze.js'
export type {
  AnalysisMode,
  AnalysisMetric,
  FeatureModelAnalysis,
  FeatureModelBddAnalysis,
  MetricAnalysis
} from './analysis/analyze.js'

export { deriveProduct, deriveProductToZip } from './derivation/derive.js'

export { extractArchive } from './fs/archive.js'
export { diffDirectories } from './fs/diff.js'
export type { FileChange } from './fs/diff.js'
export { formatDirectory } from './fs/format.js'

export {
  resolveLinePaths,
  ensureDir,
  readTextFile,
  writeTextFile,
  fileExists
} from './fs/workspace.js'
export type { LinePaths } from './fs/workspace.js'

export { resolveAsset, assetsRoot } from './assets.js'

export * from './modules/index.js'

export { checkLeftovers } from './ci/leftovers.js'
export type { Leftover, LeftoverDelimiters } from './ci/leftovers.js'
export { validateSelection, validateProductSelections, completeSelection, ablateFeature, activateFeature } from './ci/validate-specs.js'
export type { SelectionProblem, ProductSelection, ProductSelectionReport } from './ci/validate-specs.js'
export { analyzeAnnotations } from './ci/annotations.js'
export type { FeaturesByFile } from './ci/annotations.js'
export { selectProducts } from './ci/select.js'
export type { SelectableProduct, ProductSelectionResult } from './ci/select.js'
export { renderChildPipeline } from './ci/pipeline.js'
export { pairwiseSelections } from './ci/pairwise.js'
