import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// OPT-022: changing tab closes the page of one tab and opens the next; the health and pending changes of the products are not asked
// for again when they were loaded a moment ago.
describe('usePortfolio: changing tab', () => {
  it('does not ask for the statuses again when the next page opens right after the last one closed', async () => {
    vi.resetModules()
    const products = [{ _id: 'p1', name: 'p1', line: 'l', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z' }]
    const getProductsStatus = vi.fn(({ ids }) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]))))
    const getProductsDeployments = vi.fn(({ ids }) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { pending: false }]))))
    vi.doMock('src/services/lineService', () => ({ default: { findEnrolledLines: () => Promise.resolve([{ _id: 'l1', name: 'l', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z' }]) } }))
    vi.doMock('src/services/productService', () => ({ default: { async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } }, findEnrolledLines: () => Promise.resolve(products), getProductsStatus, getProductsDeployments } }))
    const { usePortfolio } = await import('src/composables/usePortfolio')

    const Page = defineComponent({ setup() { usePortfolio(); return () => h('div') } })
    const first = mount(Page)
    await flush(); await flush()
    expect(getProductsStatus).toHaveBeenCalledTimes(1)

    first.unmount()
    const second = mount(Page)
    await flush(); await flush()

    expect(getProductsStatus).toHaveBeenCalledTimes(1)
    second.unmount()
  })
})
