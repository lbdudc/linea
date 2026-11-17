import type { GitConfig } from './config.js'
import { GitHubProvider } from './github/provider.js'
import { GitLabProvider } from './gitlab/provider.js'
import { LocalProvider } from './local/provider.js'
import type { GitProvider } from './provider.js'
import { withReadCache } from './read-cache.js'

/** How a host is made: the provider for a configuration, and what its cached reads are keyed by (one cache per host address). */
export interface GitProviderRegistration {
  create: (config: GitConfig) => GitProvider
  cacheKey: (config: GitConfig) => string
}

const registrations = new Map<string, GitProviderRegistration>()

/**
 * Teaches `createGitProvider` a host. GitLab, GitHub and the local host are built in; a program can register another one by name.
 */
export const registerGitProvider = (kind: string, registration: GitProviderRegistration): void => {
  registrations.set(kind, registration)
}

export const unregisterGitProvider = (kind: string): boolean => registrations.delete(kind)

export const gitProviderKinds = (): string[] => [...registrations.keys()]

registerGitProvider('local', {
  create: (config) => {
    if (!config.local?.dataDir) throw new Error('The local git host needs a folder for the repositories (LINEA_REPOS_DIR).')
    return new LocalProvider({ ...config.local, dataDir: config.local.dataDir, redirectUri: config.gitlab?.redirectUri })
  },
  cacheKey: (config) => `local|${config.local?.dataDir ?? ''}`,
})

registerGitProvider('github', {
  create: (config) => new GitHubProvider({ config: config.github ?? {} }),
  cacheKey: (config) => `github|${config.github?.apiUrl ?? ''}`,
})

registerGitProvider('gitlab', {
  create: (config) => {
    if (!config.gitlab?.url) throw new Error('GitLab is the git host, but no address was given for it (GITLAB_HOSTNAME).')
    return new GitLabProvider(config.gitlab)
  },
  cacheKey: (config) => `gitlab|${config.gitlab?.url ?? ''}`,
})

/**
 * A provider of the host `config` names. Each call returns a new one, because a provider remembers what it did so that `rollback()` can
 * undo it: take one per operation.
 */
export const createGitProvider = (config: GitConfig): GitProvider => {
  const registration = registrations.get(config.provider)
  if (!registration) throw new Error(`${config.provider} is not a git host this program offers (${gitProviderKinds().join(', ') || 'none'}).`)
  return withReadCache(registration.create(config), registration.cacheKey(config))
}

/** `createGitProvider` with the configuration fixed: what a server calls once per operation. */
export const gitProviderFactory = (config: GitConfig | (() => GitConfig)): (() => GitProvider) =>
  () => createGitProvider(typeof config === 'function' ? config() : config)
