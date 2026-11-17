import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import messages from 'src/i18n'
import ProductDetail from 'pages/ProductDetail.vue'

const T = messages.es

vi.mock('src/boot/ws', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {} } }))

vi.mock('src/components/modules/ProductModelsEditor.vue', () => ({
  default: { name: 'ProductModelsEditorStub', props: ['productId', 'overview', 'metamodel'], template: '<div class="models-editor-stub">{{ metamodel }}</div>' },
  // an async component takes the `default` of the module it loads only if the module says it is one
  __esModule: true,
}))

const { SPEC } = vi.hoisted(() => ({
  SPEC: {
    basicData: { name: 'Shop', version: '0.1.0', database: {}, extra: {}, testEnvironment: { image: '', command: '' }, languages: ['en'], createdAt: '', SRID: '4326' },
    features: [],
    dataModel: { cells: [] },
    statics: [],
  },
}))

vi.mock('src/services/productService', () => ({
  default: {
    findProductById: vi.fn(async () => ({ _id: 'prod-1', lineId: 'line-1', line: { name: 'Gis', modular: true }, members: [], spec: SPEC })),
    getProductHealth: vi.fn().mockResolvedValue({ valid: true }),
  },
}))
vi.mock('src/services/lineService', () => ({ default: { findLineById: vi.fn().mockResolvedValue({ models: [], products: [] }) } }))
vi.mock('src/services/productModelService', () => ({
  default: {
    getProductModels: vi.fn().mockResolvedValue({
      metamodels: [
        { name: 'featureselection', extension: 'featureselection', description: '', requires: [], model: 'selection of Shop {\n}\n', errors: 0 },
        { name: 'basic', extension: 'basic', description: '', requires: [], model: 'basic shop\n', errors: 0 },
        { name: 'datamodel', extension: 'datamodel', description: '', requires: [], model: 'datamodel shop\n', errors: 2 },
        { name: 'forms', extension: 'forms', description: '', requires: [], model: '', errors: 0 },
      ],
      offered: [],
      bundle: { grammars: {} },
    }),
  },
}))

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

const mountPage = async () => {
  const wrapper = mount(ProductDetail, { props: { id: 'prod-1' }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

// the editor is an async component: let its import settle
const settle = async () => {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await flushPromises()
}

const openModelsTab = async (wrapper) => {
  await wrapper.findAll('.p-tab').find((tab) => tab.text().startsWith(T.labels.tab_config)).trigger('click')
  await flushPromises()
}

describe('ProductDetail of a product of a line made of modules', () => {
  it('lists the metamodels in the models tab, in place of the class diagram and the sensors model', async () => {
    const wrapper = await mountPage()
    await openModelsTab(wrapper)
    const names = wrapper.findAll('.model-selector').map((s) => s.find('.model-selector__name').text())
    expect(names).toEqual(['featureselection', 'basic', 'datamodel', 'forms'])
  })

  it('shows how each model stands as the server found it', async () => {
    const wrapper = await mountPage()
    await openModelsTab(wrapper)
    const statuses = wrapper.findAll('.model-selector').map((s) => s.find('.model-selector__status').text())
    expect(statuses.slice(1)).toEqual([T.modules.model_valid, T.modules.model_errors.replace('{n}', '2'), T.labels.model_empty])
  })

  it('opens the editor on the metamodel that is chosen, and keeps it while another model is looked at', async () => {
    const wrapper = await mountPage()
    await openModelsTab(wrapper)
    await settle()
    // the feature selection is the model a product is looked at by first
    expect(wrapper.find('.models-editor-stub').text()).toBe('featureselection')
    await wrapper.findAll('.model-selector')[2].trigger('click')
    await settle()
    expect(wrapper.find('.models-editor-stub').text()).toBe('datamodel')
    await wrapper.findAll('.model-selector')[1].trigger('click')
    await settle()
    expect(wrapper.find('.models-editor-stub').text()).toBe('basic')
  })

  it('asks for the whole answer when the tab is opened while the summary is still on its way', async () => {
    const { default: productModelService } = await import('src/services/productModelService')
    const whole = await productModelService.getProductModels({ id: 'prod-1' })
    let release
    productModelService.getProductModels.mockImplementation(({ summary }) =>
      summary ? new Promise((resolve) => { release = () => resolve({ metamodels: whole.metamodels, summary: true }) }) : Promise.resolve(whole)
    )
    try {
      const wrapper = await mountPage()
      await openModelsTab(wrapper)
      release()
      await settle()
      await wrapper.findAll('.model-selector')[1].trigger('click')
      await settle()
      expect(productModelService.getProductModels).toHaveBeenCalledWith({ id: 'prod-1', summary: false })
      expect(wrapper.find('.models-editor-stub').text()).toBe('basic')
    } finally {
      productModelService.getProductModels.mockReset().mockResolvedValue(whole)
    }
  })

  it('has no separate button for the models in the header: the tab is the one place for them', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[name=product-models]').exists()).toBe(false)
  })
})

describe('ProductDetail — the models tab says there is nothing to show only once it knows', () => {
  const withModels = async (answer) => {
    const productModelService = (await import('src/services/productModelService')).default
    productModelService.getProductModels.mockImplementationOnce(answer).mockImplementationOnce(answer)
  }

  it('shows that it is loading while the models are on their way, not that the line has none', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    await withModels(() => pending)
    const wrapper = await mountPage()
    await openModelsTab(wrapper)
    expect(wrapper.find('[name="models-loading"]').exists()).toBe(true)
    expect(wrapper.find('[name="models-empty"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(T.labels.model_not_configured_desc)
    release({ metamodels: [{ name: 'basic', extension: 'basic', description: '', requires: [], model: 'basic shop\n', errors: 0 }], offered: [], bundle: { grammars: {} } })
    await settle()
    expect(wrapper.find('[name="models-loading"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(T.labels.model_not_configured_desc)
    wrapper.unmount()
  })

  it('does not say the line has no model when the models could not be read', async () => {
    await withModels(() => Promise.reject(Object.assign(new Error('down'), { response: { data: { error: 'error_messages.internal_error' } } })))
    const wrapper = await mountPage()
    await openModelsTab(wrapper)
    await settle()
    expect(wrapper.find('[name="models-loading"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(T.labels.model_not_configured_desc)
    wrapper.unmount()
  })
})
