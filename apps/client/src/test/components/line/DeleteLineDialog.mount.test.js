import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import DeleteLineDialog from 'components/line/DeleteLineDialog.vue'
import lineService from 'src/services/lineService'

vi.mock('src/services/lineService', () => ({
  default: { findLineById: vi.fn(), deleteLine: vi.fn() },
}))

const PRODUCTS = [
  { _id: 'p1', name: 'prod-uno', version: '1.0.0' },
  { _id: 'p2', name: 'prod-dos', version: '2.0.0' },
]

async function open(found = { products: PRODUCTS }) {
  lineService.findLineById.mockResolvedValue(found)
  const wrapper = mount(DeleteLineDialog, {
    attachTo: document.body,
    props: { modelValue: false, line: { _id: 'l1', name: 'linea' } },
    global: { plugins: mountGlobalPlugins() },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

const byName = (name) => document.querySelector(`[name="${name}"]`)
const typeName = async (value) => {
  const input = document.querySelector('#delete-line-name')
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('DeleteLineDialog', () => {
  beforeEach(() => {
    lineService.deleteLine.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists every product of the line, all chosen to be deleted', async () => {
    const wrapper = await open()

    expect(document.body.textContent).toContain('prod-uno')
    expect(document.body.textContent).toContain('prod-dos')
    expect(document.body.textContent).toContain('Se eliminarán 2 de 2 productos.')
    expect(wrapper.vm.keepProductIds).toEqual([])
  })

  it('confirms only once the name is typed', async () => {
    await open()

    expect(byName('delete-line-confirm').disabled).toBe(true)
    await typeName('linea')
    expect(byName('delete-line-confirm').disabled).toBe(false)
  })

  it('by default deletes everything, keeping nothing', async () => {
    const wrapper = await open()
    await typeName('linea')

    byName('delete-line-confirm').click()
    await flushPromises()

    expect(lineService.deleteLine).toHaveBeenCalledWith({ id: 'l1', keepProductIds: [] })
    expect(wrapper.emitted('deleted')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue').at(-1)).toEqual([false])
  })

  it('keeps the products left unticked, and warns of what becomes of them', async () => {
    const wrapper = await open()
    wrapper.vm.toggle('p2', false)
    await flushPromises()
    await typeName('linea')

    expect(document.body.textContent).toContain('Se eliminarán 1 de 2 productos.')
    expect(document.body.textContent).toContain('se conservan sin línea')

    byName('delete-line-confirm').click()
    await flushPromises()

    expect(lineService.deleteLine).toHaveBeenCalledWith({ id: 'l1', keepProductIds: ['p2'] })
  })

  it('unticking all keeps all of them', async () => {
    const wrapper = await open()

    wrapper.vm.toggleAll(false)

    expect(wrapper.vm.keepProductIds).toEqual(['p1', 'p2'])
  })

  it('says what the host does with what is deleted', async () => {
    await open({ products: PRODUCTS, delayedDeletion: true })

    expect(document.body.textContent).toContain('pendientes de eliminación')
  })

  it('stays open and says so when the deletion fails', async () => {
    const wrapper = await open()
    lineService.deleteLine.mockRejectedValue({ response: { data: { error: 'error_messages.permission_error' } } })
    await typeName('linea')

    byName('delete-line-confirm').click()
    await flushPromises()

    expect(wrapper.emitted('deleted')).toBeUndefined()
  })
})
