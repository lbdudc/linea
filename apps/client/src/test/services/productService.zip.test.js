import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
const post = vi.fn()
vi.mock('src/boot/axios', () => ({ api: { get: (...args) => get(...args), post: (...args) => post(...args) } }))
vi.mock('../boot/axios', () => ({ api: { get: (...args) => get(...args), post: (...args) => post(...args) } }))

describe('productService archives', () => {
  beforeEach(() => { get.mockReset(); post.mockReset() })

  it('asks for the zip itself, not base64 text', async () => {
    const blob = new Blob(['zip'])
    post.mockResolvedValue({ data: blob })
    get.mockResolvedValue({ data: blob })
    const { default: productService } = await import('src/services/productService')
    expect(await productService.generateZip({ id: 'p1' })).toBe(blob)
    expect(post.mock.calls[0][2]).toMatchObject({ responseType: 'blob', headers: { Accept: 'application/zip' } })
    expect(await productService.versionZip({ id: 'p1', version: '1.0.0' })).toBe(blob)
    expect(get.mock.calls[0][1]).toMatchObject({ responseType: 'blob' })
    expect(await productService.downloadGenerationBundle({ id: 'p1', version: '1.0.0' })).toBe(blob)
  })

  it('reads an error that came as a Blob back into what the server said', async () => {
    const error = Object.assign(new Error('Request failed'), {
      response: { status: 404, data: new Blob([JSON.stringify({ error: 'error_messages.product_not_found' })]) },
    })
    post.mockRejectedValue(error)
    const { default: productService } = await import('src/services/productService')
    await expect(productService.generateZip({ id: 'gone' })).rejects.toMatchObject({
      response: { data: { error: 'error_messages.product_not_found' } },
    })
  })

  it('keeps an error that is not JSON usable (empty body)', async () => {
    post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500, data: new Blob(['<html>']) } }))
    const { default: productService } = await import('src/services/productService')
    await expect(productService.generateZip({ id: 'x' })).rejects.toMatchObject({ response: { data: {} } })
  })
})
