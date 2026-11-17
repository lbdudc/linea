import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ErrorState from 'components/common/ErrorState.vue'
import { searchDialog } from 'stores/searchDialog'

const mountState = (props) => mount(ErrorState, {
  props,
  global: { plugins: mountGlobalPlugins(), mocks: { $route: { fullPath: '/lines/zzz' }, $router: { push: vi.fn() } } },
})

describe('ErrorState', () => {
  it('says what failed and the address, for each kind', () => {
    for (const [kind, code] of [['not_found', '404'], ['forbidden', '403'], ['server', '500'], ['offline', '···']]) {
      const wrapper = mountState({ kind })
      expect(wrapper.find('.error-state__code').text()).toBe(code)
      expect(wrapper.find('.error-state__path').text()).toBe('/lines/zzz')
      expect(wrapper.attributes('data-error-kind')).toBe(kind)
    }
  })

  it('offers Retry only when trying again can help, and asks the page to retry', async () => {
    expect(mountState({ kind: 'not_found' }).find('[name=error-retry]').exists()).toBe(false)
    const wrapper = mountState({ kind: 'server' })
    await wrapper.find('[name=error-retry]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('opens the search palette', async () => {
    searchDialog.open = false
    await mountState({ kind: 'not_found' }).find('[name=error-search]').trigger('click')
    expect(searchDialog.open).toBe(true)
  })
})
