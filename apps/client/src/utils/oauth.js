// The OAuth round trip of a git host: the browser leaves for the host's page and comes back to /login with `?code=` and the `state` it
// was sent with. With more than one host the state is how the page knows which host is answering, and whether the answer is for
// signing in or for linking another account to who is already signed in. The nonce in it is kept here and must come back unchanged.
const KEY = 'linea:oauth'

const nonce = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 24)

/** The address to send the browser to for `host` (one entry of `GET /users/config`'s `hosts`), remembering what it is for. */
export const authorizeUrlFor = (host, { mode = 'login' } = {}) => {
  const redirectUri = (host.redirectUri ?? '').replace(/\s/g, '')
  const base = host.authorizeUrl ?? `${String(host.url ?? '').replace(/\/+$/, '')}/oauth/authorize`
  const token = nonce()
  try { sessionStorage.setItem(KEY, JSON.stringify({ host: host.id, nonce: token, mode })) } catch { /* private window: the answer is then taken for a sign-in to the primary host */ }
  const query = new URLSearchParams({
    client_id: host.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: host.scope ?? 'api',
    state: `${host.id}.${token}`,
  })
  return `${base}?${query.toString()}`
}

/**
 * What a return to /login is: `{ host, mode }`, or `null` when the state is not the one that was sent (somebody else's link).
 * Without a state at all it is a sign-in to `fallbackHost`: what the page did when there was only one host. Can be asked once.
 */
export const readOAuthReturn = (query, fallbackHost) => {
  let kept = null
  try {
    kept = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    sessionStorage.removeItem(KEY)
  } catch { /* nothing kept */ }
  const state = typeof query?.state === 'string' ? query.state : ''
  if (!state) return { host: fallbackHost, mode: 'login' }
  const [host, token] = state.split('.')
  if (!kept || kept.host !== host || kept.nonce !== token) return null
  return { host, mode: kept.mode === 'link' ? 'link' : 'login' }
}
