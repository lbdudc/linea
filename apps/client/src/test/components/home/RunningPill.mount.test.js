import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const { push, get } = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn() }))
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => ({ push }) }))
vi.mock('src/services/dashboardService', () => ({ default: { get } }))
vi.mock('src/boot/ws', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {} } }))
vi.mock('src/services/productService', () => ({ default: { generateProduct: vi.fn(() => new Promise(() => {})) } }))

import RunningPill from 'components/home/RunningPill.vue'
import generationStore from 'stores/generationStore'
import runStore from 'stores/runStore'
import { lastDeployment } from 'stores/lastDeployment'

const mountPill = () => mount(RunningPill, { attachTo: document.body, global: { plugins: mountGlobalPlugins() } })

describe('RunningPill', () => {
  beforeEach(() => {
    generationStore.jobs.splice(0)
    generationStore._queue.splice(0)
    generationStore._processing = false
    runStore.runs.splice(0)
    lastDeployment.value = null
    push.mockClear()
    get.mockReset()
    get.mockResolvedValue({ recent: [] })
    document.body.innerHTML = ''
  })

  it('is not there when nothing runs', () => {
    expect(mountPill().find('[name="running-pill"]').exists()).toBe(false)
  })

  it('counts the generations and the syncs that run', async () => {
    generationStore.enqueue([{ _id: 'p1', name: 'visor', lineName: 'gis' }])
    runStore.begin({ id: 'p2', name: 'qa-ext', lineName: 'qa' })
    const wrapper = mountPill()
    expect(wrapper.find('[name="running-pill"]').text()).toBe('2 en curso')
  })

  it('opens a popover with each one, and the last deployment after them', async () => {
    runStore.begin({ id: 'p2', name: 'qa-ext', lineName: 'qa' })
    lastDeployment.value = { productId: 'p9', productName: 'visor-municipal', version: '1.4.2', outcome: 'success', deployedAt: new Date(Date.now() - 12 * 60_000).toISOString() }
    const wrapper = mountPill()

    await wrapper.find('[name="running-pill"]').trigger('click')

    const panel = wrapper.find('[name="running-panel"]')
    expect(panel.text()).toContain('qa-ext')
    expect(panel.text()).toContain('sincronizando')
    expect(panel.find('[name="running-last"]').text()).toContain('visor-municipal v1.4.2')
    expect(panel.find('.running__dot--ok').exists()).toBe(true)
  })

  it('goes to the product of a row', async () => {
    runStore.begin({ id: 'p2', name: 'qa-ext', lineName: 'qa' })
    const wrapper = mountPill()
    await wrapper.find('[name="running-pill"]').trigger('click')
    await wrapper.find('.running__item').trigger('click')
    expect(push).toHaveBeenCalledWith('/products/p2')
  })

  it('closes on Escape and when the last one ends', async () => {
    const finish = runStore.begin({ id: 'p2', name: 'qa-ext' })
    const wrapper = mountPill()
    await wrapper.find('[name="running-pill"]').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[name="running-panel"]').exists()).toBe(false)

    await wrapper.find('[name="running-pill"]').trigger('click')
    finish()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[name="running-pill"]').exists()).toBe(false)
  })

  it('asks for the last deployment once when it does not know it', async () => {
    get.mockResolvedValue({ recent: [{ productId: 'p1', productName: 'a', version: '1', outcome: 'error', deployedAt: new Date().toISOString() }] })
    runStore.begin({ id: 'p2', name: 'qa-ext' })
    const wrapper = mountPill()
    await wrapper.find('[name="running-pill"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(get).toHaveBeenCalledTimes(1)
    expect(lastDeployment.value.productName).toBe('a')
  })
})
