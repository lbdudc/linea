import { ModuleResolutionError, type PackageFiles, type PackageSource } from '@lbdudc/linea-core'
import { PackageNotAllowedError } from '../errors.js'
import { createGitLabClient, type GitLabClient } from '../gitlab/client.js'

/**
 * Where the modules and metamodels of an SPL come from on GitLab: projects, one version per git tag (`v1.2.3`).
 * A package's location is `gitlab:<path_with_namespace>`. It implements linea-core's `PackageSource`: linea-core never fetches anything.
 */

const PREFIX = 'gitlab:'
const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/

export const isGitLabLocation = (location: unknown): location is string => typeof location === 'string' && location.startsWith(PREFIX) && location.length > PREFIX.length
export const gitlabLocationOf = (pathWithNamespace: string): string => `${PREFIX}${pathWithNamespace}`
const pathOf = (location: string): string => location.slice(PREFIX.length)
const projectIdOf = (location: string): string => encodeURIComponent(pathOf(location))

// What a tag holds does not change, so what was read from it is kept. Per user: a private repository's contents must not be served to
// someone who cannot read it. Not forever: a tag can be deleted and made again on another commit.
const CACHE_LIMIT = 2000
const CONTENT_TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number, value: unknown }>()
const remember = <T>(key: string, value: T): T => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), value })
  return value
}
const recall = (key: string): { value: unknown } | undefined => {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  if (Date.now() - hit.at >= CONTENT_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return hit
}

/** Forgets what was read of the tags of a package: a version was just published, and the next resolution has to see it (not a minute later). */
export const forgetPackageTags = (location: string): void => {
  if (!isGitLabLocation(location)) return
  const id = projectIdOf(location)
  for (const key of [...volatile.keys()]) if (key.includes(`|${id}|tag`)) volatile.delete(key)
}

// Resolutions of the same package at once (the health of every product of a page) would each read the same files before the first one
// could be remembered: a call on its way is shared by whoever asks for the same thing, per user and version.
const inflight = new Map<string, Promise<unknown>>()
const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const call = load().finally(() => { if (inflight.get(key) === call) inflight.delete(key) })
  inflight.set(key, call)
  return call
}

/** `load` for a tagged version (`immutable`): what was read is kept, and a read on its way is joined. Any other ref is read every time. */
const readThrough = <T>(immutable: boolean, key: string, load: () => Promise<T>): Promise<T> => {
  if (!immutable) return load()
  const hit = recall(key)
  if (hit) return Promise.resolve(hit.value as T)
  return once(key, async () => remember(key, await load()))
}

// A resolution reads every file of a package one after another (linea-core), a round trip each on a remote GitLab. Once a tagged version
// is listed its files are fetched a few at a time ahead of the reads, which then find them done (or join the call still running).
const PREFETCH_CONCURRENCY = 8
const PREFETCH_LIMIT = 600

/**
 * The files of a GitLab repository at `ref`, as linea-core's `PackageFiles`. `immutable`: the ref is a tag, so what is read can be kept.
 * `id` is the numeric project id, or the URL-encoded path.
 */
export const gitlabFiles = ({ client, token, userId, id, ref, immutable = false }: { client: GitLabClient, token: string, userId: string, id: string | number, ref: string, immutable?: boolean }): PackageFiles => {
  const scope = `${userId}|${id}|${ref}`
  const fetchFile = async (path: string): Promise<Uint8Array | undefined> => {
    const bytes = await readThrough(immutable, `${scope}|file|${path}`, async () => {
      const raw = await client.getRawFile(token, id, path, ref)
      return raw === null ? null : new Uint8Array(raw)
    })
    return bytes ?? undefined
  }
  // one call per file at a time, whoever asks: a read that arrives while its prefetch is on the way waits for that call
  const running = new Map<string, Promise<Uint8Array | undefined>>()
  const readOnce = (path: string): Promise<Uint8Array | undefined> => {
    let call = running.get(path)
    if (call === undefined) {
      call = fetchFile(path).finally(() => running.delete(path))
      running.set(path, call)
    }
    return call
  }
  const prefetch = (paths: string[]): void => {
    const queue = paths.slice(0, PREFETCH_LIMIT)
    const worker = async (): Promise<void> => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) await readOnce(path).catch(() => undefined)
    }
    for (let i = 0; i < Math.min(PREFETCH_CONCURRENCY, queue.length); i++) void worker()
  }
  return {
    read: ({ path }) => readOnce(path),
    list: async ({ dir }) => {
      const paths = await readThrough(immutable, `${scope}|tree`, () => client.getFilePaths(token, id, ref))
      const prefix = dir.replace(/^\/+|\/+$/g, '')
      return prefix === '' ? paths : paths.filter((file) => file.startsWith(`${prefix}/`))
    },
    // asked by whoever is about to read all of them (a derivation); a check only reads the few files that decide something
    ...(immutable ? { prefetch } : {})
  }
}

// Tags can be created (a release) or moved, so what lists them is kept only briefly: long enough that the many resolutions one
// session asks for (each change to the chosen modules resolves them all again) do not repeat the same GitLab calls.
const TAGS_TTL_MS = 60_000
const volatile = new Map<string, { at: number, value: Promise<unknown> }>()
const recent = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const now = Date.now()
  const hit = volatile.get(key)
  if (hit && now - hit.at < TAGS_TTL_MS) return hit.value as Promise<T>
  if (volatile.size >= CACHE_LIMIT) volatile.delete(volatile.keys().next().value as string)
  const value = load()
  volatile.set(key, { at: now, value })
  // a failure is not kept: the next call asks again
  value.catch(() => { if (volatile.get(key)?.value === value) volatile.delete(key) })
  return value
}

export interface GitLabSourceOptions {
  url: string
  token: string
  userId: string | number
  /** `null`: the list exists but names no GitLab path, so nothing is trusted. Empty: anywhere. */
  allowedNamespaces?: string[] | null
  /** Packages read from a branch as one version, instead of from their tags: to check what has not been published yet. */
  overrides?: Record<string, { version: string, ref: string }>
  /**
   * Whoever asked has gone (the browser closed the request): the source takes no further step. It is checked between GitLab calls, not
   * passed into them, because the calls are shared with other resolutions of the same user and one of them leaving must not fail the rest.
   */
  signal?: AbortSignal
}

const assertLive = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw Object.assign(new Error('The request was cancelled'), { name: 'AbortError' })
}

export class GitLabPackageSource implements PackageSource {
  private readonly client: GitLabClient
  private readonly token: string
  private readonly userId: string
  private readonly allowed: string[] | null
  private readonly overrides: Record<string, { version: string, ref: string }>
  private readonly refOf = new Map<string, string>()
  private readonly signal: AbortSignal | undefined

  constructor({ url, token, userId, allowedNamespaces = [], overrides = {}, signal }: GitLabSourceOptions) {
    this.signal = signal
    this.client = createGitLabClient({ url })
    this.token = token
    // (kept by who and where: two GitLabs can have a project of the same path, and the same person name on both)
    this.userId = `${url.replace(/\/+$/, '')}|${String(userId)}`
    this.allowed = allowedNamespaces
    this.overrides = overrides
  }

  private guard(location: string): string {
    if (!isGitLabLocation(location)) throw new PackageNotAllowedError(`"${location}" is not a GitLab location (gitlab:group/project).`)
    const path = pathOf(location)
    if (this.allowed === null || (this.allowed.length > 0 && !this.allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))) {
      throw new PackageNotAllowedError(`${location} is outside the trusted namespaces (${(this.allowed ?? []).join(', ')}).`)
    }
    return projectIdOf(location)
  }

  async listVersions({ location }: { location: string }): Promise<string[]> {
    assertLive(this.signal)
    const id = this.guard(location)
    const override = this.overrides[location]
    if (override) return [override.version]
    let tags: { name: string }[]
    try {
      tags = await recent(`${this.userId}|${id}|tags`, () => this.client.getTags(this.token, id))
    } catch (error) {
      // GitLab answers 404 both for a project that does not exist and for one this user's token cannot see: a package with no tags yet
      // answers 200 with an empty list, so a 404 is never "no versions". Said as it is, instead of as "no version satisfies".
      if ((error as { status?: number }).status === 404) {
        throw new ModuleResolutionError(`${location} does not exist, or your GitLab account has no access to it.`)
      }
      throw error
    }
    const versions: string[] = []
    for (const tag of tags) {
      const match = VERSION_TAG.exec(tag.name)
      if (!match) continue
      this.refOf.set(`${location}@${match[1]}`, tag.name)
      versions.push(match[1] as string)
    }
    return versions
  }

  private ref(location: string, version: string): string {
    return this.overrides[location]?.ref ?? this.refOf.get(`${location}@${version}`) ?? `v${version}`
  }

  async open({ location, version }: { location: string, version: string }): Promise<PackageFiles> {
    assertLive(this.signal)
    const id = this.guard(location)
    const files = gitlabFiles({ client: this.client, token: this.token, userId: this.userId, id, ref: this.ref(location, version), immutable: !this.overrides[location] })
    const signal = this.signal
    return {
      read: async (query) => { assertLive(signal); return files.read(query) },
      list: async (query) => { assertLive(signal); return files.list(query) },
      ...(files.prefetch ? { prefetch: (paths: string[]) => { if (!signal?.aborted) files.prefetch?.(paths) } } : {})
    }
  }

  async revision({ location, version }: { location: string, version: string }): Promise<string | undefined> {
    assertLive(this.signal)
    const id = this.guard(location)
    if (this.overrides[location]) return undefined
    const ref = this.ref(location, version)
    const tag = await recent(`${this.userId}|${id}|tag|${ref}`, () => this.client.getTag(this.token, id, ref)) as { commit?: { id?: string } } | null
    return tag?.commit?.id
  }
}

export { withOverlay } from '@lbdudc/linea-core'
