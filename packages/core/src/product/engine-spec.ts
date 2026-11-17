import { InvalidArgumentError } from '../errors.js'
import { isPlainObject } from '../internal/guards.js'
import type { ProductSpec } from './spec.js'

export interface EngineSpec {
  features: string[]
  data: Record<string, unknown>
  [key: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
const truthyOr = (value: unknown, fallback: unknown): unknown => (value ? value : fallback)

export const buildEngineSpec = ({ spec }: { spec: ProductSpec }): ProductSpec | EngineSpec => {
  if (!isPlainObject(spec)) {
    throw new InvalidArgumentError('"spec" must be an object.')
  }

  const parsed = isPlainObject(spec.sensor) ? spec.sensor.parsed : undefined
  if (!isPlainObject(parsed)) return spec

  const parsedData = isPlainObject(parsed.data) ? parsed.data : undefined
  if (!Array.isArray(parsed.features) || !isPlainObject(parsedData?.basicData)) return spec

  const specBasicData = isPlainObject(spec.basicData) ? spec.basicData : undefined

  return {
    features: parsed.features as string[],
    data: {
      ...parsedData,
      basicData: {
        ...parsedData.basicData,
        database: truthyOr(specBasicData?.database, {}),
        version: specBasicData?.version
      }
    },
    // what the modules of a modular SPL read (`input.models`); absent for a plain line
    ...(spec.models === undefined ? {} : { models: spec.models }),
    ...(spec.modelsByMetamodel === undefined ? {} : { modelsByMetamodel: spec.modelsByMetamodel })
  }
}
