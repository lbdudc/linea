import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectLocalStore, version } from '../src/index.js'
import { LocalStore } from '../src/local/store.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-health-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
let count = 0
const fresh = (): string => path.join(root, `d-${++count}`)

describe('version', () => {
  it('is the version of package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(version).toBe(pkg.version)
  })
})

describe('inspectLocalStore', () => {
  it('reports a missing folder without making it', () => {
    const dir = fresh()
    const health = inspectLocalStore(dir)
    expect(health).toMatchObject({ exists: false, writable: false, ok: false })
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('reports a healthy folder with state and no lock', async () => {
    const dir = fresh()
    await new LocalStore(dir).update((state) => { state.next = 5 })
    const health = inspectLocalStore(dir, { parse: true })
    expect(health.ok).toBe(true)
    expect(health.writable).toBe(true)
    expect(health.state).toMatchObject({ exists: true, valid: true })
    expect(health.state.bytes).toBeGreaterThan(0)
    expect(health.lock).toEqual({ held: false, pid: null, ownedByThisProcess: false, ageMs: null, stale: false })
  })

  it('sees a lock held by this process, and does not touch it', () => {
    const dir = fresh()
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'state.json.lock'), String(process.pid))
    const health = inspectLocalStore(dir)
    expect(health.lock).toMatchObject({ held: true, pid: process.pid, ownedByThisProcess: true, stale: false })
    expect(health.ok).toBe(true)
    expect(fs.existsSync(path.join(dir, 'state.json.lock'))).toBe(true)
  })

  it('flags a stale lock left by another process', () => {
    const dir = fresh()
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'state.json.lock'), '999999')
    const health = inspectLocalStore(dir, { now: Date.now() + 60_000 })
    expect(health.lock).toMatchObject({ held: true, pid: 999999, ownedByThisProcess: false, stale: true })
    expect(health.ok).toBe(false)
  })

  it('flags a state that does not parse (only when asked to look)', () => {
    const dir = fresh()
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'state.json'), '{ nope')
    expect(inspectLocalStore(dir).ok).toBe(true)
    const health = inspectLocalStore(dir, { parse: true })
    expect(health.state.valid).toBe(false)
    expect(health.ok).toBe(false)
  })
})
