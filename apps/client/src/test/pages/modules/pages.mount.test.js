import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import messages from 'src/i18n'

// the harness mounts in Spanish: expectations read the same messages the pages do
const T = messages.es

const { push, replace, route } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), route: { path: '/modules', query: {} } }))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => route,
  useRouter: () => ({ push, replace }),
}))

const MODULES = [
  { id: 11, kind: 'module', name: 'user-management', path: 'registry/user-management', location: 'gitlab:registry/user-management', description: 'users', webUrl: 'https://gitlab.example.com/registry/user-management', versions: ['1.1.0', '1.0.0'], latest: '1.1.0' },
  { id: 12, kind: 'module', name: 'reports', path: 'registry/reports', location: 'gitlab:registry/reports', description: '', webUrl: '', versions: [], latest: null },
]

const OK_REPORT = { ok: true, diagnostics: [], metamodels: [], featureModel: '', resolved: [] }

async function mountPage(page, props, services = {}) {
  vi.resetModules()
  push.mockClear()
  const packageService = {
    list: vi.fn().mockResolvedValue(MODULES),
    create: vi.fn().mockResolvedValue({ ...MODULES[0], id: 99, name: 'fresh' }),
    get: vi.fn(),
    readFile: vi.fn(),
    saveFile: vi.fn().mockResolvedValue({ committed: true }),
    deleteFile: vi.fn(),
    check: vi.fn().mockResolvedValue(OK_REPORT),
    publish: vi.fn(),
    registryStatus: vi.fn().mockResolvedValue({ configured: false, location: null }),
    registrySuggestions: vi.fn().mockResolvedValue([]),
    register: vi.fn(),
    unregister: vi.fn().mockResolvedValue(undefined),
    getLineModules: vi.fn(),
    checkLineModules: vi.fn().mockResolvedValue({ ...OK_REPORT, packages: [] }),
    saveLineModules: vi.fn().mockResolvedValue({ packages: [], report: OK_REPORT }),
    getProductModels: vi.fn(),
    saveProductModel: vi.fn().mockResolvedValue(OK_REPORT),
    ...services.packageService,
  }
  vi.doMock('src/services/packageService', () => ({ default: packageService }))
  vi.doMock('src/services/lineService', () => ({
    default: {
      findAvailableNamespaces: vi.fn().mockResolvedValue([{ id: 7, fullPath: 'registry', name: 'Registry' }]),
      findLineById: vi.fn().mockResolvedValue({ _id: 'l1', name: 'GisApps', version: '1.0.0', modular: true }),
      ...services.lineService,
    },
  }))
  // the dialog that comes before saving asks which products the change would break
  vi.doMock('src/services/migrationService', () => ({
    default: {
      impact: vi.fn().mockResolvedValue({ summary: { total: 0, breaking: 0, fixing: 0, unaffected: 0 }, products: [] }),
      ...services.migrationService,
    },
  }))
  vi.doMock('src/services/productService', () => ({
    default: { findProductById: vi.fn().mockResolvedValue({ _id: 'p1', spec: { basicData: { name: 'Shop' } } }), ...services.productService },
  }))
  const { default: Page } = await import(`pages/modules/${page}.vue`)
  const wrapper = mount(Page, { props, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, packageService }
}

// PrimeVue's confirm popup and dialog listen on one shared bus: a page left mounted would answer the next test's questions too
const mounted = []

beforeEach(() => {
  window.localStorage.setItem('linea.modules.view', 'list')
})

afterEach(() => {
  mounted.splice(0).forEach((w) => { try { w.unmount() } catch { /* already unmounted by the test */ } })
  document.body.innerHTML = ''
})

describe('PackageRegistry', () => {
  it('lists the modules, with their latest version, and opens one', async () => {
    const { wrapper, packageService } = await mountPage('PackageRegistry', { kind: 'module' })
    expect(packageService.list).toHaveBeenCalledWith({ kind: 'module' })
    const rows = wrapper.findAll('.pkg')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('user-management')
    expect(rows[0].text()).toContain('v1.1.0')
    expect(rows[1].text()).toContain(T.modules.unpublished)
    await rows[0].trigger('click')
    expect(push).toHaveBeenCalledWith('/packages/modules/11')
  })

  it('is the list of one kind only: the metamodels have a page of their own, with no selector', async () => {
    const { wrapper, packageService } = await mountPage('PackageRegistry', { kind: 'metamodel' })
    expect(packageService.list).toHaveBeenCalledWith({ kind: 'metamodel' })
    expect(packageService.list).not.toHaveBeenCalledWith({ kind: 'module' })
    expect(wrapper.find('.registry__tab').exists()).toBe(false)
    expect(wrapper.text()).toContain(T.modules.new_metamodel)
    expect(wrapper.text()).not.toContain(T.modules.new_module)
  })

  it('opens the creation form when the address asks for it, and drops the request from the address', async () => {
    route.query = { new: '1' }
    try {
      await mountPage('PackageRegistry', { kind: 'module' })
      expect(document.body.querySelector('.create')).not.toBeNull()
      expect(replace).toHaveBeenCalledWith({ query: {} })
    } finally {
      route.query = {}
    }
  })

  it('filters by name', async () => {
    const { wrapper } = await mountPage('PackageRegistry', { kind: 'module' })
    await wrapper.find('.registry__search input').setValue('report')
    expect(wrapper.findAll('.pkg')).toHaveLength(1)
    expect(wrapper.find('.pkg').text()).toContain('reports')
  })

  it('offers no registering when this installation has no registry', async () => {
    const { wrapper } = await mountPage('PackageRegistry', { kind: 'module' })
    expect(wrapper.text()).not.toContain(T.modules.register)
    expect(wrapper.find('.pkg-row__remove').exists()).toBe(false)
  })

  describe('with a registry', () => {
    const withRegistry = {
      registryStatus: vi.fn().mockResolvedValue({ configured: true, location: 'gitlab:registry/index' }),
      registrySuggestions: vi.fn().mockResolvedValue([{ location: 'gitlab:registry/loose', latest: '0.2.0' }, { location: 'gitlab:registry/draft', latest: null }]),
    }

    it('registers a package chosen from the suggestions, and lists it again', async () => {
      const register = vi.fn().mockResolvedValue({ kind: 'module', name: 'loose', location: 'gitlab:registry/loose' })
      const { wrapper, packageService } = await mountPage('PackageRegistry', { kind: 'module' }, { packageService: { ...withRegistry, register } })
      const open = wrapper.findAll('button').find((b) => b.text() === T.modules.register)
      await open.trigger('click')
      await flushPromises()
      expect(packageService.registrySuggestions).toHaveBeenCalledWith({ kind: 'module' })

      const suggestions = document.body.querySelectorAll('.suggestion')
      expect(suggestions).toHaveLength(2)
      suggestions[0].click()
      await flushPromises()
      const form = document.body.querySelector('.create')
      expect(form.querySelector('input.ident').value).toBe('gitlab:registry/loose')
      const listCalls = packageService.list.mock.calls.length
      form.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      expect(register).toHaveBeenCalledWith({ location: 'gitlab:registry/loose' })
      expect(packageService.list.mock.calls.length).toBe(listCalls + 1)
    })

    it('says why a package cannot be registered', async () => {
      const register = vi.fn().mockRejectedValue({ response: { data: { error: 'error_messages.module_resolution_failed', detail: 'gitlab:registry/draft has no published version' } } })
      const { wrapper } = await mountPage('PackageRegistry', { kind: 'module' }, { packageService: { ...withRegistry, register } })
      await wrapper.findAll('button').find((b) => b.text() === T.modules.register).trigger('click')
      await flushPromises()
      document.body.querySelectorAll('.suggestion')[1].click()
      await flushPromises()
      document.body.querySelector('.create').dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      expect(document.body.textContent).toContain('has no published version')
    })

    it('removes a package from the registry, and cannot open one that is unreachable', async () => {
      const list = vi.fn().mockResolvedValue([...MODULES, { id: null, kind: 'module', name: 'gone', path: 'registry/gone', location: 'gitlab:registry/gone', description: '', webUrl: '', versions: [], latest: null, unavailable: true }])
      const { wrapper, packageService } = await mountPage('PackageRegistry', { kind: 'module' }, { packageService: { ...withRegistry, list } })
      const rows = wrapper.findAll('.pkg')
      expect(rows[2].classes()).toContain('pkg--unavailable')
      expect(rows[2].text()).toContain(T.modules.unavailable)
      await rows[2].trigger('click')
      expect(push).not.toHaveBeenCalled()

      // removing asks first: nothing is unregistered until it is accepted
      await wrapper.findAll('.pkg-row__remove')[0].trigger('click')
      await flushPromises()
      expect(packageService.unregister).not.toHaveBeenCalled()
      document.body.querySelector('.p-confirmpopup-accept-button').click()
      await flushPromises()
      expect(packageService.unregister).toHaveBeenCalledWith({ location: 'gitlab:registry/user-management' })
    })

    it('registers a package it creates, unless asked not to', async () => {
      const { wrapper, packageService } = await mountPage('PackageRegistry', { kind: 'module' }, { packageService: withRegistry })
      await wrapper.findAll('button').find((b) => b.text() === T.modules.new_module).trigger('click')
      await flushPromises()
      const form = document.body.querySelector('.create')
      const name = form.querySelector('input[required]')
      name.value = 'fresh'
      name.dispatchEvent(new Event('input'))
      form.dispatchEvent(new Event('submit', { cancelable: true }))
      await flushPromises()
      expect(packageService.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'module', name: 'fresh', register: true }))
    })
  })

  it('shows what is wrong when the registry cannot be read', async () => {
    const { wrapper } = await mountPage('PackageRegistry', { kind: 'module' }, { packageService: { list: vi.fn().mockRejectedValue({ response: { data: { error: 'error_messages.gitlab_error' } } }) } })
    expect(wrapper.find('.p-message').exists()).toBe(true)
  })
})

describe('PackageDetail', () => {
  const detail = {
    id: 11, kind: 'module', name: 'user-management', location: 'gitlab:registry/user-management', description: 'users',
    webUrl: 'https://gitlab.example.com/registry/user-management', versions: ['1.0.0'], latest: '1.0.0',
    files: ['code/a.js', '.linea/module.json'], manifest: { name: 'user-management', version: '1.0.0' }, manifestError: null,
  }
  const services = () => ({
    packageService: {
      get: vi.fn().mockResolvedValue(detail),
      readFile: vi.fn(async ({ path }) => ({ path, ref: 'main', content: path === '.linea/module.json' ? '{"name":"user-management"}' : 'export {}' })),
      saveFile: vi.fn().mockResolvedValue({ committed: true }),
    },
  })

  it('opens the manifest first, and saves what was edited', async () => {
    const { wrapper, packageService } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, services())
    const editor = wrapper.find('textarea')
    expect(editor.element.value).toBe('{"name":"user-management"}')
    expect(wrapper.text()).toContain('v1.0.0')

    const save = () => wrapper.findAll('button').find((b) => b.text() === T.labels.save)
    expect(save().attributes('disabled')).toBeDefined()
    await editor.setValue('{"name":"user-management","version":"1.0.1"}')
    expect(wrapper.text()).toContain(T.modules.unsaved)
    expect(save().attributes('disabled')).toBeUndefined()
    await save().trigger('click')
    await flushPromises()
    expect(packageService.saveFile).toHaveBeenCalledWith({ kind: 'module', id: '11', path: '.linea/module.json', content: '{"name":"user-management","version":"1.0.1"}' })
  })

  it('shows the problems of a check, and why a publication was refused', async () => {
    const svc = services()
    svc.packageService.check = vi.fn().mockResolvedValue({
      ok: false,
      diagnostics: [{ severity: 'error', package: 'gitlab:registry/user-management', file: '.linea/module.json', message: 'It offers a model of "x"' }],
      resolved: [{ kind: 'module', location: 'gitlab:registry/user-management', name: 'user-management', version: '1.0.0', requiredBy: ['spl'] }],
    })
    svc.packageService.publish = vi.fn().mockRejectedValue({
      response: { data: { error: 'error_messages.module_check_failed', detail: 'does not pass', diagnostics: [{ severity: 'error', package: 'gitlab:registry/x', message: 'broken grammar' }] } },
    })
    const { wrapper, packageService } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, svc)

    await wrapper.findAll('button').find((b) => b.text() === T.modules.check).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(T.modules.check_failed)
    expect(wrapper.text()).toContain('It offers a model of "x"')

    await wrapper.findAll('button').find((b) => b.text() === T.modules.publish).trigger('click')
    await flushPromises()
    expect(packageService.publish).toHaveBeenCalledWith({ kind: 'module', id: '11', bump: null })
    expect(wrapper.text()).toContain('broken grammar')
  })
})

describe('LineModules', () => {
  const modules = {
    modular: true,
    spl: { name: 'GisApps', modules: { 'gitlab:registry/user-management': '^1.0.0' } },
    lockCurrent: true,
    packages: [
      {
        kind: 'module', location: 'gitlab:registry/user-management', name: 'user-management', version: '1.1.0', requiredBy: ['spl'],
        needs: { modules: [], metamodels: [{ location: 'gitlab:registry/datamodel', name: 'datamodel', version: '2.0.0' }] }, offers: ['datamodel'],
      },
      {
        kind: 'metamodel', location: 'gitlab:registry/datamodel', name: 'datamodel', version: '2.0.0', requiredBy: ['gitlab:registry/user-management@1.1.0'],
        needs: { modules: [], metamodels: [] }, offers: [],
      },
    ],
    featureModel: 'features\n\tGisApps\n',
  }

  const CORE = {
    kind: 'module', location: 'gitlab:registry/core', name: 'core', version: '1.0.0', requiredBy: ['gitlab:registry/user-management@1.1.0'],
    needs: { modules: [], metamodels: [] }, offers: [],
  }
  const saveButton = (wrapper) => wrapper.find('[name=save-modules]')
  // saving goes through a dialog: it checks the impact, and the change is committed when it is confirmed
  const saveAndConfirm = async (wrapper) => {
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    document.body.querySelector('[name=save-confirm]').click()
    await flushPromises()
  }

  it('shows the modules, what they resolve to, and the composed feature model', async () => {
    const checked = { ...OK_REPORT, packages: modules.packages }
    const { wrapper } = await mountPage('LineModules', { id: 'l1' }, {
      packageService: { getLineModules: vi.fn().mockResolvedValue(modules), checkLineModules: vi.fn().mockResolvedValue(checked) },
    })
    expect(wrapper.find('[name=chosen-user-management] input').element.value).toBe('^1.0.0')
    expect(wrapper.find('.resolution__summary').text()).toContain('1 módulos y 1 metamodelos')
    expect(wrapper.find('.fm').text()).toContain('GisApps')
  })

  it('reports the module that is missing, and who needs it, and a button adds it; saving waits for that', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const checked = { ...OK_REPORT, packages: [...modules.packages, CORE] }
    const { wrapper, packageService } = await mountPage('LineModules', { id: 'l1' }, {
      packageService: { getLineModules: vi.fn().mockResolvedValue(modules), checkLineModules: vi.fn().mockResolvedValue(checked) },
    })
    const row = wrapper.find('[name=missing-modules]')
    expect(row.text()).toContain('core')
    expect(wrapper.find('[name=required-core]').text()).toContain('user-management')
    // a set that does not hold together is not offered for saving
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.find('[name=add-missing-core]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[name=chosen-core]').exists()).toBe(true)
    expect(wrapper.find('[name=missing-modules]').exists()).toBe(false)
    // the picker checks the new choice before saving is offered again
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    await saveAndConfirm(wrapper)
    expect(packageService.saveLineModules).toHaveBeenCalledWith({ id: 'l1', modules: { 'gitlab:registry/user-management': '^1.0.0', 'gitlab:registry/core': '*' }, bump: 'minor' })
    vi.useRealTimers()
  })

  it('checks by itself when the choice changes, so what a module brings in is seen at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const checked = { ...OK_REPORT, packages: [...modules.packages, CORE] }
      const { wrapper, packageService } = await mountPage('LineModules', { id: 'l1' }, {
        packageService: { getLineModules: vi.fn().mockResolvedValue(modules), checkLineModules: vi.fn().mockResolvedValue({ ...OK_REPORT, packages: modules.packages }) },
      })
      packageService.checkLineModules.mockClear()
      packageService.checkLineModules.mockResolvedValue(checked)
      expect(wrapper.find('[name=missing-modules]').exists()).toBe(false)
      await wrapper.find('[name=module-reports]').trigger('click')
      await flushPromises()
      expect(packageService.checkLineModules).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(600)
      await flushPromises()
      expect(packageService.checkLineModules).toHaveBeenCalledWith(expect.objectContaining({
        id: 'l1', modules: { 'gitlab:registry/user-management': '^1.0.0', 'gitlab:registry/reports': '*' },
      }))
      expect(wrapper.find('[name=missing-modules]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('adds a module with the range of its latest version, and saves the new set', async () => {
    const { wrapper, packageService } = await mountPage('LineModules', { id: 'l1' }, { packageService: { getLineModules: vi.fn().mockResolvedValue(modules) } })
    await wrapper.find('[name=module-reports]').trigger('click')
    await flushPromises()
    // an unpublished module is accepted at any version
    expect(wrapper.find('[name=chosen-reports]').exists()).toBe(true)
    expect(wrapper.text()).toContain(T.modules.unsaved_modules.slice(0, 22))

    await saveAndConfirm(wrapper)
    expect(packageService.saveLineModules).toHaveBeenCalledWith({
      id: 'l1',
      modules: { 'gitlab:registry/user-management': '^1.0.0', 'gitlab:registry/reports': '*' },
      bump: 'minor',
    })
  })

  it('shows every diagnostic when the modules are refused', async () => {
    const { wrapper } = await mountPage('LineModules', { id: 'l1' }, {
      packageService: {
        getLineModules: vi.fn().mockResolvedValue(modules),
        saveLineModules: vi.fn().mockRejectedValue({ response: { data: { error: 'error_messages.module_check_failed', diagnostics: [{ severity: 'error', package: 'gitlab:registry/datamodel', message: 'type clash' }] } } }),
      },
    })
    await wrapper.find('[name=chosen-user-management] input').setValue('^1.1.0')
    await saveAndConfirm(wrapper)
    expect(document.body.textContent).toContain('type clash')
  })

  it('lists the products the change would break before saving, and starts from a major version', async () => {
    const impact = vi.fn().mockResolvedValue({
      summary: { total: 1, breaking: 1, fixing: 0, unaffected: 0 },
      products: [{ productId: 'p1', name: 'Shop', version: '1.0.0', impact: 'breaking', reason: 'feature gone' }],
    })
    const { wrapper, packageService } = await mountPage('LineModules', { id: 'l1' }, {
      packageService: { getLineModules: vi.fn().mockResolvedValue(modules) },
      migrationService: { impact },
    })
    await wrapper.find('[name=module-reports]').trigger('click')
    await flushPromises()
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(impact).toHaveBeenCalledWith({ lineId: 'l1', modules: { 'gitlab:registry/user-management': '^1.0.0', 'gitlab:registry/reports': '*' } })
    expect(packageService.saveLineModules).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Shop')
    expect(document.body.textContent).toContain('feature gone')
    expect(document.body.textContent).toContain('v2.0.0')
    document.body.querySelector('[name=save-confirm]').click()
    await flushPromises()
    expect(packageService.saveLineModules).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }))
  })

  it('explains that a plain line has no modules', async () => {
    const { wrapper } = await mountPage('LineModules', { id: 'l1' }, { packageService: { getLineModules: vi.fn().mockResolvedValue({ modular: false, kind: 'plain' }) } })
    expect(wrapper.text()).toContain(T.modules.line_not_modular)
    expect(wrapper.find('[name=save-modules]').exists()).toBe(false)
  })

  it('lists the metamodels of a project and moves one to another version after showing what it changes', async () => {
    const location = 'gitlab:registry/settings'
    const project = {
      modular: false, kind: 'project', spl: { kind: 'project', modules: {}, metamodels: { [location]: '^0.1.0' } },
      packages: [{ kind: 'metamodel', location, name: 'settings', version: '0.1.0' }], featureModel: 'features\n  A\n',
    }
    const proposed = { ok: true, diagnostics: [], packages: [{ kind: 'metamodel', location, name: 'settings', version: '0.2.0' }], featureModel: 'features\n  A\n  B\n' }
    const impact = vi.fn().mockResolvedValue({ summary: { total: 1, breaking: 1, fixing: 0, unaffected: 0 }, products: [{ productId: 'p1', name: 'Shop', impact: 'breaking', reason: 'B is missing' }] })
    const { wrapper, packageService } = await mountPage('LineMetamodels', { id: 'l1' }, {
      packageService: {
        getLineModules: vi.fn().mockResolvedValue(project),
        list: vi.fn().mockResolvedValue([{ location, versions: ['0.2.0', '0.1.0'] }]),
        checkLineModules: vi.fn().mockResolvedValue(proposed),
        saveLineModules: vi.fn().mockResolvedValue({}),
      },
      migrationService: { impact },
    })
    expect(wrapper.find('[name=save-modules]').exists()).toBe(false)
    const row = wrapper.find('[data-test=line-packages] tbody tr')
    expect(row.text()).toContain('settings')
    expect(row.text()).toContain('^0.1.0')
    await row.find('button').trigger('click')
    await flushPromises()
    expect(packageService.list).toHaveBeenCalledWith({ kind: 'metamodel' })
    expect(packageService.checkLineModules).toHaveBeenCalledWith({ id: 'l1', metamodels: { [location]: '^0.2.0' } })
    expect(impact).toHaveBeenCalledWith({ lineId: 'l1', metamodels: { [location]: '^0.2.0' } })
    const dialog = document.body.querySelector('[data-test=pin-dialog]')
    expect(dialog.textContent).toContain('v0.1.0 → v0.2.0')
    expect(dialog.textContent).toContain('+   B')
    expect(dialog.textContent).toContain('B is missing')
    document.body.querySelector('[name=confirm-pin]').click()
    await flushPromises()
    expect(packageService.saveLineModules).toHaveBeenCalledWith({ id: 'l1', metamodels: { [location]: '^0.2.0' }, bump: 'minor' })
  })
})

describe('PackageDetail of a metamodel', () => {
  const save = vi.fn()
  const detail = {
    id: 21, kind: 'metamodel', name: 'shapes', location: 'gitlab:registry/shapes', description: 'shapes',
    webUrl: '', versions: ['0.1.0'], latest: '0.1.0',
    files: ['grammars/shapes.langium', 'metamodel.json'], manifest: { name: 'shapes', version: '0.1.0', requires: {} }, manifestError: null,
  }
  const services = () => ({
    packageService: {
      get: vi.fn().mockResolvedValue(detail),
      readFile: vi.fn(async ({ path }) => ({ path, ref: 'main', content: path === 'metamodel.json' ? '{"name":"shapes"}' : 'grammar Shapes' })),
    },
  })
  const mountMetamodel = async () => {
    // the studio runs Monaco and bango's workers: the page is tested with a stand-in that has the same interface
    vi.doMock('components/modules/MetamodelStudio.vue', async () => {
      const { defineComponent, h } = await import('vue')
      return {
        __esModule: true, // the page loads it lazily, and Vue looks at this to find the component
        default: defineComponent({
          name: 'MetamodelStudioStub',
          props: { kind: String, id: String },
          emits: ['dirty', 'saved'],
          setup(props, { expose }) {
            expose({ save })
            return () => h('div', { class: 'studio-stub' }, `${props.kind}/${props.id}`)
          },
        }),
      }
    })
    const mounted = await mountPage('PackageDetail', { kind: 'metamodel', id: '21' }, services())
    wrappers.push(mounted.wrapper)
    await flushPromises() // the studio is loaded when the page asks for it
    return mounted
  }
  const wrappers = []
  const mode = (wrapper, label) => wrapper.findAll('[role=tab]').find((b) => b.text().startsWith(label))
  const dialogButton = (which) => document.body.querySelector(`.p-confirmdialog-${which}-button`)

  afterEach(() => {
    // the page listens to the window: a page left mounted would answer the next test's keys too
    wrappers.splice(0).forEach((w) => w.unmount())
    vi.unstubAllGlobals()
    save.mockReset()
  })

  it('opens in the studio, and the files are one click away', async () => {
    const { wrapper } = await mountMetamodel()
    expect(wrapper.find('.studio-stub').text()).toBe('metamodel/21')
    expect(wrapper.find('textarea').isVisible()).toBe(false) // the files are in their own tab
    expect(mode(wrapper, T.modules.studio).attributes('aria-selected')).toBe('true')

    await mode(wrapper, T.modules.files).trigger('click')
    await flushPromises()
    expect(wrapper.find('.studio-stub').exists()).toBe(false)
    expect(wrapper.find('textarea').element.value).toBe('{"name":"shapes"}')

    await mode(wrapper, T.modules.studio).trigger('click')
    expect(wrapper.find('.studio-stub').exists()).toBe(true)
  })

  it('asks before leaving a studio with changes, and saves it with Ctrl+S', async () => {
    const { wrapper } = await mountMetamodel()
    wrapper.findComponent({ name: 'MetamodelStudioStub' }).vm.$emit('dirty', true)
    await flushPromises()
    expect(wrapper.text()).not.toContain('undefined')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    expect(save).toHaveBeenCalledTimes(1)

    await mode(wrapper, T.modules.files).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain(T.modules.discard_changes)
    dialogButton('reject').click() // cancel: it stays
    await flushPromises()
    expect(wrapper.find('.studio-stub').exists()).toBe(true)
  })

  it('leaves a studio with changes once the discard is accepted', async () => {
    const { wrapper } = await mountMetamodel()
    wrapper.findComponent({ name: 'MetamodelStudioStub' }).vm.$emit('dirty', true)
    await flushPromises()
    await mode(wrapper, T.modules.files).trigger('click')
    await flushPromises()
    dialogButton('accept').click()
    await flushPromises()
    expect(wrapper.find('.studio-stub').exists()).toBe(false)
    expect(wrapper.find('textarea').isVisible()).toBe(true)
  })

  it('reloads the package when the studio saved', async () => {
    const { wrapper, packageService } = await mountMetamodel()
    const before = packageService.get.mock.calls.length
    wrapper.findComponent({ name: 'MetamodelStudioStub' }).vm.$emit('saved', { committed: true })
    await flushPromises()
    expect(packageService.get.mock.calls.length).toBe(before + 1)
  })

  it('a module has no studio', async () => {
    const { wrapper } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, {
      packageService: { get: vi.fn().mockResolvedValue({ ...detail, kind: 'module', files: ['.linea/module.json'] }), readFile: vi.fn().mockResolvedValue({ path: '.linea/module.json', content: '{}' }) },
    })
    expect(mode(wrapper, T.modules.studio)).toBeUndefined()
    expect(wrapper.find('textarea').exists()).toBe(true)
  })
})

describe('where a package is used', () => {
  const detail = {
    id: 11, kind: 'module', name: 'user-management', location: 'gitlab:registry/user-management', description: '', webUrl: '',
    versions: ['1.1.0', '1.0.0'], latest: '1.1.0', files: ['.linea/module.json'], manifest: { name: 'user-management', version: '1.1.0' }, manifestError: null,
  }
  const usage = {
    location: detail.location,
    lines: [
      { id: 'l1', name: 'GisApps', kind: 'modular', direct: true, range: '^1.0.0', version: '1.0.0', products: [{ id: 'p1', name: 'Shop' }] },
      { id: 'l2', name: 'Other', kind: 'modular', direct: false, range: null, version: '1.1.0', products: [] },
    ],
  }
  const services = () => ({
    packageService: {
      get: vi.fn().mockResolvedValue(detail),
      readFile: vi.fn().mockResolvedValue({ path: '.linea/module.json', ref: 'main', content: '{}' }),
      usage: vi.fn().mockResolvedValue(usage),
      getLineModules: vi.fn().mockResolvedValue({ modular: true, kind: 'modular', spl: { modules: { [detail.location]: '^1.0.0' }, metamodels: {} }, packages: [{ kind: 'module', location: detail.location, name: 'user-management', version: '1.0.0' }], featureModel: '' }),
      checkLineModules: vi.fn().mockResolvedValue({ ok: true, diagnostics: [], packages: [{ kind: 'module', location: detail.location, name: 'user-management', version: '1.1.0' }], featureModel: '' }),
      saveLineModules: vi.fn().mockResolvedValue({}),
    },
  })

  it('lists the lines that use the package, at which version, and which are behind', async () => {
    const { wrapper, packageService } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, services())
    expect(packageService.usage).toHaveBeenCalledWith({ kind: 'module', id: '11' })
    const rows = wrapper.findAll('[data-test=package-usage] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('GisApps')
    expect(rows[0].text()).toContain('^1.0.0')
    expect(rows[0].text()).toContain('v1.0.0')
    expect(rows[0].text()).toContain('v1.1.0') // the latest, as what it is behind
    // a line that has it through another package has nothing of its own to pin
    expect(rows[1].find('button').attributes('disabled')).toBeDefined()
  })

  it('shows the impact of a new version, and pins it', async () => {
    const impact = vi.fn().mockResolvedValue({ summary: { total: 0, breaking: 0, fixing: 0, unaffected: 0 }, products: [] })
    const { wrapper, packageService } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, { ...services(), migrationService: { impact } })
    await wrapper.find('[data-test=package-usage] tbody tr button').trigger('click')
    await flushPromises()
    expect(packageService.checkLineModules).toHaveBeenCalledWith({ id: 'l1', modules: { [detail.location]: '^1.1.0' } })
    expect(impact).toHaveBeenCalledWith({ lineId: 'l1', modules: { [detail.location]: '^1.1.0' } })
    expect(document.body.querySelector('[data-test=pin-impact]').textContent).toContain(T.labels.impact_safe)
    document.body.querySelector('[name=confirm-pin]').click()
    await flushPromises()
    expect(packageService.saveLineModules).toHaveBeenCalledWith({ id: 'l1', modules: { [detail.location]: '^1.1.0' }, bump: 'minor' })
  })

  it('says so, and asks for confirmation, when the impact on the products could not be checked', async () => {
    const impact = vi.fn().mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, { ...services(), migrationService: { impact } })
    await wrapper.find('[data-test=package-usage] tbody tr button').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-test=pin-impact-failed]')).not.toBeNull()
    expect(document.body.querySelector('[name=confirm-pin]').textContent).toContain(T.modules.pin_anyway)
  })

  it('does not hide that some lines could not be read', async () => {
    const base = services()
    base.packageService.usage = vi.fn().mockResolvedValue({ ...usage, unreadable: 2 })
    const { wrapper } = await mountPage('PackageDetail', { kind: 'module', id: '11' }, base)
    expect(wrapper.find('[data-test=usage-unreadable]').exists()).toBe(true)
  })
})
