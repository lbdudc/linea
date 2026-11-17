import type { GitHostKind } from './provider.js'
import type { GitHubConfig } from './github/config.js'
import type { GitLabConfig } from './gitlab/provider.js'

/**
 * Which git host a deployment (or a command line) works on, and how to reach it. The server builds it from its environment
 * (`gitConfigFromEnv`), the CLI from its own settings; nothing else in this library reads `process.env`.
 */
export interface LocalConfig {
  /** The folder the repositories live in. */
  dataDir?: string | undefined
  /** Where the repositories are served (`<baseUrl>/<group>/<name>.git`). */
  baseUrl?: string | undefined
  /** Top-level groups only their owner and the administrators write in (the registry); everybody else reads. */
  readOnlyGroups?: string[] | undefined
  /** Whose token it is: the server's accounts (without it every token is the one user `local`). */
  resolveUser?: ((token: string) => { username: string, avatarUrl?: string | undefined, admin?: boolean | undefined } | null | Promise<{ username: string, avatarUrl?: string | undefined, admin?: boolean | undefined } | null>) | undefined
}

export interface GitConfig {
  /** The host the user's repositories live on. */
  provider: GitHostKind
  gitlab?: GitLabConfig | undefined
  github?: GitHubConfig | undefined
  /** The repositories kept on the machine LINEA runs on (the `local` host). */
  local?: LocalConfig | undefined
  /**
   * Packages carry scripts that run in the process that checks them, so it can be limited to where they may come from: paths of
   * GitLab groups or projects (`registry`, `team/modules`), and `github:<owner>` for GitHub. Empty: anywhere. Set, but with nothing for a
   * host: nothing is read from that host.
   */
  trustedNamespaces?: string[] | undefined
  /** GitHub users or organisations whose packages (found by topic) are listed even when the deployment is not on GitHub. */
  githubOwners?: string[] | undefined
  /** Where the catalog of registered packages is kept: a repository, such as `gitlab:linea/registry`. Unset: every package found by topic is listed. */
  registry?: string | undefined
}

const list = (value: string | undefined): string[] => (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)

/**
 * The configuration the LINEA server has always been given:
 *   GIT_PROVIDER (gitlab by default | github | local)
 *   Local:   LINEA_REPOS_DIR, LINEA_GIT_URL (where the repositories are served)
 *   GitLab:  GITLAB_HOSTNAME, GITLAB_CLIENT_ID, GITLAB_SECRET_ID
 *   GitHub:  GITHUB_URL, GITHUB_API_URL (or LINEA_GITHUB_API), GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_WEB_IDE_URL, GITHUB_TOKEN
 *   both:    REDIRECT_URI (the address of the client; `/login` is added), LINEA_TRUSTED_NAMESPACES, LINEA_GITHUB_OWNERS,
 *            LINEA_REGISTRY (the repository that holds the catalog of registered packages, e.g. `gitlab:linea/registry`)
 */
export const gitConfigFromEnv = (env: Record<string, string | undefined> = process.env): GitConfig => {
  const provider = (env['GIT_PROVIDER'] ?? 'gitlab').toLowerCase()
  if (provider !== 'gitlab' && provider !== 'github' && provider !== 'local') {
    throw new Error(`GIT_PROVIDER=${provider} is not a git host this server knows (local, gitlab, github).`)
  }
  const redirectUri = `${env['REDIRECT_URI']}/login`
  return {
    provider,
    gitlab: {
      url: env['GITLAB_HOSTNAME'] ?? '',
      clientId: env['GITLAB_CLIENT_ID'],
      clientSecret: env['GITLAB_SECRET_ID'],
      redirectUri
    },
    github: {
      webUrl: env['GITHUB_URL'],
      apiUrl: env['GITHUB_API_URL'] ?? env['LINEA_GITHUB_API'],
      clientId: env['GITHUB_CLIENT_ID'],
      clientSecret: env['GITHUB_CLIENT_SECRET'],
      redirectUri,
      webIdeUrl: env['GITHUB_WEB_IDE_URL'],
      token: env['GITHUB_TOKEN']
    },
    local: { dataDir: env['LINEA_REPOS_DIR'], baseUrl: env['LINEA_GIT_URL'] },
    trustedNamespaces: list(env['LINEA_TRUSTED_NAMESPACES']),
    githubOwners: list(env['LINEA_GITHUB_OWNERS']),
    registry: env['LINEA_REGISTRY']?.trim() || undefined
  }
}
