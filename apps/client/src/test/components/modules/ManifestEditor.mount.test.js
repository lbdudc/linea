import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import messages from 'src/i18n'
import ManifestEditor from 'components/modules/ManifestEditor.vue'

const T = messages.es

const saveFile = vi.fn()
vi.mock('src/services/packageService', () => ({ default: { saveFile: (...args) => saveFile(...args) } }))

const REGISTRY = {
  metamodel: [
    { location: 'gitlab:registry/metamodels/datamodel', name: 'datamodel', latest: '1.2.0' },
    { location: 'gitlab:registry/metamodels/forms', name: 'forms', latest: '1.0.0' },
  ],
  module: [
    { location: 'gitlab:registry/modules/core', name: 'core', latest: '1.0.0' },
    { location: 'gitlab:registry/modules/um', name: 'um', latest: null },
  ],
}

const MODULE = {
  location: 'gitlab:registry/modules/um',
  files: ['.linea/module.json', 'models/datamodel.instance', 'code/a.js'],
  manifest: {
    name: 'um',
    version: '1.0.0',
    requires: { modules: { '../core': '^1.0.0' }, metamodels: { '../../metamodels/datamodel': '^1.0.0' } },
    offers: { datamodel: 'models/datamodel.instance' },
  },
}

const mountEditor = (props) =>
  mount(ManifestEditor, { props: { kind: 'module', id: 7, pkg: MODULE, registry: REGISTRY, ...props }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })

afterEach(() => {
  document.body.innerHTML = ''
  saveFile.mockReset()
})

describe('ManifestEditor', () => {
  it('shows what a module declares, naming the packages that its relative references point at', () => {
    const wrapper = mountEditor()
    const blocks = wrapper.findAll('.decl__block')
    expect(blocks).toHaveLength(3)
    expect(blocks[0].text()).toContain('datamodel')
    expect(blocks[0].find('input').element.value).toBe('^1.0.0')
    expect(blocks[1].text()).toContain('core')
    expect(blocks[2].find('.row').exists()).toBe(true)
  })

  it('does not offer to save until something changes', async () => {
    const wrapper = mountEditor()
    // the save bar is not on the page until there is something to save
    expect(wrapper.find('[name=save-declaration]').exists()).toBe(false)
    await wrapper.findAll('.decl__block')[0].find('input').setValue('^1.1.0')
    expect(wrapper.find('[name=save-declaration]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain(T.modules.declaration_unsaved)
  })

  it('adds a metamodel, with the range of its latest version, and writes the manifest with paths that work under any group', async () => {
    saveFile.mockResolvedValue({})
    const wrapper = mountEditor()
    const metamodels = wrapper.findAll('.decl__block')[0]
    metamodels.findComponent({ name: 'Select' }).vm.$emit('update:modelValue', 'gitlab:registry/metamodels/forms')
    await flushPromises()
    await metamodels.find('[name=add-metamodel]').trigger('click')
    expect(metamodels.findAll('.row')).toHaveLength(2)

    await wrapper.find('[name=save-declaration]').trigger('click')
    await flushPromises()
    expect(saveFile).toHaveBeenCalledTimes(1)
    const written = saveFile.mock.calls[0][0]
    expect(written).toMatchObject({ kind: 'module', id: 7, path: '.linea/module.json' })
    expect(JSON.parse(written.content)).toEqual({
      name: 'um',
      version: '1.0.0',
      requires: {
        modules: { '../core': '^1.0.0' },
        metamodels: { '../../metamodels/datamodel': '^1.0.0', '../../metamodels/forms': '^1.0.0' },
      },
      offers: { datamodel: 'models/datamodel.instance' },
    })
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })

  it('removes what is no longer needed', async () => {
    saveFile.mockResolvedValue({})
    const wrapper = mountEditor()
    await wrapper.findAll('.decl__block')[1].find('.row button').trigger('click')
    await wrapper.find('[name=save-declaration]').trigger('click')
    await flushPromises()
    expect(JSON.parse(saveFile.mock.calls[0][0].content).requires.modules).toEqual({})
  })

  it('says when a package it needs is not in the registry', () => {
    const wrapper = mountEditor({ registry: { module: [], metamodel: [] } })
    expect(wrapper.text()).toContain(T.modules.not_in_registry)
    expect(wrapper.findAll('.decl__block')[0].text()).toContain('datamodel')
  })

  it('lets a module offer a model of a metamodel it declares, from its models folder', async () => {
    saveFile.mockResolvedValue({})
    const wrapper = mountEditor({
      pkg: {
        ...MODULE,
        files: [...MODULE.files, 'models/forms.instance'],
        manifest: { ...MODULE.manifest, requires: { ...MODULE.manifest.requires, metamodels: { '../../metamodels/datamodel': '^1.0.0', '../../metamodels/forms': '^1.0.0' } } },
      },
    })
    // it offers a model of datamodel already: the one it can still offer is a model of forms
    await wrapper.find('[name=add-offer]').trigger('click')
    expect(wrapper.findAll('.decl__block')[2].findAll('.row')).toHaveLength(2)
    expect(wrapper.find('[name=add-offer]').attributes('disabled')).toBeDefined()
    await wrapper.find('[name=save-declaration]').trigger('click')
    await flushPromises()
    expect(JSON.parse(saveFile.mock.calls[0][0].content).offers).toEqual({ datamodel: 'models/datamodel.instance', forms: 'models/forms.instance' })
  })

  it('shows a metamodel only what a metamodel can declare: the metamodels it imports', async () => {
    saveFile.mockResolvedValue({})
    const wrapper = mountEditor({
      kind: 'metamodel',
      pkg: { location: 'gitlab:registry/metamodels/forms', files: [], manifest: { name: 'forms', version: '1.0.0', requires: { '../datamodel': '^1.0.0' } } },
    })
    expect(wrapper.findAll('.decl__block')).toHaveLength(1)
    await wrapper.find('.row input').setValue('^1.2.0')
    await wrapper.find('[name=save-declaration]').trigger('click')
    await flushPromises()
    expect(JSON.parse(saveFile.mock.calls[0][0].content)).toEqual({ name: 'forms', version: '1.0.0', requires: { '../datamodel': '^1.2.0' } })
  })

  it('reports why saving failed', async () => {
    saveFile.mockRejectedValue({ response: { data: { error: 'error_messages.module_manifest_invalid', detail: 'bad range' } } })
    const wrapper = mountEditor()
    await wrapper.findAll('.decl__block')[0].find('input').setValue('nonsense')
    await wrapper.find('[name=save-declaration]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.p-message').text()).toContain('bad range')
  })
})
