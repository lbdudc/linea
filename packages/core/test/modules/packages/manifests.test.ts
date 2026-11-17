import { describe, expect, it } from 'vitest'
import {
  ModuleManifestError,
  parseLock,
  parseMetamodelManifest,
  parseModuleManifest,
  parseSplManifest,
  serializeLock,
  serializeSplManifest
} from '../../../src/index.js'

const json = (value: unknown): string => JSON.stringify(value)

describe('parseMetamodelManifest', () => {
  it('reads a valid manifest', () => {
    expect(parseMetamodelManifest({
      content: json({ name: 'gis', version: '1.2.3', description: 'GIS', requires: { 'file:a': '^1.0.0' } })
    })).toEqual({ name: 'gis', version: '1.2.3', description: 'GIS', requires: { 'file:a': '^1.0.0' } })
  })

  it('defaults requires and leaves the description out when there is none', () => {
    expect(parseMetamodelManifest({ content: json({ name: 'gis', version: '1.0.0' }) })).toEqual({
      name: 'gis', version: '1.0.0', requires: {}
    })
  })

  it.each([
    ['not json', '{', /not valid JSON/],
    ['not an object', '[]', /must be a JSON object/],
    ['bad name', json({ name: 'a b', version: '1.0.0' }), /"name"/],
    ['bad version', json({ name: 'a', version: '1.0' }), /"version"/],
    ['bad description', json({ name: 'a', version: '1.0.0', description: 1 }), /"description"/],
    ['requires not an object', json({ name: 'a', version: '1.0.0', requires: [] }), /"requires" must be an object/],
    ['bad range', json({ name: 'a', version: '1.0.0', requires: { x: 'nonsense' } }), /semver range/],
    ['range not a string', json({ name: 'a', version: '1.0.0', requires: { x: 1 } }), /semver range/],
    ['bad location', json({ name: 'a', version: '1.0.0', requires: { 'a b': '^1.0.0' } }), /not a valid location/]
  ])('rejects %s', (_label, content, message) => {
    expect(() => parseMetamodelManifest({ content })).toThrow(ModuleManifestError)
    expect(() => parseMetamodelManifest({ content })).toThrow(message)
  })

  it('lists every problem at once', () => {
    expect(() => parseMetamodelManifest({ content: json({ name: '', version: 'x' }) })).toThrow(/"name"[\s\S]*"version"/)
  })
})

describe('parseModuleManifest', () => {
  it('reads requires and offers', () => {
    const manifest = parseModuleManifest({
      content: json({
        name: 'um',
        version: '1.0.0',
        description: 'users',
        requires: { modules: { 'file:core': '^1.0.0' }, metamodels: { 'file:dm': '~2.0.0' } },
        offers: { datamodel: 'models/dm.instance' }
      })
    })
    expect(manifest).toEqual({
      name: 'um',
      version: '1.0.0',
      description: 'users',
      requires: { modules: { 'file:core': '^1.0.0' }, metamodels: { 'file:dm': '~2.0.0' } },
      offers: { datamodel: 'models/dm.instance' }
    })
  })

  it('defaults everything optional', () => {
    expect(parseModuleManifest({ content: json({ name: 'um', version: '1.0.0' }) })).toEqual({
      name: 'um', version: '1.0.0', requires: { modules: {}, metamodels: {} }, offers: {}
    })
  })

  it.each([
    ['requires not an object', { requires: 3 }, /"requires" must be an object/],
    ['modules not an object', { requires: { modules: 3 } }, /"requires.modules"/],
    ['offers not an object', { offers: [] }, /"offers" must be an object/],
    ['offer name invalid', { offers: { 'a b': 'x' } }, /not a valid metamodel name/],
    ['offer path absolute', { offers: { a: '/etc/x' } }, /relative path/],
    ['offer path climbs', { offers: { a: '../x' } }, /relative path/],
    ['offer path not a string', { offers: { a: 1 } }, /relative path/],
    ['offer path with backslash', { offers: { a: 'a\\b' } }, /relative path/]
  ])('rejects %s', (_label, extra, message) => {
    expect(() => parseModuleManifest({ content: json({ name: 'um', version: '1.0.0', ...extra }) })).toThrow(message)
  })
})

describe('parseSplManifest / serializeSplManifest', () => {
  it('round-trips, sorting the modules', () => {
    const spl = parseSplManifest({ content: json({ name: 'gis', version: '1.0.0', modules: { 'file:b': '^1.0.0', 'file:a': '^2.0.0' } }) })
    const text = serializeSplManifest({ spl })
    expect(text.endsWith('\n')).toBe(true)
    expect(Object.keys((JSON.parse(text) as { modules: object }).modules)).toEqual(['file:a', 'file:b'])
    expect(parseSplManifest({ content: text })).toEqual(spl)
  })

  it('does not need a version', () => {
    const spl = parseSplManifest({ content: json({ name: 'gis', modules: {} }) })
    expect(spl).toEqual({ name: 'gis', kind: 'plain', metamodels: {}, modules: {} })
    expect(JSON.parse(serializeSplManifest({ spl }))).toEqual({ name: 'gis', kind: 'plain', metamodels: {}, modules: {} })
  })

  it('rejects a bad version', () => {
    expect(() => parseSplManifest({ content: json({ name: 'gis', version: 'x', modules: {} }) })).toThrow(/"version"/)
  })
})

describe('parseLock / serializeLock', () => {
  const lock = {
    lockVersion: 1 as const,
    packages: {
      'file:b': { kind: 'metamodel' as const, version: '1.0.0', revision: 'abc' },
      'file:a': { kind: 'module' as const, version: '2.0.0' }
    }
  }

  it('serializes sorted and parses back', () => {
    const text = serializeLock({ lock })
    expect(Object.keys((JSON.parse(text) as { packages: object }).packages)).toEqual(['file:a', 'file:b'])
    expect(parseLock({ content: text })).toEqual(lock)
  })

  it.each([
    ['wrong lockVersion', { lockVersion: 2, packages: {} }, /"lockVersion"/],
    ['packages missing', { lockVersion: 1 }, /"packages"/],
    ['bad entry', { lockVersion: 1, packages: { x: { kind: 'other', version: '1.0.0' } } }, /"kind"/],
    ['entry not an object', { lockVersion: 1, packages: { x: 1 } }, /"kind"/],
    ['bad revision', { lockVersion: 1, packages: { x: { kind: 'module', version: '1.0.0', revision: 1 } } }, /"revision"/]
  ])('rejects %s', (_label, value, message) => {
    expect(() => parseLock({ content: json(value) })).toThrow(message)
  })
})
