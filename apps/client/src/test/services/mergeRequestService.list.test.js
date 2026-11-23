import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
vi.mock('src/boot/axios', () => ({ api: { get: (...args) => get(...args) } }))

describe('mergeRequestService.list', () => {
  beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: { items: [] } }) })

  it('asks for every state when "All" is picked (the hosts list only the open ones otherwise)', async () => {
    const { default: mergeRequestService } = await import('src/services/mergeRequestService')
    await mergeRequestService.list({ kind: 'line', id: 'L1', filter: { state: 'all', origin: 'all', search: '', labels: [] } })
    expect(get).toHaveBeenCalledWith('/lines/L1/mrs', { params: { state: 'all' } })
  })

  it('names the origin and the labels only when narrowed to them', async () => {
    const { default: mergeRequestService } = await import('src/services/mergeRequestService')
    await mergeRequestService.list({ kind: 'product', id: 'P1', filter: { state: 'opened', origin: 'sync', labels: ['bug', 'ui'], page: 2 } })
    expect(get).toHaveBeenCalledWith('/products/P1/mrs', { params: { state: 'opened', origin: 'sync', labels: 'bug,ui', page: 2 } })
  })
})
