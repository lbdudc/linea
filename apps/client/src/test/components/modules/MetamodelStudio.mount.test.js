import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import messages from 'src/i18n'
import MetamodelStudio from 'components/modules/MetamodelStudio.vue'

const T = messages.es

const { getStudio, saveFiles, loadBangoLibraries, startEngine } = vi.hoisted(() => ({ getStudio: vi.fn(), saveFiles: vi.fn(), loadBangoLibraries: vi.fn(), startEngine: vi.fn() }))
// bango's libraries are static files and Monaco is a browser's: the component is given fakes
vi.mock('components/modules/bangoLibraries', () => ({ loadBangoLibraries, startEngine }))
vi.mock('src/services/packageService', () => ({ default: { getStudio, saveFiles } }))

const PAYLOAD = {
  location: 'gitlab:registry/shapes',
  version: '0.1.0',
  metamodel: 'shapes',
  paths: { grammar: 'grammars/shapes.langium', constraints: 'constraints/shapes.js', scope: 'scopes/shapes.js', spec: 'specs/shapes.js', import: 'imports/shapes.js', cases: 'cases/shapes.json' },
  files: { grammar: 'grammar Shapes\n', constraints: 'return []' },
  dependencies: { common: { grammar: 'grammar Common\n' } },
  diagnostics: [],
}

// the libraries are bango's, loaded as static files: here, a studio that records what it was given and lets the test edit
let studios = []
class FakeStudio {
  constructor(input) {
    this.input = input
    this.current = { ...input.files }
    this.base = { ...input.files }
    this.listeners = {}
    this.mounted = false
    this.disposed = false
    studios.push(this)
  }
  get files() { return { ...this.current } }
  dirty() { return Object.keys({ ...this.current, ...this.base }).filter((k) => (this.current[k] ?? '') !== (this.base[k] ?? '')) }
  markSaved() { this.base = { ...this.current } }
  async reset(files) { this.current = { ...files }; this.base = { ...files } }
  on(event, fn) { this.listeners[event] = fn }
  async mount(el) { this.mounted = el }
  dispose() { this.disposed = true }
  /** the user edits a file */
  edit(key, text) { this.current[key] = text; this.listeners.change?.({ key, files: this.files }) }
}

const monaco = { editor: { setTheme: vi.fn() }, languages: { typescript: { javascriptDefaults: {} } } }
const connectBango = vi.fn()
const registerTextRenderer = vi.fn()

const mountStudio = async (props = {}) => {
  const wrapper = mount(MetamodelStudio, { props: { id: '7', ...props }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  document.body.innerHTML = ''
  studios = []
  getStudio.mockReset().mockResolvedValue(PAYLOAD)
  saveFiles.mockReset().mockResolvedValue({ committed: true })
  connectBango.mockClear()
  loadBangoLibraries.mockReset().mockResolvedValue({ connectBango, rendererLibrary: { registerTextRenderer, ModelRenderer: class {} }, studioLibrary: { MetamodelStudio: FakeStudio }, monaco })
  startEngine.mockReset().mockReturnValue({ fake: 'engine' })
  registerTextRenderer.mockClear()
})
getStudio.mockResolvedValue(PAYLOAD)
saveFiles.mockResolvedValue({ committed: true })
loadBangoLibraries.mockResolvedValue({ connectBango, rendererLibrary: { registerTextRenderer, ModelRenderer: class {} }, studioLibrary: { MetamodelStudio: FakeStudio }, monaco })
startEngine.mockReturnValue({ fake: 'engine' })


describe('MetamodelStudio', () => {
  it('reads the package, starts an engine of its own and gives the studio the files and what they need', async () => {
    const wrapper = await mountStudio()
    expect(getStudio).toHaveBeenCalledWith({ kind: 'metamodel', id: '7' })
    expect(startEngine).toHaveBeenCalledWith(connectBango)
    expect(registerTextRenderer).toHaveBeenCalledWith(monaco, expect.objectContaining({ fontSize: 13 }))
    const [studio] = studios
    expect(studio.input).toMatchObject({ metamodel: 'shapes', files: PAYLOAD.files, dependencies: PAYLOAD.dependencies })
    expect(studio.input.bango).toEqual({ fake: 'engine' })
    expect(await studio.input.typescript()).toBe(monaco.languages.typescript)
    expect(studio.mounted).toBeTruthy()
    expect(wrapper.find('.p-skeleton').exists()).toBe(false)
    expect(wrapper.vm.dirty).toBe(false)
  })

  it('saves what changed in one request, by the path of each file, and deletes what was emptied', async () => {
    const wrapper = await mountStudio()
    const [studio] = studios
    studio.edit('grammar', 'grammar Shapes\n// edited\n')
    studio.edit('constraints', '')
    studio.edit('cases', '[{"name":"a"}]')
    await flushPromises()
    // the page header shows the unsaved mark; the studio only enables its buttons
    expect(wrapper.vm.dirty).toBe(true)
    expect(wrapper.emitted('dirty').at(-1)).toEqual([true])

    await wrapper.vm.save()
    await flushPromises()
    expect(saveFiles).toHaveBeenCalledTimes(1)
    expect(saveFiles).toHaveBeenCalledWith({
      kind: 'metamodel',
      id: '7',
      message: T.modules.studio_commit,
      files: { 'grammars/shapes.langium': 'grammar Shapes\n// edited\n', 'constraints/shapes.js': null, 'cases/shapes.json': '[{"name":"a"}]' },
    })
    expect(studio.dirty()).toEqual([])
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('dirty').at(-1)).toEqual([false])
    expect(wrapper.text()).not.toContain(T.modules.unsaved)
  })

  it('shows why a save was refused and keeps the changes', async () => {
    saveFiles.mockRejectedValue({ response: { data: { error: 'error_messages.module_manifest_invalid', detail: 'metamodel.json is not valid' } } })
    const wrapper = await mountStudio()
    studios[0].edit('grammar', 'x')
    await flushPromises()
    await wrapper.vm.save()
    await flushPromises()
    expect(wrapper.find('.p-message').text()).toContain('metamodel.json is not valid')
    expect(studios[0].dirty()).toEqual(['grammar'])
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('goes back to what is saved when the changes are discarded', async () => {
    const wrapper = await mountStudio()
    studios[0].edit('grammar', 'x')
    await flushPromises()
    await wrapper.vm.discard()
    await flushPromises()
    expect(studios[0].files.grammar).toBe(PAYLOAD.files.grammar)
    expect(wrapper.emitted('dirty').at(-1)).toEqual([false])
  })

  it('says what cannot be resolved, and what failed to load', async () => {
    getStudio.mockResolvedValue({ ...PAYLOAD, diagnostics: [{ severity: 'error', package: 'x', message: 'gitlab:registry/nothing has no version' }] })
    expect((await mountStudio()).text()).toContain('gitlab:registry/nothing has no version')

    getStudio.mockRejectedValue({ response: { data: { error: 'error_messages.package_not_found' } } })
    const failed = await mountStudio()
    expect(failed.text()).toContain(T.error_messages.package_not_found)
    expect(failed.emitted('failed')).toHaveLength(1)
  })

  it('lets go of the studio when it goes away', async () => {
    const wrapper = await mountStudio()
    wrapper.unmount()
    expect(studios[0].disposed).toBe(true)
  })
})
