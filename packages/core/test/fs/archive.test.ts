import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { extractArchive, InvalidArgumentError } from '../../src/index.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/archives')
const ARCHIVE = path.join(FIXTURES, 'line-archive.zip')

const created: string[] = []
const makeTmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-arch-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('extractArchive', () => {
  it('extracts into destDir and returns it when no prefix is given', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({ source: ARCHIVE, destDir })
    expect(dir).toBe(path.resolve(destDir))
    expect(fs.existsSync(path.join(dir, 'myline-abc123def'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'other-dir'))).toBe(true)
  })

  it('resolves the top-level directory by prefix, like unZip srcPath', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({ source: ARCHIVE, destDir, prefix: 'myline' })
    expect(path.basename(dir)).toBe('myline-abc123def')
    expect(fs.existsSync(path.join(dir, 'src', 'platform', 'model.uvl'))).toBe(true)
  })

  it('falls back to the first directory when the prefix matches nothing', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({ source: ARCHIVE, destDir, prefix: 'no-such-prefix' })
    expect(path.basename(dir)).toBe('myline-abc123def')
  })

  it('preserves nested file contents byte for byte', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({ source: ARCHIVE, destDir, prefix: 'myline' })
    expect(fs.readFileSync(path.join(dir, 'src', 'platform', 'code', 'app.js'), 'utf8'))
      .toBe('const a = 1;')
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('# MyLine')
  })

  it('yields the files of the line where they were', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({ source: ARCHIVE, destDir, prefix: 'myline' })
    expect(fs.readFileSync(path.join(dir, 'src', 'platform', 'model.uvl'), 'utf8')).toBe('features\n\tMyLine\n\t\tmandatory\n\t\t\tvoid')
  })

  it('accepts the archive as bytes', async () => {
    const destDir = makeTmpDir()
    const { dir } = await extractArchive({
      source: fs.readFileSync(ARCHIVE),
      destDir,
      prefix: 'myline'
    })
    expect(fs.existsSync(path.join(dir, 'src', 'platform', 'model.uvl'))).toBe(true)
  })

  it('leaves no archive.zip behind in destDir', async () => {
    const destDir = makeTmpDir()
    await extractArchive({ source: fs.readFileSync(ARCHIVE), destDir })
    expect(fs.existsSync(path.join(destDir, 'archive.zip'))).toBe(false)
  })

  it('creates destDir when it does not exist', async () => {
    const destDir = path.join(makeTmpDir(), 'deep', 'target')
    const { dir } = await extractArchive({ source: ARCHIVE, destDir })
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  })

  it('rejects malformed arguments', async () => {
    const destDir = makeTmpDir()
    await expect(extractArchive({ source: ARCHIVE, destDir: '' }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(extractArchive({ source: '', destDir }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(extractArchive({ source: 42 as unknown as string, destDir }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(extractArchive({ source: ARCHIVE, destDir, prefix: 7 as unknown as string }))
      .rejects.toThrow(InvalidArgumentError)
  })

  it('rejects a source archive that does not exist', async () => {
    await expect(extractArchive({
      source: path.join(FIXTURES, 'no-such-archive.zip'),
      destDir: makeTmpDir()
    })).rejects.toThrow(InvalidArgumentError)
  })
})
