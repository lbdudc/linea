import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diffDirectories, InvalidArgumentError, type FileChange } from '../../src/index.js'

const created: string[] = []

const makeTree = (files: Record<string, string | Uint8Array>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-diff-'))
  created.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(dir, ...relative.split('/'))
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    if (typeof content === 'string') fs.writeFileSync(absolute, content, 'utf8')
    else fs.writeFileSync(absolute, content)
  }
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const byPath = (changes: FileChange[]): Record<string, FileChange> =>
  Object.fromEntries(changes.map((change) => [change.file_path, change]))

describe('diffDirectories', () => {
  it('leaves out what a JVM build tool wrote next to a project', () => {
    const oldDir = makeTree({ 'server/build.gradle': 'same' })
    const newDir = makeTree({
      'server/build.gradle': 'same',
      'server/.gradle/8.5/checksums/checksums.lock': 'x',
      'server/bin/main/App.class': 'x',
      'scripts/bin/run.sh': 'echo hi'
    })

    expect(diffDirectories({ oldDir, newDir }).map((change) => change.file_path)).toEqual(['scripts/bin/run.sh'])
  })

  it('reports create, update and delete in one pass', () => {
    const oldDir = makeTree({
      'keep.txt': 'same',
      'change.txt': 'before',
      'gone.txt': 'bye'
    })
    const newDir = makeTree({
      'keep.txt': 'same',
      'change.txt': 'after',
      'fresh.txt': 'hello'
    })

    const changes = byPath(diffDirectories({ oldDir, newDir }))
    expect(Object.keys(changes).sort()).toEqual(['change.txt', 'fresh.txt', 'gone.txt'])
    expect(changes['change.txt']?.action).toBe('update')
    expect(changes['change.txt']?.content).toBe('after')
    expect(changes['fresh.txt']?.action).toBe('create')
    expect(changes['fresh.txt']?.content).toBe('hello')
    expect(changes['gone.txt']?.action).toBe('delete')
  })

  it('reports nothing for identical trees', () => {
    const files = { 'a.txt': 'x', 'nested/b.txt': 'y' }
    expect(diffDirectories({ oldDir: makeTree(files), newDir: makeTree(files) })).toEqual([])
  })

  it('omits content and encoding on a delete', () => {
    const changes = diffDirectories({
      oldDir: makeTree({ 'gone.txt': 'bye' }),
      newDir: makeTree({})
    })
    expect(changes).toEqual([{ action: 'delete', file_path: 'gone.txt' }])
    expect(changes[0]).not.toHaveProperty('content')
    expect(changes[0]).not.toHaveProperty('encoding')
  })

  it('never deletes README.md', () => {
    const changes = diffDirectories({
      oldDir: makeTree({ 'README.md': 'hand written', 'other.md': 'generated' }),
      newDir: makeTree({})
    })
    expect(changes.map((c) => c.file_path)).toEqual(['other.md'])
  })

  it('excludes README.md at any depth, matching the basename check', () => {
    const changes = diffDirectories({
      oldDir: makeTree({ 'docs/deep/README.md': 'x', 'docs/deep/other.txt': 'y' }),
      newDir: makeTree({})
    })
    expect(changes.map((c) => c.file_path)).toEqual(['docs/deep/other.txt'])
  })

  it('still UPDATES a README.md that changed', () => {
    const changes = diffDirectories({
      oldDir: makeTree({ 'README.md': 'before' }),
      newDir: makeTree({ 'README.md': 'after' })
    })
    expect(changes).toEqual([
      { action: 'update', file_path: 'README.md', content: 'after', encoding: 'text' }
    ])
  })

  it('emits POSIX file_path even for deeply nested files', () => {
    const nested = 'a/b/c/d/e/f/deep.txt'
    const changes = diffDirectories({
      oldDir: makeTree({}),
      newDir: makeTree({ [nested]: 'deep' })
    })
    expect(changes[0]?.file_path).toBe(nested)
    expect(changes[0]?.file_path).not.toContain('\\')
  })

  it('never emits a backslash or an absolute path, whatever the platform', () => {
    const oldDir = makeTree({ 'x/y/old.txt': 'a' })
    const newDir = makeTree({ 'x/y/new.txt': 'b', 'x/z/deeper/other.txt': 'c' })
    for (const change of diffDirectories({ oldDir, newDir })) {
      expect(change.file_path, change.file_path).not.toContain('\\')
      expect(path.isAbsolute(change.file_path), change.file_path).toBe(false)
      expect(change.file_path, change.file_path).not.toContain(os.tmpdir())
    }
  })

  it('encodes binary files as base64 and text as utf-8', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe])
    const changes = byPath(diffDirectories({
      oldDir: makeTree({}),
      newDir: makeTree({ 'img/logo.png': bytes, 'src/app.js': 'const a = 1' })
    }))
    expect(changes['img/logo.png']?.encoding).toBe('base64')
    expect(changes['img/logo.png']?.content).toBe(Buffer.from(bytes).toString('base64'))
    expect(changes['src/app.js']?.encoding).toBe('text')
    expect(changes['src/app.js']?.content).toBe('const a = 1')
  })

  it('detects a binary update by content, not by size', () => {
    const before = new Uint8Array([1, 2, 3, 4])
    const after = new Uint8Array([4, 3, 2, 1])
    const changes = diffDirectories({
      oldDir: makeTree({ 'a.png': before }),
      newDir: makeTree({ 'a.png': after })
    })
    expect(changes[0]?.action).toBe('update')
    expect(changes[0]?.encoding).toBe('base64')
  })

  it('is deterministic: sorted by file_path', () => {
    const oldDir = makeTree({ 'z.txt': 'z', 'a.txt': 'a' })
    const newDir = makeTree({ 'm.txt': 'm', 'b.txt': 'b' })
    const paths = diffDirectories({ oldDir, newDir }).map((c) => c.file_path)
    expect(paths).toEqual([...paths].sort())
  })

  it('treats a missing directory as empty rather than throwing', () => {
    const newDir = makeTree({ 'a.txt': 'a' })
    const missing = path.join(os.tmpdir(), 'linea-core-not-here-xyz')
    expect(diffDirectories({ oldDir: missing, newDir }).map((c) => c.action)).toEqual(['create'])
  })

  it('ignores directories, reporting only files', () => {
    const oldDir = makeTree({ 'keep/a.txt': 'a' })
    const newDir = makeTree({ 'keep/a.txt': 'a', 'empty-dir/placeholder.txt': 'p' })
    const changes = diffDirectories({ oldDir, newDir })
    expect(changes.map((c) => c.file_path)).toEqual(['empty-dir/placeholder.txt'])
  })

  it('rejects malformed arguments', () => {
    const dir = makeTree({})
    expect(() => diffDirectories({ oldDir: '', newDir: dir })).toThrow(InvalidArgumentError)
    expect(() => diffDirectories({ oldDir: dir, newDir: '' })).toThrow(InvalidArgumentError)
    expect(() => diffDirectories({ oldDir: dir, newDir: null as unknown as string }))
      .toThrow(InvalidArgumentError)
  })
})
