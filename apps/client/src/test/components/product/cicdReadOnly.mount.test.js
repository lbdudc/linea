import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductCicd from 'components/product/ProductCicd.vue'
import LineCicd from 'components/line/LineCicd.vue'

vi.mock('src/boot/axios', () => ({ api: {} }))
vi.mock('src/boot/ws', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {} } }))
const { product, line } = vi.hoisted(() => ({
  product: {
    getCi: vi.fn(), getAutomation: vi.fn(), listMergeRequests: vi.fn().mockResolvedValue([]), saveCi: vi.fn(), setCiRunners: vi.fn(),
  },
  line: { getSync: vi.fn(), getCi: vi.fn() },
}))
vi.mock('src/services/productService', () => ({ default: product }))
vi.mock('src/services/lineService', () => ({ default: line }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const job = { id: 'server_test', stage: 'test', enabled: true, image: 'node:20', script: 'npm test', junit: '', variables: {}, services: [], cache: [] }
const ciOf = (canEdit, runners = {}) => ({
  host: 'gitlab', supported: true, canEdit, rendered: 'x', pipelineFile: '.gitlab-ci.yml', fileInRepository: true,
  config: { enabled: true, tags: ['deploy'], waitForChecks: true, waitMinutes: 30, mode: 'jobs', yaml: '', jobs: [job] },
  runners: { supported: true, instanceRunners: true, runners: [], ...runners },
})
const automationOf = (canEdit) => ({ canEdit, sync: { mode: 'custom', preset: '6h', cron: '', behavior: 'mr' }, generation: {}, lineSync: {} })
const lineSyncOf = (canEdit) => ({ canEdit, sync: { enabled: true, preset: '6h', cron: '', behavior: 'mr' }, products: { total: 1, own: 0, off: 0 } })
const lineCiOf = (canEdit) => ({ host: 'gitlab', supported: true, canEdit, rendered: 'x', pipelineFile: '.gitlab-ci.yml', fileInRepository: true, config: { enabled: true, tags: [], maxProducts: 5, maxSamples: 30, maxCcn: 15, package: 'p', metrics: true, pairwise: true, version: true, release: true, security: true } })

const mounted = []
const mountIt = (component, props) => {
  const wrapper = mount(component, { attachTo: document.body, props, global: { plugins: mountGlobalPlugins() } })
  mounted.push(wrapper)
  return wrapper
}
const mountProduct = async (canEdit, runners) => {
  product.getCi.mockResolvedValue(ciOf(canEdit, runners))
  product.getAutomation.mockResolvedValue(automationOf(canEdit))
  const wrapper = mountIt(ProductCicd, { productId: 'p', initialMode: 'config' })
  await settle()
  return wrapper
}
const switches = (wrapper) => wrapper.findAll('.p-toggleswitch input')
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('the CI/CD configuration of a product', () => {
  it('cannot be changed by who has no permission to', async () => {
    const wrapper = await mountProduct(false)
    expect(wrapper.find('[name="cicd-read-only"]').exists()).toBe(true)
    expect(switches(wrapper).length).toBeGreaterThan(2)
    expect(switches(wrapper).every((input) => input.element.disabled)).toBe(true)
    expect(wrapper.find('input[name="cicd-tags"]').element.readOnly).toBe(true)
    expect(wrapper.find('[name="cicd-add-job"]').exists()).toBe(false)
    expect(wrapper.find('[name="cicd-job-remove-server_test"]').exists()).toBe(false)
    expect(wrapper.findAll('[name="sync-mode"] button').every((button) => button.element.disabled)).toBe(true)
    expect(wrapper.find('[name="sync-preset"] .p-select').classes()).toContain('p-disabled')
    expect(wrapper.find('[name="cicd-save-bar"]').exists()).toBe(false)
  })

  it('can still be read in full: a job opens', async () => {
    const wrapper = await mountProduct(false)
    await wrapper.find('[name="cicd-jobcard-server_test"] .cicd__card-title').trigger('click')
    await settle()
    const script = wrapper.find('[name="cicd-job-script-server_test"]')
    expect(script.element.value).toBe('npm test')
    expect(script.element.readOnly).toBe(true)
  })

  it('can be changed by who has the permission to', async () => {
    const wrapper = await mountProduct(true)
    expect(wrapper.find('[name="cicd-read-only"]').exists()).toBe(false)
    expect(switches(wrapper).some((input) => input.element.disabled)).toBe(false)
    expect(wrapper.find('[name="cicd-add-job"]').exists()).toBe(true)
  })

  it('keeps what to do if the checks do not pass', async () => {
    const wrapper = await mountProduct(true)
    await wrapper.find('[name="cicd-on-failed-choice-merge"]').trigger('click')
    await settle()
    expect(wrapper.find('[name="cicd-save-bar"]').exists()).toBe(true)
    product.saveCi.mockResolvedValue(ciOf(true))
    await wrapper.find('[name="cicd-save"]').trigger('click')
    await settle()
    expect(product.saveCi.mock.calls.at(-1)[0].config.onChecksFailed).toBe('merge')
  })

  it('shows it but does not let it change without permission', async () => {
    const wrapper = await mountProduct(false)
    expect(wrapper.find('[name="cicd-on-failed-choice-merge"]').element.disabled).toBe(true)
  })

  it('does not say there are no runners when the host would not list them', async () => {
    const wrapper = await mountProduct(false, { listed: false })
    expect(wrapper.find('[name="cicd-runners-hidden"]').exists()).toBe(true)
    expect(wrapper.find('[name="cicd-runners-state"]').exists()).toBe(false)
  })

  it('tells of the runners when it can', async () => {
    const wrapper = await mountProduct(true, { listed: true })
    expect(wrapper.find('[name="cicd-runners-hidden"]').exists()).toBe(false)
    expect(wrapper.find('[name="cicd-runners-state"]').exists()).toBe(true)
  })
})

describe('the CI/CD configuration of an SPL', () => {
  const open = async (canEdit) => {
    line.getSync.mockResolvedValue(lineSyncOf(canEdit))
    line.getCi.mockResolvedValue(lineCiOf(canEdit))
    const wrapper = mountIt(LineCicd, { lineId: 'l' })
    await settle()
    const config = wrapper.findAll('.ln-panel button, button').find((button) => /Configuraci/.test(button.text()))
    await config.trigger('click')
    await settle()
    return wrapper
  }

  it('cannot be changed by who has no permission to', async () => {
    const wrapper = await open(false)
    expect(wrapper.findAll('[name="cicd-read-only"]')).toHaveLength(1)
    expect(switches(wrapper).every((input) => input.element.disabled)).toBe(true)
    expect(wrapper.find('[name="line-sync-save"]').exists()).toBe(false)
    expect(wrapper.find('[name="line-ci-save"]').exists()).toBe(false)
  })

  it('can be changed by who has the permission to', async () => {
    const wrapper = await open(true)
    expect(wrapper.find('[name="cicd-read-only"]').exists()).toBe(false)
    expect(wrapper.find('[name="line-ci-save"]').exists()).toBe(true)
  })
})
