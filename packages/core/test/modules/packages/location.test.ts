import { describe, expect, it } from 'vitest'
import {
  absoluteRequires,
  checkSpl,
  createMemoryPackageSource,
  ModuleManifestError,
  readMetamodelBundle,
  resolveReference,
  resolveSpl,
  type MemoryPackages
} from '../../../src/index.js'
import { createEngine } from '../helpers.js'

describe('resolveReference', () => {
  it.each([
    ['gitlab:registry/basic', '../common', 'gitlab:registry/common'],
    ['gitlab:registry/basic', './sub', 'gitlab:registry/basic/sub'],
    ['file:metamodels/basic', '../../modules/core', 'file:modules/core'],
    ['gitlab:a/b/c', '../../x/y', 'gitlab:a/x/y']
  ])('%s + %s = %s', (from, reference, expected) => {
    expect(resolveReference({ from, reference })).toBe(expected)
  })

  it('leaves an absolute location as it is', () => {
    expect(resolveReference({ from: 'gitlab:registry/basic', reference: 'gitlab:other/common' })).toBe('gitlab:other/common')
    expect(resolveReference({ from: 'gitlab:registry/basic', reference: 'file:modules/core' })).toBe('file:modules/core')
  })

  it('refuses a reference that leaves the place its packages live in, or has no place to be relative to', () => {
    expect(() => resolveReference({ from: 'gitlab:basic', reference: '../../x' })).toThrow(ModuleManifestError)
    expect(() => resolveReference({ from: 'gitlab:basic', reference: '..' + '/' })).toThrow(/outside/)
    expect(() => resolveReference({ from: 'no-scheme', reference: '../x' })).toThrow(/not a location/)
  })
})

describe('absoluteRequires', () => {
  it('makes every requirement of a module or a metamodel absolute', () => {
    expect(absoluteRequires({
      kind: 'module',
      location: 'gitlab:registry/um',
      manifest: { name: 'um', version: '1.0.0', requires: { modules: { '../core': '^1.0.0' }, metamodels: { '../dm': '^2.0.0', 'gitlab:x/y': '*' } }, offers: {} }
    })).toEqual({ modules: { 'gitlab:registry/core': '^1.0.0' }, metamodels: { 'gitlab:registry/dm': '^2.0.0', 'gitlab:x/y': '*' } })
    expect(absoluteRequires({
      kind: 'metamodel',
      location: 'gitlab:registry/gis',
      manifest: { name: 'gis', version: '1.0.0', requires: { '../dm': '^1.0.0' } }
    })).toEqual({ modules: {}, metamodels: { 'gitlab:registry/dm': '^1.0.0' } })
  })
})

const GRAMMAR_COMMON = "grammar Common\n\nterminal ID: /[_a-zA-Z][\\w_-]*/;\nhidden terminal WS: /\\s+/;\n"
const GRAMMAR_BASIC = "grammar Basic\nimport './common'\n\n// Basic\nentry BasicModel: 'basic' name=ID;\n"

/** Packages that reach each other only by `../`: they work wherever they are published. */
const portable = (group: string): { packages: MemoryPackages, location: (name: string) => string } => ({
  location: (name) => `gitlab:${group}/${name}`,
  packages: {
    [`gitlab:${group}/common`]: { '1.0.0': { 'metamodel.json': JSON.stringify({ name: 'common', version: '1.0.0' }), 'grammars/common.langium': GRAMMAR_COMMON } },
    [`gitlab:${group}/basic`]: {
      '1.0.0': {
        'metamodel.json': JSON.stringify({ name: 'basic', version: '1.0.0', requires: { '../common': '^1.0.0' } }),
        'grammars/basic.langium': GRAMMAR_BASIC,
        'specs/basic.js': 'return { root: true, map(model) { return { name: model.name }; } };'
      }
    },
    [`gitlab:${group}/core`]: {
      '1.0.0': { '.linea/module.json': JSON.stringify({ name: 'core', version: '1.0.0', requires: { metamodels: { '../basic': '^1.0.0' } } }), '.linea/model.uvl': 'features\n\tCore\n' }
    }
  }
})

describe('packages that refer to each other by ../', () => {
  it.each(['registry', 'team/lbd'])('resolve, check and bundle the same in any group (%s)', async (group) => {
    const { packages, location } = portable(group)
    const source = createMemoryPackageSource({ packages })
    const resolved = await resolveSpl({ spl: { name: 'spl', kind: 'modular', metamodels: {}, modules: { [location('core')]: '^1.0.0' } }, source })
    expect(resolved.metamodels.map((m) => m.location)).toEqual([location('common'), location('basic')])
    expect(resolved.lock.packages[location('basic')]).toEqual({ kind: 'metamodel', version: '1.0.0' })

    // (these packages are checked on their own: there is no SPL, so no feature model)
    const report = await checkSpl({ resolved, createEngine, configuration: false })
    expect(report.diagnostics).toEqual([])
    expect(report.metamodels.map((m) => m.name)).toEqual(['basic'])

    const bundle = await readMetamodelBundle({ resolved })
    expect(Object.keys(bundle.grammars).sort()).toEqual(['basic', 'common'])
    expect(bundle.specs.basic).toContain('root: true')
    expect(bundle.constraints).toEqual({})
    expect(bundle.imports).toEqual({})
    expect(bundle.scopes).toEqual({})
    expect(bundle.visualizations).toEqual({})
  })

  it('say, as each download starts, which modules declare a metamodel', async () => {
    const { packages, location } = portable('registry')
    const progress: { location: string, requiredBy: readonly string[] }[] = []
    await resolveSpl({
      spl: { name: 'spl', kind: 'modular', metamodels: {}, modules: { [location('core')]: '^1.0.0' } },
      source: createMemoryPackageSource({ packages }),
      onProgress: ({ location: where, requiredBy }) => { progress.push({ location: where, requiredBy }) }
    })
    expect(progress).toEqual([
      { location: location('core'), requiredBy: [] },
      { location: location('basic'), requiredBy: [location('core')] },
      { location: location('common'), requiredBy: [] }
    ])
  })

  it('still require the import to be declared', async () => {
    const { packages, location } = portable('registry')
    packages[location('basic')] = {
      '1.0.0': { 'metamodel.json': JSON.stringify({ name: 'basic', version: '1.0.0', requires: {} }), 'grammars/basic.langium': GRAMMAR_BASIC }
    }
    // common is still in the closure (nothing asks for it now), so the import is of a grammar nobody provides
    const resolved = await resolveSpl({ spl: { name: 'spl', kind: 'modular', metamodels: {}, modules: { [location('core')]: '*' } }, source: createMemoryPackageSource({ packages }) })
    expect(resolved.metamodels.map((m) => m.location)).toEqual([location('basic')])
    const report = await checkSpl({ resolved, createEngine, configuration: false })
    expect(report.ok).toBe(false)
  })
})
