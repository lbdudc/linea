import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ModulePicker from 'components/modules/ModulePicker.vue'

const list = vi.fn()
const previewModules = vi.fn()
const checkLineModules = vi.fn()
vi.mock('src/services/packageService', () => ({
  default: { list: (...a) => list(...a), previewModules: (...a) => previewModules(...a), checkLineModules: (...a) => checkLineModules(...a) },
}))

const REGISTRY = [
  { location: 'gitlab:r/modules/core', name: 'core', description: 'The core', latest: '1.0.0', path: 'r/modules/core' },
  { location: 'gitlab:r/modules/um', name: 'um', description: 'Users', latest: '1.2.0', path: 'r/modules/um' },
]
const REPORT = {
  ok: true,
  diagnostics: [],
  packages: [
    { kind: 'module', location: 'gitlab:r/modules/um', name: 'um', version: '1.2.0', offers: ['UM_User'], needs: { modules: [], metamodels: [] }, requiredBy: ['spl'] },
    { kind: 'module', location: 'gitlab:r/modules/core', name: 'core', version: '1.0.0', offers: [], needs: { modules: [], metamodels: [] }, requiredBy: ['gitlab:r/modules/um@1.2.0'] },
    { kind: 'metamodel', location: 'gitlab:r/metamodels/datamodel', name: 'datamodel', version: '1.0.0', offers: [], needs: { modules: [], metamodels: [] }, requiredBy: ['gitlab:r/modules/um@1.2.0'] },
  ],
}

const mountPicker = (props = {}) => {
  const wrapper = mount(ModulePicker, { props: { modelValue: [], name: 'shop', ...props }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
  return wrapper
}

beforeEach(() => {
  window.localStorage.setItem('linea.modules.view', 'list')
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  list.mockReset()
  previewModules.mockReset()
  checkLineModules.mockReset()
})

describe('ModulePicker', () => {
  it('adds a module from the catalog with the range of its latest version', async () => {
    list.mockResolvedValue(REGISTRY)
    const wrapper = mountPicker()
    await flushPromises()
    await wrapper.find('[name=module-um]').trigger('click')
    expect(wrapper.emitted('update:modelValue')[0][0]).toEqual([{ location: 'gitlab:r/modules/um', range: '^1.2.0' }])
  })

  it('checks the chosen modules through the server (bango), without a line, and shows what they bring in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }] })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(previewModules).toHaveBeenCalledWith({ name: 'shop', modules: { 'gitlab:r/modules/um': '^1.2.0' }, signal: expect.any(AbortSignal) })
    expect(wrapper.text()).toContain('core')
    expect(wrapper.text()).toContain('datamodel')
    // `core` is needed and not chosen: the choice is reported as not valid until it is added
    expect(wrapper.emitted('result').at(-1)[0].ok).toBe(false)
  })

  it('uses the check of the line when there is one', async () => {
    list.mockResolvedValue(REGISTRY)
    checkLineModules.mockResolvedValue(REPORT)
    mountPicker({ lineId: 'l1', modelValue: [{ location: 'gitlab:r/modules/um', range: '*' }] })
    await flushPromises()
    expect(checkLineModules).toHaveBeenCalledWith({ id: 'l1', modules: { 'gitlab:r/modules/um': '*' }, signal: expect.any(AbortSignal) })
  })

  it('stops waiting for the check of an earlier choice when the modules change', async () => {
    list.mockResolvedValue(REGISTRY)
    previewModules.mockReturnValue(new Promise(() => {}))
    const wrapper = mountPicker({ lineId: undefined, modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }] })
    await flushPromises()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await vi.runAllTimersAsync()
    const first = previewModules.mock.calls[0][0].signal
    expect(first.aborted).toBe(false)

    await wrapper.setProps({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.3.0' }] })
    await vi.runAllTimersAsync()
    expect(first.aborted).toBe(true)
    expect(previewModules.mock.calls.at(-1)[0].signal.aborted).toBe(false)
  })

  it('says which module is missing, and who needs it, instead of bringing it in; a button adds it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }] })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()

    // one notice, naming what is missing; who needs it is said by the row of the required module
    const row = wrapper.find('[name=missing-modules]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('core')
    expect(wrapper.find('[name=required-core]').text()).toContain(wrapper.vm.$t('modules.picker_reason_required', { by: 'um' }))
    // it is not listed as chosen, and the choice is reported as not valid
    expect(wrapper.find('[name=implied-core]').exists()).toBe(false)
    expect(wrapper.emitted('result').at(-1)[0].ok).toBe(false)

    await wrapper.find('[name=add-missing-core]').trigger('click')
    expect(wrapper.emitted('update:modelValue').at(-1)[0]).toEqual([
      { location: 'gitlab:r/modules/um', range: '^1.2.0' },
      { location: 'gitlab:r/modules/core', range: '^1.0.0' },
    ])
  })

  it('has nothing to say once what the chosen modules need is chosen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({
      modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }, { location: 'gitlab:r/modules/core', range: '^1.0.0' }],
    })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[name=missing-modules]').exists()).toBe(false)
    expect(wrapper.emitted('result').at(-1)[0].ok).toBe(true)
  })

  it('says in one line what was chosen, with the plural right', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }, { location: 'gitlab:r/modules/core', range: '^1.0.0' }] })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    const result = wrapper.find('[name=picker-result]').text()
    expect(result).toContain(wrapper.vm.$tc('modules.count_modules', 2, { n: 2 }))
    expect(result).toContain(wrapper.vm.$tc('modules.count_metamodels', 1, { n: 1 }))
    expect(result).toMatch(/2 \S+, 1 \S+/)
    expect(wrapper.vm.$tc('modules.count_metamodels', 1, { n: 1 })).not.toBe(wrapper.vm.$tc('modules.count_metamodels', 3, { n: 3 }).replace('3', '1'))
  })

  it('offers Add or Remove on each card and says why a chosen module is there', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }, { location: 'gitlab:r/modules/core', range: '^1.0.0' }] })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[name=module-um]').text()).toContain(wrapper.vm.$t('modules.picker_remove'))
    // core is chosen and also needed by um
    expect(wrapper.find('[name=chosen-core]').text()).toContain(wrapper.vm.$t('modules.picker_reason_required', { by: 'um' }))
    expect(wrapper.find('[name=chosen-um]').text()).not.toContain(wrapper.vm.$t('modules.picker_reason_required', { by: 'um' }))
    expect(wrapper.find('[name=chosen-um]').text()).toContain(wrapper.vm.$tc('modules.count_metamodels', 1, { n: 1 }))
  })

  it('lists the module that is needed and not chosen as required by who needs it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }] })
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(wrapper.find('[name=required-core]').text()).toContain(wrapper.vm.$t('modules.picker_reason_required', { by: 'um' }))
  })

  it('tells its container whether it is checking, and fills it when asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    list.mockResolvedValue(REGISTRY)
    previewModules.mockResolvedValue(REPORT)
    const wrapper = mountPicker({ fill: true, modelValue: [{ location: 'gitlab:r/modules/um', range: '^1.2.0' }] })
    expect(wrapper.find('.picker').classes()).toContain('picker--fill')
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()
    const flags = wrapper.emitted('checking').map((e) => e[0])
    expect(flags).toContain(true)
    expect(flags.at(-1)).toBe(false)
  })
})
