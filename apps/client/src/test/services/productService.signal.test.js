import { describe, it, expect, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue({ data: {} }) }))
vi.mock('boot/axios', () => ({ api: { get }, default: { get } }))

import productService from 'src/services/productService'

describe('productService — cancellable status requests', () => {
  it('forwards the abort signal to health and pending-change requests', async () => {
    const { signal } = new AbortController()
    await productService.getProductsStatus({ ids: ['a'], signal })
    await productService.getProductsDeployments({ ids: ['a'], signal })
    expect(get.mock.calls[0][1].signal).toBe(signal)
    expect(get.mock.calls[1][1].signal).toBe(signal)
  })
})
