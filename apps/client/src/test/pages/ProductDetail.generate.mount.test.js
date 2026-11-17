import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductDetail from 'pages/ProductDetail.vue'
import store from 'stores/productState'
import productService from 'src/services/productService'

vi.mock('src/boot/ws', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))


const { FAKE_SPEC, GENERATED_SPEC } = vi.hoisted(() => ({
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
  GENERATED_SPEC: {
    basicData: {
      name: 'Producto de prueba',
      version: '0.2.0',
      database: {},
      extra: {},
      testEnvironment: { image: '', command: '' },
      languages: ['en', 'es', 'gl'],
      createdAt: '',
      SRID: '4326',
    },
    features: ['server-only-feature'],
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
    generateProduct: vi.fn().mockResolvedValue({
      spec: GENERATED_SPEC,
      conflicts: false,
      changed: true,
    }),
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

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ProductDetail — reconciliación del spec tras generar', () => {
  it('deriva productData.spec de store.getSpec(), no del spec crudo devuelto por el servidor', async () => {
    const wrapper = mountPage()
    await flush()
    await wrapper.vm.$nextTick()

    await wrapper.vm.generateProduct()
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.productData.spec).toEqual(store.getSpec())
    // the features are the index of the feature selection: they stay as the server has them
    expect(wrapper.vm.productData.spec).toHaveProperty('features')
  })

  it('tras generar, la comprobación de cambios pendientes vuelve a decir "sin cambios"', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const wrapper = mountPage()
    await flush()
    await wrapper.vm.$nextTick()

    const pollTick = setIntervalSpy.mock.calls[0][0]
    setIntervalSpy.mockRestore()

    await wrapper.vm.generateProduct()
    await flush()
    await wrapper.vm.$nextTick()

    pollTick()

    expect(wrapper.vm.changes).toBe(false)
  })

  it('un cambio hecho justo antes de generar cuenta como pendiente, sin esperar al sondeo', async () => {
    const wrapper = mountPage()
    await flush()
    await wrapper.vm.$nextTick()
    productService.generateProduct.mockClear()

    // editado en el momento: el sondeo (cada segundo) aún no lo ha visto
    store.basicData.extra = { edited: true }
    await wrapper.vm.generateProduct()

    expect(productService.generateProduct).not.toHaveBeenCalled()
    expect(wrapper.vm.changes).toBe(true)
  })
})
