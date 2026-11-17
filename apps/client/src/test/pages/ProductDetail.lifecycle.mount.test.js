import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductDetail from 'pages/ProductDetail.vue'

const { socketOn, socketOff } = vi.hoisted(() => ({
  socketOn: vi.fn(),
  socketOff: vi.fn(),
}))

vi.mock('src/boot/ws', () => ({
  socket: { on: socketOn, off: socketOff, emit: vi.fn() },
}))


const { FAKE_SPEC } = vi.hoisted(() => ({
  FAKE_SPEC: {
    basicData: {
      name: 'Producto uno',
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

vi.mock('src/services/productModelService', () => ({
  default: {
    getProductModels: vi.fn().mockResolvedValue({ metamodels: [], diagnostics: [], summary: true }),
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

function mountPage(id = 'prod-1') {
  return mount(ProductDetail, {
    props: { id },
    global: { plugins: mountGlobalPlugins() },
  })
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function generationCalls(mockFn) {
  return mockFn.mock.calls.filter((call) => call[0] === 'generation')
}

beforeEach(() => {
  socketOn.mockClear()
  socketOff.mockClear()
})

describe('ProductDetail — desuscripción del socket entre productos', () => {
  it('reutiliza la misma referencia de handler entre on y off al cambiar de producto, para que el off real desuscriba', async () => {
    const wrapper = mountPage('prod-1')
    await flush()
    await wrapper.vm.$nextTick()

    expect(generationCalls(socketOn)).toHaveLength(1)
    const firstHandler = generationCalls(socketOn)[0][1]
    expect(typeof firstHandler).toBe('function')

    await wrapper.setProps({ id: 'prod-2' })
    await flush()
    await wrapper.vm.$nextTick()

    expect(generationCalls(socketOff).at(-1)[1]).toBe(firstHandler)
    expect(generationCalls(socketOn).at(-1)[1]).toBe(firstHandler)

    wrapper.unmount()
    expect(generationCalls(socketOff).at(-1)[1]).toBe(firstHandler)
  })
})

describe('ProductDetail — temporizador de cambios pendientes', () => {
  let setIntervalSpy
  let clearIntervalSpy

  beforeEach(() => {
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
  })

  afterEach(() => {
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('no deja temporizadores vivos al recorrer varios productos y desmontar', async () => {
    const wrapper = mountPage('prod-1')
    await flush()
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ id: 'prod-2' })
    await flush()
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ id: 'prod-3' })
    await flush()
    await wrapper.vm.$nextTick()

    wrapper.unmount()

    expect(setIntervalSpy).toHaveBeenCalledTimes(3)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(3)
  })
})

describe('ProductDetail — recarga al cambiar de producto sin desmontar', () => {
  it('al cambiar el :id recarga: pide el producto nuevo y no deja en pantalla el anterior', async () => {
    const productService = (await import('src/services/productService')).default
    productService.findProductById.mockClear()
    productService.findProductById.mockResolvedValueOnce({
      _id: 'prod-2',
      lineId: 'line-1',
      line: { name: 'Línea de prueba' },
      members: [],
      spec: { ...FAKE_SPEC, basicData: { ...FAKE_SPEC.basicData, name: 'Producto dos' } },
    })

    const wrapper = mountPage('prod-1')
    await flush()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Producto dos')

    await wrapper.setProps({ id: 'prod-2' })
    await flush()
    await wrapper.vm.$nextTick()

    expect(productService.findProductById).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Producto uno')
    expect(wrapper.text()).not.toContain('Producto dos')
  })
})

describe('ProductDetail — cambios sin guardar', () => {
  it('un producto sin línea avisa en naranja y no deja generar ni sincronizar', async () => {
    const { default: productService } = await import('src/services/productService')
    productService.findProductById.mockResolvedValueOnce({
      _id: 'prod-1', lineId: 'line-1', line: { name: 'Línea de prueba', deleted: true }, members: [], spec: FAKE_SPEC,
    })
    const wrapper = mountPage()
    await flush()

    const banner = wrapper.find('[name="product-line-deleted"]')
    expect(banner.text()).toContain('Producto no mantenido')
    expect(banner.classes()).toContain('line-deleted-banner')
    expect(wrapper.find('[name="product-generate"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[name="product-sync"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('un producto sin línea enseña su configuración, pero no deja cambiarla', async () => {
    const { default: productService } = await import('src/services/productService')
    const { default: productModelService } = await import('src/services/productModelService')
    productService.findProductById.mockResolvedValueOnce({
      _id: 'prod-1', lineId: 'line-1', line: { name: 'Línea de prueba', deleted: true }, members: [], spec: FAKE_SPEC,
    })
    productModelService.getProductModels.mockResolvedValueOnce({
      metamodels: [{ name: 'featureselection', extension: 'fs', model: 'selection of Gis: Mapa', requires: [] }],
      offered: [], configuration: [], diagnostics: [], readOnly: true,
    })
    const wrapper = mountPage()
    await flush()
    await flush()

    wrapper.vm.tab = 'models'
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[name="model-readonly-text"]').text()).toContain('selection of Gis: Mapa')
    expect(wrapper.find('[name="models-read-only"]').text()).toContain('Solo lectura')
    expect(wrapper.find('[name="save-models"]').exists()).toBe(false)

    wrapper.vm.tab = 'settings'
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[name="settings-fields"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[name="product-delete"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('un producto con su línea no avisa de nada', async () => {
    const wrapper = mountPage()
    await flush()

    expect(wrapper.find('[name="product-line-deleted"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('con todas las características en el modelo no hay nada sin guardar', async () => {
    const wrapper = mountPage('prod-1')
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.hasUnsavedChanges()).toBe(false)
    wrapper.unmount()
  })
})
