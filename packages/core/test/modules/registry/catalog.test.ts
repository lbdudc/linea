import { describe, expect, it } from 'vitest'
import {
  createFileCatalog,
  createMemoryCatalog,
  createMemoryPackageSource,
  createMetamodelRegistry,
  createModuleRegistry,
  emptyRegistryIndex,
  ModuleManifestError,
  ModuleResolutionError,
  parseRegistryIndex,
  registerLocation,
  registerPackage,
  serializeRegistryIndex,
  type RegistryEntry
} from '../../../src/index.js'

const entry = (location: string, kind: RegistryEntry['kind'] = 'metamodel'): RegistryEntry => ({
  kind,
  location,
  name: location.split('/').pop()!,
  addedAt: '2026-10-07T00:00:00.000Z'
})

describe('registry index', () => {
  it('round-trips, sorted by location', () => {
    const index = {
      registryVersion: 1 as const,
      packages: { 'gitlab:r/z': { kind: 'module' as const, name: 'z', addedAt: 'x' }, 'gitlab:r/a': { kind: 'metamodel' as const, name: 'a', description: 'A', addedAt: 'x', addedBy: 'dev' } }
    }
    const text = serializeRegistryIndex({ index })
    expect(Object.keys((JSON.parse(text) as { packages: object }).packages)).toEqual(['gitlab:r/a', 'gitlab:r/z'])
    expect(parseRegistryIndex({ content: text })).toEqual(index)
  })

  it.each([
    ['{}', /registryVersion/],
    ['{"registryVersion":1,"packages":{"gitlab:r/a":{"kind":"thing","name":"a","addedAt":"x"}}}', /kind/],
    ['[]', /JSON object/]
  ])('refuses %s', (content, message) => {
    expect(() => parseRegistryIndex({ content })).toThrow(ModuleManifestError)
    expect(() => parseRegistryIndex({ content })).toThrow(message)
  })
})

describe('catalogs', () => {
  it('lists by kind, replaces on add and ignores removing what is not there', async () => {
    const catalog = createMemoryCatalog()
    await catalog.add({ entry: entry('gitlab:r/common') })
    await catalog.add({ entry: entry('gitlab:r/core', 'module') })
    await catalog.add({ entry: { ...entry('gitlab:r/common'), description: 'second' } })
    expect((await catalog.list()).map((e) => e.location)).toEqual(['gitlab:r/common', 'gitlab:r/core'])
    expect((await catalog.list({ kind: 'metamodel' })).map((e) => e.description)).toEqual(['second'])
    await catalog.remove({ location: 'gitlab:r/nothing' })
    await catalog.remove({ location: 'gitlab:r/core' })
    expect(await catalog.get({ location: 'gitlab:r/core' })).toBeUndefined()
  })

  it('a file catalog starts empty, writes the whole file with a message, and skips a write that changes nothing', async () => {
    let content: string | undefined
    const writes: string[] = []
    const catalog = createFileCatalog({
      read: () => Promise.resolve(content),
      write: ({ content: next, message }) => {
        content = next
        writes.push(message)
        return Promise.resolve()
      }
    })
    expect(await catalog.list()).toEqual([])
    await catalog.add({ entry: entry('gitlab:r/common') })
    await catalog.add({ entry: entry('gitlab:r/common') })
    await catalog.remove({ location: 'gitlab:r/common' })
    expect(writes).toEqual(['Register gitlab:r/common', 'Unregister gitlab:r/common'])
    expect(parseRegistryIndex({ content: content! })).toEqual(emptyRegistryIndex())
  })
})

describe('registerPackage', () => {
  const source = createMemoryPackageSource({
    packages: {
      'gitlab:r/common': {
        '1.0.0': { 'metamodel.json': '{"name":"common","version":"1.0.0"}' },
        '1.1.0': { 'metamodel.json': '{"name":"common","version":"1.1.0","description":"Shared"}' }
      },
      'gitlab:r/core': { '1.0.0': { '.linea/module.json': '{"name":"core","version":"1.0.0"}' } },
      'gitlab:r/draft': {},
      'gitlab:r/notes': { '1.0.0': { 'README.md': 'hello' } }
    }
  })
  const now = () => new Date('2026-10-07T12:00:00Z')

  it('reads the latest version and takes name and description from its manifest', async () => {
    const catalog = createMemoryCatalog()
    const registered = await registerPackage({ catalog, registry: createMetamodelRegistry({ source }), location: 'gitlab:r/common', addedBy: 'dev', now })
    expect(registered).toEqual({ kind: 'metamodel', location: 'gitlab:r/common', name: 'common', description: 'Shared', addedAt: '2026-10-07T12:00:00.000Z', addedBy: 'dev' })
    expect(await catalog.list()).toEqual([registered])
  })

  it('keeps the original date when it is registered again', async () => {
    const catalog = createMemoryCatalog()
    const registry = createModuleRegistry({ source })
    await registerPackage({ catalog, registry, location: 'gitlab:r/core', now })
    const again = await registerPackage({ catalog, registry, location: 'gitlab:r/core', now: () => new Date('2027-01-01') })
    expect(again.addedAt).toBe('2026-10-07T12:00:00.000Z')
  })

  it('refuses what is not a package of that kind, has no version, or is registered as the other kind', async () => {
    const catalog = createMemoryCatalog()
    await expect(registerPackage({ catalog, registry: createModuleRegistry({ source }), location: 'gitlab:r/notes' })).rejects.toThrow(/no \.linea\/module\.json/)
    await expect(registerPackage({ catalog, registry: createModuleRegistry({ source }), location: 'gitlab:r/draft' })).rejects.toThrow(/no published version/)
    await registerPackage({ catalog, registry: createModuleRegistry({ source }), location: 'gitlab:r/core' })
    await expect(registerPackage({ catalog, registry: createMetamodelRegistry({ source }), location: 'gitlab:r/core' })).rejects.toThrow(ModuleResolutionError)
    expect(await catalog.list()).toHaveLength(1)
  })
})

describe('registerLocation', () => {
  const source = createMemoryPackageSource({
    packages: {
      'gitlab:r/common': { '1.0.0': { 'metamodel.json': '{"name":"common","version":"1.0.0"}' } },
      'gitlab:r/core': { '1.0.0': { '.linea/module.json': '{"name":"core","version":"1.0.0"}' } },
      'gitlab:r/draft': {},
      'gitlab:r/notes': { '1.0.0': { 'README.md': 'hello' } }
    }
  })

  it('finds out from its manifest whether it is a module or a metamodel', async () => {
    const catalog = createMemoryCatalog()
    expect(await registerLocation({ catalog, source, location: 'gitlab:r/core' })).toMatchObject({ kind: 'module', name: 'core' })
    expect(await registerLocation({ catalog, source, location: 'gitlab:r/common', addedBy: 'ana' })).toMatchObject({ kind: 'metamodel', name: 'common', addedBy: 'ana' })
    expect((await catalog.list()).map((e) => e.location)).toEqual(['gitlab:r/common', 'gitlab:r/core'])
  })

  it('refuses what has no version or no manifest', async () => {
    const catalog = createMemoryCatalog()
    await expect(registerLocation({ catalog, source, location: 'gitlab:r/draft' })).rejects.toThrow(/no published version/)
    await expect(registerLocation({ catalog, source, location: 'gitlab:r/notes' })).rejects.toThrow(/no \.linea\/module\.json/)
    expect(await catalog.list()).toEqual([])
  })
})
