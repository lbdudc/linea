/**
 * Where GitHub is, and who LINEA is on it. Everything has the value of github.com unless it is given otherwise (GitHub Enterprise
 * Server, or the in-memory GitHub of the dev stack).
 */
export interface GitHubConfig {
  /** The website (default https://github.com): where the browser logs in. */
  webUrl?: string | undefined
  /** The REST API (default https://api.github.com; for another `webUrl`, `<webUrl>/api/v3`). */
  apiUrl?: string | undefined
  /** The OAuth App (or GitHub App) LINEA logs in with. */
  clientId?: string | undefined
  clientSecret?: string | undefined
  /** Where the browser comes back to after logging in. */
  redirectUri?: string | undefined
  /** The web editor (default https://github.dev). */
  webIdeUrl?: string | undefined
  /** A token to read with when the user has none of their own (packages from public repositories need none). */
  token?: string | undefined
}

const trimmed = (url: string): string => url.replace(/\/+$/, '')

export const githubWebUrl = (config: GitHubConfig = {}): string => trimmed(config.webUrl ?? 'https://github.com')

export const githubApiUrl = (config: GitHubConfig = {}): string => {
  if (config.apiUrl) return trimmed(config.apiUrl)
  return githubWebUrl(config) === 'https://github.com' ? 'https://api.github.com' : `${githubWebUrl(config)}/api/v3`
}

export const githubWebIdeUrl = (config: GitHubConfig = {}): string => trimmed(config.webIdeUrl ?? 'https://github.dev')

/** What LINEA asks the user to allow: their repositories (create, write, delete), the organisations they belong to, and webhooks. */
export const GITHUB_SCOPE = 'repo delete_repo read:org write:repo_hook'
