import { createRoutingSource, type PackageSource } from '@lbdudc/linea-core'
import type { GitConfig } from '../config.js'
import { createGitProvider } from '../factory.js'
import type { GitHostKind } from '../provider.js'
import { ProviderPackageSource } from './provider-source.js'
import { GitHubPackageSource } from './github-source.js'
import { GitLabPackageSource } from './gitlab-source.js'

export { GitHubPackageSource, discoverGitHubPackages, githubFiles, githubLocationOf, isGitHubLocation } from './github-source.js'
export { ProviderPackageSource } from './provider-source.js'
export { GitLabPackageSource, gitlabFiles, gitlabLocationOf, isGitLabLocation, withOverlay } from './gitlab-source.js'

/** The entries of `config.trustedNamespaces` that apply to a host: `github:<owner>` ones to GitHub, the others to GitLab. */
const trustedFor = (config: GitConfig, host: 'gitlab' | 'github'): string[] | null => {
  const entries = config.trustedNamespaces ?? []
  if (entries.length === 0) return []
  const mine = entries
    .filter((entry) => entry.startsWith('github:') === (host === 'github'))
    .map((entry) => (host === 'github' ? entry.slice('github:'.length) : entry).replace(/^\/+|\/+$/g, ''))
  return mine.length > 0 ? mine : null
}

export interface PackageSourceOptions {
  /** The user's token: it reads GitLab, and GitHub when GitHub is the host of the deployment. */
  token: string
  /** The user's token on each host they signed in to: it wins over `token` for that host (a person on both reads both). */
  tokens?: Partial<Record<GitHostKind, string | undefined>>
  userId: string | number
  /** Packages read from a branch as one version, instead of from their tags (to check a working copy that is not published). */
  overrides?: Record<string, { version: string, ref: string }>
  /** Aborted when whoever asked has gone: the GitLab source takes no further step. */
  signal?: AbortSignal
}

/**
 * The source linea-core reads packages through: one per host, chosen by the scheme of a location (`gitlab:`, `github:`). A module on
 * GitHub can require a metamodel on GitLab and the other way round.
 */
export const createPackageSource = (config: GitConfig, { token, tokens = {}, userId, overrides = {}, signal }: PackageSourceOptions): PackageSource =>
  createRoutingSource({
    sources: {
      // the packages on this server's own repositories; the user's token on `local` is theirs, as on any host
      ...(config.local?.dataDir || config.provider === 'local' || tokens.local
        ? { local: new ProviderPackageSource({ scheme: 'local', provider: createGitProvider({ ...config, provider: 'local' }), token: tokens.local ?? (config.provider === 'local' ? token : ''), overrides }) }
        : {}),
      // a GitLab that is not set up has no packages to read: its locations are refused as ones no registry here reads
      ...(config.gitlab?.url
        ? { gitlab: new GitLabPackageSource({ url: config.gitlab.url, token: tokens.gitlab ?? token, userId, allowedNamespaces: trustedFor(config, 'gitlab'), overrides, signal }) }
        : {}),
      // on a GitHub deployment the user's own token reads GitHub; otherwise only the configured token (or none, for public repositories) does
      github: new GitHubPackageSource({
        config: config.github ?? {},
        token: tokens.github ?? (config.provider === 'github' ? token : undefined),
        userId,
        allowedOwners: trustedFor(config, 'github'),
        overrides
      })
    }
  })

/** The location of a repository of the host: `gitlab:group/project`, `github:owner/repo`. */
export const locationOf = ({ kind, path }: { kind: GitHostKind, path: string }): string => `${kind}:${path}`
