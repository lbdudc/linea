import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import CompositionGraph from 'components/modules/CompositionGraph.vue'

const PACKAGES = [
  { kind: 'module', location: 'gitlab:r/modules/um', name: 'um', version: '1.2.0', offers: ['UM_User'], needs: { modules: [], metamodels: [] }, requiredBy: ['spl'] },
  { kind: 'module', location: 'gitlab:r/modules/core', name: 'core', version: '1.0.0', offers: [], needs: { modules: [], metamodels: [] }, requiredBy: ['gitlab:r/modules/um@1.2.0'] },
  { kind: 'metamodel', location: 'gitlab:r/metamodels/datamodel', name: 'datamodel', version: '1.0.0', offers: [], needs: { modules: [], metamodels: [] }, requiredBy: ['gitlab:r/modules/um@1.2.0'] },
]
const CHOSEN = [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }]
const nameOf = (l) => l.replace(/^gitlab:/, '').split('/').pop()

const mountGraph = (props = {}) =>
  mount(CompositionGraph, {
    props: { packages: PACKAGES, chosen: CHOSEN, splName: 'shop', nameOf, registry: [], ...props },
    attachTo: document.body,
    global: { plugins: mountGlobalPlugins() },
  })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CompositionGraph', () => {
  it('says what to do when nothing is chosen', async () => {
    const wrapper = mountGraph({ packages: [], chosen: [] })
    await flushPromises()
    expect(wrapper.find('.vue-flow').exists()).toBe(false)
    expect(wrapper.find('.cg__empty').exists()).toBe(true)
  })

  it('draws the SPL, the chosen module, the one it needs and the metamodel', async () => {
    const wrapper = mountGraph()
    await flushPromises()
    expect(wrapper.findAll('.vue-flow__node')).toHaveLength(4)
    const text = wrapper.text()
    expect(text).toContain('shop')
    expect(text).toContain('um')
    expect(text).toContain('core')
    expect(text).toContain('datamodel')
    expect(text).toContain('UM_User')
  })

  it('offers to add a module that is needed and was not chosen, and says which', async () => {
    const wrapper = mountGraph()
    await flushPromises()
    const add = wrapper.find('[name=graph-add-core]')
    expect(add.exists()).toBe(true)
    expect(wrapper.find('[name=graph-add-um]').exists()).toBe(false)

    await add.trigger('click')
    expect(wrapper.emitted('add')).toEqual([['gitlab:r/modules/core']])
  })

  it('has an "add all" only when more than one module is missing', async () => {
    const wrapper = mountGraph()
    await flushPromises()
    expect(wrapper.find('[name=graph-add-all]').exists()).toBe(false)

    const more = [
      ...PACKAGES,
      { kind: 'module', location: 'gitlab:r/modules/log', name: 'log', version: '0.1.0', offers: [], needs: { modules: [], metamodels: [] }, requiredBy: ['gitlab:r/modules/um@1.2.0'] },
    ]
    const withTwo = mountGraph({ packages: more })
    await flushPromises()
    await withTwo.find('[name=graph-add-all]').trigger('click')
    expect(withTwo.emitted('add-all')).toHaveLength(1)
  })

  it('shows a circular requirement from the message of the failed check', async () => {
    const wrapper = mountGraph({
      packages: [],
      chosen: [{ location: 'gitlab:r/modules/a', range: '*' }],
      errors: ['Circular requirement: gitlab:r/modules/a -> gitlab:r/modules/b -> gitlab:r/modules/a'],
    })
    await flushPromises()
    expect(wrapper.findAll('.vue-flow__node').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.findAll('.cg-edge--cycle').length).toBe(2)
  })
})
