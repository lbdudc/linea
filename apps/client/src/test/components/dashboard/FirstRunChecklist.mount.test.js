import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import FirstRunChecklist from 'components/dashboard/FirstRunChecklist.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const mountList = (props) => mount(FirstRunChecklist, { props, global: { plugins: mountGlobalPlugins() } })

describe('FirstRunChecklist', () => {
  it('starts with creating a line when there is nothing, and blocks the steps that need one', async () => {
    push.mockClear()
    const wrapper = mountList({ lines: [], products: [] })
    expect(wrapper.findAll('.first-run__step--done')).toHaveLength(0)
    expect(wrapper.find('.first-run__step--next [name="first-run-line"]').exists()).toBe(true)
    expect(wrapper.find('[name="first-run-product"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[name="first-run-line"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/add')
  })

  it('marks what is done and points the next step at the first line', async () => {
    push.mockClear()
    const wrapper = mountList({ lines: [{ _id: 'l1', name: 'a', kind: 'modular' }], products: [] })
    expect(wrapper.findAll('.first-run__step--done')).toHaveLength(2)
    expect(wrapper.find('.first-run__step--next [name="first-run-product"]').exists()).toBe(true)
    await wrapper.find('[name="first-run-product"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/lines/l1/new-product')
  })

  it('asks to be hidden', async () => {
    const wrapper = mountList({ lines: [], products: [] })
    await wrapper.find('[name="first-run-dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})
