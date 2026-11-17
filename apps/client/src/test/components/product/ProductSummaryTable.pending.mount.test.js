import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductSummaryTable from 'components/product/ProductSummaryTable.vue'

const ROWS = [
  { _id: 'p1', name: 'prod-alpha', version: '1.0.0', createdAt: '01/02/2026', repo: { id: 1, webUrl: 'https://gitlab.example/a' } },
  { _id: 'p2', name: 'prod-beta', version: '2.0.0', createdAt: '03/04/2026', repo: { id: 2, webUrl: 'https://gitlab.example/b' } },
  { _id: 'p3', name: 'prod-gamma', version: '3.0.0', createdAt: '05/06/2026', repo: { id: 3, webUrl: 'https://gitlab.example/c' } },
]

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function mountTable(props = {}) {
  return mount(ProductSummaryTable, {
    attachTo: document.body,
    props: { tableData: ROWS, ...props },
    global: { plugins: mountGlobalPlugins(), mocks: { $router: { push: vi.fn() } } },
  })
}

describe('ProductSummaryTable — saved changes that no generation has deployed', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('marks only the products that have them', () => {
    const wrapper = mountTable({
      deployments: { p1: { pending: false }, p2: { pending: true, version: '2.0.0' }, p3: { pending: null } },
    })

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0].find('.pending-tag').exists()).toBe(false)
    expect(rows[1].find('.pending-tag').exists()).toBe(true)
    expect(rows[2].find('.pending-tag').exists()).toBe(false)
  })

  it('shows nothing before it is known', () => {
    const wrapper = mountTable()
    expect(wrapper.find('.pending-tag').exists()).toBe(false)
  })

  it('selects the products it is asked to, so they can be generated together', async () => {
    const wrapper = mountTable({ deployments: { p2: { pending: true }, p3: { pending: true } } })

    await wrapper.setProps({ selectRequest: { ids: ['p2', 'p3'] } })
    await flush()

    const selection = wrapper.emitted('update:selection').at(-1)[0]
    expect(selection.map((p) => p._id)).toEqual(['p2', 'p3'])
  })

  it('lists only the products of the status it is given', async () => {
    const wrapper = mountTable({
      health: { p1: { isHealthy: true, openMRs: 0 }, p2: { isHealthy: false, openMRs: 2 }, p3: { isHealthy: true, openMRs: 0 } },
      deployments: { p3: { pending: true } },
    })
    const names = () => wrapper.findAll('tbody tr').map((row) => row.find('.product-name').text())

    await wrapper.setProps({ status: 'ok' })
    expect(names()).toEqual(['prod-alpha', 'prod-gamma'])
    await wrapper.setProps({ status: 'bad' })
    expect(names()).toEqual(['prod-beta'])
    await wrapper.setProps({ status: 'pending' })
    expect(names()).toEqual(['prod-gamma'])
    await wrapper.setProps({ status: 'mrs' })
    expect(names()).toEqual(['prod-beta'])
    await wrapper.setProps({ status: 'all', filter: 'alp' })
    expect(names()).toEqual(['prod-alpha'])
  })
})
