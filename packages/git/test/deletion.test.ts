import { describe, it, expect, vi } from 'vitest'
import { deleteEmptyLineNamespace, deleteLineOnHost, deleteProductOnHost } from '../src/deletion.js'
import type { GitProvider } from '../src/provider.js'

const line = { repositoryId: 1, namespaceId: 10 }
const products = [
  { id: 'a', repositoryId: 2, namespaceId: 20 },
  { id: 'b', repositoryId: 3, namespaceId: 30 },
]

const fakeProvider = (namespaceIsRepository = false, fail: (id: unknown) => unknown = () => undefined) => {
  const calls: unknown[] = []
  const record = (kind: string) => vi.fn(async ({ id }: { id: unknown }) => {
    calls.push([kind, id])
    const error = fail(id)
    if (error) throw error
  })
  const provider = {
    capabilities: () => ({ deletion: { namespaceIsRepository, delayed: false } }),
    deleteRepository: record('repository'),
    deleteNamespace: record('namespace'),
  } as unknown as GitProvider
  return { provider, calls }
}

describe('deleteLineOnHost', () => {
  it('follows the shape of the host', async () => {
    const nested = fakeProvider()
    const flat = fakeProvider(true)

    await deleteLineOnHost({ provider: nested.provider, token: 't', line, products, keepProductIds: ['b'] })
    await deleteLineOnHost({ provider: flat.provider, token: 't', line, products, keepProductIds: ['b'] })

    expect(nested.calls).toEqual([['repository', 2], ['namespace', 20], ['repository', 1]])
    expect(flat.calls).toEqual([['namespace', 20], ['repository', 1]])
  })

  it('says what it deleted and what stays', async () => {
    const { provider } = fakeProvider()

    const plan = await deleteLineOnHost({ provider, token: 't', line, products, keepProductIds: ['b'] })

    expect(plan).toMatchObject({ deletedProductIds: ['a'], keptProductIds: ['b'], lineSurvives: true })
  })

  it('a retry goes on past what is already gone or already waiting to be deleted', async () => {
    const { provider, calls } = fakeProvider(false, (id) => (
      id === 2 ? Object.assign(new Error('gone'), { status: 404 })
        : id === 20 ? Object.assign(new Error('Project has been already marked for deletion'), { status: 400 })
          : undefined
    ))

    await deleteLineOnHost({ provider, token: 't', line, products, keepProductIds: ['b'] })

    expect(calls).toContainEqual(['repository', 1])
  })

  it('stops at a real failure, before deleting the line', async () => {
    const { provider, calls } = fakeProvider(false, (id) => (id === 2 ? Object.assign(new Error('nope'), { status: 403 }) : undefined))

    await expect(deleteLineOnHost({ provider, token: 't', line, products, keepProductIds: ['b'] })).rejects.toThrow('nope')

    expect(calls).toEqual([['repository', 2]])
  })

  it('touches nothing when asked to keep a product of another line', async () => {
    const { provider, calls } = fakeProvider()

    await expect(deleteLineOnHost({ provider, token: 't', line, products, keepProductIds: ['other'] })).rejects.toThrow('other')

    expect(calls).toEqual([])
  })
})

describe('deleteProductOnHost', () => {
  it('follows the shape of the host', async () => {
    const nested = fakeProvider()
    const flat = fakeProvider(true)

    await deleteProductOnHost({ provider: nested.provider, token: 't', product: products[0]! })
    await deleteProductOnHost({ provider: flat.provider, token: 't', product: products[0]! })

    expect(nested.calls).toEqual([['repository', 2], ['namespace', 20]])
    expect(flat.calls).toEqual([['namespace', 20]])
  })
})

describe('deleteEmptyLineNamespace', () => {
  it('has nothing to do where the namespace went with the repository of the line', async () => {
    const { provider } = fakeProvider(true, () => Object.assign(new Error('gone'), { status: 404 }))

    await expect(deleteEmptyLineNamespace({ provider, token: 't', namespaceId: 10 })).resolves.toBeUndefined()
  })
})
