import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import { bumpVersion } from 'src/utils/bumpVersion'
import GenerateButton from 'components/generation/GenerateButton.vue'
import GenerationPanel from 'components/generation/GenerationPanel.vue'

vi.mock('src/services/productService', () => ({
  default: {
    getProductsDeployments: vi.fn().mockResolvedValue({}),
    getProductsStatus: vi.fn().mockResolvedValue({}),
    getDeployment: vi.fn().mockResolvedValue({ saved: { features: [] }, deployed: null, models: null, version: null }),
    getProductHealth: vi.fn().mockResolvedValue({ valid: true }),
    previewGeneration: vi.fn(),
  },
}))

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('bumpVersion', () => {
  it('sube la parte pedida y pone a cero las siguientes', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(bumpVersion('1.2.3')).toBe('1.2.4')
  })
})

describe('GenerateButton', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function mountButton(props = {}) {
    return mount(GenerateButton, {
      attachTo: document.body,
      props: { productId: 'p1', productName: 'Producto', version: '1.2.3', ...props },
      global: { plugins: mountGlobalPlugins() },
    })
  }

  it('abre la vista previa y emite el incremento elegido', async () => {
    const wrapper = mountButton()
    await wrapper.find('[name="product-generate"]').trigger('click')
    await settle()

    document.body.querySelector('[name="bump-minor"]').click()
    await settle()
    document.body.querySelector('[name="product-generate-confirm"]').click()
    await settle()

    expect(wrapper.emitted('generate')).toEqual([['minor']])
  })

  it('con cambios sin guardar avisa en vez de abrir la vista previa', async () => {
    const wrapper = mountButton({ blocked: true })
    await wrapper.find('[name="product-generate"]').trigger('click')
    await settle()

    expect(wrapper.emitted('blocked')).toHaveLength(1)
    expect(document.body.querySelector('[name="bump-patch"]')).toBeNull()
  })
})

describe('GenerationPanel', () => {
  it('no es modal y refleja cómo terminó la generación', () => {
    const wrapper = mount(GenerationPanel, {
      props: { visible: true, running: false, version: '1.2.4', messages: [{ type: 'warning', message: 'log.conflicts_merge_request', params: ['a', 'b'], createdAt: new Date() }] },
      global: { plugins: mountGlobalPlugins() },
    })
    expect(document.body.querySelector('.p-dialog-mask')).toBeNull()
    expect(wrapper.find('.generation-panel--warning').exists()).toBe(true)
    expect(wrapper.find('[name="generation-panel-close"]').exists()).toBe(true)
  })
})
