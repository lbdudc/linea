import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const { setProfile } = vi.hoisted(() => ({ setProfile: vi.fn() }))
vi.mock('src/services/userService', () => ({ default: { setProfile } }))

const mountSwitcher = async ({ hosts, activeHost, enabled = ['local', 'gitlab', 'github'] }) => {
  const { state } = await import('stores/userState')
  const { gitHosts } = await import('stores/gitHosts')
  state.user = { username: 'ana', hosts, activeHost }
  gitHosts.hosts = enabled.map((id) => ({ id }))
  const { default: ProfileSwitcher } = await import('components/layout/ProfileSwitcher.vue')
  return { wrapper: mount(ProfileSwitcher, { global: { plugins: mountGlobalPlugins() }, attachTo: document.body }), state }
}

describe('ProfileSwitcher', () => {
  beforeEach(() => { setProfile.mockReset(); document.body.innerHTML = '' })

  it('is not there for a person with one remote: nothing to switch', async () => {
    const { wrapper } = await mountSwitcher({ hosts: ['gitlab'], activeHost: 'gitlab' })
    expect(wrapper.find('[data-profile-switcher]').exists()).toBe(false)
  })

  it('is not there for a remote that is off now, even when they once signed in to it', async () => {
    const { wrapper } = await mountSwitcher({ hosts: ['gitlab', 'github'], activeHost: 'gitlab', enabled: ['gitlab'] })
    expect(wrapper.find('[data-profile-switcher]').exists()).toBe(false)
  })

  it('shows the remote in use and offers the others they are signed in to', async () => {
    const { wrapper } = await mountSwitcher({ hosts: ['gitlab', 'github'], activeHost: 'gitlab' })
    expect(wrapper.get('[data-profile-switcher]').attributes('data-active-profile')).toBe('gitlab')
    expect(wrapper.text()).toContain('GitLab')

    await wrapper.get('button').trigger('click')
    await flushPromises()
    const offered = [...document.querySelectorAll('[data-profile]')].map((el) => el.getAttribute('data-profile'))
    expect(offered).toEqual(['gitlab', 'github']) // not local: they have no account there
  })

  it('asks the server to switch, then tells the shell', async () => {
    setProfile.mockResolvedValue({ hosts: ['gitlab', 'github'], activeHost: 'github' })
    const { wrapper, state } = await mountSwitcher({ hosts: ['gitlab', 'github'], activeHost: 'gitlab' })
    await wrapper.get('button').trigger('click')
    await flushPromises()

    document.querySelector('[data-profile="github"]').click()
    await flushPromises()

    expect(setProfile).toHaveBeenCalledWith({ host: 'github' })
    expect(state.user.activeHost).toBe('github')
    expect(wrapper.emitted('switched')).toEqual([['github']])
  })

  it('does nothing when the one in use is picked', async () => {
    const { wrapper } = await mountSwitcher({ hosts: ['gitlab', 'github'], activeHost: 'gitlab' })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    document.querySelector('[data-profile="gitlab"]').click()
    await flushPromises()
    expect(setProfile).not.toHaveBeenCalled()
  })
})
