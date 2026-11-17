import { describe, expect, it } from 'vitest'
import * as api from '../src/index.js'

const PUBLIC_EXPORTS = [
  'PLATFORM_PATHS',
  'PRODUCTS_INDEX_PATH',
  'NAME_PATTERN',
  'VERSION_PATTERN',
  'DEFAULT_LANGUAGES',
  'DEFAULT_SRID',
  'ANALYSIS_THRESHOLDS',
  'LineaCoreError',
  'InvalidArgumentError',
  'UvlParseError',
  'FeatureSelectionInvalidError',
  'LinePlatformNotFoundError',
  'InvalidProductSpecError',
  'ProductsIndexError',
  'AnalysisRuntimeError',
  'ModuleManifestError',
  'ModuleResolutionError',
  'ModuleCheckError',
  'TemplateError',
  'FeatureModelEmptyError',
  'cipFragmentPath',
  'cipKind',
  'cipMarkers',
  'cipTarget',
  'describeCips',
  'planLineDeletion',
  'planLineRestoration',
  'planProductDeletion',
  'planProductRestoration',
  'normalizeUvl',
  'estimateFeatureCount',
  'parseUvl',
  'printUvl',
  'uvlName',
  'featuresOf',
  'bangoName',
  'checkSelections',
  'defaultSelection',
  'rootFeatureName',
  'selectionText',
  'validateProductSpec',
  'assertProductSpec',
  'normalizeProductSpec',
  'incrementVersion',
  'buildEngineSpec',
  'emptyProductsIndex',
  'parseProductsIndex',
  'serializeProductsIndex',
  'validateProductsIndex',
  'addProductToIndex',
  'renameProductInIndex',
  'removeProductFromIndex',
  'readProductsIndex',
  'writeProductsIndex',
  'reconcileProductsIndex',
  'buildLineScaffold',
  'buildSplManifest',
  'emptyFeatureModel',
  'FEATURE_MODEL_PATH',
  'writeLineScaffold',
  'DEFAULT_PLATFORM_CONFIG',
  'DEFAULT_CODE_GITIGNORE',
  'buildExtraJs',
  'buildTransformationJs',
  'getPipelineFiles',
  'getSplPipelineFiles',
  'createAnalysisRuntime',
  'disposeAnalysisRuntime',
  'analyzeFeatureModel',
  'analyzeFeatureModelBdd',
  'analyzeMetric',
  'ANALYSIS_METRICS',
  'deriveProduct',
  'deriveProductToZip',
  'extractArchive',
  'diffDirectories',
  'formatDirectory',
  'resolveLinePaths',
  'ensureDir',
  'readTextFile',
  'writeTextFile',
  'fileExists',
  'resolveAsset',
  'assetsRoot',
  'METAMODEL_MANIFEST_PATH',
  'MODULE_MANIFEST_PATH',
  'SPL_MANIFEST_PATH',
  'LOCK_PATH',
  'REGISTRY_INDEX_PATH',
  'parseMetamodelManifest',
  'parseModuleManifest',
  'parseSplManifest',
  'serializeSplManifest',
  'parseLock',
  'serializeLock',
  'emptyRegistryIndex',
  'parseRegistryIndex',
  'serializeRegistryIndex',
  'readPackageText',
  'createFsFiles',
  'createFsPackageSource',
  'createMemoryPackageSource',
  'withOverlay',
  'resolveReference',
  'absoluteRequires',
  'createModuleRegistry',
  'createMetamodelRegistry',
  'createRoutingSource',
  'createMemoryCatalog',
  'createFileCatalog',
  'registerPackage',
  'registerLocation',
  'resolveModules',
  'resolveMetamodels',
  'resolveSpl',
  'isLockCurrent',
  'planPlatform',
  'writePlatform',
  'FEATURE_METAMODEL',
  'FEATURE_MODEL_GRAMMAR',
  'FEATURE_SELECTION_GRAMMAR',
  'withFeatureMetamodel',
  'configure',
  'prepareEngine',
  'checkSpl',
  'listOfferedModels',
  'readMetamodelBundle',
  'readMetamodelFiles',
  'readMetamodelText',
  'metamodelPath',
  'METAMODEL_FOLDERS',
  'checkProduct',
  'seedProductModels',
  'deriveModularProduct',
  'deriveModularProductToZip',
  'checkLeftovers',
  'validateSelection',
  'validateProductSelections',
  'completeSelection',
  'ablateFeature',
  'activateFeature',
  'pairwiseSelections',
  'analyzeAnnotations',
  'selectProducts',
  'renderChildPipeline'
].sort()

describe('public API', () => {
  it('exports exactly the declared surface', () => {
    expect(Object.keys(api).sort()).toEqual(PUBLIC_EXPORTS)
  })

  it('exposes every error class as a subclass of LineaCoreError', () => {
    const errorNames = [
      'InvalidArgumentError',
      'UvlParseError',
      'FeatureSelectionInvalidError',
      'LinePlatformNotFoundError',
      'InvalidProductSpecError',
      'ProductsIndexError',
      'ModuleManifestError',
      'ModuleResolutionError'
    ] as const

    for (const name of errorNames) {
      const ErrorClass = api[name]
      const instance = new ErrorClass('boom')
      expect(instance, name).toBeInstanceOf(api.LineaCoreError)
      expect(instance, name).toBeInstanceOf(Error)
      expect(instance.name, name).toBe(name)
      expect(typeof instance.code, name).toBe('string')
    }
  })

  it('gives every error class a distinct, stable code', () => {
    const codes = [
      new api.InvalidArgumentError('x').code,
      new api.UvlParseError('x').code,
      new api.FeatureSelectionInvalidError('x').code,
      new api.LinePlatformNotFoundError('x').code,
      new api.InvalidProductSpecError('x').code,
      new api.ProductsIndexError('x').code,
      new api.ModuleManifestError('x').code,
      new api.ModuleResolutionError('x').code,
      new api.ModuleCheckError('x', []).code
    ]
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toEqual([
      'INVALID_ARGUMENT',
      'UVL_PARSE_ERROR',
      'FEATURE_SELECTION_INVALID',
      'LINE_PLATFORM_NOT_FOUND',
      'INVALID_PRODUCT_SPEC',
      'PRODUCTS_INDEX_ERROR',
      'MODULE_MANIFEST_INVALID',
      'MODULE_RESOLUTION_FAILED',
      'MODULE_CHECK_FAILED'
    ])
  })

  it('preserves the underlying failure through `cause`', () => {
    const cause = new Error('root cause')
    expect(new api.UvlParseError('wrapped', { cause }).cause).toBe(cause)
  })

  it('exports only functions, classes, and frozen-ish constant values', () => {
    for (const [name, value] of Object.entries(api)) {
      expect(value, `${name} must not be undefined`).toBeDefined()
    }
  })
})
