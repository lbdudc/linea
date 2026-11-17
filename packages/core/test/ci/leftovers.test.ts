import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkLeftovers } from '../../src/index.js'

const config = {
  delimiters: [
    { start: '/*%', end: '%*/' },
    { start: '###<', end: '>###' }
  ],
  ignore: ['build']
}

let dir: string

const write = (file: string, content: string | Buffer): void => {
  const full = path.join(dir, file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leftovers-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('checkLeftovers', () => {
  it('finds nothing in a clean product', () => {
    write('src/a.js', 'const a = 1\n')
    expect(checkLeftovers({ productDir: dir, config })).toEqual([])
  })

  it('finds an annotation in a file type the engine does not process it for', () => {
    write('package.json', '{\n  "name": "/*%= normalize(data.basicData.name) %*/"\n}\n')
    expect(checkLeftovers({ productDir: dir, config })).toEqual([
      { file: 'package.json', line: 2, delimiter: '/*%' }
    ])
  })

  it('skips binaries, ignored folders, node_modules and excluded paths', () => {
    write('logo.png', Buffer.from([0, 1, 2, 0x2f, 0x2a, 0x25]))
    write('build/out.js', '/*% x %*/')
    write('node_modules/m/index.js', '/*% x %*/')
    write('docs/syntax.md', '/*% documented %*/')
    expect(checkLeftovers({ productDir: dir, config, exclude: ['docs/syntax.md'] })).toEqual([])
  })

  it('rejects a directory that does not exist', () => {
    expect(() => checkLeftovers({ productDir: path.join(dir, 'nope'), config })).toThrow(/not a directory/)
  })
})
