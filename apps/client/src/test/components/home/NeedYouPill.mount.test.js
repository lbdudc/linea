import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import NeedYouPill from 'components/home/NeedYouPill.vue'
import { homeView, setHomeView } from 'stores/homeView'

const mountPill = (count) => mount(NeedYouPill, { props: { count }, global: { plugins: mountGlobalPlugins() } })

describe('NeedYouPill', () => {
  beforeEach(() => {
    setHomeView('panel')
  })

  it('shows the count', () => {
    expect(mountPill(5).find('[name="need-you-pill"]').text()).toBe('5 te necesitan')
  })

  it('is not there with nothing to attend', () => {
    expect(mountPill(0).find('[name="need-you-pill"]').exists()).toBe(false)
  })

  it('brings the inbox back when pressed', async () => {
    const wrapper = mountPill(5)
    await wrapper.find('[name="need-you-pill"]').trigger('click')
    expect(homeView.view).toBe('all')
  })
})
