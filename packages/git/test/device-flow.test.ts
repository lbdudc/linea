import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitDeviceFlowError } from '../src/index.js'
import { GitHubProvider } from '../src/github/provider.js'
import { GitLabProvider } from '../src/gitlab/provider.js'

const answer = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const stub = (...answers: Response[]) => {
  const fn = vi.fn()
  for (const a of answers) fn.mockResolvedValueOnce(a)
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

const gitlab = () => new GitLabProvider({ url: 'https://gl.test', clientId: 'cid', clientSecret: 'sec' })
const github = () => new GitHubProvider({ config: { clientId: 'cid', clientSecret: 'sec' } })
const started = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://x/device', expires_in: 600, interval: 5 }

describe('device authorization', () => {
  it.each([['gitlab', gitlab, 'https://gl.test/oauth/authorize_device', 'https://gl.test/oauth/token'], ['github', github, 'https://github.com/login/device/code', 'https://github.com/login/oauth/access_token']] as const)('%s: starts, polls, finishes', async (_name, make, startUrl, tokenUrl) => {
    const fetchMock = stub(answer(started), answer({ error: 'authorization_pending' }, 400), answer({ error: 'slow_down', interval: 10 }, 400), answer({ access_token: 'tok', refresh_token: 'ref' }))
    const git = make()
    const auth = await git.startDeviceAuthorization!()
    expect(auth).toMatchObject({ deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://x/device', expiresIn: 600, interval: 5 })
    expect(fetchMock.mock.calls[0]![0]).toBe(startUrl)
    expect(String(fetchMock.mock.calls[0]![1].body)).toContain('client_id=cid')
    expect(await git.pollDeviceAuthorization!({ deviceCode: 'dc', interval: 5 })).toEqual({ status: 'pending', interval: 5 })
    expect(await git.pollDeviceAuthorization!({ deviceCode: 'dc', interval: 5 })).toEqual({ status: 'pending', interval: 10 })
    expect(await git.pollDeviceAuthorization!({ deviceCode: 'dc' })).toEqual({ status: 'done', tokens: { accessToken: 'tok', refreshToken: 'ref' } })
    expect(fetchMock.mock.calls[1]![0]).toBe(tokenUrl)
    const body = String(fetchMock.mock.calls[1]![1].body)
    expect(body).toContain('device_code=dc')
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code')
  })

  it('maps the errors that end the flow', async () => {
    stub(answer({ error: 'expired_token' }, 400), answer({ error: 'access_denied' }, 400), answer({ error: 'device_flow_disabled' }, 400), answer({}, 404))
    const git = github()
    await expect(git.pollDeviceAuthorization!({ deviceCode: 'dc' })).rejects.toMatchObject({ reason: 'expired_token' })
    await expect(git.pollDeviceAuthorization!({ deviceCode: 'dc' })).rejects.toMatchObject({ reason: 'access_denied' })
    await expect(git.startDeviceAuthorization!()).rejects.toBeInstanceOf(GitDeviceFlowError)
    await expect(git.startDeviceAuthorization!()).rejects.toMatchObject({ reason: 'unsupported' })
  })
})
