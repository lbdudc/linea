import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addProductToIndex,
  emptyProductsIndex,
  InvalidArgumentError,
  parseProductsIndex,
  PRODUCTS_INDEX_PATH,
  ProductsIndexError,
  readProductsIndex,
  reconcileProductsIndex,
  removeProductFromIndex,
  renameProductInIndex,
  serializeProductsIndex,
  validateProductsIndex,
  writeProductsIndex,
  type ProductsIndex
} from '../../src/index.js'

const created: string[] = []
const makeLineDir = (content?: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-idx-'))
  created.push(dir)
  if (content !== undefined) {
    fs.writeFileSync(path.join(dir, PRODUCTS_INDEX_PATH), content, 'utf8')
  }
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const frozenIndex = (): ProductsIndex => {
  const index: ProductsIndex = {
    productos: [
      { name: 'beta', repositorio: '/lab/linea/beta' },
      { name: 'alpha', repositorio: '/lab/linea/alpha' }
    ]
  }
  index.productos.forEach((entry) => Object.freeze(entry))
  Object.freeze(index.productos)
  return Object.freeze(index)
}

const frozenVersionedIndex = (): ProductsIndex => {
  const index: ProductsIndex = {
    productos: [
      { name: 'beta', repositorio: '/lab/linea/beta', version: '2.0.1' },
      { name: 'alpha', repositorio: '/lab/linea/alpha', version: '1.2.3' }
    ]
  }
  index.productos.forEach((entry) => Object.freeze(entry))
  Object.freeze(index.productos)
  return Object.freeze(index)
}

const LEGACY_INDEX_BYTES = [
  '{',
  '  "productos": [',
  '    {',
  '      "name": "alpha",',
  '      "repositorio": "/lab/linea/alpha"',
  '    },',
  '    {',
  '      "name": "beta",',
  '      "repositorio": "/lab/linea/beta"',
  '    }',
  '  ]',
  '}',
  ''
].join('\n')

describe('emptyProductsIndex', () => {
  it('is the ADR-011 empty shape', () => {
    expect(emptyProductsIndex()).toEqual({ productos: [] })
  })

  it('returns a fresh object every call', () => {
    const a = emptyProductsIndex()
    const b = emptyProductsIndex()
    expect(a).not.toBe(b)
    expect(a.productos).not.toBe(b.productos)
  })
})

describe('validateProductsIndex', () => {
  it('accepts a well-formed index', () => {
    expect(validateProductsIndex({ index: frozenIndex() })).toEqual({ valid: true, errors: [] })
  })

  it('accepts an empty index', () => {
    expect(validateProductsIndex({ index: { productos: [] } }).valid).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(validateProductsIndex({ index: null }).errors.map((e) => e.code))
      .toEqual(['INDEX_NOT_OBJECT'])
  })

  it('rejects a missing or non-array productos', () => {
    expect(validateProductsIndex({ index: {} }).errors.map((e) => e.code))
      .toEqual(['PRODUCTOS_NOT_ARRAY'])
    expect(validateProductsIndex({ index: { productos: 'x' } }).errors.map((e) => e.code))
      .toEqual(['PRODUCTOS_NOT_ARRAY'])
  })

  it('detects duplicated names', () => {
    const index = {
      productos: [
        { name: 'dup', repositorio: '/a' },
        { name: 'dup', repositorio: '/b' }
      ]
    }
    const result = validateProductsIndex({ index })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'productos[1].name',
      code: 'NAME_DUPLICATED',
      messageKey: 'error_messages.products_index_name_duplicated'
    })
  })

  it('detects invalid names with the shared i18n key', () => {
    const index = { productos: [{ name: 'bad name', repositorio: '/a' }] }
    expect(validateProductsIndex({ index }).errors).toContainEqual({
      path: 'productos[0].name',
      code: 'NAME_INVALID_CHARACTERS',
      messageKey: 'error_messages.invalid_name_characters'
    })
  })

  it('detects a missing or empty name', () => {
    expect(validateProductsIndex({ index: { productos: [{ repositorio: '/a' }] } }).errors)
      .toContainEqual({
        path: 'productos[0].name',
        code: 'NAME_REQUIRED',
        messageKey: 'error_messages.products_index_name_required'
      })
    expect(validateProductsIndex({ index: { productos: [{ name: '', repositorio: '/a' }] } })
      .errors.map((e) => e.code)).toEqual(['NAME_REQUIRED'])
    expect(validateProductsIndex({ index: { productos: [{ name: 7, repositorio: '/a' }] } })
      .errors.map((e) => e.code)).toEqual(['NAME_REQUIRED'])
  })

  it('detects a missing repositorio', () => {
    const index = { productos: [{ name: 'ok' }] }
    expect(validateProductsIndex({ index }).errors.map((e) => e.code))
      .toEqual(['REPOSITORIO_REQUIRED'])
  })

  it('detects an entry that is not an object', () => {
    expect(validateProductsIndex({ index: { productos: ['nope'] } }).errors.map((e) => e.code))
      .toEqual(['ENTRY_NOT_OBJECT'])
  })

  it('never throws', () => {
    for (const index of [null, undefined, 42, [], { productos: [null, 1, 'x'] }]) {
      expect(() => validateProductsIndex({ index })).not.toThrow()
    }
  })
})

describe('serializeProductsIndex', () => {
  it('is deterministic: same input, same string', () => {
    const index = frozenIndex()
    expect(serializeProductsIndex({ index })).toBe(serializeProductsIndex({ index }))
  })

  it('sorts alphabetically by name regardless of input order', () => {
    const a = serializeProductsIndex({
      index: {
        productos: [
          { name: 'zulu', repositorio: '/z' },
          { name: 'alpha', repositorio: '/a' }
        ]
      }
    })
    const b = serializeProductsIndex({
      index: {
        productos: [
          { name: 'alpha', repositorio: '/a' },
          { name: 'zulu', repositorio: '/z' }
        ]
      }
    })
    expect(a).toBe(b)
    expect(a.indexOf('alpha')).toBeLessThan(a.indexOf('zulu'))
  })

  it('ends with exactly one newline', () => {
    const text = serializeProductsIndex({ index: frozenIndex() })
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.endsWith('}\n\n')).toBe(false)
  })

  it('emits only the two normative ADR-011 fields', () => {
    const index = {
      productos: [
        { name: 'p', repositorio: '/p', extraneous: 'drop me' } as never
      ]
    }
    const parsed = JSON.parse(serializeProductsIndex({ index })) as ProductsIndex
    expect(Object.keys(parsed.productos[0] ?? {})).toEqual(['name', 'repositorio'])
  })

  it('round-trips through parseProductsIndex', () => {
    const index = frozenIndex()
    const text = serializeProductsIndex({ index })
    const back = parseProductsIndex({ content: text })
    expect(serializeProductsIndex({ index: back })).toBe(text)
  })

  it('rejects a malformed index', () => {
    expect(() => serializeProductsIndex({ index: null as unknown as ProductsIndex }))
      .toThrow(InvalidArgumentError)
  })
})

describe('parseProductsIndex', () => {
  it('parses the ADR-011 format', () => {
    const content = '{"productos":[{"name":"p","repositorio":"/lab/linea/p"}]}'
    expect(parseProductsIndex({ content })).toEqual({
      productos: [{ name: 'p', repositorio: '/lab/linea/p' }]
    })
  })

  it('treats an empty or whitespace file as an empty index', () => {
    expect(parseProductsIndex({ content: '' })).toEqual({ productos: [] })
    expect(parseProductsIndex({ content: '   \n' })).toEqual({ productos: [] })
  })

  it('throws ProductsIndexError on corrupt JSON', () => {
    expect(() => parseProductsIndex({ content: '{ not json' })).toThrow(ProductsIndexError)
    try {
      parseProductsIndex({ content: '{ not json' })
    } catch (error) {
      expect((error as ProductsIndexError).code).toBe('PRODUCTS_INDEX_ERROR')
      expect((error as ProductsIndexError).cause).toBeDefined()
    }
  })

  it('throws ProductsIndexError when the shape is wrong', () => {
    expect(() => parseProductsIndex({ content: '{"products":[]}' })).toThrow(ProductsIndexError)
    expect(() => parseProductsIndex({ content: '[]' })).toThrow(ProductsIndexError)
    expect(() => parseProductsIndex({ content: '{"productos":[{"name":"a"}]}' }))
      .toThrow(ProductsIndexError)
  })

  it('rejects a non-string content', () => {
    expect(() => parseProductsIndex({ content: null as unknown as string }))
      .toThrow(InvalidArgumentError)
    expect(() => parseProductsIndex({ content: 42 as unknown as string }))
      .toThrow(InvalidArgumentError)
  })

  it('drops fields outside the normative shape', () => {
    const content = '{"productos":[{"name":"p","repositorio":"/p","archived":true}]}'
    expect(parseProductsIndex({ content }).productos[0]).toEqual({
      name: 'p',
      repositorio: '/p'
    })
  })
})

describe('addProductToIndex', () => {
  it('adds and returns a NEW index without mutating the input', () => {
    const index = frozenIndex()
    const next = addProductToIndex({ index, product: { name: 'gamma', repositorio: '/g' } })
    expect(next).not.toBe(index)
    expect(index.productos).toHaveLength(2)
    expect(next.productos).toHaveLength(3)
  })

  it('keeps the result sorted', () => {
    const next = addProductToIndex({
      index: frozenIndex(),
      product: { name: 'aaa', repositorio: '/a' }
    })
    expect(next.productos.map((p) => p.name)).toEqual(['aaa', 'alpha', 'beta'])
  })

  it('rejects a duplicate name', () => {
    expect(() => addProductToIndex({
      index: frozenIndex(),
      product: { name: 'alpha', repositorio: '/other' }
    })).toThrow(ProductsIndexError)
  })

  it('rejects malformed products', () => {
    const index = frozenIndex()
    expect(() => addProductToIndex({ index, product: { name: 'bad name', repositorio: '/x' } }))
      .toThrow(InvalidArgumentError)
    expect(() => addProductToIndex({ index, product: { name: 'ok', repositorio: '' } }))
      .toThrow(InvalidArgumentError)
    expect(() => addProductToIndex({ index, product: null as never }))
      .toThrow(InvalidArgumentError)
  })
})

describe('renameProductInIndex', () => {
  it('renames without mutating and keeps the repositorio', () => {
    const index = frozenIndex()
    const next = renameProductInIndex({ index, from: 'alpha', to: 'zeta' })
    expect(next).not.toBe(index)
    expect(index.productos.map((p) => p.name).sort()).toEqual(['alpha', 'beta'])
    expect(next.productos.map((p) => p.name)).toEqual(['beta', 'zeta'])
    expect(next.productos.find((p) => p.name === 'zeta')?.repositorio).toBe('/lab/linea/alpha')
  })

  it('rejects renaming a product that is not there', () => {
    expect(() => renameProductInIndex({ index: frozenIndex(), from: 'ghost', to: 'x' }))
      .toThrow(ProductsIndexError)
  })

  it('rejects renaming onto an existing name', () => {
    expect(() => renameProductInIndex({ index: frozenIndex(), from: 'alpha', to: 'beta' }))
      .toThrow(ProductsIndexError)
  })

  it('allows a no-op rename to the same name', () => {
    const next = renameProductInIndex({ index: frozenIndex(), from: 'alpha', to: 'alpha' })
    expect(next.productos.map((p) => p.name)).toEqual(['alpha', 'beta'])
  })

  it('rejects an invalid target name', () => {
    expect(() => renameProductInIndex({ index: frozenIndex(), from: 'alpha', to: 'bad name' }))
      .toThrow(InvalidArgumentError)
  })

  it('rejects an empty or non-string source name', () => {
    const index = frozenIndex()
    expect(() => renameProductInIndex({ index, from: '', to: 'x' }))
      .toThrow(InvalidArgumentError)
    expect(() => renameProductInIndex({ index, from: null as unknown as string, to: 'x' }))
      .toThrow(InvalidArgumentError)
  })
})

describe('removeProductFromIndex', () => {
  it('removes without mutating the input', () => {
    const index = frozenIndex()
    const next = removeProductFromIndex({ index, name: 'alpha' })
    expect(next).not.toBe(index)
    expect(index.productos).toHaveLength(2)
    expect(next.productos.map((p) => p.name)).toEqual(['beta'])
  })

  it('is idempotent for a product that is not there', () => {
    const index = frozenIndex()
    const next = removeProductFromIndex({ index, name: 'ghost' })
    expect(next.productos.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(() => removeProductFromIndex({ index: next, name: 'ghost' })).not.toThrow()
  })

  it('rejects an empty name', () => {
    expect(() => removeProductFromIndex({ index: frozenIndex(), name: '' }))
      .toThrow(InvalidArgumentError)
  })
})

describe('readProductsIndex / writeProductsIndex', () => {
  it('returns an empty index when the line has no products.json', () => {
    expect(readProductsIndex({ lineDir: makeLineDir() })).toEqual({ productos: [] })
  })

  it('does not throw for a line directory that does not exist', () => {
    const missing = path.join(os.tmpdir(), 'linea-core-no-such-line-xyz')
    expect(readProductsIndex({ lineDir: missing })).toEqual({ productos: [] })
  })

  it('reads an existing index', () => {
    const dir = makeLineDir('{"productos":[{"name":"p","repositorio":"/p"}]}')
    expect(readProductsIndex({ lineDir: dir }).productos).toHaveLength(1)
  })

  it('throws ProductsIndexError when the file exists but is corrupt', () => {
    const dir = makeLineDir('{ corrupt')
    expect(() => readProductsIndex({ lineDir: dir })).toThrow(ProductsIndexError)
  })

  it('writes to products.json at the repository root', () => {
    const dir = makeLineDir()
    const { path: written } = writeProductsIndex({ lineDir: dir, index: frozenIndex() })
    expect(written).toBe(path.join(dir, PRODUCTS_INDEX_PATH))
    expect(PRODUCTS_INDEX_PATH).toBe('products.json')
  })

  it('round-trips through the filesystem', () => {
    const dir = makeLineDir()
    const index = frozenIndex()
    writeProductsIndex({ lineDir: dir, index })
    expect(readProductsIndex({ lineDir: dir })).toEqual({
      productos: [
        { name: 'alpha', repositorio: '/lab/linea/alpha' },
        { name: 'beta', repositorio: '/lab/linea/beta' }
      ]
    })
  })

  it('writes byte-identical content for equivalent indexes', () => {
    const dirA = makeLineDir()
    const dirB = makeLineDir()
    writeProductsIndex({
      lineDir: dirA,
      index: { productos: [{ name: 'b', repositorio: '/b' }, { name: 'a', repositorio: '/a' }] }
    })
    writeProductsIndex({
      lineDir: dirB,
      index: { productos: [{ name: 'a', repositorio: '/a' }, { name: 'b', repositorio: '/b' }] }
    })
    expect(fs.readFileSync(path.join(dirA, PRODUCTS_INDEX_PATH), 'utf8'))
      .toBe(fs.readFileSync(path.join(dirB, PRODUCTS_INDEX_PATH), 'utf8'))
  })

  it('rejects an empty lineDir', () => {
    expect(() => readProductsIndex({ lineDir: '' })).toThrow(InvalidArgumentError)
    expect(() => writeProductsIndex({ lineDir: '', index: emptyProductsIndex() }))
      .toThrow(InvalidArgumentError)
  })
})

describe('reconcileProductsIndex', () => {
  it('case 1 — empty index, no repositories', () => {
    const result = reconcileProductsIndex({ index: emptyProductsIndex(), repositories: [] })
    expect(result).toEqual({ index: { productos: [] }, added: [], removed: [] })
  })

  it('case 2 — entries in the index, no repositories observed: all reported as removed', () => {
    const index = frozenIndex()
    const result = reconcileProductsIndex({ index, repositories: [] })
    expect(result.added).toEqual([])
    expect(result.removed.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(result.index.productos.map((p) => p.name)).toEqual(['alpha', 'beta'])
  })

  it('case 3 — empty index, repositories observed: all added', () => {
    const result = reconcileProductsIndex({
      index: emptyProductsIndex(),
      repositories: [
        { name: 'new-b', repositorio: '/b' },
        { name: 'new-a', repositorio: '/a' }
      ]
    })
    expect(result.added.map((p) => p.name)).toEqual(['new-a', 'new-b'])
    expect(result.removed).toEqual([])
    expect(result.index.productos.map((p) => p.name)).toEqual(['new-a', 'new-b'])
  })

  it('case 4 — mixed: one known, one new, one missing', () => {
    const result = reconcileProductsIndex({
      index: frozenIndex(),
      repositories: [
        { name: 'alpha', repositorio: '/lab/linea/alpha' },
        { name: 'gamma', repositorio: '/lab/linea/gamma' }
      ]
    })
    expect(result.added.map((p) => p.name)).toEqual(['gamma'])
    expect(result.removed.map((p) => p.name)).toEqual(['beta'])
    expect(result.index.productos.map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('does not mutate the input index', () => {
    const index = frozenIndex()
    reconcileProductsIndex({ index, repositories: [{ name: 'gamma', repositorio: '/g' }] })
    expect(index.productos).toHaveLength(2)
  })

  it('keeps the repositorio already recorded for known products', () => {
    const result = reconcileProductsIndex({
      index: frozenIndex(),
      repositories: [{ name: 'alpha', repositorio: '/moved/elsewhere' }]
    })
    expect(result.index.productos.find((p) => p.name === 'alpha')?.repositorio)
      .toBe('/lab/linea/alpha')
  })

  it('rejects malformed repositories', () => {
    const index = frozenIndex()
    expect(() => reconcileProductsIndex({ index, repositories: 'x' as never }))
      .toThrow(InvalidArgumentError)
    expect(() => reconcileProductsIndex({ index, repositories: [{ name: '', repositorio: '/a' }] }))
      .toThrow(InvalidArgumentError)
    expect(() => reconcileProductsIndex({ index, repositories: [{ name: 'a' } as never] }))
      .toThrow(InvalidArgumentError)
  })
})

describe('products index: optional version', () => {
  describe('backwards compatibility with indexes that predate the field', () => {
    it('parses, validates and serialises a legacy index byte for byte', () => {
      expect(() => parseProductsIndex({ content: LEGACY_INDEX_BYTES })).not.toThrow()
      const parsed = parseProductsIndex({ content: LEGACY_INDEX_BYTES })

      expect(validateProductsIndex({ index: parsed })).toEqual({ valid: true, errors: [] })
      expect(serializeProductsIndex({ index: parsed })).toBe(LEGACY_INDEX_BYTES)
    })

    it('never invents a version key, not even as null or empty string', () => {
      const parsed = parseProductsIndex({ content: LEGACY_INDEX_BYTES })
      for (const entry of parsed.productos) {
        expect(Object.keys(entry)).toEqual(['name', 'repositorio'])
        expect('version' in entry).toBe(false)
      }
      const text = serializeProductsIndex({ index: parsed })
      expect(text).not.toContain('version')
      expect(text).not.toContain('null')
    })

    it('survives a read/write round trip on disk without changing a byte', () => {
      const dir = makeLineDir(LEGACY_INDEX_BYTES)
      writeProductsIndex({ lineDir: dir, index: readProductsIndex({ lineDir: dir }) })
      expect(fs.readFileSync(path.join(dir, PRODUCTS_INDEX_PATH), 'utf8'))
        .toBe(LEGACY_INDEX_BYTES)
    })

    it('keeps mutating a legacy index versionless', () => {
      const index = frozenIndex()
      const added = addProductToIndex({ index, product: { name: 'gamma', repositorio: '/g' } })
      const renamed = renameProductInIndex({ index: added, from: 'alpha', to: 'delta' })
      const removed = removeProductFromIndex({ index: renamed, name: 'beta' })
      expect(serializeProductsIndex({ index: removed })).not.toContain('version')
    })
  })

  describe('validateProductsIndex', () => {
    it('accepts an entry with a well-formed version', () => {
      expect(validateProductsIndex({ index: frozenVersionedIndex() }))
        .toEqual({ valid: true, errors: [] })
    })

    it('accepts a mixed index: some entries with version, some without', () => {
      const index = {
        productos: [
          { name: 'alpha', repositorio: '/a', version: '1.0.0' },
          { name: 'beta', repositorio: '/b' }
        ]
      }
      expect(validateProductsIndex({ index })).toEqual({ valid: true, errors: [] })
    })

    it('reports a malformed version instead of throwing', () => {
      for (const version of ['abc', '1.2', '', '1.2.3.4', 'v1.2.3', '1.2.3-rc1']) {
        const index = { productos: [{ name: 'p', repositorio: '/p', version }] }
        expect(() => validateProductsIndex({ index })).not.toThrow()
        expect(validateProductsIndex({ index }).errors, version).toEqual([{
          path: 'productos[0].version',
          code: 'VERSION_INVALID_FORMAT',
          messageKey: 'error_messages.basicData_version_format'
        }])
      }
    })

    it('reports a version that is not even a string', () => {
      for (const version of [1, 1.23, null, true, ['1.0.0'], { major: 1 }]) {
        const index = { productos: [{ name: 'p', repositorio: '/p', version }] }
        expect(() => validateProductsIndex({ index })).not.toThrow()
        expect(validateProductsIndex({ index }).errors.map((e) => e.code), JSON.stringify(version))
          .toEqual(['VERSION_INVALID_FORMAT'])
      }
    })

    it('treats an explicit undefined as absent, not as invalid', () => {
      const index = { productos: [{ name: 'p', repositorio: '/p', version: undefined }] }
      expect(validateProductsIndex({ index })).toEqual({ valid: true, errors: [] })
    })

    it('reports the version alongside the other problems of the same entry', () => {
      const index = { productos: [{ name: 'bad name', repositorio: '', version: 'nope' }] }
      expect(validateProductsIndex({ index }).errors.map((e) => e.code))
        .toEqual(['NAME_INVALID_CHARACTERS', 'REPOSITORIO_REQUIRED', 'VERSION_INVALID_FORMAT'])
    })

    it('is a plain i18n key, never prose (ADR-024)', () => {
      const index = { productos: [{ name: 'p', repositorio: '/p', version: 'abc' }] }
      const [problem] = validateProductsIndex({ index }).errors
      expect(problem?.messageKey).toMatch(/^error_messages\.[a-zA-Z_]+$/)
      expect(problem?.messageKey).not.toContain(' ')
    })
  })

  describe('parseProductsIndex', () => {
    it('keeps a valid version', () => {
      const content = '{"productos":[{"name":"p","repositorio":"/p","version":"1.2.3"}]}'
      expect(parseProductsIndex({ content })).toEqual({
        productos: [{ name: 'p', repositorio: '/p', version: '1.2.3' }]
      })
    })

    it('throws ProductsIndexError when a version is present but malformed', () => {
      const content = '{"productos":[{"name":"p","repositorio":"/p","version":"1.2"}]}'
      expect(() => parseProductsIndex({ content })).toThrow(ProductsIndexError)
    })

    it('still drops fields outside the normative shape', () => {
      const content =
        '{"productos":[{"name":"p","repositorio":"/p","version":"1.0.0","archived":true}]}'
      expect(Object.keys(parseProductsIndex({ content }).productos[0] ?? {}))
        .toEqual(['name', 'repositorio', 'version'])
    })
  })

  describe('serializeProductsIndex', () => {
    it('is deterministic with versions present', () => {
      const index = frozenVersionedIndex()
      expect(serializeProductsIndex({ index })).toBe(serializeProductsIndex({ index }))
    })

    it('emits the same bytes regardless of input order and key order', () => {
      const a = serializeProductsIndex({
        index: {
          productos: [
            { name: 'zulu', repositorio: '/z', version: '0.1.0' },
            { name: 'alpha', repositorio: '/a', version: '3.2.1' }
          ]
        }
      })
      const b = serializeProductsIndex({
        index: {
          productos: [
            { version: '3.2.1', repositorio: '/a', name: 'alpha' },
            { version: '0.1.0', name: 'zulu', repositorio: '/z' }
          ]
        }
      })
      expect(a).toBe(b)
    })

    it('emits the keys in a fixed order: name, repositorio, version', () => {
      const text = serializeProductsIndex({
        index: { productos: [{ version: '1.0.0', name: 'p', repositorio: '/p' }] }
      })
      const parsed = JSON.parse(text) as ProductsIndex
      expect(Object.keys(parsed.productos[0] ?? {})).toEqual(['name', 'repositorio', 'version'])
    })

    it('omits the key for entries without version, in a mixed index', () => {
      const text = serializeProductsIndex({
        index: {
          productos: [
            { name: 'alpha', repositorio: '/a', version: '1.0.0' },
            { name: 'beta', repositorio: '/b' }
          ]
        }
      })
      const parsed = JSON.parse(text) as ProductsIndex
      expect(Object.keys(parsed.productos[0] ?? {})).toEqual(['name', 'repositorio', 'version'])
      expect(Object.keys(parsed.productos[1] ?? {})).toEqual(['name', 'repositorio'])
      expect(text.match(/"version"/g)).toHaveLength(1)
    })

    it('does not emit a version that is null or empty', () => {
      const text = serializeProductsIndex({
        index: {
          productos: [
            { name: 'a', repositorio: '/a', version: '' },
            { name: 'b', repositorio: '/b', version: null as unknown as string }
          ]
        }
      })
      expect(text).not.toContain('version')
    })

    it('round-trips a mixed index without losing or inventing anything', () => {
      const index: ProductsIndex = {
        productos: [
          { name: 'alpha', repositorio: '/a', version: '1.0.0' },
          { name: 'beta', repositorio: '/b' },
          { name: 'gamma', repositorio: '/c', version: '10.20.30' }
        ]
      }
      const text = serializeProductsIndex({ index })
      const back = parseProductsIndex({ content: text })
      expect(back.productos).toEqual([
        { name: 'alpha', repositorio: '/a', version: '1.0.0' },
        { name: 'beta', repositorio: '/b' },
        { name: 'gamma', repositorio: '/c', version: '10.20.30' }
      ])
      expect(serializeProductsIndex({ index: back })).toBe(text)
    })
  })

  describe('addProductToIndex', () => {
    it('records the version when given', () => {
      const next = addProductToIndex({
        index: frozenIndex(),
        product: { name: 'gamma', repositorio: '/g', version: '0.0.1' }
      })
      expect(next.productos.find((p) => p.name === 'gamma')).toEqual({
        name: 'gamma',
        repositorio: '/g',
        version: '0.0.1'
      })
    })

    it('adds no version key when it is omitted or undefined', () => {
      const omitted = addProductToIndex({
        index: emptyProductsIndex(),
        product: { name: 'a', repositorio: '/a' }
      })
      const explicit = addProductToIndex({
        index: emptyProductsIndex(),
        product: { name: 'a', repositorio: '/a', version: undefined }
      })
      expect(Object.keys(omitted.productos[0] ?? {})).toEqual(['name', 'repositorio'])
      expect(explicit).toEqual(omitted)
    })

    it('rejects a malformed version', () => {
      const index = frozenIndex()
      for (const version of ['abc', '1.2', '', 3 as unknown as string]) {
        expect(() => addProductToIndex({
          index,
          product: { name: 'gamma', repositorio: '/g', version }
        }), String(version)).toThrow(InvalidArgumentError)
      }
    })

    it('does not mutate the deep-frozen input index', () => {
      const index = frozenVersionedIndex()
      const next = addProductToIndex({
        index,
        product: { name: 'gamma', repositorio: '/g', version: '0.0.1' }
      })
      expect(next).not.toBe(index)
      expect(index.productos).toHaveLength(2)
      expect(index.productos.map((p) => p.version)).toEqual(['2.0.1', '1.2.3'])
    })
  })

  describe('renameProductInIndex', () => {
    it('keeps the version of the renamed product', () => {
      const next = renameProductInIndex({ index: frozenVersionedIndex(), from: 'alpha', to: 'zeta' })
      expect(next.productos.find((p) => p.name === 'zeta')).toEqual({
        name: 'zeta',
        repositorio: '/lab/linea/alpha',
        version: '1.2.3'
      })
    })

    it('leaves the other entries untouched', () => {
      const next = renameProductInIndex({ index: frozenVersionedIndex(), from: 'alpha', to: 'zeta' })
      expect(next.productos.find((p) => p.name === 'beta')?.version).toBe('2.0.1')
    })

    it('does not give a version to an entry that had none', () => {
      const index: ProductsIndex = {
        productos: [
          { name: 'alpha', repositorio: '/a' },
          { name: 'beta', repositorio: '/b', version: '1.0.0' }
        ]
      }
      const next = renameProductInIndex({ index, from: 'alpha', to: 'zeta' })
      expect(Object.keys(next.productos[1] ?? {})).toEqual(['name', 'repositorio'])
    })

    it('does not mutate the deep-frozen input index', () => {
      const index = frozenVersionedIndex()
      renameProductInIndex({ index, from: 'alpha', to: 'zeta' })
      expect(index.productos.map((p) => p.name)).toEqual(['beta', 'alpha'])
      expect(index.productos.map((p) => p.version)).toEqual(['2.0.1', '1.2.3'])
    })
  })

  describe('removeProductFromIndex', () => {
    it('does not mutate the deep-frozen input index and keeps the survivors intact', () => {
      const index = frozenVersionedIndex()
      const next = removeProductFromIndex({ index, name: 'alpha' })
      expect(next).not.toBe(index)
      expect(index.productos).toHaveLength(2)
      expect(next.productos).toEqual([
        { name: 'beta', repositorio: '/lab/linea/beta', version: '2.0.1' }
      ])
    })
  })

  describe('reconcileProductsIndex', () => {
    it('preserves the version already recorded, even if the caller reports another', () => {
      const result = reconcileProductsIndex({
        index: frozenVersionedIndex(),
        repositories: [{ name: 'alpha', repositorio: '/moved', version: '9.9.9' }]
      })
      expect(result.index.productos.find((p) => p.name === 'alpha')).toEqual({
        name: 'alpha',
        repositorio: '/lab/linea/alpha',
        version: '1.2.3'
      })
    })

    it('keeps the version of the entries it reports as missing (it does not prune, ADR-022)', () => {
      const result = reconcileProductsIndex({
        index: frozenVersionedIndex(),
        repositories: []
      })
      expect(result.removed).toEqual([
        { name: 'alpha', repositorio: '/lab/linea/alpha', version: '1.2.3' },
        { name: 'beta', repositorio: '/lab/linea/beta', version: '2.0.1' }
      ])
      expect(result.index.productos).toHaveLength(2)
    })

    it('carries the version of a newly discovered repository, when there is one', () => {
      const result = reconcileProductsIndex({
        index: emptyProductsIndex(),
        repositories: [
          { name: 'new-a', repositorio: '/a', version: '1.0.0' },
          { name: 'new-b', repositorio: '/b' }
        ]
      })
      expect(result.added).toEqual([
        { name: 'new-a', repositorio: '/a', version: '1.0.0' },
        { name: 'new-b', repositorio: '/b' }
      ])
    })

    it('rejects a malformed version in the observed repositories', () => {
      expect(() => reconcileProductsIndex({
        index: emptyProductsIndex(),
        repositories: [{ name: 'a', repositorio: '/a', version: '1.2' }]
      })).toThrow(InvalidArgumentError)
    })

    it('does not mutate the deep-frozen input index', () => {
      const index = frozenVersionedIndex()
      reconcileProductsIndex({ index, repositories: [{ name: 'gamma', repositorio: '/g' }] })
      expect(index.productos).toHaveLength(2)
    })
  })

  describe('on disk', () => {
    it('round-trips a versioned index through the filesystem', () => {
      const dir = makeLineDir()
      writeProductsIndex({ lineDir: dir, index: frozenVersionedIndex() })
      expect(readProductsIndex({ lineDir: dir })).toEqual({
        productos: [
          { name: 'alpha', repositorio: '/lab/linea/alpha', version: '1.2.3' },
          { name: 'beta', repositorio: '/lab/linea/beta', version: '2.0.1' }
        ]
      })
    })

    it('throws instead of silently dropping a corrupt version', () => {
      const dir = makeLineDir('{"productos":[{"name":"p","repositorio":"/p","version":"nope"}]}')
      expect(() => readProductsIndex({ lineDir: dir })).toThrow(ProductsIndexError)
    })
  })
})
