import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

vi.mock('src/services/dashboardService', () => ({ default: { get: vi.fn().mockResolvedValue({ deployments: { current: { total: 4, successRate: 75 }, previous: { total: 2, successRate: 80 }, byDay: [], byLine: [{ name: 'line-0', successRate: 75, total: 4, success: 3, warning: 0, error: 1 }], topFailing: [] }, products: { staleness: {}, stalest: [] }, recent: [] }) } }))
vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {}, emit: () => {} },
}))

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push }),
}))

function makeLines(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `l${i}`, name: `line-${i}`, version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
    productCount: 1, webUrl: `https://gitlab.example.com/sig/line-${i}`,
  }))
}

function makeProducts(lines) {
  return lines.map((line) => ({
    _id: `${line.name}-p0`, name: `${line.name}-p0`, line: line.name,
    version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
  }))
}

async function mountIndexPage({ healthImpl, allPipelinesPass = false, prepare } = {}) {
  vi.resetModules()
  // (after the reset: what the page will import afresh, the plugins' registry say)
  await prepare?.()
  push.mockClear()

  const lines = makeLines(3)
  const products = makeProducts(lines)

  vi.doMock('src/services/lineService', () => ({
    default: { findEnrolledLines: vi.fn().mockResolvedValue(lines) },
  }))
  vi.doMock('src/services/productService', () => ({
    default: {
      async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
      findEnrolledLines: vi.fn().mockResolvedValue(products),
      getProductsDeployments: vi.fn().mockResolvedValue({}),
      getProductsPipelines: vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { status: id === 'line-1-p0' && !allPipelinesPass ? 'failed' : 'success', webUrl: null }]))),
      getProductsStatus: vi.fn(async ({ ids }) => {
        const entries = await Promise.all(ids.map(async (id) => {
          const health = await (healthImpl ?? (() => Promise.resolve({ valid: true })))({ id }).catch(() => ({ valid: null }))
          return [id, { health, conflicts: { conflictingMRs: 0 } }]
        }))
        return Object.fromEntries(entries)
      }),
    },
  }))

  const { default: IndexPage } = await import('pages/IndexPage.vue')

  const wrapper = mount(IndexPage, {
    attachTo: document.body,
    global: {
      plugins: mountGlobalPlugins(),
      stubs: { 'router-link': RouterLinkStub },
      mocks: { $router: { push: vi.fn() } },
    },
  })

  return { wrapper, lines, products }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('IndexPage — the home with the inbox and the panel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('has no right sidebar, stats strip or table of lines', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()

    expect(wrapper.find('.dashboard__sidebar').exists()).toBe(false)
    expect(wrapper.find('.lines-table').exists()).toBe(false)
    expect(wrapper.find('.stats').exists()).toBe(false)
    expect(wrapper.text().toLowerCase()).not.toContain('agente')
  })

  it('lists a product once with its reasons when its pipeline failed', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('.inbox__row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('line-1-p0')
    expect(rows[0].text()).toContain('Pipeline fallido')
    expect(wrapper.find('.inbox__title').text()).toContain('1')
  })

  it('shows the inbox and the panel together by default', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()

    expect(wrapper.find('[name="attention-inbox"]').exists()).toBe(true)
    expect(wrapper.find('[name="lines-health-card"]').exists()).toBe(true)
    expect(wrapper.find('.gen-chart').exists()).toBe(true)
  })

  it('keeps the charts of the panel', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()

    expect(wrapper.find('.dashboard__insights').exists()).toBe(true)
  })

  it('hides the panel in the view of the inbox and the inbox in the view of the panel', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()

    await wrapper.find('[name="home-view-inbox"]').trigger('click')
    expect(wrapper.find('[name="attention-inbox"]').exists()).toBe(true)
    expect(wrapper.find('[name="lines-health-card"]').exists()).toBe(false)

    await wrapper.find('[name="home-view-panel"]').trigger('click')
    expect(wrapper.find('[name="attention-inbox"]').exists()).toBe(false)
    expect(wrapper.find('[name="lines-health-card"]').exists()).toBe(true)
    expect(localStorage.getItem('linea-home-view')).toBe('panel')
  })

  it('shows the pill of what needs people in the page, only when the inbox is hidden', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()
    expect(wrapper.find('[name="need-you-pill"]').exists()).toBe(false)

    await wrapper.find('[name="home-view-panel"]').trigger('click')
    expect(wrapper.find('[name="need-you-pill"]').text()).toBe('1 te necesitan')

    await wrapper.find('[name="need-you-pill"]').trigger('click')
    expect(wrapper.find('[name="attention-inbox"]').exists()).toBe(true)
    expect(wrapper.find('[name="need-you-pill"]').exists()).toBe(false)
  })

  it('draws the chart taller in the view of the panel', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()
    expect(wrapper.find('.bars__area').attributes('style')).toContain('112px')

    await wrapper.find('[name="home-view-panel"]').trigger('click')
    expect(wrapper.find('.bars__area').attributes('style')).toContain('260px')
  })

  it('draws a row per line with its health and success rate', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()
    await flush()

    const rows = wrapper.findAll('.lines-card__row')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('line-0')
    expect(rows[0].text()).toContain('75 %')
  })

  it('asks the chart for another period', async () => {
    const { wrapper } = await mountIndexPage()
    await flush()

    await wrapper.find('[name="period-90"]').trigger('click')
    expect(wrapper.find('[name="period-90"]').attributes('aria-pressed')).toBe('true')
  })

  it('says everything is healthy when no product needs anything', async () => {
    const { wrapper } = await mountIndexPage({ allPipelinesPass: true })
    await flush()
    await flush()

    expect(wrapper.find('[name="inbox-healthy"]').exists()).toBe(true)
  })

  it('shows what a plugin puts on the home, and nothing of it when none does', async () => {
    const { h, markRaw } = await import('vue')
    const first = await mountIndexPage()
    await flush()
    expect(first.wrapper.find('.dashboard__widgets').exists()).toBe(false)
    first.wrapper.unmount()

    const widget = markRaw({ props: ['view'], render() { return h('p', { class: 'widget' }, `a widget in ${this.view}`) } })
    const { wrapper } = await mountIndexPage({
      prepare: async () => {
        const { contributions } = await import('src/plugins/registry')
        contributions.slots['dashboard.widgets'] = [{ id: 'p:widget', component: widget }]
      },
    })
    await flush()
    expect(wrapper.find('.dashboard__widgets .widget').text()).toBe('a widget in all')
  })
})
