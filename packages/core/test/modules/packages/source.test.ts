import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFsFiles,
  createFsPackageSource,
  createMemoryPackageSource,
  InvalidArgumentError,
  ModuleResolutionError,
  readPackageText
} from '../../../src/index.js'
import { MODULAR } from '../helpers.js'

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-source-'))
  created.push(dir)
  return dir
}

describe('createMemoryPackageSource', () => {
  const source = createMemoryPackageSource({
    packages: { 'x:a': { '1.0.0': { '.linea/module.json': '{}', 'code/a.txt': 'a', 'code/b/c.bin': new Uint8Array([1, 2]) } } },
    revisions: { 'x:a': { '1.0.0': 'sha1' } }
  })

  it('lists versions, and none for an unknown package', async () => {
    expect(await source.listVersions({ location: 'x:a' })).toEqual(['1.0.0'])
    expect(await source.listVersions({ location: 'x:zzz' })).toEqual([])
  })

  it('opens a version: reads text and bytes, lists a directory', async () => {
    const files = await source.open({ location: 'x:a', version: '1.0.0' })
    expect(await readPackageText({ files, path: 'code/a.txt' })).toBe('a')
    expect(await files.read({ path: 'code/b/c.bin' })).toEqual(new Uint8Array([1, 2]))
    expect(await files.read({ path: 'nope' })).toBeUndefined()
    expect(await readPackageText({ files, path: 'nope' })).toBeUndefined()
    expect(await files.list({ dir: 'code' })).toEqual(['code/a.txt', 'code/b/c.bin'])
    expect(await files.list({ dir: '/code/b/' })).toEqual(['code/b/c.bin'])
    expect(await files.list({ dir: '' })).toHaveLength(3)
    expect(await files.list({ dir: 'cod' })).toEqual([])
  })

  it('knows the revision of a version', async () => {
    expect(await source.revision?.({ location: 'x:a', version: '1.0.0' })).toBe('sha1')
    expect(await source.revision?.({ location: 'x:a', version: '2.0.0' })).toBeUndefined()
  })

  it('refuses to open a version it does not have', async () => {
    await expect(source.open({ location: 'x:a', version: '9.9.9' })).rejects.toBeInstanceOf(ModuleResolutionError)
  })

  it('has no revisions unless given', async () => {
    const plain = createMemoryPackageSource({ packages: {} })
    expect(await plain.revision?.({ location: 'x:a', version: '1.0.0' })).toBeUndefined()
  })
})

describe('createFsPackageSource', () => {
  const source = createFsPackageSource({ root: MODULAR })

  it('has the one version a folder declares', async () => {
    expect(await source.listVersions({ location: 'file:modules/core' })).toEqual(['1.2.0'])
    expect(await source.listVersions({ location: 'file:metamodels/datamodel' })).toEqual(['2.1.0'])
  })

  it('has no versions for a folder without a manifest, or with a broken one', async () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, 'empty'))
    fs.mkdirSync(path.join(root, 'broken', '.linea'), { recursive: true })
    fs.writeFileSync(path.join(root, 'broken', '.linea', 'module.json'), '{')
    fs.mkdirSync(path.join(root, 'noversion', '.linea'), { recursive: true })
    fs.writeFileSync(path.join(root, 'noversion', '.linea', 'module.json'), '{}')
    const local = createFsPackageSource({ root })
    expect(await local.listVersions({ location: 'file:empty' })).toEqual([])
    expect(await local.listVersions({ location: 'file:broken' })).toEqual([])
    expect(await local.listVersions({ location: 'file:noversion' })).toEqual([])
  })

  it('opens the declared version only', async () => {
    const files = await source.open({ location: 'file:modules/core', version: '1.2.0' })
    expect(await files.list({ dir: 'code' })).toEqual(['code/server/core.js'])
    await expect(source.open({ location: 'file:modules/core', version: '1.0.0' })).rejects.toBeInstanceOf(ModuleResolutionError)
  })

  it('accepts only file: locations inside the workspace', () => {
    expect(() => source.listVersions({ location: 'gitlab://x/y' })).toThrow(InvalidArgumentError)
    expect(() => source.listVersions({ location: 'file:' })).toThrow(InvalidArgumentError)
    expect(() => source.listVersions({ location: 'file:../outside' })).toThrow(/outside the workspace/)
  })
})

describe('createFsFiles', () => {
  it('lists recursively, skips .git and node_modules, and reads files', async () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.git'))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.writeFileSync(path.join(dir, 'a', 'b', 'c.txt'), 'c')
    fs.writeFileSync(path.join(dir, 'top.txt'), 't')
    fs.writeFileSync(path.join(dir, '.git', 'x'), 'x')
    fs.writeFileSync(path.join(dir, 'node_modules', 'y'), 'y')
    const files = createFsFiles({ dir })
    expect(await files.list({ dir: '' })).toEqual(['a/b/c.txt', 'top.txt'])
    expect(await files.list({ dir: 'a' })).toEqual(['a/b/c.txt'])
    expect(await readPackageText({ files, path: 'a/b/c.txt' })).toBe('c')
    expect(await files.read({ path: 'missing' })).toBeUndefined()
    expect(await files.read({ path: '../escape' })).toBeUndefined()
  })

  it('lists nothing for a folder that does not exist', async () => {
    expect(await createFsFiles({ dir: path.join(tmp(), 'nope') }).list({ dir: '' })).toEqual([])
  })
})
