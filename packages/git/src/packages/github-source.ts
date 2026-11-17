import type { PackageFiles, PackageSource } from '@lbdudc/linea-core'
import { PackageNotAllowedError } from '../errors.js'
import { GitHubClient } from '../github/client.js'
import { githubApiUrl, type GitHubConfig } from '../github/config.js'

/**
 * Where the modules and metamodels of an SPL can also come from: GitHub repositories, one version per git tag (`v1.2.3`).
 * A package's location is `github:<owner>/<repo>`, and `../x` in a manifest means the sibling repository of the same owner, exactly as
 * it does on GitLab. It implements linea-core's `PackageSource`.
 *
 * It needs no account for public repositories (GitHub allows 60 requests an hour without a token); a token raises that and
 * gives access to private ones.
 */

const PREFIX = 'github:'
const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/

export const isGitHubLocation = (location: unknown): location is string => typeof location === 'string' && /^github:[^/]+\/[^/]+$/.test(location)
export const githubLocationOf = (fullName: string): string => `${PREFIX}${fullName}`
const pathOf = (location: string): string => location.slice(PREFIX.length)

const CACHE_LIMIT = 2000
const cache = new Map<string, unknown>()
const remember = <T>(key: string, value: T): T => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, value)
  return value
}
const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/** The files of a repository at `ref`, as linea-core's `PackageFiles`. */
export const githubFiles = ({ client, token, userId, fullName, ref, immutable = false }: { client: GitHubClient, token: string | undefined, userId: string, fullName: string, ref: string, immutable?: boolean }): PackageFiles => {
  const scope = `${userId}|${fullName}|${ref}`
  return {
    read: async ({ path }) => {
      const key = `${scope}|file|${path}`
      if (immutable && cache.has(key)) return (cache.get(key) as Uint8Array | null) ?? undefined
      const bytes = await client.raw({ token, path: `/repos/${fullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}` })
      const value = bytes === null ? null : new Uint8Array(bytes)
      if (immutable) remember(key, value)
      return value ?? undefined
    },
    list: async ({ dir }) => {
      const key = `${scope}|tree`
      let paths = immutable ? (cache.get(key) as string[] | undefined) : undefined
      if (!paths) {
        const tree = await client.json({ token, path: `/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1` })
        paths = (tree.tree as { type: string, path: string }[]).filter((entry) => entry.type === 'blob').map((entry) => entry.path)
        if (immutable) remember(key, paths)
      }
      const prefix = dir.replace(/^\/+|\/+$/g, '')
      return prefix === '' ? paths : paths.filter((file) => file.startsWith(`${prefix}/`))
    }
  }
}

export interface GitHubSourceOptions {
  config?: GitHubConfig
  /** The user's own token; without it `config.token`, and without that, no token at all (public repositories). */
  token?: string | undefined
  userId?: string | number
  client?: GitHubClient
  /** `null`: the list exists but names no GitHub owner, so nothing is trusted. Empty: anywhere. */
  allowedOwners?: string[] | null
  overrides?: Record<string, { version: string, ref: string }>
}

export class GitHubPackageSource implements PackageSource {
  private readonly client: GitHubClient
  private readonly token: string | undefined
  private readonly userId: string
  private readonly allowed: string[] | null
  private readonly overrides: Record<string, { version: string, ref: string }>
  private readonly refOf = new Map<string, string>()

  constructor({ config = {}, token, userId = 'anonymous', client, allowedOwners = [], overrides = {} }: GitHubSourceOptions = {}) {
    this.client = client ?? new GitHubClient({ apiUrl: githubApiUrl(config) })
    this.token = token ?? config.token
    // (kept by who and where: two GitHub servers can have a repository of the same name)
    this.userId = `${githubApiUrl(config)}|${String(userId)}`
    this.allowed = allowedOwners
    this.overrides = overrides
  }

  private guard(location: string): string {
    if (!isGitHubLocation(location)) throw new PackageNotAllowedError(`"${location}" is not a GitHub location (github:owner/repo).`)
    const fullName = pathOf(location)
    const owner = fullName.split('/')[0] as string
    if (this.allowed === null || (this.allowed.length > 0 && !this.allowed.some((entry) => entry === owner || entry === fullName))) {
      throw new PackageNotAllowedError(`${location} is outside the trusted namespaces.`)
    }
    return fullName
  }

  async listVersions({ location }: { location: string }): Promise<string[]> {
    const fullName = this.guard(location)
    const override = this.overrides[location]
    if (override) return [override.version]
    const versions: string[] = []
    try {
      const tags = await this.client.paginate({ token: this.token, path: `/repos/${fullName}/tags` })
      for (const tag of tags) {
        const match = VERSION_TAG.exec(tag.name as string)
        if (!match) continue
        this.refOf.set(`${location}@${match[1]}`, tag.name as string)
        versions.push(match[1] as string)
      }
    } catch (error) {
      if ((error as { status?: number }).status === 404) return []
      throw error
    }
    return versions
  }

  private ref(location: string, version: string): string {
    return this.overrides[location]?.ref ?? this.refOf.get(`${location}@${version}`) ?? `v${version}`
  }

  async open({ location, version }: { location: string, version: string }): Promise<PackageFiles> {
    const fullName = this.guard(location)
    return githubFiles({ client: this.client, token: this.token, userId: this.userId, fullName, ref: this.ref(location, version), immutable: !this.overrides[location] })
  }

  async revision({ location, version }: { location: string, version: string }): Promise<string | undefined> {
    const fullName = this.guard(location)
    if (this.overrides[location]) return undefined
    const commit = await this.client.json({ token: this.token, path: `/repos/${fullName}/commits/${encodeURIComponent(this.ref(location, version))}` })
    return commit?.sha as string | undefined
  }
}

/**
 * The repositories of `owners` (users or organisations) that carry a topic (`linea-module`, `linea-metamodel`), with their versions:
 * what the registry page lists next to the GitLab packages.
 */
export const discoverGitHubPackages = async ({ topic, owners, source, client, token }: { topic: string, owners: string[], source: GitHubPackageSource, client: GitHubClient, token?: string | undefined }): Promise<{ repo: { full_name: string, name: string, description: string | null, html_url: string }, location: string, versions: string[] }[]> => {
  const found = []
  for (const owner of owners) {
    const result = await client.json({ token, path: `/search/repositories?q=${encodeURIComponent(`topic:${topic} user:${owner}`)}&per_page=100` })
    for (const repo of (result.items ?? []) as { full_name: string, name: string, description: string | null, html_url: string }[]) {
      const location = githubLocationOf(repo.full_name)
      const versions = await source.listVersions({ location }).catch(() => [] as string[])
      found.push({ repo, location, versions })
    }
  }
  return found
}
