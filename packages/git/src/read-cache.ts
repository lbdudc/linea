import type { GitProvider } from './provider.js'

/**
 * What a page asks the git host over and over, kept for a while: who is a member of a repository (asked by every permission
 * check, several times in one request) and which repositories a user has with a topic (asked by each list of lines, of products and
 * by the summary of the home page). Per host and per user token. A failure is not kept, and anything that writes to the host
 * (creating, renaming or deleting a repository or a namespace, changing topics, undoing a session) drops everything, so a change made
 * through this process is seen by the next read.
 *
 * A change made somewhere else (somebody added to a project in GitLab's own page) is seen after the time-to-live.
 */

const MEMBERS_TTL_MS = 5 * 60_000
const LISTS_TTL_MS = 90_000
// past its time-to-live a list is still answered at once (and refreshed in the background) for this long: a page never waits for
// GitLab's slowest read just because nobody asked for a minute
const LISTS_STALE_MS = 10 * 60_000
const LIMIT = 500

interface Entry { at: number, value: Promise<unknown>, refreshing?: boolean }

class Recent {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly ttl: number, private readonly staleTtl = 0) {}

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const hit = this.entries.get(key)
    if (hit && now - hit.at < this.ttl) return hit.value as Promise<T>
    if (hit && now - hit.at < this.ttl + this.staleTtl) {
      // stale: answer with what is kept and look again in the background; a failed look leaves the old value for the next ask. What
      // the look finds is dropped when the entry is no longer this one (a write cleared the cache, or a newer read replaced it)
      if (!hit.refreshing) {
        hit.refreshing = true
        load().then(
          (value) => { if (this.entries.get(key) === hit) this.entries.set(key, { at: Date.now(), value: Promise.resolve(value) }) },
          () => { hit.refreshing = false }
        )
      }
      return hit.value as Promise<T>
    }
    if (this.entries.size >= LIMIT) this.entries.delete(this.entries.keys().next().value as string)
    const value = load()
    const entry: Entry = { at: now, value }
    this.entries.set(key, entry)
    value.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key) })
    return value
  }

  clear(): void { this.entries.clear() }
}

const members = new Recent(MEMBERS_TTL_MS)
const lists = new Recent(LISTS_TTL_MS, LISTS_STALE_MS)

/** Forgets what was kept (a write to the host, or a test that wants a clean start). */
export const clearReadCache = (): void => {
  members.clear()
  lists.clear()
}

// the calls that change what the reads above answer
const WRITES = new Set([
  'createNamespace', 'deleteNamespace', 'renameNamespace',
  'createRepository', 'deleteRepository', 'renameRepository', 'addTopic', 'setMember', 'removeMember',
  'restoreRepository', 'restoreNamespace',
  'rollback'
])

/** `provider` with the reads above kept. `host` tells apart the hosts of one process (its address). */
export const withReadCache = (provider: GitProvider, host: string): GitProvider => new Proxy(provider, {
  get(target, property, receiver) {
    const original = Reflect.get(target, property, receiver) as unknown
    if (typeof original !== 'function') return original
    const call = (original as (...args: unknown[]) => unknown).bind(target)
    const cachedMembers = (args: { token: string, id: string | number }): Promise<Array<{ username: string, accessLevel: number }>> =>
      members.get(`${host}|${args.token}|${args.id}`, () => target.getMembers(args) as Promise<Array<{ username: string, accessLevel: number }>>)
    switch (property) {
      case 'getMembers':
        return cachedMembers
      case 'getAccessLevel':
        // GitLab answers from the same kept member list as getMembers: one members/all call serves both. GitHub answers for the token's
        // own user whoever `username` is, and a member list does not hold everyone who can read a repository: it keeps its own answer
        if (target.kind !== 'gitlab') return call
        return async (args: { token: string, id: string | number, username: string }) => {
          const list = await cachedMembers(args)
          return list.find((member) => member.username === args.username)?.accessLevel ?? 0
        }
      case 'listRepositories':
        return (args: { token: string, topic: string }) => lists.get(`${host}|${args.token}|${args.topic}`, () => call(args) as Promise<unknown>)
      default:
        if (typeof property === 'string' && WRITES.has(property)) {
          return async (...args: unknown[]) => {
            try {
              return await call(...args)
            } finally {
              clearReadCache()
            }
          }
        }
        return call
    }
  }
})
