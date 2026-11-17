import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { mountGlobalPlugins } from 'src/test/mount'
import LineCreationForm from 'pages/LineCreationForm.vue'
import { gitHosts } from 'stores/gitHosts'
import { state } from 'stores/userState'

const { lines, kinds } = vi.hoisted(() => ({
  lines: { findAvailableNamespaces: vi.fn(), createLine: vi.fn() },
  kinds: [],
}))
vi.mock('src/services/lineService', () => ({ default: lines }))
vi.mock('components/modules/lineKinds', () => ({ lineKinds: kinds }))
vi.mock('stores/gitHosts', () => ({
  gitHosts: { hosts: [{ id: 'gitlab', terms: {} }], primary: 'gitlab' },
  loadGitHosts: vi.fn().mockResolvedValue(),
}))
vi.mock('stores/userState', () => ({ state: { user: { hosts: ['gitlab'] } } }))

const picker = (what) => defineComponent({
  props: { name: { type: String, default: '' }, modelValue: { type: Array, default: () => [] } },
  emits: ['result', 'update:modelValue'],
  setup: (_, { emit }) => () => h('button', { type: 'button', name: `${what}-fits`, onClick: () => emit('result', { ok: true }) }),
})
kinds.push(
  { kind: 'project', order: 10, icon: 'pi-folder', label: 'modules.line_project', hint: 'modules.line_project_hint', stepTitle: 'creation.step_contents_metamodels', picker: picker('metamodels'), initial: () => [], toPayload: () => ({ metamodels: {} }), blocker: ({ report }) => (report?.ok === true ? '' : 'creation.need_fit') },
  { kind: 'modular', order: 20, icon: 'pi-th-large', label: 'modules.line_modular', hint: 'modules.line_modular_hint', stepTitle: 'creation.step_contents_modules', picker: picker('modules'), initial: () => [], toPayload: () => ({ modules: {} }), blocker: () => '' },
)

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const GROUPS = [{ id: 1, fullPath: 'a', name: 'a' }, { id: 2, fullPath: 'b', name: 'b' }]

const mounted = []
const router = { replace: vi.fn(), go: vi.fn() }
const mountForm = async () => {
  const wrapper = mount(LineCreationForm, { attachTo: document.body, global: { plugins: mountGlobalPlugins(), mocks: { $router: router } } })
  mounted.push(wrapper)
  await settle()
  return wrapper
}
const titles = (wrapper) => wrapper.findAll('[name^="line-step-"]').map((step) => step.attributes('name').replace('line-step-', '')).filter((key) => key !== 'optional')
const stepOpen = (wrapper, key) => wrapper.find(`[name="line-step-${key}"]`).attributes('aria-current') === 'step'
const locked = (wrapper, key) => wrapper.find(`[name="line-step-${key}"] button`).attributes('disabled') !== undefined
const click = async (wrapper, name) => {
  await wrapper.find(`[name="${name}"]`).trigger('click')
  await settle()
}
// the first step is the name and where it goes: both done, the person can go on to the kind
const toType = async (wrapper) => {
  await wrapper.find('#line-name').setValue('Tienda')
  wrapper.vm.parentNamespaceId = 2
  await settle()
}

beforeEach(() => {
  lines.findAvailableNamespaces.mockResolvedValue(GROUPS)
  lines.createLine.mockResolvedValue({ _id: 'l1' })
  localStorage.clear()
})
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('LineCreationForm: the steps', () => {
  it('uses the Stepper, with no numbers of its own', async () => {
    const wrapper = await mountForm()
    expect(wrapper.find('.p-stepper').exists()).toBe(true)
    expect(wrapper.find('.step__num').exists()).toBe(false)
    // a greyed step before the summary keeps the stepper the same size for the kinds with nothing to choose
    expect(wrapper.find('[name="line-step-optional"]').exists()).toBe(true)
    expect(wrapper.findAll('.p-step-number').map((n) => n.text())).toEqual(['1', '2', '99', '3'])
  })

  it('has the step of what it is made of only for the kinds that need one, numbered in its place', async () => {
    const wrapper = await mountForm()
    expect(titles(wrapper)).toEqual(['details', 'type', 'summary'])
    await toType(wrapper)
    await click(wrapper, 'step-next')
    await click(wrapper, 'kind-project')
    expect(titles(wrapper)).toEqual(['details', 'type', 'contents', 'summary'])
    expect(wrapper.findAll('.p-step-number').map((n) => n.text())).toEqual(['1', '2', '3', '4'])
    expect(wrapper.find('[name="metamodels-fits"]').exists()).toBe(true)
    expect(wrapper.find('[name="line-step-optional"]').exists()).toBe(false)
    await click(wrapper, 'kind-modular')
    expect(wrapper.find('[name="metamodels-fits"]').exists()).toBe(false)
    expect(wrapper.find('[name="modules-fits"]').exists()).toBe(true)
    await click(wrapper, 'kind-plain')
    expect(titles(wrapper)).toEqual(['details', 'type', 'summary'])
    expect(stepOpen(wrapper, 'type')).toBe(true)
  })
})

describe('LineCreationForm: what stops it', () => {
  it('does not go on without a name, by any way', async () => {
    const wrapper = await mountForm()
    expect(wrapper.find('[name="step-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[name="create-status"]').text()).toContain('Escribe un nombre')
    expect(locked(wrapper, 'type')).toBe(true)
    expect(locked(wrapper, 'summary')).toBe(true)
    await wrapper.find('form').trigger('submit')
    await settle()
    expect(stepOpen(wrapper, 'details')).toBe(true)
    expect(lines.createLine).not.toHaveBeenCalled()
  })

  it('goes on from the name with Enter, without creating', async () => {
    const wrapper = await mountForm()
    await toType(wrapper)
    await wrapper.find('form').trigger('submit')
    await settle()
    expect(stepOpen(wrapper, 'type')).toBe(true)
    expect(lines.createLine).not.toHaveBeenCalled()
  })

  it('does not reach the summary until what it is made of fits', async () => {
    const wrapper = await mountForm()
    await toType(wrapper)
    await click(wrapper, 'step-next')
    await click(wrapper, 'kind-project')
    await click(wrapper, 'step-next')
    expect(stepOpen(wrapper, 'contents')).toBe(true)
    expect(wrapper.find('[name="step-next"]').attributes('disabled')).toBeDefined()
    expect(locked(wrapper, 'summary')).toBe(true)
    await wrapper.find('form').trigger('submit')
    await settle()
    expect(stepOpen(wrapper, 'contents')).toBe(true)

    await click(wrapper, 'metamodels-fits')
    expect(locked(wrapper, 'summary')).toBe(false)
    await click(wrapper, 'step-next')
    expect(stepOpen(wrapper, 'summary')).toBe(true)
  })

  it('does not create without a group, and then creates what was chosen', async () => {
    const wrapper = await mountForm()
    await wrapper.find('#line-name').setValue('Tienda')
    await settle()
    // the group is part of the first step: without it there is no going on
    expect(stepOpen(wrapper, 'details')).toBe(true)
    expect(wrapper.find('[name="step-next"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[name="create-status"]').text()).toContain('Elige un grupo')
    await wrapper.find('form').trigger('submit')
    await settle()
    expect(lines.createLine).not.toHaveBeenCalled()

    wrapper.vm.parentNamespaceId = 2
    await settle()
    await click(wrapper, 'step-next')
    await click(wrapper, 'step-next')
    expect(stepOpen(wrapper, 'summary')).toBe(true)
    expect(wrapper.find('[name="create-status"]').text()).toContain('Lista para crear')
    await wrapper.find('form').trigger('submit')
    await settle()
    expect(lines.createLine).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tienda', kind: 'plain', parentNamespaceId: 2 }))
    expect(router.replace).toHaveBeenCalledWith('/lines/l1')
  })

  describe('the group it starts on', () => {
    const SPLS = { id: 3, fullPath: 'linea/spls', name: 'spls' }
    afterEach(() => { delete gitHosts.hosts[0].defaultNamespace })

    it('is the one the host is set to, over the one used last time', async () => {
      gitHosts.hosts[0].defaultNamespace = 'linea/spls'
      lines.findAvailableNamespaces.mockResolvedValue([...GROUPS, SPLS])
      localStorage.setItem('linea.lastNamespace.gitlab', '1')
      const wrapper = await mountForm()
      expect(wrapper.vm.parentNamespaceId).toBe(3)
    })

    it('is the one used last time when the person cannot use the one set', async () => {
      gitHosts.hosts[0].defaultNamespace = 'linea/spls'
      localStorage.setItem('linea.lastNamespace.gitlab', '1')
      const wrapper = await mountForm()
      expect(wrapper.vm.parentNamespaceId).toBe(1)
    })
  })

  it('goes back keeping what was written', async () => {
    const wrapper = await mountForm()
    await toType(wrapper)
    await click(wrapper, 'step-next')
    expect(stepOpen(wrapper, 'type')).toBe(true)
    await click(wrapper, 'step-previous')
    expect(stepOpen(wrapper, 'details')).toBe(true)
    expect(wrapper.find('#line-name').element.value).toBe('Tienda')
  })

  describe('the shell', () => {
    it('keeps the footer hint, Back and Next in place on every step', async () => {
      const wrapper = await mountForm()
      for (const name of ['create-status', 'step-previous', 'step-next']) expect(wrapper.find(`[name="${name}"]`).exists()).toBe(true)
      expect(wrapper.find('[name="step-previous"]').attributes('disabled')).toBeDefined()
      await toType(wrapper)
      await click(wrapper, 'step-next')
      await click(wrapper, 'step-next')
      for (const name of ['create-status', 'step-previous', 'line-create']) expect(wrapper.find(`[name="${name}"]`).exists()).toBe(true)
      expect(wrapper.find('[name="step-previous"]').attributes('disabled')).toBeUndefined()
    })

    it('shows what will be created on the last step, each part with a way back to edit it', async () => {
      const wrapper = await mountForm()
      await toType(wrapper)
      await click(wrapper, 'step-next')
      await click(wrapper, 'step-next')
      expect(wrapper.find('[name="summary-details"]').text()).toContain('Tienda')
      await click(wrapper, 'summary-edit-details')
      expect(stepOpen(wrapper, 'details')).toBe(true)
    })

    it('draws what was chosen by name, under the rows', async () => {
      const wrapper = await mountForm()
      await toType(wrapper)
      wrapper.vm.kind = 'modular'
      wrapper.vm.selection = [{ location: 'gitlab:registry/modules/main-component', name: 'main-component' }]
      await settle()
      wrapper.vm.activeStep = wrapper.vm.steps.length
      await settle()
      const summary = wrapper.find('[name="creation-summary"]')
      expect(summary.find('[name="kind-diagram-modular"]').text()).toContain('main-component')
      expect(summary.find('.cs__rows').element.compareDocumentPosition(summary.find('.cs__figure').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  describe('the version', () => {
    it('is one plain field, and does not go on while it is not x.y.z', async () => {
      const wrapper = await mountForm()
      await toType(wrapper)
      expect(wrapper.find('#line-version').element.value).toBe('0.1.0')
      await wrapper.find('#line-version').setValue('1.2')
      expect(wrapper.find('[name="step-next"]').attributes('disabled')).toBeDefined()
      await wrapper.find('#line-version').setValue('2.0.1')
      expect(wrapper.find('[name="step-next"]').attributes('disabled')).toBeUndefined()
    })
  })

  describe('the git hosts', () => {
    afterEach(() => { gitHosts.hosts.splice(1); state.user.hosts = ['gitlab'] })

    it('offers only those the person is signed in to', async () => {
      gitHosts.hosts.push({ id: 'github', terms: {} }, { id: 'local', terms: {} })
      state.user.hosts = ['gitlab', 'local']
      const wrapper = await mountForm()
      expect(wrapper.find('[name="host-gitlab"]').exists()).toBe(true)
      expect(wrapper.find('[name="host-local"]').exists()).toBe(true)
      expect(wrapper.find('[name="host-github"]').exists()).toBe(false)
      expect(wrapper.find('[name="host-connect-github"]').exists()).toBe(false)
    })

    it('starts on the remote of the profile in use, not the primary one', async () => {
      gitHosts.hosts.push({ id: 'local', terms: {} })
      state.user.hosts = ['gitlab', 'local']
      state.user.activeHost = 'local'
      const wrapper = await mountForm()
      delete state.user.activeHost
      expect(wrapper.vm.host).toBe('local')
      expect(lines.findAvailableNamespaces).toHaveBeenCalledWith('local')
    })

    it('keeps the groups of the host picked last when a slower one answers late', async () => {
      gitHosts.hosts.push({ id: 'local', terms: {} })
      state.user.hosts = ['gitlab', 'local']
      let slow
      lines.findAvailableNamespaces.mockImplementation((host) => (host === 'gitlab' ? new Promise((resolve) => { slow = () => resolve([{ id: 9, fullPath: 'from-gitlab', name: 'x' }]) }) : Promise.resolve([{ id: 7, fullPath: 'from-local', name: 'y' }])))
      const wrapper = await mountForm()
      await click(wrapper, 'host-local')
      slow()
      await settle()
      expect(wrapper.vm.namespaceOptions.map((o) => o.fullPath)).toEqual(['from-local'])
    })

    it('does not ask when there is only one', async () => {
      gitHosts.hosts.push({ id: 'github', terms: {} })
      const wrapper = await mountForm()
      expect(wrapper.find('.host-choice').exists()).toBe(false)
    })
  })
})
