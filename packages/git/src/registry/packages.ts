import semver from 'semver'
import { ModuleCheckError, NAME_PATTERN, type Diagnostic, type PackageCatalog } from '@lbdudc/linea-core'
import type { GitConfig } from '../config.js'
import { generateChangelog } from '../changelog/index.js'
import { PackageNotFoundError } from '../errors.js'
import { GitHubClient } from '../github/client.js'
import { githubApiUrl } from '../github/config.js'
import { GitHubPackageSource, discoverGitHubPackages } from '../packages/github-source.js'
import { locationOf } from '../packages/index.js'
import { forgetPackageTags } from '../packages/gitlab-source.js'
import type { GitHostKind, GitProvider, Id, Release, Repository } from '../provider.js'
import { entryFor } from './catalog.js'
import { KIND_DEFINITIONS, type PackageKind } from './kinds.js'
import { assertPublishable, bumpWarning, createPackageRelease, preflight, publishedVersions, suggestBump, tagOf, type BumpLevel, type Preflight } from './release.js'

/**
 * The registry of modules and metamodels, on the git host: repositories with the topic `linea-module` or `linea-metamodel`, whose
 * versions are their `vX.Y.Z` tags. There is no database: the git host is the registry. These are the operations on it; who may do
 * what is for the caller to decide before calling.
 */

const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/
const CONCURRENCY = 5

export interface PackageSummary {
  id: Id | null
  host: GitHostKind
  kind: PackageKind
  /** `gitlab:group/project`, `github:owner/repo`: what an SPL names it by. */
  location: string
  name: string
  path: string
  description: string
  webUrl: string
  /** Highest first. */
  versions: string[]
  latest: string | null
  /** Listed for use, edited and published elsewhere. */
  readOnly?: boolean
  /** Registered, but its repository cannot be reached (deleted, private, host down). */
  unavailable?: boolean
}

export interface PackageDetail extends PackageSummary {
  files: string[]
  manifest: unknown
  manifestError: string | null
}

export const versionsOfTags = (tags: { name: string }[]): string[] =>
  semver.rsort(tags.map((tag) => VERSION_TAG.exec(tag.name)?.[1]).filter((version): version is string => Boolean(version)))

const summarize = ({ repository, kind, versions, host }: { repository: Repository, kind: PackageKind, versions: string[], host: GitHostKind }): PackageSummary => ({
  id: repository.id,
  host,
  kind,
  location: locationOf({ kind: host, path: repository.path }),
  name: repository.name,
  path: repository.path,
  description: repository.description ?? '',
  webUrl: repository.webUrl,
  versions,
  latest: versions[0] ?? null
})

export const isSafePath = (path: unknown): path is string =>
  typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some((part) => part === '' || part === '..' || part === '.git')

const decode = (bytes: Buffer | null): string | null => (bytes === null ? null : bytes.toString('utf8'))

interface Host {
  provider: GitProvider
  token: string
}

/** The repository of a package, which must be one of that kind. */
export const packageRepository = async ({ provider, token, kind, id }: Host & { kind: PackageKind, id: Id }): Promise<Repository> => {
  let repository: Repository
  try {
    repository = await provider.getRepository({ token, id })
  } catch (error) {
    if ((error as { status?: number }).status === 404) throw new PackageNotFoundError()
    throw error
  }
  if (!repository.topics.includes(KIND_DEFINITIONS[kind].topic)) throw new PackageNotFoundError()
  return repository
}

/** The manifest of a package as it is on `ref` (parsed: a manifest that is not valid throws what linea-core throws). */
export const readManifest = async ({ provider, token, kind, id, ref = 'main' }: Host & { kind: PackageKind, id: Id, ref?: string }): Promise<any> => {
  const definition = KIND_DEFINITIONS[kind]
  const content = decode(await provider.readFile({ token, id, path: definition.manifest, ref }))
  if (content === null) throw new PackageNotFoundError(`${definition.manifest} is missing`)
  return definition.parse({ content })
}

/**
 * Writes several files to a branch in one commit: a string creates or updates the file, `null` deletes it. A file that already has that
 * content is left as it is. Returns `null` without committing when nothing has to change.
 */
export const upsertFiles = async ({ provider, token, id, branch = 'main', message, files }: Host & { id: Id, branch?: string, message: string, files: Record<string, string | null> }): Promise<{ id: string } | null> => {
  const actions = []
  for (const [path, content] of Object.entries(files)) {
    let current: string | null = null
    try {
      current = Buffer.from((await provider.getFileRevision({ token, id, path, ref: branch })).content, 'base64').toString('utf8')
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
    if (content === null) {
      if (current !== null) actions.push({ action: 'delete' as const, path })
    } else if (current !== content) {
      actions.push({ action: current !== null ? 'update' as const : 'create' as const, path, content })
    }
  }
  if (actions.length === 0) return null
  return provider.commit({ token, id, branch, message, actions, track: false })
}

/** The packages of one kind the user can see, with their versions. */
export const listPackages = async ({ provider, token, kind, config, userId = 'anonymous' }: Host & { kind: PackageKind, config?: GitConfig, userId?: string | number }): Promise<PackageSummary[]> => {
  const topic = KIND_DEFINITIONS[kind].topic
  const repositories = await provider.listRepositories({ token, topic })
  const summaries: PackageSummary[] = []
  for (let i = 0; i < repositories.length; i += CONCURRENCY) {
    summaries.push(...await Promise.all(repositories.slice(i, i + CONCURRENCY).map(async (repository) => {
      let versions: string[] = []
      try {
        versions = versionsOfTags(await provider.listTags({ token, id: repository.id }))
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error
      }
      return summarize({ repository, kind, versions, host: provider.kind })
    })))
  }
  if (provider.kind !== 'github' && config) summaries.push(...await listGitHubPackages({ kind, config, userId }))
  return summaries.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * On a deployment that is not on GitHub, the packages of the GitHub owners named in `config.githubOwners`, found by the same topics.
 * They can be used by an SPL like any other; they are read-only here: published and edited on GitHub.
 */
const listGitHubPackages = async ({ kind, config, userId }: { kind: PackageKind, config: GitConfig, userId: string | number }): Promise<PackageSummary[]> => {
  const owners = config.githubOwners ?? []
  if (owners.length === 0) return []
  try {
    const client = new GitHubClient({ apiUrl: githubApiUrl(config.github ?? {}) })
    const source = new GitHubPackageSource({ config: config.github ?? {}, userId, client })
    const found = await discoverGitHubPackages({ topic: KIND_DEFINITIONS[kind].topic, owners, source, client, token: config.github?.token })
    return found.map(({ repo, location, versions }) => {
      const sorted = semver.rsort(versions)
      return {
        id: null,
        host: 'github' as const,
        readOnly: true,
        kind,
        location,
        name: repo.name,
        path: repo.full_name,
        description: repo.description ?? '',
        webUrl: repo.html_url,
        versions: sorted,
        latest: sorted[0] ?? null
      }
    })
  } catch {
    return [] // GitHub being unreachable (or rate limited) must not take the registry down with it
  }
}

/** A new package: a repository with its topic and the files a package of that kind starts with. What it made is undone if it fails. */
export const createPackage = async ({ provider, token, kind, name, description, namespaceId, catalog }: Host & { kind: PackageKind, name: string, description?: string | undefined, namespaceId?: Id | null | undefined, catalog?: PackageCatalog | undefined }): Promise<PackageSummary> => {
  if (!NAME_PATTERN.test(name)) throw new Error(`"${name}" is not a valid package name`)
  const definition = KIND_DEFINITIONS[kind]
  try {
    const repository = await provider.createRepository({ token, name, namespaceId: namespaceId ?? undefined, topics: [definition.topic] })
    for (const [path, content] of Object.entries(definition.scaffold({ name, description }))) {
      await provider.createFile({ token, id: repository.id, path, branch: 'main', content })
    }
    const summary = summarize({ repository: { ...repository, description: description ?? '' }, kind, versions: [], host: provider.kind })
    if (catalog) await catalog.add({ entry: entryFor({ kind, provider, path: repository.path, name, description }) })
    return summary
  } catch (error) {
    await provider.rollback().catch(() => {})
    throw error
  }
}

export const getPackage = async ({ provider, token, kind, id }: Host & { kind: PackageKind, id: Id }): Promise<PackageDetail> => {
  const repository = await packageRepository({ provider, token, kind, id })
  const [files, tags] = await Promise.all([provider.listFiles({ token, id, ref: 'main' }), provider.listTags({ token, id })])
  let manifest: unknown = null
  let manifestError: string | null = null
  try {
    manifest = await readManifest({ provider, token, kind, id })
  } catch (error) {
    manifestError = (error as Error).message
  }
  return { ...summarize({ repository, kind, versions: versionsOfTags(tags), host: provider.kind }), files, manifest, manifestError }
}

export const readPackageFile = async ({ provider, token, kind, id, path, ref = 'main' }: Host & { kind: PackageKind, id: Id, path: string, ref?: string }): Promise<{ path: string, ref: string, content: string }> => {
  await packageRepository({ provider, token, kind, id })
  if (!isSafePath(path)) throw new PackageNotFoundError()
  const content = decode(await provider.readFile({ token, id, path, ref }))
  if (content === null) throw new PackageNotFoundError()
  return { path, ref, content }
}

/** Writes (or, with `content: null`, deletes) one file of a package on `main`. A manifest is checked before it is saved. */
export const savePackageFile = async ({ provider, token, kind, id, path, content, message }: Host & { kind: PackageKind, id: Id, path: string, content: string | null, message?: string | undefined }): Promise<{ path: string, committed: boolean }> => {
  await packageRepository({ provider, token, kind, id })
  if (!isSafePath(path)) throw new PackageNotFoundError()
  const definition = KIND_DEFINITIONS[kind]
  if (path === definition.manifest) {
    if (content === null) throw new Error(`${path} cannot be deleted`)
    definition.parse({ content }) // throws ModuleManifestError when it is not valid
  }
  const commit = await upsertFiles({ provider, token, id, message: message ?? `${content === null ? 'Delete' : 'Update'} ${path}`, files: { [path]: content } })
  return { path, committed: commit !== null }
}

/**
 * Writes (a string) or deletes (`null`) several files of a package on `main` in ONE commit, so an editor that changed a grammar and its
 * scripts leaves one version in the history instead of five. Every path is checked first, and so is the manifest if it is among them;
 * nothing is written when any of them is not valid.
 */
export const savePackageFiles = async ({ provider, token, kind, id, files, message }: Host & { kind: PackageKind, id: Id, files: Record<string, string | null>, message?: string | undefined }): Promise<{ paths: string[], committed: boolean }> => {
  await packageRepository({ provider, token, kind, id })
  const paths = Object.keys(files)
  if (paths.length === 0) return { paths, committed: false }
  for (const path of paths) if (!isSafePath(path)) throw new PackageNotFoundError()
  const definition = KIND_DEFINITIONS[kind]
  if (definition.manifest in files) {
    const content = files[definition.manifest]
    if (content === null || content === undefined) throw new Error(`${definition.manifest} cannot be deleted`)
    definition.parse({ content }) // throws ModuleManifestError when it is not valid
  }
  const commit = await upsertFiles({ provider, token, id, message: message ?? `Update ${paths.length === 1 ? paths[0] : `${paths.length} files`}`, files })
  return { paths, committed: commit !== null }
}

export interface PublishPreview {
  /** The version the manifest on `main` has. */
  version: string
  /** The last version published (null: none yet). */
  latest: string | null
  /** Why `version` cannot be published (not semver, already published, lower than the last one); null when it can. */
  versionError: string | null
  /** The bump the commits since `latest` imply. */
  suggestedBump: BumpLevel | null
  /** How many commits `main` has since `latest` (null when there is no `latest`): what the release's changelog will list. */
  commitsSince: number | null
  warnings: string[]
}

/** What publishing `version` of a package would do, without doing it: whether the version may be published, the bump the commits imply and how much there is to release. */
export const previewPublication = async ({ provider, token, kind, id, version }: Host & { kind: PackageKind, id: Id, version: unknown }): Promise<PublishPreview> => {
  const file = KIND_DEFINITIONS[kind].manifest
  const tags = await provider.listTags({ token, id })
  const published = publishedVersions(tags)
  const latest = published[0] ?? null
  let versionError: string | null = null
  try {
    assertPublishable({ version, published, file })
  } catch (error) {
    versionError = (error as Error).message
  }
  const warnings: string[] = []
  let suggested: BumpLevel | null = null
  let commitsSince: number | null = null
  if (latest !== null) {
    const changes = await generateChangelog({ provider, token, id, from: tagOf(tags, latest), to: 'main' })
    commitsSince = changes.commits.length
    suggested = suggestBump(changes.commits)
    if (versionError === null) {
      const warning = bumpWarning({ latest, version: version as string, suggested })
      if (warning) warnings.push(warning)
    }
  }
  return { version: String(version), latest, versionError, suggestedBump: suggested, commitsSince, warnings }
}

export interface PackageCheck {
  ok: boolean
  diagnostics: readonly Diagnostic[]
  [key: string]: unknown
}

/**
 * Publishes the version of `main`: checks that the version is valid semver, higher than the last one published and not already
 * published, checks the package (with `check`, which is given the location and the manifest), tags it `vX.Y.Z` and creates the release of
 * the tag with the changelog since the previous version. With `bump` (`patch`, `minor`, `major`) the version in the manifest is raised
 * first (a commit on `main`), so a package can be released without editing the manifest by hand.
 *
 * `suggestedBump` is what the commits since the last version imply, and `warnings` says when the version does not match it (it never blocks).
 */
export const publishPackage = async ({ provider, token, kind, id, bump, check }: Host & {
  kind: PackageKind
  id: Id
  bump?: semver.ReleaseType | undefined
  check: (args: { location: string, manifest: any }) => Promise<PackageCheck>
}): Promise<{ location: string, version: string, tag: string, report: PackageCheck, release: Release | null, suggestedBump: BumpLevel | null, warnings: string[] }> => {
  const definition = KIND_DEFINITIONS[kind]
  const repository = await packageRepository({ provider, token, kind, id })
  const location = locationOf({ kind: provider.kind, path: repository.path })
  let manifest = await readManifest({ provider, token, kind, id })

  let checked: Preflight
  if (bump) {
    const next = semver.inc(manifest.version, bump)
    checked = await preflight({ provider, token, id, version: next, file: definition.manifest }) // before anything is committed
    const raw = JSON.parse(decode(await provider.readFile({ token, id, path: definition.manifest, ref: 'main' })) as string)
    await upsertFiles({ provider, token, id, message: `Bump version to ${next}`, files: { [definition.manifest]: `${JSON.stringify({ ...raw, version: next }, null, 2)}\n` } })
    manifest = await readManifest({ provider, token, kind, id })
  } else {
    checked = await preflight({ provider, token, id, version: manifest.version, file: definition.manifest })
  }
  const { suggestedBump, warnings } = checked
  const tag = `v${manifest.version}`
  const report = await check({ location, manifest })
  if (!report.ok) throw new ModuleCheckError(`${location}@${manifest.version} does not pass its checks`, [...report.diagnostics])
  await provider.createTag({ token, id, tag, ref: 'main', message: `Release ${manifest.version}` })
  forgetPackageTags(location)
  const { release, warning } = await createPackageRelease({ provider, token, id, tag, name: manifest.name ?? repository.name })
  if (warning) warnings.push(warning)
  return { location, version: manifest.version, tag, report, release, suggestedBump, warnings }
}

export interface PackageChangelog {
  version: string
  tag: string
  /** Markdown, made from commit messages that whoever can push wrote: a page that shows it has to sanitize it (HTML included). */
  markdown: string
  /** The release the host holds, or the changelog worked out from the commits for a version that was tagged without one. */
  source: 'release' | 'commits'
  /** The page of the release on the host (empty when there is none). */
  url: string
}

/** The changelog of one version of a package (`1.2.0` or `v1.2.0`), for the catalog to show: its release, or the commits when it has none. */
export const getPackageChangelog = async ({ provider, token, kind, id, version }: Host & { kind: PackageKind, id: Id, version: string }): Promise<PackageChangelog> => {
  await packageRepository({ provider, token, kind, id })
  const clean = version.replace(/^v/, '')
  if (!semver.valid(clean)) throw new PackageNotFoundError()
  const tag = `v${clean}`
  if (!await provider.getTag({ token, id, tag })) throw new PackageNotFoundError()
  const release = await provider.getRelease({ token, id, tag })
  if (release) return { version: clean, tag, markdown: release.description, source: 'release', url: release.url }
  const changes = await generateChangelog({ provider, token, id, to: tag })
  return { version: clean, tag, markdown: changes.markdown, source: 'commits', url: '' }
}

/** The changelogs of every published version of a package, highest first (one call to the host for all the releases; a version without release is worked out from its commits). */
export const listPackageChangelogs = async ({ provider, token, kind, id }: Host & { kind: PackageKind, id: Id }): Promise<PackageChangelog[]> => {
  await packageRepository({ provider, token, kind, id })
  const [tags, releases] = await Promise.all([provider.listTags({ token, id }), provider.listReleases({ token, id })])
  const byTag = new Map(releases.map((release) => [release.tag, release]))
  const versions = versionsOfTags(tags)
  const result: PackageChangelog[] = []
  // a version with no release is worked out from its commits: a few at a time, each one is several calls to the host
  for (let i = 0; i < versions.length; i += CONCURRENCY) {
    result.push(...await Promise.all(versions.slice(i, i + CONCURRENCY).map(async (version): Promise<PackageChangelog> => {
      const tag = tagOf(tags, version)
      const release = byTag.get(tag)
      if (release) return { version, tag, markdown: release.description, source: 'release', url: release.url }
      const changes = await generateChangelog({ provider, token, id, to: tag })
      return { version, tag, markdown: changes.markdown, source: 'commits', url: '' }
    })))
  }
  return result
}
