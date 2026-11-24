import { GitDeviceFlowError, GitError } from './errors.js'
import type { DeviceAuthorization, DevicePoll, Tokens } from './provider.js'

type Json = Record<string, any>

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** POSTs a form and reads the JSON answer, whatever its status (OAuth errors come as 4xx with a body). */
async function postForm(url: string, params: Record<string, string | undefined>): Promise<{ status: number, data: Json }> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') body.set(key, value)
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'linea' },
    body,
    signal: AbortSignal.timeout(30000)
  })
  const data = (await response.json().catch(() => ({}))) as Json
  return { status: response.status, data }
}

/** Asks a host to start a device authorization. `unsupported` when the host has no such endpoint. */
export async function startDevice(url: string, params: Record<string, string | undefined>): Promise<DeviceAuthorization> {
  const { status, data } = await postForm(url, params)
  if (data.error === 'device_flow_disabled') throw new GitDeviceFlowError('device_flow_disabled', data.error_description ?? 'device flow is off for this OAuth app')
  if (status === 404 || status === 405) throw new GitDeviceFlowError('unsupported', 'this host does not offer device sign-in')
  if (status >= 400 || data.error || !data.device_code) throw new GitError(data.error_description ?? data.error ?? `device authorization failed (${status})`, status)
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? data.verification_url,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5)
  }
}

/** One poll of the token endpoint: still pending (maybe told to slow down), the tokens, or an error that ends the flow. */
export async function pollDevice(url: string, params: Record<string, string | undefined>, interval = 5): Promise<DevicePoll> {
  const { status, data } = await postForm(url, { grant_type: DEVICE_GRANT, ...params })
  if (data.access_token) return { status: 'done', tokens: { accessToken: data.access_token, refreshToken: data.refresh_token ?? null } satisfies Tokens }
  switch (data.error) {
    case 'authorization_pending': return { status: 'pending', interval }
    case 'slow_down': return { status: 'pending', interval: Number(data.interval ?? interval + 5) }
    case 'expired_token': throw new GitDeviceFlowError('expired_token', 'the code expired')
    case 'access_denied': throw new GitDeviceFlowError('access_denied', 'sign-in was refused')
    case 'device_flow_disabled': throw new GitDeviceFlowError('device_flow_disabled', data.error_description)
    default: throw new GitError(data.error_description ?? data.error ?? `device sign-in failed (${status})`, status)
  }
}
