import { describe, it, expect, vi } from 'vitest'
import { restoreLineOnHost, restoreProductOnHost } from '../src/restoration.js'
import type { GitProvider, PendingDeletion } from '../src/provider.js'

const pending = (id: number, namespaceId: number, scheduled: Partial<PendingDeletion> = {}): PendingDeletion => ({
  id, namespaceId, name: `n${id}`, path: `p${id}`, webUrl: '', deletesOn: null,
  repositoryScheduled: false, namespaceScheduled: false, ancestorScheduled: false, ...scheduled,
})

const fakeProvider = (fail: (kind: string, id: unknown) => unknown = () => undefined) => {
  const calls: unknown[] = []
  const record = (kind: string) => vi.fn(async ({ id }: { id: unknown }) => {
    calls.push([kind, id])
    const error = fail(kind, id)
    if (error) throw error
  })
  const provider = {
    capabilities: () => ({ deletion: { namespaceIsRepository: false, delayed: true } }),
    restoreRepository: record('restore repository'),
    restoreNamespace: record('restore namespace'),
    deleteRepository: record('delete repository'),
    deleteNamespace: record('delete namespace'),
  } as unknown as GitProvider
  return { provider, calls }
}

describe('restoreLineOnHost', () => {
  it('brings the group back and schedules again what was left out of it', async () => {
    const { provider, calls } = fakeProvider()

    const plan = await restoreLineOnHost({
      provider, token: 't',
      line: pending(1, 10, { namespaceScheduled: true }),
      products: [pending(2, 20), pending(3, 30)],
      restoreProductIds: ['2'],
    })

    expect(calls).toEqual([['restore namespace', 10], ['delete repository', 3], ['delete namespace', 30]])
    expect(plan).toMatchObject({ restoredProductIds: ['2'], pendingProductIds: ['3'] })
  })

  it('with nothing chosen, brings every product back', async () => {
    const { provider, calls } = fakeProvider()

    await restoreLineOnHost({
      provider, token: 't',
      line: pending(1, 10, { repositoryScheduled: true }),
      products: [pending(2, 20, { repositoryScheduled: true, namespaceScheduled: true })],
    })

    expect(calls).toEqual([['restore repository', 1], ['restore namespace', 20], ['restore repository', 2]])
  })

  it('stops at a failure, without going on to the products', async () => {
    const { provider, calls } = fakeProvider((kind) => (kind === 'restore repository' ? Object.assign(new Error('nope'), { status: 403 }) : undefined))

    await expect(restoreLineOnHost({
      provider, token: 't',
      line: pending(1, 10, { repositoryScheduled: true }),
      products: [pending(2, 20, { repositoryScheduled: true, namespaceScheduled: true })],
    })).rejects.toMatchObject({ status: 403 })

    expect(calls).toEqual([['restore repository', 1]])
  })
})

describe('restoreProductOnHost', () => {
  it('brings back its group and then its repository', async () => {
    const { provider, calls } = fakeProvider()

    await restoreProductOnHost({ provider, token: 't', product: pending(2, 20, { repositoryScheduled: true, namespaceScheduled: true }) })

    expect(calls).toEqual([['restore namespace', 20], ['restore repository', 2]])
  })
})
