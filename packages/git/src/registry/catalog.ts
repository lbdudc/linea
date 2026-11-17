import semver from 'semver'
import { REGISTRY_INDEX_PATH, createFileCatalog, emptyRegistryIndex, serializeRegistryIndex, type PackageCatalog, type PackageSource, type RegistryEntry } from '@lbdudc/linea-core'
import type { GitHostKind, GitProvider, Id } from '../provider.js'
import { locationOf } from '../packages/index.js'
import { listPackages, type PackageSummary } from './packages.js'
import type { PackageKind } from './kinds.js'

/**
 * The catalog of a LINEA installation, kept in ONE git repository: `registry.json` on its `main` branch (a location such as
 * `gitlab:linea/registry`). Whoever may push there may register; the history of the file is the history of the registry.
 * It lists what is registered; it does not decide what an SPL may use (that is what the source and `trustedNamespaces` do).
 */

export const REGISTRY_TOPIC = 'linea-registry'
const CATALOG_CONCURRENCY = 5
const PENDING_DELETION = /-deletion_scheduled-\d+/

interface Host {
  provider: GitProvider
  token: string
}

/** The host a location is on: `local:`, `github:`, else GitLab (`gitlab:` and the locations that were written before there were schemes). */
export const hostOfLocation = (location: string): GitHostKind => (location.startsWith('local:') ? 'local' : location.startsWith('github:') ? 'github' : 'gitlab')

/** `gitlab:linea/registry` -> `linea/registry`, for the host that is being used. */
export const registryPathOf = ({ location, host }: { location: string, host: GitHostKind }): string => {
  const prefix = `${host}:`
  if (!location.startsWith(prefix) || location.length === prefix.length) {
    throw new Error(`The registry "${location}" is not on ${host}: write it as ${prefix}<path>.`)
  }
  return location.slice(prefix.length)
}

/** The text of `registry.json`, or `undefined` when the repository or the file is not there. */
const readIndex = async ({ provider, token, path }: Host & { path: string }): Promise<string | undefined> => {
  const repository = await provider.findRepository({ token, path })
  if (repository === null) return undefined
  try {
    return (await provider.readFile({ token, id: repository.id, path: REGISTRY_INDEX_PATH, ref: 'main' }))?.toString('utf8')
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined // an empty repository has no `main` yet
    throw error
  }
}

/** The repository of the registry, created with an empty `registry.json` when there is none. */
export const ensureRegistryRepository = async ({ provider, token, location }: Host & { location: string }): Promise<{ id: Id, path: string, created: boolean }> => {
  const path = registryPathOf({ location, host: provider.kind })
  const found = await provider.findRepository({ token, path })
  if (found !== null) return { id: found.id, path: found.path, created: false }
  const parts = path.split('/')
  const name = parts.pop() as string
  const group = parts.join('/')
  const namespace = await provider.findNamespace({ token, fullPath: group })
  if (namespace === null) throw new Error(`${group} does not exist on ${provider.kind}: the group (or owner) of the registry has to be there already.`)
  const repository = await provider.createRepository({ token, name, namespaceId: namespace.id, topics: [REGISTRY_TOPIC], defaultBranch: 'main' })
  await provider.commit({
    token,
    id: repository.id,
    branch: 'main',
    message: 'Start the registry',
    track: false,
    actions: [{ action: 'create', path: REGISTRY_INDEX_PATH, content: serializeRegistryIndex({ index: emptyRegistryIndex() }) }]
  })
  return { id: repository.id, path: repository.path, created: true }
}

/** Changes to one registry run one after another in this process; two processes writing at once can still lose one change. */
const queues = new Map<string, Promise<unknown>>()
const inTurn = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task)
  queues.set(key, run.catch(() => {}))
  return run
}

export const createGitCatalog = ({ provider, token, location }: Host & { location: string }): PackageCatalog => {
  const path = registryPathOf({ location, host: provider.kind })
  const catalog = createFileCatalog({
    read: () => readIndex({ provider, token, path }),
    write: async ({ content, message }) => {
      const { id } = await ensureRegistryRepository({ provider, token, location })
      const exists = (await provider.readFile({ token, id, path: REGISTRY_INDEX_PATH, ref: 'main' })) !== null
      await provider.commit({
        token,
        id,
        branch: 'main',
        message,
        track: false,
        actions: [{ action: exists ? 'update' : 'create', path: REGISTRY_INDEX_PATH, content }]
      })
    }
  })
  return {
    list: (args) => catalog.list(args),
    get: (args) => catalog.get(args),
    add: (args) => inTurn(path, () => catalog.add(args)),
    remove: (args) => inTurn(path, () => catalog.remove(args))
  }
}

/** The entry of a package that was just made or published by the caller, so there is no need to read it back. */
export const entryFor = ({ kind, provider, path, name, description, now = () => new Date() }: { kind: PackageKind, provider: GitProvider, path: string, name: string, description?: string | undefined, now?: () => Date }): RegistryEntry => ({
  kind,
  location: locationOf({ kind: provider.kind, path }),
  name,
  ...(description ? { description } : {}),
  addedAt: now().toISOString()
})

/**
 * The registered packages of one kind, with their versions. An entry that cannot be reached (deleted, private, or its host is down)
 * is still listed, marked `unavailable`, so that one broken entry does not hide the rest.
 */
export const listRegisteredPackages = async ({ provider, token, kind, catalog, source }: Host & { kind: PackageKind, catalog: PackageCatalog, source: PackageSource }): Promise<PackageSummary[]> => {
  // GitLab renames the group of a project scheduled for deletion to `<name>-deletion_scheduled-<id>` at once, and the project goes on
  // answering until the group is purged: an entry there is registered but gone, so it is not offered (the same rule the lines use)
  const entries = (await catalog.list({ kind })).filter((entry) => !PENDING_DELETION.test(entry.location))
  const summarize = async (entry: (typeof entries)[number]): Promise<PackageSummary> => {
    const host = hostOfLocation(entry.location)
    const path = entry.location.slice(host.length + 1)
    const base: PackageSummary = { id: null, host, kind, location: entry.location, name: entry.name, path, description: entry.description ?? '', webUrl: '', versions: [], latest: null }
    try {
      const sameHost = host === provider.kind
      const [versions, repository] = await Promise.all([
        source.listVersions({ location: entry.location }),
        sameHost ? provider.findRepository({ token, path }) : Promise.resolve(null)
      ])
      if (sameHost && repository === null) return { ...base, unavailable: true }
      const sorted = semver.rsort([...versions])
      return {
        ...base,
        ...(repository === null ? { readOnly: true } : { id: repository.id, name: repository.name, description: repository.description || base.description, webUrl: repository.webUrl }),
        versions: sorted,
        latest: sorted[0] ?? null
      }
    } catch {
      return { ...base, unavailable: true }
    }
  }
  // a few at a time: every entry costs a tags request and a repository lookup, and on a slow host all of them at once only queue up
  const summaries: PackageSummary[] = []
  for (let i = 0; i < entries.length; i += CATALOG_CONCURRENCY) {
    summaries.push(...await Promise.all(entries.slice(i, i + CATALOG_CONCURRENCY).map(summarize)))
  }
  return summaries.sort((a, b) => a.path.localeCompare(b.path))
}

/** Packages found by their topic that are not registered yet: what a "register a package" dialog offers. */
export const suggestPackages = async ({ catalog, ...rest }: Parameters<typeof listPackages>[0] & { catalog: PackageCatalog }): Promise<PackageSummary[]> => {
  const registered = new Set((await catalog.list({ kind: rest.kind })).map((entry) => entry.location))
  return (await listPackages(rest)).filter((summary) => !registered.has(summary.location))
}
