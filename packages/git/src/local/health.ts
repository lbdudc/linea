import fs from 'node:fs'
import path from 'node:path'
import { STALE_MS } from './store.js'

/** What `inspectLocalStore` reports about the folder of the local host. */
export interface LocalStoreHealth {
  /** The folder (resolved). */
  dir: string
  exists: boolean
  /** Whether this process can write in it. */
  writable: boolean
  state: {
    exists: boolean
    bytes: number | null
    modifiedAt: string | null
    /** Whether `state.json` parses; null when not asked for (`parse: true`). */
    valid: boolean | null
  }
  /**
   * The lock file that guards `state.json` against a second process. It is taken for each change and released after it, so it is
   * normally not held. `stale` is a lock older than the takeover time, left by a process that died.
   */
  lock: {
    held: boolean
    pid: number | null
    ownedByThisProcess: boolean
    ageMs: number | null
    stale: boolean
  }
  /** Whether everything above is as it should be: folder writable, state readable, no stale lock. */
  ok: boolean
}

const pidOf = (file: string): number | null => {
  try {
    const pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Looks at the folder of the local host without changing anything (no folder made, no lock taken, no state rewritten): for readiness
 * checks. Never throws.
 */
export const inspectLocalStore = (dataDir: string, { parse = false, now = Date.now() }: { parse?: boolean, now?: number } = {}): LocalStoreHealth => {
  const dir = path.resolve(dataDir)
  const file = path.join(dir, 'state.json')
  const lockFile = `${file}.lock`

  const exists = fs.existsSync(dir)
  let writable = false
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    writable = true
  } catch { /* stays false */ }

  const state: LocalStoreHealth['state'] = { exists: false, bytes: null, modifiedAt: null, valid: null }
  try {
    const stat = fs.statSync(file)
    state.exists = true
    state.bytes = stat.size
    state.modifiedAt = stat.mtime.toISOString()
    if (parse) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'))
        state.valid = true
      } catch {
        state.valid = false
      }
    }
  } catch { /* no state yet: a new folder */ }

  const lock: LocalStoreHealth['lock'] = { held: false, pid: null, ownedByThisProcess: false, ageMs: null, stale: false }
  try {
    const stat = fs.statSync(lockFile)
    lock.held = true
    lock.ageMs = Math.max(0, now - stat.mtimeMs)
    lock.stale = lock.ageMs > STALE_MS
    lock.pid = pidOf(lockFile)
    lock.ownedByThisProcess = lock.pid === process.pid
  } catch { /* not held */ }

  return { dir, exists, writable, state, lock, ok: exists && writable && state.valid !== false && !lock.stale }
}
