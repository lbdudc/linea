import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import FeatureModelEditor from 'pages/FeatureModelEditor.vue'

vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {}, emit: () => {} },
}))

vi.mock('src/components/modules/BangoWorkbench.vue', () => ({
  default: { name: 'BangoWorkbenchStub', template: '<div class="stub-editor" />' },
}))

vi.mock('src/services/lineService', () => ({
  default: {
    getFeatureModel: vi.fn().mockResolvedValue({
      kind: 'plain',
      readOnly: false,
      text: 'featuremodel raiz feature raiz',
      uvl: 'features\n  raiz\n',
      bundle: { grammars: {} },
    }),
    previewFeatureModel: vi.fn().mockResolvedValue({ ok: true, uvl: 'features\n  raiz\n' }),
  },
}))

function mountPage() {
  return mount(FeatureModelEditor, {
    attachTo: document.body,
    props: { id: 'l1' },
    global: {
      plugins: mountGlobalPlugins(),
      mocks: { $router: { go: vi.fn(), push: vi.fn() } },
    },
  })
}

async function montarYEsperar() {
  const wrapper = mountPage()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('FeatureModelEditor — pantalla del rediseño', () => {
  it('las acciones del modelo están a mano (fila de pestañas o barra), bajo la cabecera de la línea', async () => {
    const wrapper = await montarYEsperar()

    expect(wrapper.find('.model-actions').exists()).toBe(true)
    expect(wrapper.find('.detalle-cabecera').exists()).toBe(true)

    expect(wrapper.html()).not.toContain('fm-toolbar')
  })

  it('no queda ninguna etiqueta `<q-…` residual en el HTML renderizado', async () => {
    const wrapper = await montarYEsperar()
    expect(wrapper.html()).not.toMatch(/<q-[a-z]/)
  })

  it('un modelo de solo lectura (una línea de módulos) lo dice, y no se puede guardar', async () => {
    const lineService = (await import('src/services/lineService')).default;
    lineService.getFeatureModel.mockResolvedValueOnce({ kind: 'modular', readOnly: true, text: 'featuremodel raiz feature raiz', uvl: 'features\n  raiz\n', bundle: { grammars: {} } });
    const wrapper = await montarYEsperar()

    expect(wrapper.find('.model-actions__chip').exists()).toBe(true)
  })

  it('el cuerpo es el editor; el panel de análisis es de un plugin y sin él no hay', async () => {
    const wrapper = await montarYEsperar()

    expect(wrapper.find('.fm-body').exists()).toBe(true)
    expect(wrapper.find('.fm-analysis-panel').exists()).toBe(false)
  })

  it('un plugin que pone un componente en el hueco del panel lo ve en la página, con lo que la página sabe del modelo', async () => {
    const { contributions, resetContributions } = await import('src/plugins/registry')
    const seen = []
    contributions.slots['featureModel.panels'] = [{ id: 'x', component: { props: ['lineId', 'uvl', 'isFeatureModel'], setup(props) { seen.push({ ...props }); return () => null } } }]
    await montarYEsperar()
    resetContributions()

    expect(seen.at(-1)).toMatchObject({ lineId: 'l1', isFeatureModel: true, uvl: 'features\n  raiz\n' })
  })
})
