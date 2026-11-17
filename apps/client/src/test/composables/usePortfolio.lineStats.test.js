import { describe, it, expect, vi } from 'vitest'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function load({ lines, products, status = {} }) {
  vi.resetModules()
  vi.doMock('src/services/lineService', () => ({ default: { findEnrolledLines: () => Promise.resolve(lines) } }))
  vi.doMock('src/services/productService', () => ({
    default: {
      async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
      findEnrolledLines: () => Promise.resolve(products),
      getProductsStatus: ({ ids }) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, status[id] ?? { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]))),
      getProductsDeployments: () => Promise.resolve({}),
    },
  }))
  const portfolio = await import('src/composables/usePortfolio')
  portfolio.usePortfolio()
  await flush()
  await flush()
  return portfolio
}

const when = '2026-01-01T00:00:00Z'

describe('line statistics', () => {
  it('keeps two lines with the same name apart (keyed by id)', async () => {
    const a = { _id: 'a', name: 'Same' }
    const b = { _id: 'b', name: 'Same' }
    const portfolio = await load({
      lines: [a, b],
      products: [
        { _id: 'p1', name: 'p1', line: 'Same', lineId: 'a', createdAt: when },
        { _id: 'p2', name: 'p2', line: 'Same', lineId: 'b', createdAt: when },
        { _id: 'p3', name: 'p3', line: 'Same', lineId: 'b', createdAt: when },
      ],
      status: { p3: { health: { valid: false }, conflicts: { conflictingMRs: 2 } } },
    })
    expect(portfolio.lineProducts(a).map((p) => p.name)).toEqual(['p1'])
    expect(portfolio.lineProducts(b).map((p) => p.name)).toEqual(['p2', 'p3'])
    expect(portfolio.lineHealth(b)).toMatchObject({ total: 2, ok: 1, bad: 1 })
    expect(portfolio.lineMrCount(a)).toBe(0)
    expect(portfolio.lineMrCount(b)).toBe(2)
  })

  it('falls back to the line name for products without a line id and picks the latest sync', async () => {
    const line = { _id: 'x', name: 'Old' }
    const portfolio = await load({
      lines: [line],
      products: [
        { _id: 'p1', name: 'p1', line: 'Old', createdAt: when, lastSyncAt: '2026-02-01T00:00:00Z' },
        { _id: 'p2', name: 'p2', line: 'Old', createdAt: when, lastSyncAt: '2026-03-01T00:00:00Z' },
      ],
    })
    expect(portfolio.lineProducts(line)).toHaveLength(2)
    expect(portfolio.lineLastSync(line)).toBe(new Date('2026-03-01T00:00:00Z').getTime())
    expect(portfolio.lineHealth({ _id: 'none', name: 'Nobody' })).toMatchObject({ total: 0 })
  })
})
