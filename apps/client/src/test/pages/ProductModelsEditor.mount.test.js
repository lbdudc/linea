import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import messages from 'src/i18n'

const T = messages.es

// bango's engine and views need a browser with workers and Monaco: the workbench is stood in for, and the page is given the states an
// engine would report
const { handle } = vi.hoisted(() => ({ handle: { emit: null, emitLayouts: null, props: null, texts: {}, views: {}, layouts: {} } }))
vi.mock('src/components/modules/BangoWorkbench.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'BangoWorkbenchStub',
      props: ['bundle', 'metamodels', 'offered', 'metamodel', 'view', 'layouts'],
      emits: ['states', 'layouts'],
      setup(props, { emit, expose }) {
        handle.emit = (states) => emit('states', states)
        handle.emitLayouts = (layouts) => emit('layouts', layouts)
        handle.props = props
        expose({ texts: async () => handle.texts, views: (name) => handle.views[name] ?? [], currentLayouts: () => handle.layouts })
        return () => h('div', { class: 'stub-workbench', 'data-view': props.view, 'data-metamodel': props.metamodel })
      },
    }),
  }
})

const saveProductModel = vi.fn()
const saveProductLayouts = vi.fn()
vi.mock('src/services/productModelService', () => ({
  default: { saveProductModel: (...args) => saveProductModel(...args), saveProductLayouts: (...args) => saveProductLayouts(...args) },
}))

const OVERVIEW = {
  metamodels: [
    { name: 'basic', extension: 'basic', description: 'The name', requires: [], model: 'basic shop\n' },
    { name: 'datamodel', extension: 'datamodel', description: 'Entities', requires: ['basic'], model: 'datamodel shop\n' },
  ],
  offered: [{ origin: 'user-management', metamodel: 'datamodel', file: 'models/datamodel.instance', text: 'datamodel um\nentity UM_User {}\n' }],
  bundle: { grammars: {} },
}

const mountEditor = async (props = {}) => {
  const { default: Editor } = await import('components/modules/ProductModelsEditor.vue')
  const wrapper = mount(Editor, {
    props: { productId: 'p1', overview: OVERVIEW, metamodel: 'datamodel', ...props },
    attachTo: document.body,
    global: { plugins: mountGlobalPlugins() },
  })
  await flushPromises()
  return wrapper
}

const state = (metamodel, text, problems = []) => ({ metamodel, text, problems, available: true })
const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text))

afterEach(() => {
  document.body.innerHTML = ''
  saveProductModel.mockReset()
  saveProductLayouts.mockReset()
  handle.texts = {}
  handle.views = {}
  handle.layouts = {}
})

describe('ProductModelsEditor', () => {
  it('shows the views of bango, and the file of the model being edited', async () => {
    const wrapper = await mountEditor()
    // the text and the form are the tabs; the rest of bango's views are in a menu of their own
    expect(wrapper.findAll('[role=tab]').map((t) => t.attributes('name'))).toEqual(['view-text', 'view-form'])
    expect(wrapper.findAll('[name=views-more] option').map((o) => o.attributes('value'))).toEqual(['', 'diagram', 'ast', 'json', 'project-json'])
    expect(wrapper.find('.pme__file').text()).toBe('.linea/models/datamodel.datamodel')
    expect(wrapper.find('.stub-workbench').attributes('data-view')).toBe('text')
    await wrapper.find('[name=view-form]').trigger('click')
    expect(wrapper.find('.stub-workbench').attributes('data-view')).toBe('form')
    expect(wrapper.find('.stub-workbench').attributes('data-metamodel')).toBe('datamodel')
  })

  it('follows the metamodel it is given, and says what that one also needs', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.text()).toContain(`${T.modules.also_needs} basic`)
    await wrapper.setProps({ metamodel: 'basic' })
    expect(wrapper.find('.pme__file').text()).toBe('.linea/models/basic.basic')
    expect(wrapper.text()).not.toContain(T.modules.also_needs)
  })

  it('shows the problems the engine finds, and that a model is valid', async () => {
    const wrapper = await mountEditor()
    handle.emit([
      state('basic', 'basic shop\n'),
      state('datamodel', 'datamodel shop\n', [{ severity: 'error', message: 'Could not resolve reference to Entity named Nobody.', startLine: 4, startColumn: 12 }]),
    ])
    await flushPromises()
    expect(wrapper.text()).toContain('5:13 Could not resolve reference to Entity named Nobody.')
    handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel shop\n')])
    await flushPromises()
    expect(wrapper.text()).toContain(T.modules.model_ok)
  })

  it('offers saving only what changed, and saves it from the texts of the engine', async () => {
    saveProductModel.mockResolvedValue({ ok: true, diagnostics: [{ severity: 'error', package: 'product', message: 'a problem only the server sees' }] })
    const wrapper = await mountEditor()

    handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel shop\n')])
    await flushPromises()
    expect(button(wrapper, T.labels.save).attributes('disabled')).toBeDefined()

    handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel changed\n')])
    await flushPromises()
    const save = button(wrapper, T.modules.save_n.replace('{n}', '1'))
    expect(save.attributes('disabled')).toBeUndefined()

    handle.texts = { basic: 'basic shop\n', datamodel: 'datamodel changed\n' }
    await save.trigger('click')
    await flushPromises()
    expect(saveProductModel).toHaveBeenCalledTimes(1)
    expect(saveProductModel).toHaveBeenCalledWith({ id: 'p1', metamodel: 'datamodel', content: 'datamodel changed\n' })
    expect(wrapper.text()).toContain('a problem only the server sees')
    expect(button(wrapper, T.labels.save).attributes('disabled')).toBeDefined()
  })

  describe('views the metamodels bring', () => {
    const CLASS_DIAGRAM = { id: 'viz:class-diagram', label: 'Class diagram', kind: 'visualization', description: 'UML' }

    it('come before the text and the form, and only for the metamodel that has them', async () => {
      handle.views = { datamodel: [CLASS_DIAGRAM] }
      const wrapper = await mountEditor()
      handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel shop\n')])
      await flushPromises()
      expect(wrapper.findAll('[role=tab]').map((t) => t.attributes('name'))).toEqual(['view-viz-class-diagram', 'view-text', 'view-form'])
      expect(wrapper.find('[name=view-viz-class-diagram]').text()).toBe('Class diagram')
      await wrapper.find('[name=view-viz-class-diagram]').trigger('click')
      expect(wrapper.find('.stub-workbench').attributes('data-view')).toBe('viz:class-diagram')

      // another metamodel does not have it: the view falls back to the text, and the tab is gone
      await wrapper.setProps({ metamodel: 'basic' })
      expect(wrapper.find('[name=view-viz-class-diagram]').exists()).toBe(false)
      expect(wrapper.find('.stub-workbench').attributes('data-view')).toBe('text')
    })

    it('say why they could not be loaded, in the tab', async () => {
      handle.views = { datamodel: [{ id: 'viz:!', label: 'Visualizations', kind: 'visualization', error: 'it did not compile' }] }
      const wrapper = await mountEditor()
      handle.emit([state('datamodel', 'datamodel shop\n')])
      await flushPromises()
      expect(wrapper.find('[name="view-viz--"]').attributes('title')).toBe('it did not compile')
    })
  })

  describe('where the nodes of the diagrams were left', () => {
    const MOVED = { datamodel: { 'viz:class-diagram': { Order: { x: 5, y: 6 } } } }

    it('is given to the workbench, and is saved on its own when it is all that changed', async () => {
      saveProductLayouts.mockResolvedValue({ saved: true })
      const wrapper = await mountEditor({ overview: { ...OVERVIEW, layouts: { datamodel: { 'viz:class-diagram': { Order: { x: 1, y: 1 } } } } } })
      expect(handle.props.layouts).toEqual({ datamodel: { 'viz:class-diagram': { Order: { x: 1, y: 1 } } } })
      handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel shop\n')])
      await flushPromises()
      expect(button(wrapper, T.labels.save).attributes('disabled')).toBeDefined()

      handle.layouts = MOVED
      handle.emitLayouts(MOVED)
      await flushPromises()
      expect(wrapper.emitted('states').at(-1)[0].dirty).toEqual(['layout'])
      const save = button(wrapper, T.labels.save)
      expect(save.attributes('disabled')).toBeUndefined()
      await save.trigger('click')
      await flushPromises()
      expect(saveProductLayouts).toHaveBeenCalledWith({ id: 'p1', layouts: MOVED })
      expect(saveProductModel).not.toHaveBeenCalled()
      expect(button(wrapper, T.labels.save).attributes('disabled')).toBeDefined()
    })

    it('goes in the commit of the model that is saved with it', async () => {
      saveProductModel.mockResolvedValue({ ok: true, diagnostics: [] })
      const wrapper = await mountEditor()
      handle.emit([state('basic', 'basic changed\n'), state('datamodel', 'datamodel changed\n')])
      handle.layouts = MOVED
      handle.emitLayouts(MOVED)
      await flushPromises()
      handle.texts = { basic: 'basic changed\n', datamodel: 'datamodel changed\n' }
      await button(wrapper, T.modules.save_n.replace('{n}', '2')).trigger('click')
      await flushPromises()
      expect(saveProductModel.mock.calls.map(([args]) => args)).toEqual([
        { id: 'p1', metamodel: 'basic', content: 'basic changed\n' },
        { id: 'p1', metamodel: 'datamodel', content: 'datamodel changed\n', layouts: MOVED },
      ])
      expect(saveProductLayouts).not.toHaveBeenCalled()
    })
  })

  it('tells the page which models changed, so it can mark them', async () => {
    const wrapper = await mountEditor()
    handle.emit([state('basic', 'basic shop\n'), state('datamodel', 'datamodel changed\n')])
    await flushPromises()
    const last = wrapper.emitted('states').at(-1)[0]
    expect(last.dirty).toEqual(['datamodel'])
    expect(Object.keys(last.states)).toEqual(['basic', 'datamodel'])
  })

  it('shows what the modules offer for the model, read-only, when asked', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.find('.pme__offered').exists()).toBe(false)
    await wrapper.find('[name=show-offered]').trigger('click')
    expect(wrapper.find('.offer').text()).toContain('user-management')
    expect(wrapper.find('.offer__text').text()).toContain('UM_User')
    expect(wrapper.text()).toContain(T.modules.read_only)
    await wrapper.setProps({ metamodel: 'basic' })
    expect(wrapper.find('[name=show-offered]').exists()).toBe(false)
  })

  it('reports what went wrong when saving fails', async () => {
    saveProductModel.mockRejectedValue({ response: { data: { error: 'error_messages.permission_error' } } })
    const wrapper = await mountEditor()
    handle.emit([state('datamodel', 'x\n')])
    await flushPromises()
    handle.texts = { datamodel: 'x\n' }
    await button(wrapper, T.modules.save_n.replace('{n}', '1')).trigger('click')
    await flushPromises()
    expect(wrapper.find('.p-message').exists()).toBe(true)
  })
})
