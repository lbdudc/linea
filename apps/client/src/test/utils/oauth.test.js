import { describe, it, expect, beforeEach } from 'vitest'
import { authorizeUrlFor, readOAuthReturn } from 'src/utils/oauth'

const github = { id: 'github', clientId: 'cid', redirectUri: 'http://app/login', authorizeUrl: 'http://gh/login/oauth/authorize', scope: 'repo read:org' }
const gitlab = { id: 'gitlab', clientId: 'gid', redirectUri: 'http://app/login ', url: 'http://gl/', scope: undefined }

describe('oauth round trip', () => {
  beforeEach(() => sessionStorage.clear())

  it('sends the browser to the host with the scope it asks for and a state that names the host', () => {
    const url = new URL(authorizeUrlFor(github))
    expect(url.origin + url.pathname).toBe('http://gh/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('scope')).toBe('repo read:org')
    expect(url.searchParams.get('redirect_uri')).toBe('http://app/login')
    expect(url.searchParams.get('state')).toMatch(/^github\./)
  })

  it('builds GitLab\'s address when the server does not say it, with scope api', () => {
    const url = new URL(authorizeUrlFor(gitlab))
    expect(url.origin + url.pathname).toBe('http://gl/oauth/authorize')
    expect(url.searchParams.get('scope')).toBe('api')
    expect(url.searchParams.get('redirect_uri')).toBe('http://app/login')
  })

  it('knows which host answered and what it was for, once', () => {
    const state = new URL(authorizeUrlFor(github, { mode: 'link' })).searchParams.get('state')
    expect(readOAuthReturn({ state }, 'gitlab')).toEqual({ host: 'github', mode: 'link' })
    expect(readOAuthReturn({ state }, 'gitlab')).toBeNull() // a second reading finds nothing kept
  })

  it('refuses a state that is not the one that was sent', () => {
    authorizeUrlFor(github)
    expect(readOAuthReturn({ state: 'github.forged' }, 'gitlab')).toBeNull()
    authorizeUrlFor(github)
    expect(readOAuthReturn({ state: `gitlab.${'x'}` }, 'gitlab')).toBeNull()
  })

  it('takes a return with no state for a sign-in to the primary host (as it was with one host)', () => {
    expect(readOAuthReturn({}, 'gitlab')).toEqual({ host: 'gitlab', mode: 'login' })
  })
})
