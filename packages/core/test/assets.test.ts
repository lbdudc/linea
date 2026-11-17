import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAssets, copyAssets } from '../scripts/copy-assets.mjs'
import { assetsRoot, InvalidArgumentError, resolveAsset } from '../src/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const created: string[] = []
const makeTmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-assets-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveAsset', () => {
  it('resolves relative to the module, never to process.cwd()', () => {
    expect(path.isAbsolute(assetsRoot())).toBe(true)
    expect(assetsRoot()).toBe(path.join(ROOT, 'src'))
  })

  it('joins segments under the assets root', () => {
    expect(resolveAsset({ segments: ['line', 'templates'] }))
      .toBe(path.join(ROOT, 'src', 'line', 'templates'))
  })

  it('points at the templates directory that the build mirrors into dist/', () => {
    const templates = resolveAsset({ segments: ['line', 'templates'] })
    expect(fs.statSync(templates).isDirectory()).toBe(true)
  })

  it('rejects segments that are not an array of strings', () => {
    expect(() => resolveAsset({ segments: 'line' as unknown as string[] }))
      .toThrow(InvalidArgumentError)
    expect(() => resolveAsset({ segments: [1] as unknown as string[] }))
      .toThrow(InvalidArgumentError)
  })
})

describe('copy-assets build step', () => {
  it('treats every non-TypeScript file under src/ as an asset', () => {
    const source = makeTmpDir()
    fs.mkdirSync(path.join(source, 'line', 'templates'), { recursive: true })
    fs.writeFileSync(path.join(source, 'index.ts'), 'export {}', 'utf8')
    fs.writeFileSync(path.join(source, 'types.d.ts'), 'export {}', 'utf8')
    fs.writeFileSync(path.join(source, 'line', 'templates', 'config.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(source, 'line', 'templates', 'extra.js'), '// x', 'utf8')

    expect(collectAssets(source)).toEqual([
      'line/templates/config.json',
      'line/templates/extra.js'
    ])
  })

  it('mirrors assets into the destination preserving relative paths', () => {
    const source = makeTmpDir()
    const destination = makeTmpDir()
    fs.mkdirSync(path.join(source, 'line', 'templates'), { recursive: true })
    fs.writeFileSync(path.join(source, 'line', 'templates', 'model.uvl'), 'features\n\tX', 'utf8')

    const copied = copyAssets(source, destination)
    expect(copied).toEqual(['line/templates/model.uvl'])
    expect(fs.readFileSync(path.join(destination, 'line', 'templates', 'model.uvl'), 'utf8'))
      .toBe('features\n\tX')
  })

  it('returns an empty list for a directory that does not exist', () => {
    expect(collectAssets(path.join(os.tmpdir(), 'nope-not-here-987'))).toEqual([])
  })

  it('finds the real templates directory of this repository', () => {
    const assets = collectAssets(path.join(ROOT, 'src'))
    expect(assets.some((asset) => asset.startsWith('line/templates/'))).toBe(true)
    expect(assets.filter((asset) => asset.endsWith('.ts'))).toEqual([])
  })
})
