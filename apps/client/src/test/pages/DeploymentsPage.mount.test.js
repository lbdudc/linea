import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import DeploymentsPage from 'pages/DeploymentsPage.vue'
import cicdService from 'src/services/cicdService'

vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {}, emit: () => {} },
}))

const { FAKE_RUN, route } = vi.hoisted(() => ({
  route: { query: {} },
  FAKE_RUN: {
    kind: 'generation',
    id: 'g-p1-1.0.0',
    productId: 'p1',
    productName: 'Producto de prueba',
    lineId: 'l1',
    lineName: 'Línea de prueba',
    version: '1.0.0',
    outcome: 'success',
    at: '2026-09-01T10:05:00.000Z',
    link: null,
    stage: 'deployed',
    state: 'ok',
  },
}))

vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))

vi.mock('src/services/cicdService', () => ({
  default: {
    overview: vi.fn().mockResolvedValue({
      days: 14,
      counts: { runningSyncs: 0, awaitingMerge: 0, outdated: 0, failed: 0, products: 1 },
      series: [],
      runs: [FAKE_RUN],
      outdated: [],
    }),
  },
}))
vi.mock('src/services/dashboardService', () => ({ default: { get: vi.fn().mockResolvedValue({ products: { staleness: {} }, deployments: { topFailing: [] } }) } }))
vi.mock('src/services/schedulerService', () => ({
  default: { status: vi.fn().mockResolvedValue({ paused: false, concurrency: 2, running: [], queued: [], upcoming: [], skippedToday: 0, recent: [] }) },
}))
vi.mock('src/services/logService', () => ({
  default: { find: vi.fn().mockResolvedValue([]) },
}))

async function esperarTransicionDialog() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function globalConTransicionReal() {
  return { plugins: mountGlobalPlugins(), stubs: { transition: false } }
}

describe('DeploymentsPage — detalle de una ejecución', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('un clic en la fila abre el detalle junto a la lista, sin diálogo, y se puede cerrar', async () => {
    const wrapper = mount(DeploymentsPage, { attachTo: document.body, global: globalConTransicionReal() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const row = document.body.querySelector('[name="run-g-p1-1.0.0"]')
    expect(row).toBeTruthy()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[name="cicd-run-detail"]')).toBeTruthy()
    expect(document.body.querySelector('[name="cicd-rail"]')).toBeTruthy()
    expect(document.body.querySelector('.p-dialog')).toBeFalsy()

    document.body.querySelector('[name="cicd-back"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[name="cicd-run-detail"]')).toBeFalsy()
  })
})

describe('DeploymentsPage — filtros', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    route.query = {}
    vi.clearAllMocks()
  })

  it('sin filtros pide todo; la SPL y el producto de la dirección acotan lo que se pide', async () => {
    const wrapper = mount(DeploymentsPage, { attachTo: document.body, global: globalConTransicionReal() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(cicdService.overview).toHaveBeenCalledWith(expect.objectContaining({ lineId: null, productId: null }))
    expect(wrapper.find('[name="cicd-filter-line"]').exists()).toBe(true)
    expect(wrapper.find('[name="cicd-filter-product"]').exists()).toBe(true)
    wrapper.unmount()

    route.query = { lineId: 'l1', productId: 'p1' }
    mount(DeploymentsPage, { attachTo: document.body, global: globalConTransicionReal() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(cicdService.overview).toHaveBeenCalledWith(expect.objectContaining({ lineId: 'l1', productId: 'p1' }))
  })
})
