import {
  DEFAULT_LANGUAGES,
  DEFAULT_SRID,
  NAME_PATTERN,
  VERSION_PATTERN
} from '../constants.js'
import { InvalidArgumentError, InvalidProductSpecError } from '../errors.js'
import { isPlainObject } from '../internal/guards.js'

export interface ProductBasicData {
  name?: string
  version?: string
  languages?: string[]
  SRID?: string
  database?: Record<string, unknown>
  extra?: Record<string, unknown>
  testEnvironment?: { image?: string, command?: string }
  createdAt?: unknown
  [key: string]: unknown
}

export interface ProductSpec {
  basicData?: ProductBasicData
  dataModel?: { cells?: unknown[], [key: string]: unknown }
  features?: string[] | Record<string, boolean>
  statics?: unknown[]
  sensor?: { dsl?: string, parsed?: unknown }
  selection?: string[]
  [key: string]: unknown
}

export interface ProductSpecError {
  readonly path: string
  readonly code: ProductSpecErrorCode
  readonly messageKey: string
}

export type ProductSpecErrorCode =
  | 'SPEC_NOT_OBJECT'
  | 'BASIC_DATA_NOT_OBJECT'
  | 'NAME_REQUIRED'
  | 'NAME_INVALID_CHARACTERS'
  | 'VERSION_FORMAT'
  | 'LANGUAGES_NOT_STRING_ARRAY'
  | 'SRID_NOT_STRING'
  | 'FEATURES_INVALID_SHAPE'
  | 'STATICS_NOT_ARRAY'

export interface ProductSpecValidation {
  readonly valid: boolean
  readonly errors: ProductSpecError[]
}

export const validateProductSpec = ({ spec }: { spec: unknown }): ProductSpecValidation => {
  const errors: ProductSpecError[] = []

  if (!isPlainObject(spec)) {
    return {
      valid: false,
      errors: [{
        path: 'spec',
        code: 'SPEC_NOT_OBJECT',
        messageKey: 'error_messages.spec_object_validation'
      }]
    }
  }

  const basicData = spec.basicData
  if (!isPlainObject(basicData)) {
    return {
      valid: false,
      errors: [{
        path: 'spec.basicData',
        code: 'BASIC_DATA_NOT_OBJECT',
        messageKey: 'error_messages.basicData_object_validation'
      }]
    }
  }

  const name = basicData.name
  if (typeof name !== 'string' || name === '') {
    errors.push({
      path: 'spec.basicData.name',
      code: 'NAME_REQUIRED',
      messageKey: 'error_messages.basicData_name_validation'
    })
  } else if (!NAME_PATTERN.test(name)) {
    errors.push({
      path: 'spec.basicData.name',
      code: 'NAME_INVALID_CHARACTERS',
      messageKey: 'error_messages.invalid_name_characters'
    })
  }

  if (typeof basicData.version !== 'string' || !VERSION_PATTERN.test(basicData.version)) {
    errors.push({
      path: 'spec.basicData.version',
      code: 'VERSION_FORMAT',
      messageKey: 'error_messages.basicData_version_format'
    })
  }

  const { languages } = basicData
  if (
    languages !== undefined &&
    (!Array.isArray(languages) || languages.some((l) => typeof l !== 'string'))
  ) {
    errors.push({
      path: 'spec.basicData.languages',
      code: 'LANGUAGES_NOT_STRING_ARRAY',
      messageKey: 'error_messages.basicData_languages_validation'
    })
  }

  if (basicData.SRID !== undefined && typeof basicData.SRID !== 'string') {
    errors.push({
      path: 'spec.basicData.SRID',
      code: 'SRID_NOT_STRING',
      messageKey: 'error_messages.basicData_SRID_validation'
    })
  }

  const { features } = spec
  const featuresValid =
    features === undefined ||
    (Array.isArray(features) && features.every((f) => typeof f === 'string')) ||
    isPlainObject(features)
  if (!featuresValid) {
    errors.push({
      path: 'spec.features',
      code: 'FEATURES_INVALID_SHAPE',
      messageKey: 'error_messages.spec_features_validation'
    })
  }

  if (spec.statics !== undefined && !Array.isArray(spec.statics)) {
    errors.push({
      path: 'spec.statics',
      code: 'STATICS_NOT_ARRAY',
      messageKey: 'error_messages.spec_statics_validation'
    })
  }

  return { valid: errors.length === 0, errors }
}

export const assertProductSpec = ({ spec }: { spec: ProductSpec }): ProductSpec => {
  const { valid, errors } = validateProductSpec({ spec })
  if (!valid) {
    const summary = errors.map((error) => `${error.path}: ${error.messageKey}`).join('; ')
    throw new InvalidProductSpecError(`Invalid product spec: ${summary}`)
  }
  return spec
}

export const normalizeProductSpec = ({ spec }: { spec: ProductSpec }): ProductSpec => {
  if (!isPlainObject(spec)) {
    throw new InvalidArgumentError('"spec" must be an object.')
  }
  const basicData = isPlainObject(spec.basicData) ? spec.basicData : {}
  const dataModel = isPlainObject(spec.dataModel) ? spec.dataModel : {}
  const sensor = isPlainObject(spec.sensor) ? spec.sensor : {}
  const testEnvironment = isPlainObject(basicData.testEnvironment)
    ? basicData.testEnvironment
    : {}

  const { languages } = basicData

  return {
    ...spec,
    basicData: {
      ...basicData,
      name: typeof basicData.name === 'string' ? basicData.name : '',
      version: typeof basicData.version === 'string' && basicData.version !== ''
        ? basicData.version
        : '0.0.0',
      database: isPlainObject(basicData.database) ? basicData.database : {},
      extra: isPlainObject(basicData.extra) ? basicData.extra : {},
      testEnvironment: {
        image: typeof testEnvironment.image === 'string' ? testEnvironment.image : '',
        command: typeof testEnvironment.command === 'string' ? testEnvironment.command : ''
      },
      languages: Array.isArray(languages) ? [...languages] : [...DEFAULT_LANGUAGES],
      SRID: typeof basicData.SRID === 'string' && basicData.SRID !== ''
        ? basicData.SRID
        : DEFAULT_SRID
    },
    dataModel: {
      ...dataModel,
      cells: Array.isArray(dataModel.cells) ? [...dataModel.cells] : []
    },
    features: Array.isArray(spec.features)
      ? [...spec.features]
      : isPlainObject(spec.features)
        ? { ...spec.features }
        : [],
    statics: Array.isArray(spec.statics) ? [...spec.statics] : [],
    sensor: {
      ...sensor,
      dsl: typeof sensor.dsl === 'string' ? sensor.dsl : '',
      parsed: sensor.parsed ?? null
    }
  }
}
