import { describe, expect, it } from 'vitest'
import * as api from '../src/index.js'

const EXCEPTIONS: Record<string, string> = {
  assetsRoot: 'takes no parameters',
  buildExtraJs: 'takes no parameters',
  buildTransformationJs: 'takes no parameters',
  emptyProductsIndex: 'takes no parameters',
  emptyRegistryIndex: 'takes no parameters'
}

type AnyFunction = (...args: never[]) => unknown

const exports_ = api as unknown as Record<string, unknown>

const isClass = (value: AnyFunction): boolean => /^class\s/.test(value.toString())

const allFunctions = Object.entries(exports_)
  .filter((entry): entry is [string, AnyFunction] => typeof entry[1] === 'function')

const publicFunctions = allFunctions.filter(([, value]) => !isClass(value))

describe('ADR-017 calling convention', () => {
  it('finds a non-trivial number of public functions to check', () => {
    expect(publicFunctions.length).toBeGreaterThan(25)
  })

  it.each(publicFunctions.map(([name]) => name))(
    '%s takes a single destructured object (or is a listed exception)',
    (name) => {
      const fn = publicFunctions.find(([n]) => n === name)?.[1]
      expect(fn).toBeDefined()
      if (name in EXCEPTIONS) return

      const source = fn?.toString() ?? ''
      expect(fn?.length, `${name} must take at most one parameter`).toBeLessThanOrEqual(1)
      expect(
        /^(async\s+)?\(?\s*\{/.test(source),
        `${name} must destructure its parameter: got ${source.slice(0, 60)}`
      ).toBe(true)
    }
  )

  it('keeps every exception justified and still exported', () => {
    for (const [name, reason] of Object.entries(EXCEPTIONS)) {
      expect(exports_, `${name} is listed as an exception but no longer exported`)
        .toHaveProperty(name)
      expect(reason.length, `${name} needs a stated reason`).toBeGreaterThan(10)
    }
  })

  it('exempts only zero-parameter functions', () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      const fn = allFunctions.find(([n]) => n === name)?.[1]
      const takesNoParameters = fn?.length === 0
      expect(takesNoParameters, `${name} is exempt but takes ${String(fn?.length)} parameter(s)`).toBe(true)
    }
  })

  it('exports error classes as classes, not as factory functions', () => {
    const classes = allFunctions.filter(([, value]) => isClass(value)).map(([name]) => name)
    expect(classes.sort()).toEqual([
      'AnalysisRuntimeError',
      'FeatureModelEmptyError',
      'FeatureSelectionInvalidError',
      'InvalidArgumentError',
      'InvalidProductSpecError',
      'LinePlatformNotFoundError',
      'LineaCoreError',
      'ModuleCheckError',
      'ModuleManifestError',
      'ModuleResolutionError',
      'ProductsIndexError',
      'TemplateError',
      'UvlParseError'
    ])
  })
})
