import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push }),
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeLines(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `l${i}`, name: `line-${i}`, version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
  }))
}

function makeProducts(lines, perLine) {
  const products = []
  for (const line of lines) {
    for (let i = 0; i < perLine; i++) {
      products.push({
        _id: `${line._id}-p${i}`, name: `${line.name}-p${i}`, line: line.name,
        version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
      })
    }
  }
  return products
}

async function mountDashboard({ linesImpl, productsImpl, statusImpl } = {}) {
  vi.resetModules()
  push.mockClear()

  const findEnrolledLines = vi.fn(linesImpl ?? (() => Promise.resolve([])))
  const findEnrolledProducts = vi.fn(productsImpl ?? (() => Promise.resolve([])))
  const allFine = ({ ids }) => Promise.resolve(Object.fromEntries(
    ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]),
  ))
  const getProductsStatus = vi.fn(statusImpl ?? allFine)

  vi.doMock('src/services/lineService', () => ({
    default: { findEnrolledLines },
  }))
  vi.doMock('src/services/productService', () => ({
    default: {
      async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } }, findEnrolledLines: findEnrolledProducts, getProductsStatus },
  }))

  const { default: AppExplorer } = await import('components/layout/AppExplorer.vue')
  const { default: IndexPage } = await import('pages/IndexPage.vue')

  const wrapper = mount(
    {
      components: { AppExplorer, IndexPage },
      template: '<div><AppExplorer /><IndexPage /></div>',
    },
    {
      global: {
        plugins: mountGlobalPlugins(),
        mocks: { $router: { push } },
      },
    },
  )

  return { wrapper, findEnrolledLines, findEnrolledProducts, getProductsStatus }
}

describe('usePortfolio — una sola carga de cartera compartida entre el panel lateral y el dashboard', () => {
  it('pide líneas y productos una sola vez cada uno, y la salud en una petición por grupo (no 2N)', async () => {
    const lines = makeLines(2)
    const products = makeProducts(lines, 3)

    const { findEnrolledLines, findEnrolledProducts, getProductsStatus } =
      await mountDashboard({
        linesImpl: () => Promise.resolve(lines),
        productsImpl: () => Promise.resolve(products),
      })

    await vi.waitFor(() => {
      expect(getProductsStatus).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })

    // the six products travel in one request
    expect(getProductsStatus.mock.calls[0][0].ids).toHaveLength(products.length)
    expect(findEnrolledLines).toHaveBeenCalledTimes(1)
    expect(findEnrolledProducts).toHaveBeenCalledTimes(1)
  }, 15000)

  it('pinta filas y la tarjeta de líneas en cuanto resuelven las líneas, sin esperar a productos ni a la salud', async () => {
    const lines = makeLines(2)
    let resolveProducts

    const { wrapper } = await mountDashboard({
      linesImpl: () => Promise.resolve(lines),
      productsImpl: () => new Promise((resolve) => { resolveProducts = resolve }),
    })

    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.explorer__item--line').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('line-0')
    expect(wrapper.findAll('.lines-card__row')).toHaveLength(2)
    expect(wrapper.find('[name="attention-inbox"] .p-skeleton').exists()).toBe(true)
    expect(wrapper.find('[name="inbox-healthy"]').exists()).toBe(false)

    resolveProducts([])
    await flush()
  }, 15000)

  it('el fallo de una petición de salud no impide pintar el resto', async () => {
    const lines = makeLines(1)
    const products = makeProducts(lines, 3)

    const { wrapper, getProductsStatus } = await mountDashboard({
      linesImpl: () => Promise.resolve(lines),
      productsImpl: () => Promise.resolve(products),
      statusImpl: () => Promise.reject(new Error('boom')),
    })

    await vi.waitFor(() => {
      expect(getProductsStatus).toHaveBeenCalledTimes(1)
    }, { timeout: 10000 })
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.explorer__item--line').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain(lines[0].name)
  }, 15000)

  it('reparte la salud en grupos de diez y no abre más de dos peticiones a la vez', async () => {
    const lines = makeLines(1)
    const products = makeProducts(lines, 25)
    let inFlight = 0
    let maxInFlight = 0

    const { getProductsStatus } = await mountDashboard({
      linesImpl: () => Promise.resolve(lines),
      productsImpl: () => Promise.resolve(products),
      statusImpl: ({ ids }) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlight -= 1
            resolve(Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }])))
          }, 5)
        })
      },
    })

    await vi.waitFor(() => {
      expect(getProductsStatus).toHaveBeenCalledTimes(3)
      expect(inFlight).toBe(0)
    }, { timeout: 10000 })

    expect(getProductsStatus.mock.calls.map((call) => call[0].ids.length).sort((a, b) => a - b)).toEqual([5, 10, 10])
    expect(maxInFlight).toBeLessThanOrEqual(2)
  }, 15000)
})

describe('usePortfolio — los estados solo se piden mientras una pantalla que los muestra está abierta', () => {
  it('al cerrarse el dashboard, recargar la cartera ya no pide el estado de todos los productos', async () => {
    const lines = makeLines(1)
    const products = makeProducts(lines, 3)
    const { wrapper, getProductsStatus } = await mountDashboard({
      linesImpl: () => Promise.resolve(lines),
      productsImpl: () => Promise.resolve(products),
    })

    await vi.waitFor(() => { expect(getProductsStatus).toHaveBeenCalledTimes(1) }, { timeout: 10000 })
    await flush()

    // the person goes to the page of one product: the dashboard closes, the side bar stays
    wrapper.unmount()
    const { refresh } = await import('src/composables/usePortfolio')
    await refresh()
    await flush()
    expect(getProductsStatus).toHaveBeenCalledTimes(1)
  }, 15000)

  it('una pantalla que no muestra estados no los pide ni al cargarse ni al recargar', async () => {
    vi.resetModules()
    const getProductsStatus = vi.fn()
    vi.doMock('src/services/lineService', () => ({ default: { findEnrolledLines: vi.fn().mockResolvedValue([]) } }))
    vi.doMock('src/services/productService', () => ({
      default: {
        async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } }, findEnrolledLines: vi.fn().mockResolvedValue(makeProducts(makeLines(1), 2)), getProductsStatus },
    }))
    const { usePortfolio, refresh } = await import('src/composables/usePortfolio')
    const wrapper = mount({ template: '<div />', setup() { usePortfolio({ statuses: false }); return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    await refresh()
    await flush()
    expect(getProductsStatus).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  async function setupStatuses(productCount) {
    vi.resetModules()
    const calls = []
    const deploymentCalls = []
    const getProductsDeployments = vi.fn(({ signal }) => new Promise((resolve) => { deploymentCalls.push({ signal, resolve }) }))
    const getProductsStatus = vi.fn(({ ids, signal }) => new Promise((resolve, reject) => {
      calls.push({ ids, signal, resolve })
      signal.addEventListener('abort', () => reject(new Error('canceled')))
    }))
    vi.doMock('src/services/lineService', () => ({ default: { findEnrolledLines: vi.fn().mockResolvedValue([]) } }))
    vi.doMock('src/services/productService', () => ({
      default: {
        async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
        findEnrolledLines: vi.fn().mockResolvedValue(makeProducts(makeLines(1), productCount)),
        getProductsStatus,
        getProductsDeployments,
      },
    }))
    const portfolio = await import('src/composables/usePortfolio')
    return { ...portfolio, calls, deploymentCalls, getProductsStatus }
  }

  it('cancelStatuses aborts the requests in flight, drops the queued ones and lets ensureStatuses load again', async () => {
    const { ensureStatuses, cancelStatuses, calls, getProductsStatus } = await setupStatuses(30)
    const { usePortfolio } = await import('src/composables/usePortfolio')
    // wanted by the explorer alone (no page counted as a viewer)
    const wrapper = mount({ template: '<div />', setup() { usePortfolio({ statuses: false }); return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    ensureStatuses()
    await flush()
    expect(calls.length).toBe(2)

    cancelStatuses()
    await flush()
    expect(calls.every((c) => c.signal.aborted)).toBe(true)
    expect(getProductsStatus).toHaveBeenCalledTimes(2) // the third chunk was never asked for

    ensureStatuses()
    await flush()
    expect(getProductsStatus).toHaveBeenCalledTimes(4)
    expect(calls[2].signal.aborted).toBe(false)
    wrapper.unmount()
  })

  it('cancelStatuses does nothing while a page that shows the statuses is open', async () => {
    const { usePortfolio, cancelStatuses, calls } = await setupStatuses(5)
    const wrapper = mount({ template: '<div />', setup() { usePortfolio(); return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    expect(calls.length).toBe(1)
    cancelStatuses()
    expect(calls[0].signal.aborted).toBe(false)
    wrapper.unmount()
  })

  it('a page asking for its own products is not cancelled with the tree', async () => {
    const { ensureStatusesFor, cancelStatuses, calls, deploymentCalls } = await setupStatuses(1)
    const pending = ensureStatusesFor(['extra'])
    await flush()
    cancelStatuses()
    expect(calls[0].signal.aborted).toBe(false)
    calls[0].resolve({ extra: { health: { valid: true } } })
    deploymentCalls[0].resolve({})
    await pending
  })
  it('ensureDeployments is not cancelled with the tree', async () => {
    const { usePortfolio, ensureDeployments, cancelStatuses, calls, deploymentCalls } = await setupStatuses(3)
    const wrapper = mount({ template: '<div />', setup() { usePortfolio({ statuses: false }); return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    const pending = ensureDeployments()
    await flush()
    expect(deploymentCalls.length).toBe(1)
    cancelStatuses()
    expect(deploymentCalls[0].signal.aborted).toBe(false)
    expect(calls[0].signal.aborted).toBe(false)
    deploymentCalls[0].resolve({})
    calls[0].resolve({})
    await pending
    wrapper.unmount()
  })

  it('a cancelled run does not touch healthLoading while the run that replaced it is in flight', async () => {
    const { usePortfolio, ensureStatuses, cancelStatuses, calls, deploymentCalls } = await setupStatuses(3)
    let healthLoading
    const wrapper = mount({ template: '<div />', setup() { healthLoading = usePortfolio({ statuses: false }).healthLoading; return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    ensureStatuses()
    await flush()
    expect(healthLoading.value).toBe(true)
    cancelStatuses()
    expect(healthLoading.value).toBe(false)
    ensureStatuses()
    await flush()
    expect(healthLoading.value).toBe(true) // the aborted run did not clear it
    expect(calls.length).toBe(2)
    calls[1].resolve({})
    deploymentCalls[1].resolve({})
    await flush()
    expect(healthLoading.value).toBe(false)
    wrapper.unmount()
  })

  it('once the page that shows the statuses leaves, cancelStatuses works again', async () => {
    const { usePortfolio, cancelStatuses, calls } = await setupStatuses(3)
    const wrapper = mount({ template: '<div />', setup() { usePortfolio(); return {} } }, { global: { plugins: mountGlobalPlugins() } })
    await flush()
    wrapper.unmount()
    cancelStatuses()
    expect(calls[0].signal.aborted).toBe(true)
  })
})
