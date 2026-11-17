import { describe, it, expect } from 'vitest'
import routes from 'src/router/routes'
import { refusesNonAdmin } from 'src/router'

const matched = (path) => ({ matched: routes.filter((route) => route.path === path).map((route) => ({ meta: route.meta ?? {} })) })
const configuration = '/settings/:section?'

describe('configuration pages are for administrators', () => {
  it('the configuration is refused to anyone else', () => {
    expect(refusesNonAdmin(matched(configuration), { username: 'ana', admin: false })).toBe(true)
    expect(refusesNonAdmin(matched(configuration), { username: 'ana' })).toBe(true)
    expect(refusesNonAdmin(matched(configuration), null)).toBe(true)
    expect(refusesNonAdmin(matched(configuration), { username: 'root', admin: true })).toBe(false)
  })

  it.each(['/', '/lines', '/products', '/cicd', '/modules'])('%s is for everyone', (path) => {
    expect(refusesNonAdmin(matched(path), { username: 'ana', admin: false })).toBe(false)
  })
})
