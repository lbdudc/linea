import { describe, expect, it } from 'vitest'
import {
  createMemoryPackageSource,
  createRoutingSource,
  isLockCurrent,
  ModuleResolutionError,
  resolveSpl,
  type MemoryPackages,
  type SplManifest
} from '../../../src/index.js'

const metamodel = (name: string, version: string, requires: Record<string, string> = {}) => ({
  'metamodel.json': JSON.stringify({ name, version, requires })
})

const module_ = (
  name: string,
  version: string,
  requires: { modules?: Record<string, string>, metamodels?: Record<string, string> } = {}
) => ({ '.linea/module.json': JSON.stringify({ name, version, requires }) })

const spl = (modules: Record<string, string>): SplManifest => ({ name: 'spl', kind: 'modular', metamodels: {}, modules })

describe('resolveSpl', () => {
  it('chooses the highest version every dependant accepts (a diamond)', async () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { metamodels: { 'mm:x': '^1.0.0' } }) },
      'm:b': { '1.0.0': module_('b', '1.0.0', { metamodels: { 'mm:x': '>=1.1.0 <2.0.0' } }) },
      'mm:x': {
        '1.0.0': metamodel('x', '1.0.0'),
        '1.2.0': metamodel('x', '1.2.0'),
        '1.9.0': metamodel('x', '1.9.0'),
        '2.0.0': metamodel('x', '2.0.0')
      }
    }
    const resolved = await resolveSpl({ spl: spl({ 'm:a': '^1.0.0', 'm:b': '^1.0.0' }), source: createMemoryPackageSource({ packages }) })
    expect(resolved.metamodels.map((m) => [m.location, m.version])).toEqual([['mm:x', '1.9.0']])
    expect([...(resolved.metamodels[0]?.requiredBy ?? [])].sort()).toEqual(['m:a@1.0.0', 'm:b@1.0.0'])
    expect(resolved.modules.map((m) => m.location)).toEqual(['m:a', 'm:b'])
  })

  it('puts dependencies before dependants', async () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { modules: { 'm:b': '*' } }) },
      'm:b': { '1.0.0': module_('b', '1.0.0', { modules: { 'm:c': '*' } }) },
      'm:c': { '1.0.0': module_('c', '1.0.0') }
    }
    const resolved = await resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) })
    expect(resolved.modules.map((m) => m.location)).toEqual(['m:c', 'm:b', 'm:a'])
  })

  it('names who asked for what when the ranges contradict', async () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { metamodels: { 'mm:x': '^1.0.0' } }) },
      'm:b': { '1.0.0': module_('b', '1.0.0', { metamodels: { 'mm:x': '^2.0.0' } }) },
      'mm:x': { '1.0.0': metamodel('x', '1.0.0'), '2.0.0': metamodel('x', '2.0.0') }
    }
    const run = resolveSpl({ spl: spl({ 'm:a': '^1.0.0', 'm:b': '^1.0.0' }), source: createMemoryPackageSource({ packages }) })
    await expect(run).rejects.toBeInstanceOf(ModuleResolutionError)
    await expect(run).rejects.toThrow(/mm:x.*\^1\.0\.0 \(required by m:a@1\.0\.0\), \^2\.0\.0 \(required by m:b@1\.0\.0\).*available: 1\.0\.0, 2\.0\.0/)
  })

  it('reports a package with no versions', async () => {
    const run = resolveSpl({ spl: spl({ 'm:a': '^1.0.0' }), source: createMemoryPackageSource({ packages: {} }) })
    await expect(run).rejects.toThrow(/m:a.*no published versions/)
  })

  it('ignores versions that are not semver', async () => {
    const packages: MemoryPackages = { 'm:a': { latest: {}, '1.0.0': module_('a', '1.0.0') } }
    const resolved = await resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) })
    expect(resolved.modules[0]?.version).toBe('1.0.0')
  })

  it('refuses a tag whose manifest declares another version', async () => {
    const packages: MemoryPackages = { 'm:a': { '1.0.0': module_('a', '1.0.1') } }
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) }))
      .rejects.toThrow(/declares version 1\.0\.1/)
  })

  it('refuses a package without its manifest', async () => {
    const packages: MemoryPackages = { 'm:a': { '1.0.0': { 'readme.md': 'x' } } }
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) }))
      .rejects.toThrow(/has no \.linea\/module\.json/)
  })

  it('refuses an invalid manifest, saying where', async () => {
    const packages: MemoryPackages = { 'm:a': { '1.0.0': { '.linea/module.json': '{' } } }
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) }))
      .rejects.toThrow(/m:a@1\.0\.0: \.linea\/module\.json is not valid JSON/)
  })

  it('refuses a module that is asked for as a metamodel: the metamodel registry only reads metamodels', async () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { metamodels: { 'm:b': '*' } }) },
      'm:b': { '1.0.0': module_('b', '1.0.0') }
    }
    const source = createMemoryPackageSource({ packages })
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source })).rejects.toThrow(/m:b@1\.0\.0 has no metamodel\.json: it is not a metamodel/)
  })

  it('refuses one package that is both a module and a metamodel of the same SPL', async () => {
    const both = { ...module_('b', '1.0.0'), 'metamodel.json': JSON.stringify({ name: 'b', version: '1.0.0', requires: {} }) }
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { metamodels: { 'm:b': '*' } }) },
      'm:b': { '1.0.0': both }
    }
    const source = createMemoryPackageSource({ packages })
    await expect(resolveSpl({ spl: spl({ 'm:a': '*', 'm:b': '*' }), source })).rejects.toThrow(/required as a module and as a metamodel/)
  })

  it('reads each kind from its own registry, which can live somewhere else', async () => {
    const modules = createMemoryPackageSource({ packages: { 'a:core': { '1.0.0': module_('core', '1.0.0', { metamodels: { 'b:basic': '*' } }) } } })
    const metamodels = createMemoryPackageSource({ packages: { 'b:basic': { '1.0.0': { 'metamodel.json': JSON.stringify({ name: 'basic', version: '1.0.0', requires: {} }), 'grammars/basic.langium': 'x' } } } })
    const resolved = await resolveSpl({
      spl: spl({ 'a:core': '*' }),
      source: createRoutingSource({ sources: { a: modules, b: metamodels } })
    })
    expect(resolved.modules.map((m) => m.location)).toEqual(['a:core'])
    expect(resolved.metamodels.map((m) => m.location)).toEqual(['b:basic'])
    expect(() => createRoutingSource({ sources: {} }).listVersions({ location: 'x:y' })).toThrow(/not a location any registry here reads/)
  })

  it('finds a cycle between modules', async () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0', { modules: { 'm:b': '*' } }) },
      'm:b': { '1.0.0': module_('b', '1.0.0', { modules: { 'm:a': '*' } }) }
    }
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) }))
      .rejects.toThrow(/Circular requirement: m:a -> m:b -> m:a/)
  })

  it('settles on a version that a later-found dependant restricts', async () => {
    // a@2.0.0 would need `x`; b asks for a ^1, so a@1.0.0 is used, and `x` is not in the closure
    const packages: MemoryPackages = {
      'm:a': {
        '1.0.0': module_('a', '1.0.0'),
        '2.0.0': module_('a', '2.0.0', { metamodels: { 'mm:x': '*' } })
      },
      'm:b': { '1.0.0': module_('b', '1.0.0', { modules: { 'm:a': '^1.0.0' } }) },
      'mm:x': { '1.0.0': metamodel('x', '1.0.0') }
    }
    const resolved = await resolveSpl({ spl: spl({ 'm:a': '*', 'm:b': '*' }), source: createMemoryPackageSource({ packages }) })
    expect(resolved.modules.map((m) => [m.location, m.version])).toEqual([['m:a', '1.0.0'], ['m:b', '1.0.0']])
    expect(resolved.metamodels).toEqual([])
  })

  it('gives up when the versions never settle', async () => {
    // a@2 wants b ^1 and a@1 wants b ^2, b@1 wants a ^1, b@2 wants a ^2: every choice contradicts the next
    const packages: MemoryPackages = {
      'm:a': {
        '1.0.0': module_('a', '1.0.0', { modules: { 'm:b': '^2.0.0' } }),
        '2.0.0': module_('a', '2.0.0', { modules: { 'm:b': '^1.0.0' } })
      },
      'm:b': {
        '1.0.0': module_('b', '1.0.0', { modules: { 'm:a': '^1.0.0' } }),
        '2.0.0': module_('b', '2.0.0', { modules: { 'm:a': '^2.0.0' } })
      }
    }
    await expect(resolveSpl({ spl: spl({ 'm:a': '*' }), source: createMemoryPackageSource({ packages }) })).rejects.toBeInstanceOf(ModuleResolutionError)
  })

  describe('with a lock', () => {
    const packages: MemoryPackages = {
      'm:a': { '1.0.0': module_('a', '1.0.0'), '1.1.0': module_('a', '1.1.0'), '2.0.0': module_('a', '2.0.0') }
    }
    const source = createMemoryPackageSource({ packages, revisions: { 'm:a': { '1.0.0': 'sha-100', '1.1.0': 'sha-110' } } })

    it('keeps the locked version while it still fits', async () => {
      const first = await resolveSpl({ spl: spl({ 'm:a': '^1.0.0' }), source })
      expect(first.lock.packages['m:a']).toEqual({ kind: 'module', version: '1.1.0', revision: 'sha-110' })
      const pinned = await resolveSpl({
        spl: spl({ 'm:a': '^1.0.0' }),
        source,
        lock: { lockVersion: 1, packages: { 'm:a': { kind: 'module', version: '1.0.0' } } }
      })
      expect(pinned.modules[0]?.version).toBe('1.0.0')
      expect(pinned.modules[0]?.revision).toBe('sha-100')
    })

    it('moves on when the lock no longer fits', async () => {
      const resolved = await resolveSpl({
        spl: spl({ 'm:a': '^2.0.0' }),
        source,
        lock: { lockVersion: 1, packages: { 'm:a': { kind: 'module', version: '1.0.0' } } }
      })
      expect(resolved.modules[0]?.version).toBe('2.0.0')
      expect(resolved.lock.packages['m:a']).toEqual({ kind: 'module', version: '2.0.0' })
    })

    it('says whether a lock is still current', async () => {
      const resolved = await resolveSpl({ spl: spl({ 'm:a': '^1.0.0' }), source })
      expect(isLockCurrent({ lock: resolved.lock, resolved })).toBe(true)
      expect(isLockCurrent({ lock: { lockVersion: 1, packages: { 'm:a': { kind: 'module', version: '1.0.0' } } }, resolved })).toBe(false)
      expect(isLockCurrent({ lock: { lockVersion: 1, packages: {} }, resolved })).toBe(false)
    })
  })
})
