import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'

const get = vi.fn()
vi.mock('src/boot/axios', () => ({ api: { get: (...args) => get(...args) } }))

// the routes a plugin adds are not known until the plugins are loaded: the navigation that loaded them starts again, with its query
describe('the plugin guard', () => {
  let router
  let installPluginGuard

  beforeEach(async () => {
    vi.resetModules()
    get.mockReset()
    ;({ installPluginGuard } = await import('src/plugins/host'))
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: { template: '<i/>' } },
        { path: '/:rest(.*)*', component: { template: '<i/>' } },
      ],
    })
  })

  it('keeps the query of the page that was asked for (the OAuth code of the login page, a tab)', async () => {
    get.mockResolvedValue({ data: [{ id: 'analytics-plugin', client: true }] })
    installPluginGuard({ router, i18n: { global: {} } })
    await router.push('/login?code=abc')
    expect(router.currentRoute.value.fullPath).toBe('/login?code=abc')
  })

  it('asks the server once, and does not insist when the server is not there', async () => {
    get.mockRejectedValue(new Error('down'))
    installPluginGuard({ router, i18n: { global: {} } })
    await router.push('/lines?tab=history')
    expect(router.currentRoute.value.fullPath).toBe('/lines?tab=history')
  })
})
