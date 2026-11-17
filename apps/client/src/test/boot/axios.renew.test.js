import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('src/router/index.js', () => ({ default: { push: vi.fn() } }))
const { api } = await import('src/boot/axios')

const reply = (status, data = {}) => ({ status, data, statusText: '', headers: {}, config: {} })
const refused = (config) => Object.assign(new Error('401'), { config, response: reply(401, { code: 'GIT_HOST_AUTH' }) })

describe('a request refused because the git host token ran out', () => {
  let calls
  beforeEach(() => { localStorage.token = 'old'; calls = [] })

  const adapter = (renewed) => async (config) => {
    calls.push({ url: config.url, auth: config.headers.Authorization })
    if (config.url === '/users/loginFromServiceToken') return { ...reply(200, { token: 'new', user: { username: 'a' } }), config }
    if (config.headers.Authorization === 'Bearer old') throw refused(config)
    return { ...reply(200, { ok: true }), config }
  }

  it('is asked again once with the renewed session, and the page never sees the failure', async () => {
    api.defaults.adapter = adapter()
    const response = await Promise.all([api.get('/lines/enrolled'), api.get('/products/1')])
    expect(response.map((r) => r.data.ok)).toEqual([true, true])
    expect(calls.filter((c) => c.url === '/users/loginFromServiceToken')).toHaveLength(1)
    expect(localStorage.token).toBe('new')
  })

  it('fails as before when the renewal does not help', async () => {
    api.defaults.adapter = async (config) => { throw refused(config) }
    await expect(api.get('/lines/enrolled')).rejects.toMatchObject({ response: { status: 401 } })
  })
})
