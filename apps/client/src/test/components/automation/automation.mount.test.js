import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import InfoHint from 'components/common/InfoHint.vue'
import SyncFields from 'components/automation/SyncFields.vue'
import GenerationCard from 'components/product/GenerationCard.vue'
import SyncCard from 'components/product/SyncCard.vue'

vi.mock('src/boot/axios', () => ({ api: {} }))
const productService = vi.hoisted(() => ({ getAutomation: vi.fn(), saveAutomation: vi.fn() }))
vi.mock('src/services/productService', () => ({ default: productService }))
vi.mock('src/composables/useNotify', () => ({ notify: vi.fn(), errorMessage: (e) => e.message }))

const ProductAutomation = (await import('components/automation/ProductAutomation.vue')).default
const global = { plugins: mountGlobalPlugins(), directives: { tooltip: {} } }
const mountIt = (component, props) => mount(component, { props, attachTo: document.body, global })
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

describe('InfoHint', () => {
  it('is an icon that carries its text for people who cannot hover', () => {
    const wrapper = mountIt(InfoHint, { text: 'What it does' })
    expect(wrapper.find('i.pi-info-circle').attributes('aria-label')).toBe('What it does')
    expect(wrapper.find('i').attributes('tabindex')).toBe('0')
  })
})

describe('SyncFields', () => {
  it('on a line: a switch, the frequency only while it is on, and the behavior', async () => {
    const off = mountIt(SyncFields, { modelValue: { enabled: false, preset: '6h', cron: '', behavior: 'mr' }, scope: 'line' })
    expect(off.find('[name="sync-preset"]').exists()).toBe(false)
    expect(off.find('[name="sync-behavior"]').exists()).toBe(true)
    const on = mountIt(SyncFields, { modelValue: { enabled: true, preset: 'cron', cron: '0 3 * * *', behavior: 'mr' }, scope: 'line' })
    expect(on.find('[name="sync-preset"]').exists()).toBe(true)
    expect(on.find('[name="sync-cron"]').element.value).toBe('0 3 * * *')
  })

  it('on a product: follow the SPL, own, or off; the frequency only when it is its own; the behavior can follow the SPL', () => {
    const inherit = mountIt(SyncFields, { modelValue: { mode: 'inherit', preset: '6h', cron: '', behavior: 'inherit' }, scope: 'product', inheritedText: 'La SPL sincroniza cada 6 horas' })
    expect(inherit.find('[name="sync-preset"]').exists()).toBe(false)
    expect(inherit.text()).toContain('La SPL sincroniza cada 6 horas')
    expect(inherit.text()).toContain('Seguir la SPL')
    const own = mountIt(SyncFields, { modelValue: { mode: 'custom', preset: '1h', cron: '', behavior: 'check' }, scope: 'product' })
    expect(own.find('[name="sync-preset"]').exists()).toBe(true)
  })

  it('asks for a change by emitting the whole value with it', async () => {
    const wrapper = mountIt(SyncFields, { modelValue: { enabled: false, preset: '6h', cron: '', behavior: 'mr' }, scope: 'line' })
    await wrapper.find('#sync-enabled').setValue(true)
    expect(wrapper.emitted('update:modelValue')[0][0]).toEqual({ enabled: true, preset: '6h', cron: '', behavior: 'mr' })
  })

  it('has no paragraphs of explanation: they are in the hints', () => {
    const wrapper = mountIt(SyncFields, { modelValue: { enabled: true, preset: '6h', cron: '', behavior: 'mr' }, scope: 'line' })
    expect(wrapper.findAll('i.pi-info-circle').length).toBeGreaterThanOrEqual(3)
    expect(wrapper.findAll('p, small')).toHaveLength(0)
  })
})

describe('GenerationCard', () => {
  it('says the saved spec is deployed, or what the next version would be', async () => {
    const quiet = mountIt(GenerationCard, { version: '1.4.0', pending: false, nextVersion: '1.4.1' })
    expect(quiet.find('[name="state-changes"]').text()).toBe('Al día')
    expect(quiet.text()).toContain('v1.4.0')
    expect(quiet.find('[name="generation-diff"]').exists()).toBe(false)
    const pending = mountIt(GenerationCard, { version: '1.4.0', pending: true, nextVersion: '1.4.1' })
    expect(pending.text()).toContain('v1.4.1')
    await pending.find('[name="generation-generate"]').trigger('click')
    await pending.find('[name="generation-diff"]').trigger('click')
    expect(pending.emitted('generate')).toHaveLength(1)
    expect(pending.emitted('diff')).toHaveLength(1)
  })

  it('a product never generated says so', () => {
    expect(mountIt(GenerationCard, { version: null }).find('[name="state-version"]').text()).toBe('Sin generar')
  })
})

describe('SyncCard', () => {
  const automation = (patch = {}) => ({ effective: { enabled: true, source: 'line', preset: '6h' }, nextSyncAt: new Date(Date.now() + 3 * 3600_000).toISOString(), ...patch })
  const run = (patch = {}) => ({ status: 'unchanged', files: 0, finishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), ...patch })

  it('says it is in line with the SPL, when it last looked and when it will next', () => {
    const wrapper = mountIt(SyncCard, { automation: automation(), lastRun: run() })
    expect(wrapper.find('[name="sync-status"]').text()).toBe('Al día con la SPL')
    expect(wrapper.text()).toContain('Último:')
    expect(wrapper.text()).toContain('Próximo:')
    expect(wrapper.find('[name="sync-configure"]').text()).toContain('de la SPL')
  })

  it('says how many files differ, and links the request it opened', () => {
    const wrapper = mountIt(SyncCard, { automation: automation(), lastRun: run({ status: 'drift', files: 4 }) })
    expect(wrapper.find('[name="sync-status"]').text()).toBe('Desactualizado · 4 archivos')
    const mr = mountIt(SyncCard, { automation: automation(), lastRun: run({ status: 'mr', mr: { number: 9, url: 'https://gl/9' } }) })
    expect(mr.find('a').attributes('href')).toBe('https://gl/9')
  })

  it('never synced; not scheduled; the reason a sync was skipped', () => {
    const never = mountIt(SyncCard, { automation: automation({ effective: { enabled: false } }), lastRun: null })
    expect(never.find('[name="sync-status"]').text()).toBe('Nunca sincronizado')
    expect(never.find('[name="sync-configure"]').text()).toBe('sin programar')
    expect(never.text()).not.toContain('Próximo')
    const skipped = mountIt(SyncCard, { automation: automation(), lastRun: run({ status: 'skipped', reason: 'busy' }) })
    expect(skipped.text()).toContain('El producto estaba ocupado')
  })

  it('asks for a sync or for the settings, and does not start another while one runs', async () => {
    const wrapper = mountIt(SyncCard, { automation: automation(), lastRun: run() })
    await wrapper.find('[name="sync-now"]').trigger('click')
    await wrapper.find('[name="sync-configure"]').trigger('click')
    expect(wrapper.emitted('sync')).toHaveLength(1)
    expect(wrapper.emitted('configure')).toHaveLength(1)
    const busy = mountIt(SyncCard, { automation: automation(), lastRun: run(), syncing: true })
    expect(busy.find('[name="sync-now"]').attributes('disabled')).toBeDefined()
  })
})

describe('ProductAutomation', () => {
  const loaded = () => ({
    sync: { mode: 'inherit', preset: '6h', cron: '', behavior: 'inherit' },
    generation: { bump: 'patch', autoMerge: true },
    lineSync: { enabled: true, preset: '6h', cron: '', behavior: 'mr' },
    effective: { enabled: true, source: 'line', preset: '6h', behavior: 'mr' },
  })

  it('shows the sync (generation is chosen when generating), saved only when something changed', async () => {
    productService.getAutomation.mockResolvedValue(loaded())
    const wrapper = mountIt(ProductAutomation, { productId: 'p1' })
    await flushPromises()
    expect(wrapper.find('[name="automation-generation"]').exists()).toBe(false)
    expect(wrapper.find('[name="automation-sync"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('La SPL sincroniza cada 6 horas')
    expect(wrapper.find('[name="automation-save"]').attributes('disabled')).toBeDefined()
  })

  it('sends what was edited and tells the page', async () => {
    productService.getAutomation.mockResolvedValue(loaded())
    productService.saveAutomation.mockResolvedValue({ ...loaded(), sync: { mode: 'off', preset: '6h', cron: '', behavior: 'inherit' } })
    const wrapper = mountIt(ProductAutomation, { productId: 'p1' })
    await flushPromises()
    await wrapper.find('[name="sync-mode"] [aria-label="Desactivada"], [name="sync-mode"] .p-togglebutton:last-child').trigger('click')
    expect(wrapper.find('[name="automation-save"]').attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(productService.saveAutomation).toHaveBeenCalledWith({ id: 'p1', sync: { ...loaded().sync, mode: 'off' }, generation: loaded().generation })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.find('[name="automation-save"]').attributes('disabled')).toBeDefined()
  })

  it('will not save an own schedule written as cron and left empty', async () => {
    productService.getAutomation.mockResolvedValue({ ...loaded(), sync: { mode: 'custom', preset: 'cron', cron: '', behavior: 'inherit' } });
    const wrapper = mountIt(ProductAutomation, { productId: 'p1' })
    await flushPromises()
    await wrapper.find('[name="sync-cron"]').setValue('0 3 * * *')
    await wrapper.find('[name="sync-cron"]').setValue('')
    await wrapper.find('[name="sync-behavior"] [aria-label], [name="sync-behavior"]').exists()
    expect(wrapper.find('[name="automation-save"]').attributes('disabled')).toBeDefined()
  })
})
