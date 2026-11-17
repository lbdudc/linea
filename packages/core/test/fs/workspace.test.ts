import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureDir,
  fileExists,
  InvalidArgumentError,
  PLATFORM_PATHS,
  PRODUCTS_INDEX_PATH,
  readTextFile,
  resolveLinePaths,
  writeTextFile
} from '../../src/index.js'

const created: string[] = []
const makeTmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-ws-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveLinePaths', () => {
  it('mirrors properties.yml paths.platform.*', () => {
    const dir = makeTmpDir()
    const paths = resolveLinePaths({ lineDir: dir })
    expect(paths.platform).toBe(path.join(dir, PLATFORM_PATHS.root))
    expect(paths.code).toBe(path.join(dir, PLATFORM_PATHS.code))
    expect(paths.model).toBe(path.join(dir, PLATFORM_PATHS.model))
    expect(paths.config).toBe(path.join(dir, PLATFORM_PATHS.config))
    expect(paths.extraJs).toBe(path.join(dir, PLATFORM_PATHS.extraJs))
    expect(paths.transformation).toBe(path.join(dir, PLATFORM_PATHS.transformation))
  })

  it('places the product index at the repository root (ADR-011)', () => {
    const dir = makeTmpDir()
    expect(resolveLinePaths({ lineDir: dir }).productsIndex)
      .toBe(path.join(dir, PRODUCTS_INDEX_PATH))
    expect(PRODUCTS_INDEX_PATH).toBe('products.json')
  })

  it('returns absolute paths even for a relative lineDir', () => {
    const paths = resolveLinePaths({ lineDir: 'some/relative/line' })
    expect(path.isAbsolute(paths.model)).toBe(true)
    expect(path.isAbsolute(paths.productsIndex)).toBe(true)
  })

  it('exposes exactly the documented keys', () => {
    expect(Object.keys(resolveLinePaths({ lineDir: makeTmpDir() })).sort()).toEqual([
      'code', 'config', 'extraJs', 'model', 'platform', 'productsIndex', 'transformation'
    ])
  })

  it('reads nothing and requires nothing to exist', () => {
    const paths = resolveLinePaths({ lineDir: path.join(os.tmpdir(), 'definitely-not-here-123') })
    expect(paths.model).toContain('model.uvl')
  })

  it('rejects an empty lineDir', () => {
    expect(() => resolveLinePaths({ lineDir: '' })).toThrow(InvalidArgumentError)
    expect(() => resolveLinePaths({ lineDir: '   ' })).toThrow(InvalidArgumentError)
    expect(() => resolveLinePaths({ lineDir: null as unknown as string }))
      .toThrow(InvalidArgumentError)
  })
})

describe('ensureDir', () => {
  it('creates nested directories and is idempotent', () => {
    const dir = makeTmpDir()
    const target = path.join(dir, 'a', 'b', 'c')
    expect(ensureDir({ dirPath: target })).toBe(target)
    expect(fs.statSync(target).isDirectory()).toBe(true)
    expect(ensureDir({ dirPath: target })).toBe(target)
  })

  it('rejects an empty path', () => {
    expect(() => ensureDir({ dirPath: '' })).toThrow(InvalidArgumentError)
  })
})

describe('readTextFile / writeTextFile', () => {
  it('round-trips UTF-8 content verbatim', () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, 'deep', 'nested', 'model.uvl')
    const content = 'features\n\tÑandú\n\t\tmandatory\n\t\t\tvoid'
    expect(writeTextFile({ filePath, content })).toBe(filePath)
    expect(readTextFile({ filePath })).toBe(content)
  })

  it('creates parent directories when writing', () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, 'x', 'y', 'z.json')
    writeTextFile({ filePath, content: '{}' })
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('adds no trailing newline', () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, 'exact.txt')
    writeTextFile({ filePath, content: 'no-newline' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe('no-newline')
  })

  it('preserves CRLF and tabs byte for byte', () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, 'bytes.uvl')
    const content = 'features\r\n\tShop\r\n'
    writeTextFile({ filePath, content })
    expect(readTextFile({ filePath })).toBe(content)
  })

  it('rejects bad arguments', () => {
    const dir = makeTmpDir()
    expect(() => readTextFile({ filePath: '' })).toThrow(InvalidArgumentError)
    expect(() => writeTextFile({ filePath: '', content: 'x' })).toThrow(InvalidArgumentError)
    expect(() => writeTextFile({
      filePath: path.join(dir, 'f.txt'),
      content: 1 as unknown as string
    })).toThrow(InvalidArgumentError)
  })

  it('propagates a real filesystem error when reading a missing file', () => {
    expect(() => readTextFile({ filePath: path.join(makeTmpDir(), 'missing.txt') })).toThrow()
  })
})

describe('fileExists', () => {
  it('is true only for regular files', () => {
    const dir = makeTmpDir()
    const filePath = path.join(dir, 'a.txt')
    fs.writeFileSync(filePath, 'x', 'utf8')
    expect(fileExists({ filePath })).toBe(true)
    expect(fileExists({ filePath: dir })).toBe(false)
    expect(fileExists({ filePath: path.join(dir, 'nope.txt') })).toBe(false)
  })

  it('rejects an empty path instead of returning false', () => {
    expect(() => fileExists({ filePath: '' })).toThrow(InvalidArgumentError)
  })
})
