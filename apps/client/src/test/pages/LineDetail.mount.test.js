import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import LineDetail from 'pages/LineDetail.vue'

vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {}, emit: () => {} },
}))

vi.mock('src/services/lineService', () => ({
  default: {
    findLineById: vi.fn().mockResolvedValue({
      _id: 'line-1',
      name: 'Línea de prueba',
      version: '1.0.0',
      description: '',
      models: ['FM'],
      products: [],
      members: [],
      repoId: 1,
      webUrl: 'https://gitlab.example.test/line-1',
      webIdeUrl: 'https://gitlab.example.test/line-1/-/ide',
    }),
    getFeatureModel: vi.fn().mockResolvedValue({ content: '', featureModelType: 'UVL' }),
  },
}))

vi.mock('src/services/productService', () => ({
  default: {
    async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
    getProductsStatus: vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]))),
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
  return mount(LineDetail, {
    props: { id: 'line-1' },
    global: { plugins: mountGlobalPlugins() },
  })
}

describe('LineDetail — monta sin claves i18n sin traducir', () => {
  it('pinta el nombre de la línea y las etiquetas migradas de PrimeIcons, no claves crudas', async () => {
    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Línea de prueba')
    expect(wrapper.text()).toContain(wrapper.vm.$t('labels.products'))
    expect(wrapper.text()).not.toMatch(/labels\.\w/)

    expect(wrapper.html()).not.toMatch(/<q-[a-zA-Z-]/)
  })

  it('el menú de desbordamiento (antes `q-icon`/`iconColor`) sigue disparando "borrar"', async () => {
    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    const shell = wrapper.findComponent({ name: 'LineShell' })
    expect(shell.vm.confirmDelete).toBe(false)
    const deleteItem = shell.vm.items.find((i) => i.icon === 'pi pi-trash')
    expect(deleteItem).toBeTruthy()
    deleteItem.command()
    expect(shell.vm.confirmDelete).toBe(true)
  })
})

describe('LineDetail — cambiar de línea sin desmontar', () => {
  it('al cambiar el :id recarga: pide la línea nueva y no deja en pantalla la anterior', async () => {
    const lineService = (await import('src/services/lineService')).default
    lineService.findLineById.mockClear()
    lineService.findLineById.mockResolvedValueOnce({
      _id: 'line-2',
      name: 'Otra línea',
      version: '2.0.0',
      description: '',
      models: ['FM'],
      products: [],
      members: [],
      repoId: 2,
      webUrl: 'https://gitlab.example.test/line-2',
      webIdeUrl: 'https://gitlab.example.test/line-2/-/ide',
    })

    const wrapper = mountPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Otra línea')

    await wrapper.setProps({ id: 'line-2' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    expect(lineService.findLineById).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Línea de prueba')
    expect(wrapper.text()).not.toContain('Otra línea')
  })
})
