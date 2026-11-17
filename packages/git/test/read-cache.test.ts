import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearReadCache, withReadCache } from '../src/read-cache.js'
import type { GitProvider } from '../src/provider.js'

const stub = () => {
  const calls = { getMembers: 0, getAccessLevel: 0, listRepositories: 0, createRepository: 0, getFile: 0 }
  const provider = {
    kind: 'gitlab',
    getMembers: async () => { calls.getMembers++; return [{ username: 'dev', accessLevel: 50 }] },
    getAccessLevel: async () => { calls.getAccessLevel++; return 50 },
    listRepositories: async ({ topic }: { topic: string }) => { calls.listRepositories++; return [{ id: topic }] },
    createRepository: async () => { calls.createRepository++; return {} },
    getFile: async () => { calls.getFile++; return {} }
  } as unknown as GitProvider
  return { calls, cached: withReadCache(provider, 'gitlab|https://git.example') }
}

describe('withReadCache', () => {
  afterEach(() => {
    clearReadCache()
    vi.useRealTimers()
  })

  it('asks the host once for what several permission checks of a request ask for', async () => {
    const { calls, cached } = stub()
    const args = { token: 't', id: 7, username: 'dev' }
    expect(await Promise.all([cached.getAccessLevel(args), cached.getAccessLevel(args), cached.getAccessLevel(args)])).toEqual([50, 50, 50])
    await cached.getAccessLevel(args)
    expect(calls.getMembers).toBe(1)
  })

  it('answers the access level and the member list of a repository with one call', async () => {
    const { calls, cached } = stub()
    await cached.getMembers({ token: 't', id: 7 })
    expect(await cached.getAccessLevel({ token: 't', id: 7, username: 'dev' })).toBe(50)
    expect(await cached.getAccessLevel({ token: 't', id: 7, username: 'nobody' })).toBe(0)
    expect(calls.getMembers).toBe(1)
  })

  it('asks GitHub for the access level of the token, which a member list cannot say', async () => {
    const calls = { getMembers: 0, getAccessLevel: 0 }
    const provider = {
      kind: 'github',
      getMembers: async () => { calls.getMembers++; return [] },
      getAccessLevel: async () => { calls.getAccessLevel++; return 30 }
    } as unknown as GitProvider
    const cached = withReadCache(provider, 'github|https://api.example')
    expect(await cached.getAccessLevel({ token: 't', id: 7, username: 'not-a-collaborator' })).toBe(30)
    expect(calls).toEqual({ getMembers: 0, getAccessLevel: 1 })
  })

  it('keeps one user, one repository and one topic apart from another', async () => {
    const { calls, cached } = stub()
    await cached.getAccessLevel({ token: 'a', id: 7, username: 'dev' })
    await cached.getAccessLevel({ token: 'b', id: 7, username: 'dev' })
    await cached.getAccessLevel({ token: 'a', id: 8, username: 'dev' })
    expect(calls.getMembers).toBe(3)
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    await cached.listRepositories({ token: 'a', topic: 'product' })
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    expect(calls.listRepositories).toBe(2)
  })

  it('answers a list past its time-to-live at once and refreshes it in the background', async () => {
    vi.useFakeTimers()
    const { calls, cached } = stub()
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    vi.advanceTimersByTime(91_000)
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    expect(calls.listRepositories).toBe(2)
  })

  it('does not put back a list that was being refreshed when a write cleared the cache', async () => {
    vi.useFakeTimers()
    let release: (repositories: unknown[]) => void = () => {}
    let asked = 0
    const provider = {
      kind: 'gitlab',
      listRepositories: () => {
        asked++
        return asked === 2 ? new Promise((resolve) => { release = resolve }) : Promise.resolve([{ id: `v${asked}` }])
      },
      createRepository: async () => ({})
    } as unknown as GitProvider
    const cached = withReadCache(provider, 'h')
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    vi.advanceTimersByTime(91_000)
    await cached.listRepositories({ token: 'a', topic: 'spl' })   // stale: the refresh (the second ask) is on its way
    await cached.createRepository({ token: 'a', name: 'x' })      // a write clears what is kept
    release([{ id: 'old' }])                                      // the refresh arrives after it
    await Promise.resolve()
    expect(await cached.listRepositories({ token: 'a', topic: 'spl' })).toEqual([{ id: 'v3' }])
  })

  it('stops answering with a list whose refresh never came back, once it is too old to be shown', async () => {
    vi.useFakeTimers()
    let asked = 0
    const provider = {
      kind: 'gitlab',
      listRepositories: () => (++asked === 2 ? new Promise(() => {}) : Promise.resolve([{ id: asked }]))
    } as unknown as GitProvider
    const cached = withReadCache(provider, 'h')
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    vi.advanceTimersByTime(91_000)
    await cached.listRepositories({ token: 'a', topic: 'spl' })   // starts the refresh that never settles
    vi.advanceTimersByTime(11 * 60_000)
    expect(await cached.listRepositories({ token: 'a', topic: 'spl' })).toEqual([{ id: 3 }])
  })

  it('asks and waits again once a list is too old to be shown', async () => {
    vi.useFakeTimers()
    const { calls, cached } = stub()
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    vi.advanceTimersByTime(11 * 60_000)
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    expect(calls.listRepositories).toBe(2)
  })

  it('asks again for the members after their time-to-live', async () => {
    vi.useFakeTimers()
    const { calls, cached } = stub()
    await cached.getMembers({ token: 'a', id: 1 })
    vi.advanceTimersByTime(6 * 60_000)
    await cached.getMembers({ token: 'a', id: 1 })
    expect(calls.getMembers).toBe(2)
  })

  it('sees its own writes: a repository that was just made is in the next list', async () => {
    const { calls, cached } = stub()
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    await cached.createRepository({ token: 'a', name: 'x' })
    await cached.listRepositories({ token: 'a', topic: 'spl' })
    expect(calls.listRepositories).toBe(2)
  })

  it('does not touch what it does not know about, and does not keep a failure', async () => {
    const calls = { n: 0 }
    const provider = {
      getMembers: async () => { calls.n++; if (calls.n === 1) throw new Error('boom'); return [] },
      getFile: async () => ({ content: 'x' })
    } as unknown as GitProvider
    const cached = withReadCache(provider, 'h')
    await expect(cached.getMembers({ token: 't', id: 1 })).rejects.toThrow('boom')
    expect(await cached.getMembers({ token: 't', id: 1 })).toEqual([])
    expect(await cached.getFile({ token: 't', id: 1, path: 'a', ref: 'main' })).toEqual({ content: 'x' })
  })
})
