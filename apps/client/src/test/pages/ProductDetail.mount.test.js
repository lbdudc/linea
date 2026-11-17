import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductDetail from 'pages/ProductDetail.vue'

vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {}, emit: () => {} },
}))


const { FAKE_SPEC } = vi.hoisted(() => ({
  FAKE_SPEC: {
    basicData: {
      name: 'Producto de prueba',
      version: '0.1.0',
      database: {},
      extra: {},
      testEnvironment: { image: '', command: '' },
      languages: ['en', 'es', 'gl'],
      createdAt: '',
      SRID: '4326',
    },
    features: [],
    dataModel: { cells: [] },
    statics: [],
  },
}))

vi.mock('src/services/productService', () => ({
  default: {
    findProductById: vi.fn().mockResolvedValue({
      _id: 'prod-1',
      lineId: 'line-1',
      line: { name: 'Línea de prueba' },
      members: [],
      spec: FAKE_SPEC,
    }),
    getProductHealth: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('src/services/lineService', () => ({
  default: {
    findLineById: vi.fn().mockResolvedValue({ models: [], products: [] }),
  },
}))

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function mountPage() {
  return mount(ProductDetail, {
    props: { id: 'prod-1' },
    global: { plugins: mountGlobalPlugins() },
  })
}

describe('ProductDetail — monta sin claves i18n sin traducir ni residuo Quasar', () => {
  it('pinta el nombre y la versión del producto', async () => {
    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Producto de prueba')
    expect(wrapper.text()).toContain('0.1.0')
    expect(wrapper.text()).not.toMatch(/labels\.\w/)
  })

  it('no queda ninguna etiqueta `<q-…` residual en el HTML renderizado', async () => {
    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.html()).not.toMatch(/<q-[a-zA-Z-]/)
  })

  it('el título va en la cabecera del rediseño, no en la barra de marca', async () => {
    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const title = wrapper.get('h1')
    expect(title.classes()).toContain('detalle-cabecera__title')
    expect(title.text()).toBe('Producto de prueba')

    expect(wrapper.html()).not.toContain('product-toolbar')
  })
})
