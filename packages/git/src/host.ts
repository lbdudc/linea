import type { GitConfig } from './config.js'
import type { GitHostKind } from './provider.js'

/**
 * What differs between the git hosts in the way a program uses them, in one place. A program asks the descriptor of a host instead of
 * comparing its name (`kind === 'local'`), so a host is taught by adding its descriptor and not by hunting for the places that name it.
 */
export interface GitHostDescriptor {
  kind: GitHostKind
  /** What people call it. */
  label: string
  /** Whether people sign in with an OAuth application of the host (the local host has accounts made on the server instead). */
  oauth: boolean
  /** Whether the program makes and keeps the accounts (password, git token) of the host. */
  ownsAccounts: boolean
  /** Whether the host runs pipelines for what is pushed to it. */
  pipelines: boolean
  /** Whether who works on a repository is managed by the program (the host has no members of its own to manage). */
  managesMembers: boolean
  /** Whether every line and product has a group of its own, which is not a place to put a line in. */
  groupPerRepository: boolean
  /** The addresses a terminal needs to work on the host. */
  endpoints(config: GitConfig): Record<string, string | undefined>
  /** `config` with the settings an administrator gave the host over it (an unset one leaves what the configuration says); `extra` is added to the host's own section. */
  withSettings(config: GitConfig, settings: Record<string, unknown>, extra?: Record<string, unknown>): GitConfig
}

const defined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''))

const DESCRIPTORS: Record<GitHostKind, GitHostDescriptor> = {
  local: {
    kind: 'local',
    label: 'LINEA',
    oauth: false,
    ownsAccounts: true,
    pipelines: false,
    managesMembers: true,
    groupPerRepository: true,
    endpoints: (config) => ({ url: config.local?.baseUrl }),
    withSettings: (config, settings, extra = {}) => ({ ...config, local: { ...config.local, ...defined({ dataDir: settings['dataDir'] }), ...extra } }),
  },
  gitlab: {
    kind: 'gitlab',
    label: 'GitLab',
    oauth: true,
    ownsAccounts: false,
    pipelines: true,
    managesMembers: false,
    groupPerRepository: false,
    endpoints: (config) => ({ url: config.gitlab?.url }),
    withSettings: (config, settings, extra = {}) => {
      const { url, clientId, clientSecret, redirectUri } = settings
      return { ...config, gitlab: { ...config.gitlab, ...defined({ url, clientId, clientSecret, redirectUri }), ...extra } as GitConfig['gitlab'] }
    },
  },
  github: {
    kind: 'github',
    label: 'GitHub',
    oauth: true,
    ownsAccounts: false,
    pipelines: true,
    managesMembers: false,
    groupPerRepository: false,
    endpoints: (config) => ({ webUrl: config.github?.webUrl, apiUrl: config.github?.apiUrl }),
    withSettings: (config, settings, extra = {}) => {
      const { url, apiUrl, clientId, clientSecret, webIdeUrl, token, redirectUri } = settings
      return { ...config, github: { ...config.github, ...defined({ webUrl: url, apiUrl, clientId, clientSecret, webIdeUrl, token, redirectUri }), ...extra } as GitConfig['github'] }
    },
  },
}

/** The descriptor of a host. An unknown name is the local host's (as the program has always taken it). */
export const hostDescriptor = (kind: string): GitHostDescriptor => DESCRIPTORS[kind as GitHostKind] ?? DESCRIPTORS.local
