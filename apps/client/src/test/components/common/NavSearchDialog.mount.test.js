import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, reactive, nextTick } from 'vue'
import { mountGlobalPlugins, createTestI18n } from 'src/test/mount'
import { state } from 'stores/userState'
import NavSearchDialog from 'components/common/NavSearchDialog.vue'

const { portfolio, route, push, notify, services, signOut, enqueue } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  portfolio: { lines: null, products: null },
  route: { path: '/' },
  push: vi.fn(),
  notify: vi.fn(),
  signOut: vi.fn(),
  services: {
    scheduler: { status: vi.fn() },
    settings: { saveInstance: vi.fn() },
    plugin: { exportConfig: vi.fn() },
    package: { list: vi.fn() },
    product: { syncProduct: vi.fn() },
  },
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }))
vi.mock('src/services/schedulerService', () => ({ default: services.scheduler }))
vi.mock('src/services/settingsService', () => ({ default: services.settings }))
vi.mock('src/services/pluginService', () => ({ default: services.plugin }))
vi.mock('src/services/packageService', () => ({ default: services.package }))
vi.mock('stores/generationStore', () => ({ default: { jobs: [], enqueue: enqueue } }))
vi.mock('src/services/productService', () => ({ default: services.product }))
vi.mock('src/composables/useSignOut', () => ({ useSignOut: () => signOut }))
vi.mock('src/composables/useNotify', () => ({ notify, errorMessage: (e) => e.message }))
vi.mock('src/composables/usePortfolio', () => ({
  usePortfolio: () => portfolio,
  ensureStatuses: () => {},
  healthOf: (product) => ({ status: 'ok', reasons: [], lastGeneration: product.lastGeneration ?? null }),
  hasPendingChanges: (product) => Boolean(product.pending),
  lineHealth: () => ({ total: 0, ok: 0, bad: 0, checking: 0 }),
  lineLastSync: () => null,
}))
vi.mock('components/generation/GeneratePreviewDialog.vue', () => ({
  default: {
    name: 'GeneratePreviewDialog',
    props: ['visible', 'products'],
    emits: ['confirm', 'update:visible'],
    template: '<div v-if="visible" class="generate-stub">{{ products.map((p) => p.name).join(",") }}<button class="generate-confirm" @click="$emit(\'confirm\', products.map((p) => ({ ...p, bump: \'patch\' })))" /></div>',
  },
}))

const t = (key, params) => createTestI18n().global.t(key, params ?? {})
const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
const body = () => document.body

const PRODUCTS = [
  { _id: 'p1', name: 'GIS-Platform-1', line: 'GIS-Platform', lineId: 'l1', version: '1.0.0', repo: { webUrl: 'https://git.example/p1' }, gitHost: 'gitlab', pending: true },
  { _id: 'p2', name: 'GIS-Platform-2', line: 'GIS-Platform', lineId: 'l1', version: '1.0.0', repo: { webUrl: 'https://git.example/p2' }, gitHost: 'gitlab', lastGeneration: { outcome: 'error', at: new Date().toISOString() } },
]

const open = async (query = '') => {
  const wrapper = mount(NavSearchDialog, { props: { modelValue: false }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
  await wrapper.setProps({ modelValue: true })
  await settle()
  const input = body().querySelector('.palette__input')
  input.value = query
  input.dispatchEvent(new Event('input'))
  await settle()
  return { wrapper, input }
}

const titles = () => [...body().querySelectorAll('.palette__title')].map((node) => node.textContent.trim())
const press = (input, key, init = {}) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = 'light-theme'
  portfolio.lines = ref([{ _id: 'l1', name: 'GIS-Platform', version: '1.0.0' }])
  portfolio.products = ref(PRODUCTS.map((product) => ({ ...product })))
  route.path = '/'
  state.user = { admin: true, hosts: ['local'] }
  for (const fn of [push, notify, signOut, enqueue, ...Object.values(services).flatMap(Object.values)]) fn.mockReset()
  services.package.list.mockResolvedValue([])
  services.scheduler.status.mockResolvedValue({ paused: false })
  services.settings.saveInstance.mockResolvedValue({})
})

afterEach(() => { document.body.innerHTML = '' })

describe('NavSearchDialog actions', () => {
  it('shows the administrator actions only to administrators', async () => {
    const admin = await open('>')
    expect(titles()).toEqual(expect.arrayContaining([t('palette.act_add_user'), t('palette.act_new_module'), t('palette.act_download_config'), t('palette.act_sign_out')]))
    admin.wrapper.unmount()
    document.body.innerHTML = ''
    state.user = { admin: false, hosts: ['local'] }
    await open('>')
    expect(titles()).toContain(t('palette.act_sign_out'))
    expect(titles()).not.toContain(t('palette.act_add_user'))
    expect(titles()).not.toContain(t('palette.act_scheduler_pause'))
  })

  it('shows the state of the scheduler in its row and pauses it', async () => {
    const { input } = await open('>scheduler')
    expect(titles()).toEqual([t('palette.act_scheduler_pause')])
    expect(body().querySelector('.palette__badge').textContent).toBe(t('scheduler.running'))
    press(input, 'Enter')
    await settle()
    expect(services.settings.saveInstance).toHaveBeenCalledWith({ schedulerPaused: true })
  })

  it('starts a generation from > generate after asking, and links to the run', async () => {
    const { input } = await open(`>${t('palette.act_generate', { name: 'GIS-Platform-1' })}`)
    expect(titles()[0]).toBe(t('palette.act_generate', { name: 'GIS-Platform-1' }))
    press(input, 'Enter')
    await settle()
    expect(body().querySelector('.generate-stub').textContent).toContain('GIS-Platform-1')
    body().querySelector('.generate-confirm').click()
    await settle()
    expect(enqueue).toHaveBeenCalledWith([expect.objectContaining({ _id: 'p1', name: 'GIS-Platform-1', bump: 'patch' })])
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive', action: expect.objectContaining({ label: t('palette.see_run') }) }))
  })

  it('offers the failed run first for a product whose last generation failed', async () => {
    await open('>GIS-Platform-2')
    expect(titles()[0]).toBe(t('palette.act_failed_run', { name: 'GIS-Platform-2' }))
  })

  it('shows the actions of the line only inside a line', async () => {
    const outside = await open('>ci/cd')
    expect(titles().filter((title) => title.includes('GIS-Platform'))).toEqual([])
    outside.wrapper.unmount()
    document.body.innerHTML = ''
    route.path = '/lines/l1'
    const { input } = await open('>ci/cd')
    expect(titles()).toHaveLength(1)
    press(input, 'Enter')
    expect(push).toHaveBeenCalledWith('/lines/l1?tab=cicd')
  })

  it('lists the products that generate all pending would touch and asks first', async () => {
    const { input } = await open(`>${t('palette.act_generate_pending')}`)
    expect(titles()).toEqual([t('palette.act_generate_pending')])
    press(input, 'Enter')
    await settle()
    expect(body().querySelector('.generate-stub').textContent).toBe('GIS-Platform-1')
  })

  it('offers Undo after toggling the theme and gets it back', async () => {
    const { input } = await open(`>${t('labels.toggle_theme')}`)
    press(input, 'Enter')
    await nextTick()
    expect(document.documentElement.classList.contains('dark-theme')).toBe(true)
    const { action } = notify.mock.calls[0][0]
    expect(action.label).toBe(t('palette.undo'))
    action.handler()
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false)
  })

  it('keeps the used action at the top of the empty palette on the next visit and lets it be pinned', async () => {
    const first = await open(`>${t('labels.toggle_theme')}`)
    press(first.input, 'Enter')
    await nextTick()
    first.wrapper.unmount()
    document.body.innerHTML = ''
    await open('>')
    expect(titles()[0]).toBe(t('labels.toggle_theme'))

    body().querySelector('[name=palette-pin]').click()
    await nextTick()
    expect(JSON.parse(localStorage.getItem('linea.search.pinned'))).toEqual(['action:theme'])
  })

  it('shows the keyboard shortcut of an action in its row', async () => {
    await open(`>${t('labels.toggle_theme')}`)
    expect(body().querySelector('.palette__shortcut').textContent).toBe('⌥⇧T')
  })
})
