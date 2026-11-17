import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import RestoreLineDialog from 'components/line/RestoreLineDialog.vue'
import lineService from 'src/services/lineService'
import productService from 'src/services/productService'

vi.mock('src/services/lineService', () => ({ default: { restoreLine: vi.fn() } }))
vi.mock('src/services/productService', () => ({ default: { findInactiveProducts: vi.fn() } }))

const PENDING = [
  { repoId: 21, name: 'prod-uno', version: '1.0.0', parentNamespaceId: 10 },
  { repoId: 22, name: 'prod-dos', version: '2.0.0', parentNamespaceId: 10 },
  { repoId: 31, name: 'de-otra-linea', version: '1.0.0', parentNamespaceId: 99 },
]

async function open() {
  const wrapper = mount(RestoreLineDialog, {
    attachTo: document.body,
    props: { modelValue: false, line: { repoId: 1, name: 'linea', namespaceId: 10 } },
    global: { plugins: mountGlobalPlugins() },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

const byName = (name) => document.querySelector(`[name="${name}"]`)

describe('RestoreLineDialog', () => {
  beforeEach(() => {
    lineService.restoreLine.mockReset().mockResolvedValue({})
    productService.findInactiveProducts.mockReset().mockResolvedValue(PENDING)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists the products waiting in this line, all chosen', async () => {
    await open()

    expect(document.body.textContent).toContain('prod-uno')
    expect(document.body.textContent).toContain('prod-dos')
    expect(document.body.textContent).not.toContain('de-otra-linea')
    expect(document.body.textContent).toContain('Se recuperarán 2 de 2 productos.')
    expect(byName('restore-line-hint')).toBeNull()
  })

  it('by default brings all of them back', async () => {
    const wrapper = await open()

    byName('restore-line-confirm').click()
    await flushPromises()

    expect(lineService.restoreLine).toHaveBeenCalledWith({ repoId: 1, productRepoIds: [21, 22] })
    expect(wrapper.emitted('restored')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false])
  })

  it('leaves out the products left unticked, and warns of what becomes of them', async () => {
    const wrapper = await open()
    wrapper.vm.toggle(22, false)
    await flushPromises()

    expect(document.body.textContent).toContain('Se recuperarán 1 de 2 productos.')
    expect(byName('restore-line-hint')).not.toBeNull()

    byName('restore-line-confirm').click()
    await flushPromises()

    expect(lineService.restoreLine).toHaveBeenCalledWith({ repoId: 1, productRepoIds: [21] })
  })

  it('unticking all brings back the line alone', async () => {
    const wrapper = await open()

    wrapper.vm.toggleAll(false)
    byName('restore-line-confirm').click()
    await flushPromises()

    expect(lineService.restoreLine).toHaveBeenCalledWith({ repoId: 1, productRepoIds: [] })
  })

  it('stays open when it fails', async () => {
    const wrapper = await open()
    lineService.restoreLine.mockRejectedValue({ response: { data: { error: 'error_messages.permission_error' } } })

    byName('restore-line-confirm').click()
    await flushPromises()

    expect(wrapper.emitted('restored')).toBeUndefined()
  })
})
