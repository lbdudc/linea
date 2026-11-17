import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const COLLAPSED_STORAGE_KEY = 'linea-explorer-collapsed'

const { push, cancelStatuses } = vi.hoisted(() => ({ push: vi.fn(), cancelStatuses: vi.fn() }))

const LINE = { _id: '1', name: 'NuevoTest' }
const PRODUCT = { _id: '9', name: 'SimpleProduct', line: 'NuevoTest' }
const FAILING = { _id: '10', name: 'BrokenProduct', line: 'NuevoTest', version: '1.0.0' }

vi.mock('src/composables/usePortfolio', async () => {
  const { ref } = await import('vue')
  return {
    usePortfolio: () => ({ lines: ref([LINE]), products: ref([PRODUCT, FAILING]) }),
    ensureStatuses: () => Promise.resolve(),
    ensureDeployments: async () => {},
    loadCi: async () => {},
    deploymentsMap: ref({}),
    ciMap: ref({ 10: { status: 'failed', webUrl: null } }),
    cancelStatuses,
    healthOf: () => ({ status: 'ok', reasons: [], isHealthy: true, hasIssue: false, health: { valid: true }, conflicts: { conflictingMRs: 0 } }),
  }
})

vi.mock('src/services/productService', () => ({ default: { listMergeRequests: async () => [] } }))
vi.mock('src/services/productModelService', () => ({ default: { syncProductModels: async () => ({}) } }))
vi.mock('src/services/issueService', () => ({ default: { list: async () => ({ items: [] }) } }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push }),
}))

async function mountExplorer(savedCollapsed) {
  vi.resetModules()
  localStorage.clear()
  if (savedCollapsed) localStorage.setItem(COLLAPSED_STORAGE_KEY, savedCollapsed)

  const { default: AppExplorer } = await import('components/layout/AppExplorer.vue')

  return mount(AppExplorer, { global: { plugins: mountGlobalPlugins() } })
}

const rowOf = (wrapper, label) =>
  wrapper.findAll('.explorer__item').find((f) => f.text().includes(label))

describe('AppExplorer — collapsing the explorer', () => {
  beforeEach(() => { localStorage.clear(); cancelStatuses.mockClear() })
  afterEach(() => localStorage.clear())

  it('starts expanded with nothing saved: filter visible and collapse button', async () => {
    const wrapper = await mountExplorer()

    expect(wrapper.find('.explorer__filter').exists()).toBe(true)
    expect(wrapper.find('.explorer--collapsed').exists()).toBe(false)
    expect(wrapper.find('.explorer__toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.explorer__title').exists()).toBe(false)
  })

  it('cancels the status requests when it unmounts', async () => {
    const wrapper = await mountExplorer()
    wrapper.unmount()
    expect(cancelStatuses).toHaveBeenCalledTimes(1)
  })

  it('the [ key collapses it and the / key opens it and focuses the filter', async () => {
    const wrapper = await mountExplorer()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('aside').classes()).not.toContain('explorer--collapsed')
  })

  it('a click collapses it, persists it, and leaves only the expand button', async () => {
    const wrapper = await mountExplorer()

    await wrapper.find('.explorer__toggle').trigger('click')

    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')
    expect(wrapper.find('.explorer__filter').exists()).toBe(false)
    expect(wrapper.find('.explorer__toggle--rail').attributes('aria-expanded')).toBe('false')
    expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('1')
  })

  it('starts collapsed if that was the last state, and the rail restores it', async () => {
    const wrapper = await mountExplorer('1')

    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')

    await wrapper.find('.explorer__toggle--rail').trigger('click')

    expect(wrapper.find('aside').classes()).not.toContain('explorer--collapsed')
    expect(wrapper.find('.explorer__filter').exists()).toBe(true)
    expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('0')
  })
})

describe('AppExplorer — what each zone of the row does', () => {
  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })
  afterEach(() => localStorage.clear())

  it('the line name only navigates', async () => {
    const wrapper = await mountExplorer()

    await rowOf(wrapper, 'NuevoTest').find('.explorer__link').trigger('click')

    expect(push).toHaveBeenCalledWith('/lines/1')
    expect(wrapper.text()).not.toContain('SimpleProduct')
  })

  it('the chevron only expands and collapses', async () => {
    const wrapper = await mountExplorer()

    await rowOf(wrapper, 'NuevoTest').find('.explorer__chevron').trigger('click')

    expect(push).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('SimpleProduct')

    await rowOf(wrapper, 'NuevoTest').find('.explorer__chevron').trigger('click')

    expect(wrapper.text()).not.toContain('SimpleProduct')
    expect(push).not.toHaveBeenCalled()
  })

  it('a product name navigates to the product', async () => {
    const wrapper = await mountExplorer()

    await rowOf(wrapper, 'NuevoTest').find('.explorer__chevron').trigger('click')
    await rowOf(wrapper, 'SimpleProduct').find('.explorer__link').trigger('click')

    expect(push).toHaveBeenCalledWith('/products/9')
  })
})

describe('AppExplorer — what needs you', () => {
  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })

  it('a line shows how many of its products need you and a product shows its main reason', async () => {
    const wrapper = await mountExplorer()

    expect(rowOf(wrapper, 'NuevoTest').find('.explorer__badge').text()).toBe('1')

    await rowOf(wrapper, 'NuevoTest').find('.explorer__chevron').trigger('click')

    expect(rowOf(wrapper, 'BrokenProduct').find('.explorer__reason').text()).toBe('Pipeline fallido')
    expect(rowOf(wrapper, 'SimpleProduct').find('.explorer__reason').exists()).toBe(false)
  })

  it('the Te necesitan scope lists only the products that need you', async () => {
    const wrapper = await mountExplorer()

    await wrapper.find('[name="scope-need"]').trigger('click')

    expect(wrapper.text()).toContain('BrokenProduct')
    expect(wrapper.text()).not.toContain('SimpleProduct')
  })

  it('the collapsed rail shows the count and a square per line', async () => {
    const wrapper = await mountExplorer('1')

    expect(wrapper.find('.explorer__rail-badge').text()).toBe('1')
    expect(wrapper.find('.explorer__rail-line').text()).toContain('NU')
  })
})

describe('AppExplorer — narrow screen', () => {
  const matchMediaOriginal = window.matchMedia

  function narrowScreen(matches) {
    const listeners = new Set()
    window.matchMedia = (query) => ({
      matches,
      media: query,
      addEventListener: (_, fn) => listeners.add(fn),
      removeEventListener: (_, fn) => listeners.delete(fn),
    })
    return listeners
  }

  beforeEach(() => {
    localStorage.clear()
    push.mockClear()
  })

  afterEach(() => {
    window.matchMedia = matchMediaOriginal
    localStorage.clear()
  })

  it('starts collapsed even if the saved preference says otherwise', async () => {
    narrowScreen(true)

    const wrapper = await mountExplorer('0')

    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')
  })

  it('opening it overlays and dims the background; the overlay closes it again', async () => {
    narrowScreen(true)

    const wrapper = await mountExplorer('0')
    await wrapper.find('.explorer__toggle--rail').trigger('click')

    expect(wrapper.find('aside').classes()).toContain('explorer--overlay')
    expect(wrapper.find('.explorer-overlay').exists()).toBe(true)

    await wrapper.find('.explorer-overlay').trigger('click')

    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')
    expect(wrapper.find('.explorer-overlay').exists()).toBe(false)
  })

  it('opening it on narrow screens does not overwrite the saved preference for wide screens', async () => {
    narrowScreen(true)

    const wrapper = await mountExplorer('0')
    await wrapper.find('.explorer__toggle--rail').trigger('click')

    expect(localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('0')
  })

  it('widening the screen restores the saved preference', async () => {
    const listeners = narrowScreen(true)

    const wrapper = await mountExplorer('0')
    expect(wrapper.find('aside').classes()).toContain('explorer--collapsed')

    for (const fn of listeners) fn({ matches: false })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('aside').classes()).not.toContain('explorer--collapsed')
    expect(wrapper.find('.explorer__filter').exists()).toBe(true)
  })
})
