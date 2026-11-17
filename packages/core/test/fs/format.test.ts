import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDirectory, InvalidArgumentError } from '../../src/index.js'

const created: string[] = []

const makeTree = (files: Record<string, string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-fmt-'))
  created.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(dir, ...relative.split('/'))
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, content, 'utf8')
  }
  return dir
}

const read = (dir: string, relative: string): string =>
  fs.readFileSync(path.join(dir, ...relative.split('/')), 'utf8')

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('formatDirectory', () => {
  it('formats a badly formatted JavaScript file', async () => {
    const dir = makeTree({ 'a.js': 'const   x=1;;\n\n\nconst y   =   2\n' })
    const { formatted } = await formatDirectory({ dir })
    expect(formatted).toBe(1)
    expect(read(dir, 'a.js')).toBe('const x = 1;\n\nconst y = 2;\n')
  })

  it('does not rewrite a file that is already formatted', async () => {
    const dir = makeTree({ 'a.js': 'const x = 1;\n' })
    expect((await formatDirectory({ dir })).formatted).toBe(0)
  })

  it('is idempotent: formatting twice yields the same bytes', async () => {
    const dir = makeTree({
      'a.js': 'const   x=1;;\n\n\n',
      'b.json': '{"b":1,   "a":2}',
      'nested/c.css': 'a{color:red}'
    })
    await formatDirectory({ dir })
    const afterFirst = ['a.js', 'b.json', 'nested/c.css'].map((f) => read(dir, f))

    const second = await formatDirectory({ dir })
    const afterSecond = ['a.js', 'b.json', 'nested/c.css'].map((f) => read(dir, f))

    expect(afterSecond).toEqual(afterFirst)
    expect(second.formatted).toBe(0)
  })

  it('walks nested directories', async () => {
    const dir = makeTree({ 'deep/nested/here/a.js': 'const   x=1\n' })
    expect((await formatDirectory({ dir })).formatted).toBe(1)
    expect(read(dir, 'deep/nested/here/a.js')).toBe('const x = 1;\n')
  })

  it('skips files prettier has no parser for, like --ignore-unknown', async () => {
    const dir = makeTree({ 'data.bin': 'not   really   code', 'notes.xyz': 'x   y' })
    const { formatted } = await formatDirectory({ dir })
    expect(formatted).toBe(0)
    expect(read(dir, 'data.bin')).toBe('not   really   code')
  })

  it('does not throw when there is no prettier configuration', async () => {
    const dir = makeTree({ 'a.js': 'const   x=1\n' })
    await expect(formatDirectory({ dir })).resolves.toEqual({ formatted: 1 })
  })

  it('ignores a malformed prettier configuration instead of failing', async () => {
    const dir = makeTree({ '.prettierrc': '{ this is not valid json', 'a.js': 'const   x=1\n' })
    const { formatted } = await formatDirectory({ dir })
    expect(formatted).toBe(0)
    expect(read(dir, 'a.js')).toBe('const   x=1\n')
  })

  it('honours a .prettierrc living IN the formatted directory', async () => {
    const dir = makeTree({
      '.prettierrc': '{ "semi": false, "singleQuote": true }',
      'a.js': 'const x = "hello";\n'
    })
    expect((await formatDirectory({ dir })).formatted).toBe(2)
    expect(read(dir, 'a.js')).toBe("const x = 'hello'\n")
  })

  it('honours a nested .prettierrc for its own subtree', async () => {
    const dir = makeTree({
      'plain/a.js': 'const x = "hello";\n',
      'nosemi/.prettierrc': '{ "semi": false }',
      'nosemi/b.js': 'const y = "hello";\n'
    })
    await formatDirectory({ dir })
    expect(read(dir, 'plain/a.js')).toBe('const x = "hello";\n')
    expect(read(dir, 'nosemi/b.js')).toBe('const y = "hello"\n')
  })

  it('leaves an unparseable file untouched instead of failing the run', async () => {
    const dir = makeTree({
      'broken.js': 'function ( { [ this is not javascript',
      'good.js': 'const   x=1\n'
    })
    const { formatted } = await formatDirectory({ dir })
    expect(formatted).toBe(1)
    expect(read(dir, 'broken.js')).toBe('function ( { [ this is not javascript')
    expect(read(dir, 'good.js')).toBe('const x = 1;\n')
  })

  it('ignores node_modules and other build directories', async () => {
    const dir = makeTree({
      'node_modules/pkg/index.js': 'const   x=1\n',
      'dist/out.js': 'const   y=2\n',
      'src/app.js': 'const   z=3\n'
    })
    expect((await formatDirectory({ dir })).formatted).toBe(1)
    expect(read(dir, 'node_modules/pkg/index.js')).toBe('const   x=1\n')
    expect(read(dir, 'dist/out.js')).toBe('const   y=2\n')
  })

  it('returns 0 for an empty directory', async () => {
    expect(await formatDirectory({ dir: makeTree({}) })).toEqual({ formatted: 0 })
  })

  it('rejects a path that is not an existing directory', async () => {
    await expect(formatDirectory({ dir: '' })).rejects.toThrow(InvalidArgumentError)
    await expect(formatDirectory({ dir: path.join(os.tmpdir(), 'nope-xyz-123') }))
      .rejects.toThrow(InvalidArgumentError)
    const dir = makeTree({ 'a.js': 'x\n' })
    await expect(formatDirectory({ dir: path.join(dir, 'a.js') }))
      .rejects.toThrow(InvalidArgumentError)
  })
})
