import type { AuthConfig } from './provider.js'

/**
 * Where to send a browser to log the user in on the host (the OAuth "authorize" page). The server's `/api/users/config` says which host
 * it is on and how (`AuthConfig`); a client that builds the address itself (the CLI, with a loopback redirect) uses this.
 */
export const buildAuthorizeUrl = ({ auth, redirectUri, state, scope }: { auth: Pick<AuthConfig, 'authorizeUrl' | 'clientId' | 'scope'>, redirectUri: string, state?: string, scope?: string }): string => {
  const params = new URLSearchParams({
    client_id: auth.clientId ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scope ?? auth.scope
  })
  if (state) params.set('state', state)
  return `${auth.authorizeUrl}?${params.toString()}`
}
