import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { LocalStore } from '../src/local/store.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-state-cache-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
let count = 0

describe('the state of the host is read once while the file stays as it is', () => {
  it('does not parse the file again for a read, and sees what another process wrote', async () => {
    const dir = path.join(root, `a-${++count}`)
    const store = new LocalStore(dir)
    await store.update((state) => { state.next = 5 })

    const parse = vi.spyOn(JSON, 'parse')
    expect(await store.read((state) => state.next)).toBe(5)
    expect(await store.read((state) => state.next)).toBe(5)
    expect(await store.read((state) => state.next)).toBe(5)
    expect(parse.mock.calls.length).toBeLessThanOrEqual(1)
    parse.mockRestore()

    // another process (the CLI, a second server) replaces the file: the next read has the new content
    const other = new LocalStore(dir)
    await other.update((state) => { state.next = 9 })
    expect(await store.read((state) => state.next)).toBe(9)
  })

  it('shares the state between reads without letting a reader change it, and a failed update leaves it as it was', async () => {
    const dir = path.join(root, `b-${++count}`)
    const store = new LocalStore(dir)
    await store.update((state) => { state.next = 5 })
    await expect(store.read((state) => { state.next = 99 })).rejects.toThrow()
    await expect(store.update((state) => { state.next = 77; throw new Error('cut short') })).rejects.toThrow('cut short')
    expect(await store.read((state) => state.next)).toBe(5)
  })
})
