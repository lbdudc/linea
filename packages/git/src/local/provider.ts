import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { ACCESS } from '../access.js'
import type {
  AccessEntry, AuthConfig, Capabilities, ChangeRequest, CiRunners, Comment, CommitSummary, Comparison, Delivery, DiffPosition, FileAction, FileDiff, GitProvider, Id, Issue, IssueChanges, IssueFilter, HostUser, Label, LabelEvent,
  Member, MergeOptions, MergeRequest, MergeRequestChanges, MergeRequestFilter, Milestone, Namespace, Page, Pipeline, PipelineJob, Release, ReleaseChanges, Repository, RepositoryFile, Template, TemplateKind, Thread, Tokens, PendingDeletion
} from '../provider.js'
import { closingIssueNumbers } from '../closing.js'
import { parseGitDiff } from './diff.js'
import { LocalError, cleanEnv, git, gitOk, gitText, identity } from './git.js'
import { LocalStore, type ChangeRequestRecord, type CommentRecord, type ReleaseRecord, type ThreadRecord, type IssueRecord, type NamespaceRecord, type RepositoryRecord, type State } from './store.js'

/** Who a token is: the server tells (a local account, with the token LINEA gave it). */
export interface LocalUser {
  username: string
  avatarUrl?: string | undefined
  /** An administrator can do everything everywhere. */
  admin?: boolean | undefined
}

export interface LocalProviderOptions {
  /** The folder the repositories and their bookkeeping live in. */
  dataDir: string
  /** Where the repositories are served by git over HTTP (`<baseUrl>/<group>/<name>.git`), and what links to them say. */
  baseUrl?: string | undefined
  /** The address of the client: where a login would come back to (there is no OAuth here, so it is only reported). */
  redirectUri?: string | undefined
  /** Whose token it is. Without it every token is the one user `local` (what a laptop with no accounts is). */
  resolveUser?: ((token: string) => LocalUser | null | Promise<LocalUser | null>) | undefined
  /** Top-level groups only their owner and the administrators write in (the registry): everybody else reads (level 20), unless a member says more. */
  readOnlyGroups?: string[] | undefined
}

/** The path segment a name becomes. Never ends in `.git` (that is where a repository's address ends) or starts with a dot. */
export const slug = (name: string): string =>
  String(name).trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').replace(/(\.git)+$/i, '').replace(/-+$/g, '') || 'unnamed'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const WRITE_ACCESS: number = ACCESS.DEVELOPER
const CLOSED_KEPT_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Reads the output of `git log -z --format=%H%x00%an%x00%aI%x00%s%x00%b`: NUL is the one byte a commit message cannot hold, so a message
 * cannot add a commit or move a field. Five fields a commit, the last one (the body) followed by the NUL that ends the record.
 */
const parseLog = (output: string): CommitSummary[] => {
  const parts = output.split('\0')
  const commits: CommitSummary[] = []
  for (let at = 0; at + 4 < parts.length; at += 5) {
    const [sha = '', authorName = '', createdAt = '', title = '', body = ''] = parts.slice(at, at + 5)
    if (!/^[0-9a-f]{40,64}$/.test(sha.replace(/^\n/, ''))) break
    const rest = body.trim()
    commits.push({ shortId: sha.replace(/^\n/, '').slice(0, 8), title, authorName, createdAt, webUrl: '', message: rest ? `${title}\n\n${rest}` : title })
  }
  return commits
}

/**
 * Repositories kept on the machine LINEA runs on, as bare git repositories: LINEA works with no other git host. A person's token is
 * LINEA's own (a local account); everybody on the server can work in every repository (level 40), the person who made it, and the
 * administrators, own it (level 50).
 *
 * What the other hosts have besides git is kept in `state.json` (see store.ts): groups, topics, members, change requests. There is no
 * CI here: a pipeline is what the host runs, and this one runs none.
 */
export class LocalProvider implements GitProvider {
  readonly kind = 'local' as const
  readonly nestsNamespaces = true
  readonly webhookPath = '/api/webhooks/local'
  readonly store: LocalStore
  private readonly baseUrl: string
  private readonly redirectUri: string
  private readonly resolveUser: NonNullable<LocalProviderOptions['resolveUser']>
  private readonly undo: (() => Promise<unknown>)[] = []
  private readonly readOnlyGroups: string[]

  constructor(options: LocalProviderOptions) {
    this.store = new LocalStore(options.dataDir)
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000/git').replace(/\/+$/, '')
    this.redirectUri = options.redirectUri ?? ''
    this.resolveUser = options.resolveUser ?? (() => ({ username: 'local' }))
    this.readOnlyGroups = options.readOnlyGroups ?? []
  }

  // ── plumbing ─────────────────────────────────────────────────────────────
  private remember(undo: () => Promise<unknown>): void {
    this.undo.push(undo)
  }

  private async user(token: string): Promise<LocalUser> {
    const user = await this.resolveUser(token)
    if (!user) throw new LocalError('The token does not belong to anyone here', 401, 'unauthorized')
    return user
  }

  private namespaceOf(state: State, id: Id): NamespaceRecord {
    const found = state.namespaces.find((namespace) => namespace.id === Number(id))
    if (!found) throw new LocalError('There is no such group', 404)
    return found
  }

  private repositoryOf(state: State, id: Id): RepositoryRecord {
    const found = typeof id === 'string' && Number.isNaN(Number(id))
      ? state.repositories.find((repository) => this.pathOf(state, repository) === id)
      : state.repositories.find((repository) => repository.id === Number(id))
    if (!found) throw new LocalError('There is no such repository', 404)
    return found
  }

  private pathOf(state: State, repository: RepositoryRecord): string {
    return `${this.namespaceOf(state, repository.namespaceId).path}/${slug(repository.name)}`
  }

  private dirOf(repository: RepositoryRecord): string {
    return this.store.repositoryDir(repository.id)
  }

  private toRepository(state: State, repository: RepositoryRecord): Repository {
    const namespace = this.namespaceOf(state, repository.namespaceId)
    const repoPath = this.pathOf(state, repository)
    return {
      id: repository.id,
      name: repository.name,
      path: repoPath,
      description: repository.description,
      webUrl: `${this.baseUrl}/${repoPath}`,
      webIdeUrl: '',
      namespaceId: repository.namespaceId,
      parentNamespaceId: namespace.parentId ?? undefined,
      defaultBranch: repository.defaultBranch,
      topics: [...repository.topics]
    }
  }

  private toNamespace(namespace: NamespaceRecord): Namespace {
    return { id: namespace.id, fullPath: namespace.path, name: namespace.name }
  }

  /** The repository and the folder of its git, once the caller is known to be allowed `level` on it. */
  private async open(token: string, id: Id, level: number = ACCESS.REPORTER): Promise<{ record: RepositoryRecord, dir: string, user: LocalUser, state: State }> {
    const user = await this.user(token)
    const state = await this.store.read((current) => current)
    const record = this.repositoryOf(state, id)
    if (this.levelFor(state, record, user) < level) throw new LocalError('You are not allowed to do that here', 403)
    return { record, dir: this.dirOf(record), user, state }
  }

  /**
   * What a person may do in a repository, as a git host's access level: the owner and the administrators can do everything, a member
   * has the level they were given, and everybody else works in it (maintainer) unless it is in a group only its owner writes in.
   * The API and git over HTTP both ask this, so a person can do the same through either.
   */
  levelFor(state: State, record: RepositoryRecord, user: LocalUser): number {
    if (user.admin || record.owner === user.username) return ACCESS.OWNER
    const member = record.members.find((candidate) => candidate.username === user.username)
    if (member) return member.accessLevel
    return this.isReadOnly(state, record.namespaceId) ? ACCESS.REPORTER : ACCESS.MAINTAINER
  }

  private isReadOnly(state: State, namespaceId: number): boolean {
    const found = state.namespaces.find((namespace) => namespace.id === namespaceId)
    return Boolean(found) && this.readOnlyGroups.includes((found as NamespaceRecord).path.split('/')[0] as string)
  }

  /** The level on a group: the same rule, for creating in it, renaming it and deleting it. */
  private levelOnNamespace(state: State, namespace: NamespaceRecord, user: LocalUser): number {
    if (user.admin || namespace.owner === user.username) return ACCESS.OWNER
    return this.isReadOnly(state, namespace.id) ? ACCESS.REPORTER : ACCESS.MAINTAINER
  }

  /** Whoever owns every repository under a group may also delete or rename it (the person who made a line owns the groups of its products). */
  private ownsEverythingUnder(state: State, ids: Set<number>, user: LocalUser): boolean {
    return state.repositories.filter((repository) => ids.has(repository.namespaceId)).every((repository) => this.levelFor(state, repository, user) >= ACCESS.OWNER)
  }

  private async resolveCommit(dir: string, ref: string): Promise<string | null> {
    const result = await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return result.code === 0 ? result.stdout.toString('utf8').trim() : null
  }

  private async mustResolve(dir: string, ref: string): Promise<string> {
    const commit = await this.resolveCommit(dir, ref)
    if (!commit) throw new LocalError(`There is no "${ref}" in this repository`, 404)
    return commit
  }

  // ── identity ─────────────────────────────────────────────────────────────
  authConfig(): AuthConfig {
    return { kind: 'local', clientId: undefined, redirectUri: this.redirectUri, url: this.baseUrl, authorizeUrl: '', scope: '' }
  }

  async exchangeCode(): Promise<Tokens> {
    throw new LocalError('People sign in to LINEA with a password here: there is no code to exchange', 400)
  }

  async refreshToken({ accessToken }: { refreshToken: string | null, accessToken: string }): Promise<Tokens> {
    return { accessToken, refreshToken: null }
  }

  async getUser({ token }: { token: string }): Promise<{ username: string, avatarUrl: string }> {
    const user = await this.user(token)
    return { username: user.username, avatarUrl: user.avatarUrl ?? '' }
  }

  // ── namespaces ───────────────────────────────────────────────────────────
  async listNamespaces({ token }: { token: string }): Promise<Namespace[]> {
    await this.user(token)
    return (await this.store.read((state) => state.namespaces)).map((namespace) => this.toNamespace(namespace))
  }

  async findNamespace({ token, fullPath }: { token: string, fullPath: string }): Promise<Namespace | null> {
    await this.user(token)
    const found = await this.store.read((state) => state.namespaces.find((namespace) => namespace.path === fullPath))
    return found ? this.toNamespace(found) : null
  }

  async createNamespace({ token, name, parentId }: { token: string, name: string, parentId?: Id | undefined }): Promise<Namespace> {
    const user = await this.user(token)
    const created = await this.store.update((state) => {
      const parent = parentId === undefined || parentId === null ? null : this.namespaceOf(state, parentId)
      if (parent && this.levelOnNamespace(state, parent, user) < WRITE_ACCESS) throw new LocalError('You are not allowed to create groups here', 403)
      const fullPath = parent ? `${parent.path}/${slug(name)}` : slug(name)
      if (state.namespaces.some((namespace) => namespace.path === fullPath)) {
        throw new LocalError(`The group "${fullPath}" already exists`, 409, 'already_exists')
      }
      const record: NamespaceRecord = { id: state.next++, name, path: fullPath, parentId: parent?.id ?? null, owner: user.username }
      state.namespaces.push(record)
      return record
    })
    this.remember(() => this.store.update((state) => { state.namespaces = state.namespaces.filter((namespace) => namespace.id !== created.id) }))
    return this.toNamespace(created)
  }

  async deleteNamespace({ token, id }: { token: string, id: Id }): Promise<unknown> {
    const user = await this.user(token)
    const removed = await this.store.update((state) => {
      const root = this.namespaceOf(state, id)
      const ids = this.subtreeOf(state, root.id)
      if (this.levelOnNamespace(state, root, user) < ACCESS.OWNER && !this.ownsEverythingUnder(state, ids, user)) throw new LocalError('You are not allowed to delete this group', 403)
      const repositories = state.repositories.filter((repository) => ids.has(repository.namespaceId))
      const namespaces = state.namespaces.filter((namespace) => ids.has(namespace.id))
      state.repositories = state.repositories.filter((repository) => !ids.has(repository.namespaceId))
      state.namespaces = state.namespaces.filter((namespace) => !ids.has(namespace.id))
      return { repositories, namespaces }
    })
    const moved = removed.repositories.map((repository) => this.toTrash(repository))
    // until the caller commits its own bookkeeping, this can be undone (`rollback()`): the repositories are in the trash, not gone
    this.remember(() => this.restore({ ...removed, moved }))
    return undefined
  }

  private subtreeOf(state: State, rootId: number): Set<number> {
    const ids = new Set<number>([rootId])
    for (let grew = true; grew;) {
      grew = false
      for (const namespace of state.namespaces) {
        if (namespace.parentId !== null && ids.has(namespace.parentId) && !ids.has(namespace.id)) { ids.add(namespace.id); grew = true }
      }
    }
    return ids
  }

  async renameNamespace({ token, id, name }: { token: string, id: Id, name: string }): Promise<unknown> {
    const user = await this.user(token)
    await this.store.update((state) => {
      const namespace = this.namespaceOf(state, id)
      if (this.levelOnNamespace(state, namespace, user) < ACCESS.OWNER && !this.ownsEverythingUnder(state, this.subtreeOf(state, namespace.id), user)) {
        throw new LocalError('You are not allowed to rename this group', 403)
      }
      const parent = namespace.parentId === null ? null : this.namespaceOf(state, namespace.parentId)
      const before = namespace.path
      const after = parent ? `${parent.path}/${slug(name)}` : slug(name)
      if (after !== before && state.namespaces.some((other) => other.path === after)) throw new LocalError(`The group "${after}" already exists`, 409, 'already_exists')
      namespace.name = name
      for (const other of state.namespaces) {
        if (other.id === namespace.id) other.path = after
        else if (other.path.startsWith(`${before}/`)) other.path = `${after}${other.path.slice(before.length)}`
      }
    })
    return undefined
  }

  // ── repositories ─────────────────────────────────────────────────────────
  async createRepository({ token, name, namespaceId, topics = [], defaultBranch = 'main' }: { token: string, name: string, namespaceId?: Id | undefined, topics?: string[], defaultBranch?: string | undefined }): Promise<Repository> {
    const user = await this.user(token)
    // first the id and the group are settled; the repository exists in the state only once its git does (a cut in between leaves a
    // folder nobody refers to, which costs disk; the other way round it leaves a repository that answers 500)
    const reserved = await this.store.update((state) => {
      let namespace: NamespaceRecord
      if (namespaceId === undefined || namespaceId === null) {
        // without a group: the person's own
        const own = state.namespaces.find((candidate) => candidate.path === slug(user.username))
        namespace = own ?? ((): NamespaceRecord => {
          const made: NamespaceRecord = { id: state.next++, name: user.username, path: slug(user.username), parentId: null, owner: user.username }
          state.namespaces.push(made)
          return made
        })()
      } else {
        namespace = this.namespaceOf(state, namespaceId)
      }
      if (this.levelOnNamespace(state, namespace, user) < WRITE_ACCESS) throw new LocalError('You are not allowed to create repositories here', 403)
      if (state.repositories.some((repository) => repository.namespaceId === namespace.id && slug(repository.name) === slug(name))) {
        throw new LocalError(`The repository "${namespace.path}/${slug(name)}" already exists`, 409, 'already_exists')
      }
      return { id: state.next++, namespaceId: namespace.id }
    })
    const record: RepositoryRecord = {
      id: reserved.id, name, namespaceId: reserved.namespaceId, description: '', topics: [...new Set(topics)], defaultBranch, owner: user.username,
      members: [], changeRequests: [], nextChangeRequest: 1, hooks: [], createdAt: new Date().toISOString()
    }
    const dir = this.dirOf(record)
    try {
      fs.mkdirSync(dir, { recursive: true })
      await gitOk(dir, ['init', '--bare', '--quiet', `--initial-branch=${defaultBranch}`])
      // a repository starts with one (empty) commit on its first branch, like the hosts that initialise it
      const commit = await gitText(dir, ['commit-tree', EMPTY_TREE, '-m', 'Initial commit'], { env: identity(user.username) })
      await gitOk(dir, ['update-ref', `refs/heads/${defaultBranch}`, commit])
      await this.store.update((state) => {
        // (the same name could have been taken while git worked)
        if (state.repositories.some((other) => other.namespaceId === record.namespaceId && slug(other.name) === slug(name))) {
          throw new LocalError(`The repository "${slug(name)}" already exists`, 409, 'already_exists')
        }
        this.namespaceOf(state, record.namespaceId)
        state.repositories.push(record)
      })
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw error
    }
    // (undoing a creation removes it for good: there is nothing to keep)
    this.remember(async () => {
      await this.store.update((state) => { state.repositories = state.repositories.filter((repository) => repository.id !== record.id) })
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const state = await this.store.read((current) => current)
    return this.toRepository(state, record)
  }

  listPendingDeletion(): Promise<PendingDeletion[]> {
    return Promise.resolve([])
  }

  restoreRepository(): Promise<unknown> {
    return Promise.reject(new LocalError('This host deletes at once: there is nothing to restore', 400))
  }

  restoreNamespace(): Promise<unknown> {
    return Promise.reject(new LocalError('This host deletes at once: there is nothing to restore', 400))
  }

  async deleteRepository({ token, id }: { token: string, id: Id }): Promise<unknown> {
    const { record } = await this.open(token, id, ACCESS.OWNER)
    await this.store.update((state) => { state.repositories = state.repositories.filter((repository) => repository.id !== record.id) })
    const moved = [this.toTrash(record)]
    this.remember(() => this.restore({ repositories: [record], namespaces: [], moved }))
    return undefined
  }

  // ── the trash: what is deleted waits here, for the caller to change its mind (rollback) and for an administrator to find it ──
  private get trashDir(): string {
    return path.join(this.store.dir, 'trash')
  }

  /** Moves the git of a repository out of the way; returns where it went (null when there was nothing). */
  private toTrash(record: RepositoryRecord): { from: string, to: string } | null {
    const from = this.dirOf(record)
    if (!fs.existsSync(from)) return null
    fs.mkdirSync(this.trashDir, { recursive: true })
    const to = path.join(this.trashDir, `${record.id}-${Date.now()}.git`)
    fs.renameSync(from, to)
    this.purgeTrash()
    return { from, to }
  }

  /** Forgets what has been in the trash for longer than `maxAgeMs` (a week by default). */
  purgeTrash(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
    if (!fs.existsSync(this.trashDir)) return
    for (const name of fs.readdirSync(this.trashDir)) {
      const entry = path.join(this.trashDir, name)
      try {
        if (Date.now() - fs.statSync(entry).mtimeMs > maxAgeMs) fs.rmSync(entry, { recursive: true, force: true })
      } catch { /* somebody else took it */ }
    }
  }

  private async restore({ repositories, namespaces, moved }: { repositories: RepositoryRecord[], namespaces: NamespaceRecord[], moved: ({ from: string, to: string } | null)[] }): Promise<void> {
    for (const entry of moved) if (entry && fs.existsSync(entry.to) && !fs.existsSync(entry.from)) fs.renameSync(entry.to, entry.from)
    await this.store.update((state) => {
      for (const namespace of namespaces) if (!state.namespaces.some((other) => other.id === namespace.id)) state.namespaces.push(namespace)
      for (const repository of repositories) if (!state.repositories.some((other) => other.id === repository.id)) state.repositories.push(repository)
    })
  }

  async renameRepository({ token, id, name }: { token: string, id: Id, name: string }): Promise<Repository> {
    await this.open(token, id, ACCESS.MAINTAINER)
    return this.store.update((state) => {
      const record = this.repositoryOf(state, id)
      if (state.repositories.some((other) => other.id !== record.id && other.namespaceId === record.namespaceId && slug(other.name) === slug(name))) {
        throw new LocalError(`The repository "${slug(name)}" already exists`, 409, 'already_exists')
      }
      record.name = name
      return this.toRepository(state, record)
    })
  }

  async getRepository({ token, id }: { token: string, id: Id }): Promise<Repository> {
    const { record, state } = await this.open(token, id)
    return this.toRepository(state, record)
  }

  async findRepository({ token, path: repoPath }: { token: string, path: string }): Promise<Repository | null> {
    await this.user(token)
    return this.store.read((state) => {
      const wanted = repoPath.replace(/\.git$/, '')
      const found = state.repositories.find((repository) => this.pathOf(state, repository) === wanted)
      return found ? this.toRepository(state, found) : null
    })
  }

  async listRepositories({ token, topic }: { token: string, topic: string }): Promise<Repository[]> {
    await this.user(token)
    return this.store.read((state) => state.repositories.filter((repository) => repository.topics.includes(topic)).map((repository) => this.toRepository(state, repository)))
  }

  async addTopic({ token, id, topic }: { token: string, id: Id, topic: string }): Promise<void> {
    await this.open(token, id, WRITE_ACCESS)
    await this.store.update((state) => {
      const record = this.repositoryOf(state, id)
      if (!record.topics.includes(topic)) record.topics.push(topic)
    })
  }

  async setDefaultBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<unknown> {
    const { record, dir } = await this.open(token, id, ACCESS.MAINTAINER)
    await this.mustResolve(dir, `refs/heads/${branch}`)
    await gitOk(dir, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
    await this.store.update((state) => { this.repositoryOf(state, record.id).defaultBranch = branch })
    return undefined
  }

  async getMembers({ token, id }: { token: string, id: Id }): Promise<Member[]> {
    const { record } = await this.open(token, id)
    const members = new Map<string, number>([[record.owner, ACCESS.OWNER]])
    for (const member of record.members) members.set(member.username, member.accessLevel)
    return [...members].map(([username, accessLevel]) => ({ username, accessLevel }))
  }

  async listAccess({ token, id }: { token: string, id: Id }): Promise<AccessEntry[]> {
    return (await this.getMembers({ token, id })).map((member) => ({ ...member, source: 'direct' as const }))
  }

  async setAccess({ token, id, username, accessLevel }: { token: string, id: Id, username: string, accessLevel: number }): Promise<void> {
    await this.setMember({ token, id, username, accessLevel })
  }

  async removeAccess({ token, id, username }: { token: string, id: Id, username: string }): Promise<void> {
    await this.removeMember({ token, id, username })
  }

  /** The names this host has seen as owners and members (the accounts are the server's: it searches them itself). */
  async searchUsers({ token, query }: { token: string, query: string }): Promise<HostUser[]> {
    await this.user(token)
    const state = await this.store.read((current) => current)
    const names = new Set<string>()
    for (const repository of state.repositories) { names.add(repository.owner); for (const member of repository.members) names.add(member.username) }
    const needle = query.trim().toLowerCase()
    return [...names].filter((name) => name.toLowerCase().includes(needle)).slice(0, 10).map((username) => ({ username, name: username, avatarUrl: null }))
  }

  async getAccessLevel({ token, id, username }: { token: string, id: Id, username: string }): Promise<number> {
    await this.user(token)
    const state = await this.store.read((current) => current)
    const record = state.repositories.find((repository) => repository.id === Number(id) || this.pathOf(state, repository) === id)
    if (!record) return 0
    const user = await this.resolveUser(token)
    if (user?.username === username && user.admin) return ACCESS.OWNER
    return this.levelFor(state, record, { username })
  }

  // ── files, commits, archives ─────────────────────────────────────────────
  private async revisionOf(dir: string, ref: string, filePath: string): Promise<string> {
    return gitText(dir, ['log', '-1', '--format=%H', ref, '--', filePath])
  }

  async getFile({ token, id, path: filePath, ref }: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    const { dir } = await this.open(token, id)
    const blob = await git(dir, ['cat-file', 'blob', `${ref}:${filePath}`])
    if (blob.code !== 0) throw new LocalError(`There is no file "${filePath}" at ${ref}`, 404)
    return { path: filePath, name: path.posix.basename(filePath), content: blob.stdout.toString('base64'), encoding: 'base64', revision: await this.revisionOf(dir, ref, filePath) }
  }

  getFileRevision(args: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    return this.getFile(args)
  }

  async readFile({ token, id, path: filePath, ref }: { token: string, id: Id, path: string, ref: string }): Promise<Buffer | null> {
    const { dir } = await this.open(token, id)
    const blob = await git(dir, ['cat-file', 'blob', `${ref}:${filePath}`])
    return blob.code === 0 ? blob.stdout : null
  }

  async listFiles({ token, id, ref }: { token: string, id: Id, ref: string }): Promise<string[]> {
    const { dir } = await this.open(token, id)
    const listing = await git(dir, ['ls-tree', '-r', '--name-only', '-z', ref])
    if (listing.code !== 0) throw new LocalError(`There is no "${ref}" in this repository`, 404)
    return listing.stdout.toString('utf8').split('\0').filter(Boolean)
  }

  async createFile({ token, id, path: filePath, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    return this.commit({ token, id, branch, message: `Create ${filePath}`, actions: [{ action: 'create', path: filePath, content }] })
  }

  async saveFile({ token, id, path: filePath, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    const exists = (await this.readFile({ token, id, path: filePath, ref: branch })) !== null
    return this.commit({ token, id, branch, message: `Update ${filePath}`, actions: [{ action: exists ? 'update' : 'create', path: filePath, content }] })
  }

  async commit({ token, id, branch, message, actions, track = true }: { token: string, id: Id, branch: string, message: string, actions: FileAction[], track?: boolean }): Promise<{ id: string }> {
    const { dir, user } = await this.open(token, id, WRITE_ACCESS)
    const head = await this.resolveCommit(dir, `refs/heads/${branch}`)
    if (!head) throw new LocalError(`There is no branch "${branch}"`, 404)
    const index = path.join(os.tmpdir(), `linea-local-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`)
    const env = { GIT_INDEX_FILE: index, ...identity(user.username) }
    try {
      await gitOk(dir, ['read-tree', head], { env })
      for (const action of actions) {
        const present = (await gitText(dir, ['ls-files', '--', action.path], { env })) !== ''
        if (action.action === 'create' && present) throw new LocalError(`A file named "${action.path}" already exists`, 400)
        if (action.action !== 'create' && !present) throw new LocalError(`There is no file "${action.path}" on ${branch}`, 404)
        if (action.expectedRevision && action.action !== 'create' && await this.revisionOf(dir, head, action.path) !== action.expectedRevision) {
          throw new LocalError(`"${action.path}" changed since you read it`, 409)
        }
        if (action.action === 'delete') {
          // mode 0 takes the entry out of the index (`--force-remove` wants a work tree, and these repositories are bare)
          await gitOk(dir, ['update-index', '--index-info'], { env, input: `0 ${'0'.repeat(40)}\t${action.path}\n` })
          continue
        }
        const bytes = action.encoding === 'base64' ? Buffer.from(action.content ?? '', 'base64') : Buffer.from(action.content ?? '', 'utf8')
        const blob = await gitText(dir, ['hash-object', '-w', '--stdin'], { env, input: bytes })
        await gitOk(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${action.path}`], { env })
      }
      const tree = await gitText(dir, ['write-tree'], { env })
      if (tree === await gitText(dir, ['rev-parse', `${head}^{tree}`])) return { id: head }
      const commit = await gitText(dir, ['commit-tree', tree, '-p', head, '-m', message], { env })
      const moved = await git(dir, ['update-ref', `refs/heads/${branch}`, commit, head])
      if (moved.code !== 0) throw new LocalError(`"${branch}" moved while it was being changed`, 409)
      if (track) this.remember(() => git(dir, ['update-ref', `refs/heads/${branch}`, head, commit]))
      return { id: commit }
    } finally {
      fs.rmSync(index, { force: true })
    }
  }

  async downloadArchive({ token, id, ref }: { token: string, id: Id, ref?: string }): Promise<NodeJS.ReadableStream> {
    const { dir, record } = await this.open(token, id)
    const target = await this.mustResolve(dir, ref ?? record.defaultBranch)
    // inside one folder named after the repository and the commit, as the other hosts do (what reads an archive looks for it)
    const folder = `${slug(record.name)}-${target.slice(0, 8)}/`
    const child = spawn('git', ['archive', '--format=zip', `--prefix=${folder}`, target], { cwd: dir, env: cleanEnv({ GIT_DIR: dir }) as NodeJS.ProcessEnv, windowsHide: true })
    // a git that fails ends the stream with the error, not with an archive that looks complete
    const out = new PassThrough()
    const errors: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.stdout.pipe(out, { end: false })
    child.on('error', (error) => out.destroy(error))
    child.on('close', (code) => {
      if (code === 0) out.end()
      else out.destroy(new LocalError(`git archive failed: ${Buffer.concat(errors).toString('utf8').trim() || `exit ${code}`}`, 500))
    })
    return out
  }

  async compare({ token, id, from, to }: { token: string, id: Id, from: string, to: string }): Promise<Comparison> {
    const { dir } = await this.open(token, id)
    const [source, target] = [await this.resolveCommit(dir, from), await this.resolveCommit(dir, to)]
    if (!source || !target) throw new LocalError('There is no such branch to compare', 404)
    const base = (await git(dir, ['merge-base', source, target])).stdout.toString('utf8').trim() || source
    const log = await git(dir, ['log', '-z', '--format=%H%x00%an%x00%aI%x00%s%x00%b', `${base}..${target}`])
    const commits = parseLog(log.stdout.toString('utf8'))
    return { commits, files: parseGitDiff(await gitText(dir, ['diff', '-M', '--no-color', '--no-ext-diff', base, target])) }
  }

  async getCommits({ token, id, ref, perPage = 20 }: { token: string, id: Id, ref: string, perPage?: number }): Promise<CommitSummary[]> {
    const { dir } = await this.open(token, id)
    const log = await git(dir, ['log', '-z', `-n${perPage}`, '--format=%H%x00%an%x00%aI%x00%s%x00%b', '--end-of-options', ref])
    if (log.code !== 0) return []
    return parseLog(log.stdout.toString('utf8'))
  }

  // ── branches and tags ────────────────────────────────────────────────────
  async createBranch({ token, id, branch, ref, track = true }: { token: string, id: Id, branch: string, ref: string, track?: boolean }): Promise<unknown> {
    const { dir } = await this.open(token, id, WRITE_ACCESS)
    if (await this.resolveCommit(dir, `refs/heads/${branch}`)) throw new LocalError(`The branch "${branch}" already exists`, 400, 'already_exists')
    const commit = await this.mustResolve(dir, ref)
    await gitOk(dir, ['update-ref', `refs/heads/${branch}`, commit])
    if (track) this.remember(() => git(dir, ['update-ref', '-d', `refs/heads/${branch}`]))
    return undefined
  }

  async listBranches({ token, id }: { token: string, id: Id }): Promise<string[]> {
    const { dir } = await this.open(token, id)
    return (await gitText(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').map((line) => line.trim()).filter(Boolean)
  }

  async getBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<{ name: string, lastCommit: CommitSummary | null }> {
    const { dir } = await this.open(token, id)
    if (!await this.resolveCommit(dir, `refs/heads/${branch}`)) throw new LocalError(`There is no branch "${branch}"`, 404)
    const [last] = await this.getCommits({ token, id, ref: `refs/heads/${branch}`, perPage: 1 })
    return { name: branch, lastCommit: last ?? null }
  }

  async listTags({ token, id }: { token: string, id: Id }): Promise<{ name: string }[]> {
    const { dir } = await this.open(token, id)
    const refs = await gitText(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/tags'])
    return refs.split('\n').filter(Boolean).map((name) => ({ name }))
  }

  async getTag({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<{ name: string, commitId: string, message: string | null } | null> {
    const { dir } = await this.open(token, id)
    const shown = await git(dir, ['for-each-ref', '--format=%(objecttype)%00%(contents)', `refs/tags/${tag}`])
    const text = shown.stdout.toString('utf8')
    if (shown.code !== 0 || text.trim() === '') return null
    const [kind = '', ...contents] = text.split('\0')
    const commitId = await this.mustResolve(dir, `refs/tags/${tag}`)
    return { name: tag, commitId, message: kind === 'tag' ? contents.join('\0').trim() || null : null }
  }

  async createTag({ token, id, tag, ref, message }: { token: string, id: Id, tag: string, ref: string, message?: string }): Promise<unknown> {
    const { dir, user } = await this.open(token, id, WRITE_ACCESS)
    if (await this.resolveCommit(dir, `refs/tags/${tag}`)) throw new LocalError(`The tag "${tag}" already exists`, 409, 'already_exists')
    const commit = await this.mustResolve(dir, ref)
    if (message) await gitOk(dir, ['tag', '-a', '-m', message, tag, commit], { env: identity(user.username) })
    else await gitOk(dir, ['update-ref', `refs/tags/${tag}`, commit])
    this.remember(() => git(dir, ['update-ref', '-d', `refs/tags/${tag}`]))
    return undefined
  }

  // ── releases ─────────────────────────────────────────────────────────────
  // Kept in the state, by tag, next to the issues.
  private toRelease(record: ReleaseRecord): Release {
    // (there is no page for it on this host: the client shows no link for an empty address)
    return { tag: record.tag, name: record.name, description: record.description, createdAt: record.createdAt, url: '', prerelease: record.prerelease }
  }

  async createRelease({ token, id, tag, name, description = '', prerelease = false }: { token: string, id: Id, tag: string, name?: string, description?: string, prerelease?: boolean }): Promise<Release> {
    const { record } = await this.open(token, id, WRITE_ACCESS)
    // (the exact tag: a revision such as `v1~1` would resolve to a commit without being a tag)
    if (!await this.getTag({ token, id, tag })) throw new LocalError(`There is no tag "${tag}"`, 404)
    const made = await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      if ((repository.releases ?? []).some((release) => release.tag === tag)) throw new LocalError(`The release of the tag "${tag}" already exists`, 409, 'already_exists')
      const release: ReleaseRecord = { tag, name: name?.trim() || tag, description, prerelease, createdAt: new Date().toISOString() }
      repository.releases = [...(repository.releases ?? []), release]
      return release
    })
    this.remember(() => this.store.update((current) => {
      const repository = current.repositories.find((candidate) => candidate.id === record.id)
      if (repository) repository.releases = (repository.releases ?? []).filter((release) => release.tag !== tag)
    }))
    return this.toRelease(made)
  }

  async getRelease({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<Release | null> {
    const { record } = await this.open(token, id)
    const found = (record.releases ?? []).find((release) => release.tag === tag)
    return found ? this.toRelease(found) : null
  }

  async listReleases({ token, id }: { token: string, id: Id }): Promise<Release[]> {
    const { record } = await this.open(token, id)
    return [...(record.releases ?? [])].reverse().map((release) => this.toRelease(release))
  }

  async updateRelease({ token, id, tag, changes }: { token: string, id: Id, tag: string, changes: ReleaseChanges }): Promise<Release> {
    const { record } = await this.open(token, id, WRITE_ACCESS)
    const updated = await this.store.update((current) => {
      const release = (this.repositoryOf(current, record.id).releases ?? []).find((candidate) => candidate.tag === tag)
      if (!release) throw new LocalError(`There is no release of the tag "${tag}"`, 404)
      if (changes.name !== undefined) release.name = changes.name.trim() || tag
      if (changes.description !== undefined) release.description = changes.description
      if (changes.prerelease !== undefined) release.prerelease = changes.prerelease
      return release
    })
    return this.toRelease(updated)
  }

  // ── change requests ──────────────────────────────────────────────────────
  private async conflicts(dir: string, target: string, source: string): Promise<boolean> {
    const [a, b] = [await this.resolveCommit(dir, `refs/heads/${target}`), await this.resolveCommit(dir, `refs/heads/${source}`)]
    if (!a || !b) return false
    return (await git(dir, ['merge-tree', '--write-tree', a, b])).code === 1
  }

  private async toChangeRequest(dir: string, web: string, request: ChangeRequestRecord): Promise<ChangeRequest> {
    return {
      number: request.number,
      title: request.title,
      sourceBranch: request.sourceBranch,
      targetBranch: request.targetBranch,
      // (there is no page for it on this host: the client shows no link for an empty address)
      webUrl: '',
      hasConflicts: request.state === 'opened' && await this.conflicts(dir, request.targetBranch, request.sourceBranch),
      state: request.state,
      createdAt: request.createdAt
    }
  }

  async createChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch: string }): Promise<ChangeRequest> {
    const { dir, record, state, user } = await this.open(token, id, WRITE_ACCESS)
    await this.mustResolve(dir, `refs/heads/${sourceBranch}`)
    await this.mustResolve(dir, `refs/heads/${targetBranch}`)
    const request = await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      // the ones that are over are not kept for ever: the state is read whole at every call
      const horizon = Date.now() - CLOSED_KEPT_MS
      repository.changeRequests = repository.changeRequests.filter((kept) => kept.state === 'opened' || Date.parse(kept.createdAt) > horizon)
      const made: ChangeRequestRecord = { number: repository.nextChangeRequest++, title, sourceBranch, targetBranch, state: 'opened', createdAt: new Date().toISOString(), author: user.username }
      repository.changeRequests.push(made)
      return made
    })
    return this.toChangeRequest(dir, this.toRepository(state, record).webUrl, request)
  }

  /** Closes a change request without merging it (it was not wanted). A merged or closed one stays as it is. */
  async closeChangeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<void> {
    const { record } = await this.open(token, id, WRITE_ACCESS)
    await this.store.update((state) => {
      const request = this.repositoryOf(state, record.id).changeRequests.find((candidate) => candidate.number === number)
      if (!request) throw new LocalError(`There is no change request ${number}`, 404)
      if (request.state === 'opened') request.state = 'closed'
    })
  }

  async createOrRenameChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch?: string }): Promise<ChangeRequest> {
    const { dir, record, state } = await this.open(token, id, WRITE_ACCESS)
    const target = targetBranch ?? record.defaultBranch
    const renamed = await this.store.update((current) => {
      const standing = this.repositoryOf(current, record.id).changeRequests.find((request) => request.state === 'opened' && request.sourceBranch === sourceBranch && request.targetBranch === target)
      if (standing) standing.title = title
      return standing ?? null
    })
    if (renamed) return this.toChangeRequest(dir, this.toRepository(state, record).webUrl, renamed)
    return this.createChangeRequest({ token, id, title, sourceBranch, targetBranch: target })
  }

  async listChangeRequests({ token, id, state: wanted = 'opened', targetBranch }: { token: string, id: Id, state?: 'opened' | 'merged' | 'closed' | 'all', targetBranch?: string }): Promise<ChangeRequest[]> {
    const { dir, record, state } = await this.open(token, id)
    const web = this.toRepository(state, record).webUrl
    const requests = record.changeRequests.filter((request) => (wanted === 'all' || request.state === wanted) && (!targetBranch || request.targetBranch === targetBranch))
    return Promise.all(requests.map((request) => this.toChangeRequest(dir, web, request)))
  }

  /**
   * Merges a change request. Answers whether it has conflicts (`true`: nothing was merged, it has to be resolved by hand). Anything
   * else that goes wrong is an error, not a conflict: git too old, a repository that cannot be read.
   */
  async mergeChangeRequest({ token, id, number, deleteSourceBranch = false }: { token: string, id: Id, number: number, deleteSourceBranch?: boolean }): Promise<boolean> {
    const { dir, record, user } = await this.open(token, id, WRITE_ACCESS)
    const request = record.changeRequests.find((candidate) => candidate.number === number)
    if (!request) throw new LocalError(`There is no change request ${number}`, 404)
    if (request.state !== 'opened') return false
    const targetRef = `refs/heads/${request.targetBranch}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [target, source] = [await this.mustResolve(dir, targetRef), await this.mustResolve(dir, `refs/heads/${request.sourceBranch}`)]
      // already in the target: nothing to merge, only to close
      const contained = (await git(dir, ['merge-base', '--is-ancestor', source, target])).code === 0
      if (!contained) {
        const merged = await git(dir, ['merge-tree', '--write-tree', target, source])
        if (merged.code === 1) return true
        if (merged.code !== 0) throw new LocalError(`git merge-tree failed (it needs git 2.38 or newer): ${merged.stderr.trim() || `exit ${merged.code}`}`, 500)
        const tree = merged.stdout.toString('utf8').split('\n')[0]?.trim() ?? ''
        const commit = await gitText(dir, ['commit-tree', tree, '-p', target, '-p', source, '-m', `Merge branch '${request.sourceBranch}' into '${request.targetBranch}'`], { env: identity(user.username) })
        // the target moves only if nobody moved it meanwhile; if they did, it is merged again over what is there now
        const moved = await git(dir, ['update-ref', targetRef, commit, target])
        if (moved.code !== 0) continue
      }
      if (deleteSourceBranch) await git(dir, ['update-ref', '-d', `refs/heads/${request.sourceBranch}`])
      await this.store.update((current) => {
        const standing = this.repositoryOf(current, record.id).changeRequests.find((candidate) => candidate.number === number)
        if (standing) standing.state = 'merged'
      })
      return false
    }
    throw new LocalError(`"${request.targetBranch}" kept moving while the change request was merged: try again`, 409)
  }

  // ── issues ───────────────────────────────────────────────────────────────
  // Kept in the state next to the change requests. Labels and milestones are free text here: there is no list to choose from, so the
  // ones offered are the ones the issues already use.
  capabilities(): Capabilities {
    return {
      issues: { labels: true, milestones: true, assignees: true, closingWords: true },
      templates: { editable: true },
      mergeRequests: { labels: true, reviewers: true, approvals: false, resolvableThreads: true, squash: true },
      deletion: { namespaceIsRepository: false, delayed: false },
      releases: { prerelease: true }
    }
  }

  private toIssue(record: IssueRecord): Issue {
    return {
      number: record.number, title: record.title, description: record.description, state: record.state, author: record.author,
      assignees: [...record.assignees], labels: [...record.labels], milestone: record.milestone,
      createdAt: record.createdAt, updatedAt: record.updatedAt, closedAt: record.closedAt,
      // (there is no page for it on this host: the client shows no link for an empty address)
      webUrl: '', commentCount: record.comments.length
    }
  }

  private issueOf(record: RepositoryRecord, number: number): IssueRecord {
    const found = (record.issues ?? []).find((candidate) => candidate.number === number)
    if (!found) throw new LocalError(`There is no issue ${number}`, 404)
    return found
  }

  private cleanList(values: string[] | undefined): string[] {
    return [...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))]
  }

  async listIssues({ token, id, filter = {} }: { token: string, id: Id, filter?: IssueFilter }): Promise<Page<Issue>> {
    const { record } = await this.open(token, id)
    const { state: wanted = 'opened', author, assignee, labels = [], milestone, search } = filter
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const needle = search?.trim().toLowerCase()
    const matching = (record.issues ?? [])
      .filter((issue) => (wanted === 'all' || issue.state === wanted)
        && (!author || issue.author === author)
        && (!assignee || issue.assignees.includes(assignee))
        && labels.every((label) => issue.labels.includes(label))
        && (!milestone || issue.milestone === milestone)
        && (!needle || issue.title.toLowerCase().includes(needle) || issue.description.toLowerCase().includes(needle)))
      .sort((a, b) => b.number - a.number)
    const items = matching.slice((page - 1) * perPage, page * perPage).map((issue) => this.toIssue(issue))
    return { items, page, perPage, hasMore: matching.length > page * perPage }
  }

  async getIssue({ token, id, number }: { token: string, id: Id, number: number }): Promise<Issue> {
    const { record } = await this.open(token, id)
    return this.toIssue(this.issueOf(record, number))
  }

  async createIssue({ token, id, title, description = '', labels, assignees, milestone }: { token: string, id: Id, title: string, description?: string, labels?: string[], assignees?: string[], milestone?: string | null }): Promise<Issue> {
    const { record, user } = await this.open(token, id)
    if (!title.trim()) throw new LocalError('An issue needs a title', 400)
    const made = await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      const now = new Date().toISOString()
      const issue: IssueRecord = {
        number: repository.nextIssue ?? 1, title: title.trim(), description, state: 'opened', author: user.username,
        assignees: this.cleanList(assignees), labels: this.cleanList(labels), milestone: milestone?.trim() || null,
        createdAt: now, updatedAt: now, closedAt: null, comments: [], nextComment: 1
      }
      issue.labelEvents = this.labelChanges([], issue.labels, user.username, now)
      repository.nextIssue = issue.number + 1
      repository.issues = [...(repository.issues ?? []), issue]
      return issue
    })
    return this.toIssue(made)
  }

  async updateIssue({ token, id, number, changes }: { token: string, id: Id, number: number, changes: IssueChanges }): Promise<Issue> {
    const { record, state, user } = await this.open(token, id)
    const level = this.levelFor(state, record, user)
    const updated = await this.store.update((current) => {
      const issue = this.issueOf(this.repositoryOf(current, record.id), number)
      // anyone who can read may open an issue and write on it; changing one is for who can push, and for who wrote it
      if (level < WRITE_ACCESS && issue.author !== user.username) throw new LocalError('You are not allowed to do that here', 403)
      if (changes.title !== undefined) {
        if (!changes.title.trim()) throw new LocalError('An issue needs a title', 400)
        issue.title = changes.title.trim()
      }
      if (changes.description !== undefined) issue.description = changes.description
      if (changes.labels !== undefined) {
        const labels = this.cleanList(changes.labels)
        issue.labelEvents = [...(issue.labelEvents ?? []), ...this.labelChanges(issue.labels, labels, user.username, new Date().toISOString())]
        issue.labels = labels
      }
      if (changes.assignees !== undefined) issue.assignees = this.cleanList(changes.assignees)
      if (changes.milestone !== undefined) issue.milestone = changes.milestone?.trim() || null
      if (changes.state !== undefined && changes.state !== issue.state) {
        issue.state = changes.state
        issue.closedAt = changes.state === 'closed' ? new Date().toISOString() : null
      }
      issue.updatedAt = new Date().toISOString()
      return issue
    })
    return this.toIssue(updated)
  }

  async listTemplates({ token, id, kind }: { token: string, id: Id, kind: TemplateKind }): Promise<Template[]> {
    const { record } = await this.open(token, id)
    return [...(record.templates?.[kind] ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((template) => ({ name: template.name, content: template.content }))
  }

  async saveTemplate({ token, id, kind, name, content }: { token: string, id: Id, kind: TemplateKind, name: string, content: string }): Promise<Template> {
    const { record } = await this.open(token, id, ACCESS.MAINTAINER)
    const clean = name.trim()
    if (!clean) throw new LocalError('A template needs a name', 400)
    await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      const templates = repository.templates ?? { issue: [], mergeRequest: [] }
      const others = templates[kind].filter((template) => template.name !== clean)
      repository.templates = { ...templates, [kind]: [...others, { name: clean, content }] }
    })
    return { name: clean, content }
  }

  async deleteTemplate({ token, id, kind, name }: { token: string, id: Id, kind: TemplateKind, name: string }): Promise<void> {
    const { record } = await this.open(token, id, ACCESS.MAINTAINER)
    if (!(record.templates?.[kind] ?? []).some((template) => template.name === name)) throw new LocalError(`There is no template ${name}`, 404)
    await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      const templates = repository.templates ?? { issue: [], mergeRequest: [] }
      repository.templates = { ...templates, [kind]: templates[kind].filter((template) => template.name !== name) }
    })
  }

  private async closeIssues(repositoryId: number, numbers: number[]): Promise<number[]> {
    if (!numbers.length) return []
    return this.store.update((current) => {
      const repository = this.repositoryOf(current, repositoryId)
      const closed: number[] = []
      const now = new Date().toISOString()
      for (const issue of repository.issues ?? []) {
        if (!numbers.includes(issue.number) || issue.state === 'closed') continue
        issue.state = 'closed'
        issue.closedAt = now
        issue.updatedAt = now
        closed.push(issue.number)
      }
      return closed
    })
  }

  async closeIssuesOfPush({ repositoryId, before, after }: { repositoryId: number, before: string | null, after: string }): Promise<number[]> {
    const dir = this.store.repositoryDir(repositoryId)
    const range = before ? `${before}..${after}` : after
    const log = await git(dir, ['log', '--max-count=500', '--format=%B%x00', range])
    if (log.code !== 0) return []
    return this.closeIssues(repositoryId, closingIssueNumbers(...log.stdout.toString('utf8').split('\0')))
  }

  async defaultBranchHead(repositoryId: number): Promise<string | null> {
    const record = await this.store.read((state) => this.repositoryOf(state, repositoryId))
    const head = await git(this.store.repositoryDir(repositoryId), ['rev-parse', '--verify', '--quiet', `refs/heads/${record.defaultBranch}`])
    return head.code === 0 ? head.stdout.toString('utf8').trim() : null
  }

  private toComment(record: CommentRecord): Comment {
    return { id: record.id, author: record.author, body: record.body, createdAt: record.createdAt, updatedAt: record.updatedAt }
  }

  /** What changed from one set of labels to another, as events. */
  private labelChanges(before: string[], after: string[], author: string, at: string) {
    return [
      ...before.filter((label) => !after.includes(label)).map((label) => ({ label, action: 'removed' as const, author, createdAt: at })),
      ...after.filter((label) => !before.includes(label)).map((label) => ({ label, action: 'added' as const, author, createdAt: at })),
    ]
  }

  async listIssueLabelEvents({ token, id, number }: { token: string, id: Id, number: number }): Promise<LabelEvent[]> {
    const { record } = await this.open(token, id)
    return (this.issueOf(record, number).labelEvents ?? []).map((event) => ({ ...event }))
  }

  async listIssueComments({ token, id, number }: { token: string, id: Id, number: number }): Promise<Comment[]> {
    const { record } = await this.open(token, id)
    return this.issueOf(record, number).comments.map((comment) => this.toComment(comment))
  }

  async addIssueComment({ token, id, number, body }: { token: string, id: Id, number: number, body: string }): Promise<Comment> {
    const { record, user } = await this.open(token, id)
    if (!body.trim()) throw new LocalError('A comment cannot be empty', 400)
    const made = await this.store.update((current) => {
      const issue = this.issueOf(this.repositoryOf(current, record.id), number)
      const now = new Date().toISOString()
      const comment: CommentRecord = { id: issue.nextComment, author: user.username, body, createdAt: now, updatedAt: now }
      issue.nextComment += 1
      issue.comments.push(comment)
      issue.updatedAt = now
      return comment
    })
    return this.toComment(made)
  }

  async listLabels({ token, id }: { token: string, id: Id }): Promise<Label[]> {
    const { record } = await this.open(token, id)
    return [...new Set((record.issues ?? []).flatMap((issue) => issue.labels))].sort().map((name) => ({ name }))
  }

  async listMilestones({ token, id }: { token: string, id: Id }): Promise<Milestone[]> {
    const { record } = await this.open(token, id)
    const titles = [...new Set((record.issues ?? []).flatMap((issue) => issue.milestone ? [issue.milestone] : []))].sort()
    return titles.map((title) => ({ title, state: 'opened' as const }))
  }

  // ── merge requests (the pages of them) ──────────────────────────────────
  private async toMergeRequest(dir: string, web: string, request: ChangeRequestRecord): Promise<MergeRequest> {
    const head = await this.resolveCommit(dir, `refs/heads/${request.sourceBranch}`)
    const threads = request.threads ?? []
    return {
      number: request.number, title: request.title, description: request.description ?? '', state: request.state, author: request.author,
      sourceBranch: request.sourceBranch, targetBranch: request.targetBranch, labels: [...(request.labels ?? [])], reviewers: [...(request.reviewers ?? [])], assignees: [],
      createdAt: request.createdAt, updatedAt: request.updatedAt ?? request.createdAt, mergedAt: request.mergedAt ?? null,
      // (there is no page for it on this host: the client shows no link for an empty address)
      webUrl: '',
      hasConflicts: request.state === 'opened' && await this.conflicts(dir, request.targetBranch, request.sourceBranch),
      headSha: head ?? undefined,
      commentCount: threads.reduce((sum, thread) => sum + thread.comments.length, 0)
    }
  }

  private requestOf(record: RepositoryRecord, number: number): ChangeRequestRecord {
    const found = record.changeRequests.find((candidate) => candidate.number === number)
    if (!found) throw new LocalError(`There is no merge request ${number}`, 404)
    return found
  }

  async listMergeRequests({ token, id, filter = {} }: { token: string, id: Id, filter?: MergeRequestFilter }): Promise<Page<MergeRequest>> {
    const { dir, record, state } = await this.open(token, id)
    const web = this.toRepository(state, record).webUrl
    const { state: wanted = 'opened', author, reviewer, labels = [], search, sourceBranch, targetBranch } = filter
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const needle = search?.trim().toLowerCase()
    const matching = record.changeRequests
      .filter((request) => (wanted === 'all' || request.state === wanted)
        && (!author || request.author === author)
        && (!reviewer || (request.reviewers ?? []).includes(reviewer))
        && labels.every((label) => (request.labels ?? []).includes(label))
        && (!sourceBranch || request.sourceBranch === sourceBranch)
        && (!targetBranch || request.targetBranch === targetBranch)
        && (!needle || request.title.toLowerCase().includes(needle) || (request.description ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => b.number - a.number)
    const items = await Promise.all(matching.slice((page - 1) * perPage, page * perPage).map((request) => this.toMergeRequest(dir, web, request)))
    return { items, page, perPage, hasMore: matching.length > page * perPage }
  }

  async getMergeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<MergeRequest> {
    const { dir, record, state } = await this.open(token, id)
    return this.toMergeRequest(dir, this.toRepository(state, record).webUrl, this.requestOf(record, number))
  }

  async createMergeRequest({ token, id, title, description = '', sourceBranch, targetBranch, labels, reviewers }: { token: string, id: Id, title: string, description?: string, sourceBranch: string, targetBranch: string, labels?: string[], reviewers?: string[] }): Promise<MergeRequest> {
    if (!title.trim()) throw new LocalError('A merge request needs a title', 400)
    const { dir, record, state, user } = await this.open(token, id, WRITE_ACCESS)
    await this.mustResolve(dir, `refs/heads/${sourceBranch}`)
    await this.mustResolve(dir, `refs/heads/${targetBranch}`)
    const made = await this.store.update((current) => {
      const repository = this.repositoryOf(current, record.id)
      if (repository.changeRequests.some((request) => request.state === 'opened' && request.sourceBranch === sourceBranch && request.targetBranch === targetBranch)) {
        throw new LocalError('Another open merge request already exists for this source branch', 409, 'already_exists')
      }
      const now = new Date().toISOString()
      const request: ChangeRequestRecord = {
        number: repository.nextChangeRequest++, title: title.trim(), sourceBranch, targetBranch, state: 'opened', createdAt: now, updatedAt: now,
        description, author: user.username, labels: this.cleanList(labels), reviewers: this.cleanList(reviewers), threads: [], nextThread: 1, nextComment: 1
      }
      repository.changeRequests.push(request)
      return request
    })
    return this.toMergeRequest(dir, this.toRepository(state, record).webUrl, made)
  }

  async updateMergeRequest({ token, id, number, changes }: { token: string, id: Id, number: number, changes: MergeRequestChanges }): Promise<MergeRequest> {
    const { dir, record, state, user } = await this.open(token, id)
    const level = this.levelFor(state, record, user)
    const updated = await this.store.update((current) => {
      const request = this.requestOf(this.repositoryOf(current, record.id), number)
      if (level < WRITE_ACCESS && request.author !== user.username) throw new LocalError('You are not allowed to do that here', 403)
      if (changes.title !== undefined) {
        if (!changes.title.trim()) throw new LocalError('A merge request needs a title', 400)
        request.title = changes.title.trim()
      }
      if (changes.description !== undefined) request.description = changes.description
      if (changes.labels !== undefined) request.labels = this.cleanList(changes.labels)
      if (changes.reviewers !== undefined) request.reviewers = this.cleanList(changes.reviewers)
      if (changes.state === 'closed' && request.state === 'opened') request.state = 'closed'
      if (changes.state === 'opened' && request.state === 'closed') request.state = 'opened'
      request.updatedAt = new Date().toISOString()
      return request
    })
    return this.toMergeRequest(dir, this.toRepository(state, record).webUrl, updated)
  }

  async getMergeRequestDiff({ token, id, number }: { token: string, id: Id, number: number }): Promise<FileDiff[]> {
    const { dir, record } = await this.open(token, id)
    const request = this.requestOf(record, number)
    const [target, source] = [await this.resolveCommit(dir, `refs/heads/${request.targetBranch}`), await this.resolveCommit(dir, `refs/heads/${request.sourceBranch}`)]
    if (!target || !source) return []
    // what the branch brought since it left the target, not what the target did meanwhile
    const base = (await git(dir, ['merge-base', target, source])).stdout.toString('utf8').trim() || target
    return parseGitDiff(await gitText(dir, ['diff', '-M', '--no-color', '--no-ext-diff', base, source]))
  }

  private toThread(thread: ThreadRecord): Thread {
    return {
      id: thread.id, resolvable: Boolean(thread.position), resolved: thread.resolved,
      position: thread.position ? { ...thread.position } : undefined,
      comments: thread.comments.map((comment) => this.toComment(comment))
    }
  }

  async listMergeRequestThreads({ token, id, number }: { token: string, id: Id, number: number }): Promise<Thread[]> {
    const { record } = await this.open(token, id)
    return (this.requestOf(record, number).threads ?? []).map((thread) => this.toThread(thread))
  }

  async addMergeRequestComment({ token, id, number, body, position, threadId }: { token: string, id: Id, number: number, body: string, position?: DiffPosition, threadId?: Id }): Promise<Thread> {
    if (!body.trim()) throw new LocalError('A comment cannot be empty', 400)
    const { record, user } = await this.open(token, id)
    const made = await this.store.update((current) => {
      const request = this.requestOf(this.repositoryOf(current, record.id), number)
      const now = new Date().toISOString()
      const comment: CommentRecord = { id: request.nextComment ?? 1, author: user.username, body, createdAt: now, updatedAt: now }
      request.nextComment = comment.id + 1
      request.threads ??= []
      let thread = threadId === undefined ? undefined : request.threads.find((candidate) => candidate.id === Number(threadId))
      if (threadId !== undefined && !thread) throw new LocalError(`There is no thread ${threadId}`, 404)
      if (!thread) {
        thread = { id: request.nextThread ?? 1, resolved: false, comments: [], ...(position ? { position: { path: position.path, line: position.line, side: position.side } } : {}) }
        request.nextThread = thread.id + 1
        request.threads.push(thread)
      }
      thread.comments.push(comment)
      request.updatedAt = now
      return thread
    })
    return this.toThread(made)
  }

  async setThreadResolved({ token, id, number, threadId, resolved }: { token: string, id: Id, number: number, threadId: Id, resolved: boolean }): Promise<Thread> {
    const { record } = await this.open(token, id)
    const made = await this.store.update((current) => {
      const thread = (this.requestOf(this.repositoryOf(current, record.id), number).threads ?? []).find((candidate) => candidate.id === Number(threadId))
      if (!thread) throw new LocalError(`There is no thread ${threadId}`, 404)
      if (!thread.position) throw new LocalError('Only a thread about the code can be resolved', 400)
      thread.resolved = resolved
      return thread
    })
    return this.toThread(made)
  }

  async mergeMergeRequest({ token, id, number, options = {} }: { token: string, id: Id, number: number, options?: MergeOptions }): Promise<boolean> {
    const { dir, record, user } = await this.open(token, id, WRITE_ACCESS)
    const request = this.requestOf(record, number)
    if (request.state !== 'opened') return true
    const targetRef = `refs/heads/${request.targetBranch}`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [target, source] = [await this.mustResolve(dir, targetRef), await this.mustResolve(dir, `refs/heads/${request.sourceBranch}`)]
      const contained = (await git(dir, ['merge-base', '--is-ancestor', source, target])).code === 0
      if (!contained) {
        const merged = await git(dir, ['merge-tree', '--write-tree', target, source])
        if (merged.code === 1) return true
        if (merged.code !== 0) throw new LocalError(`git merge-tree failed (it needs git 2.38 or newer): ${merged.stderr.trim() || `exit ${merged.code}`}`, 500)
        const tree = merged.stdout.toString('utf8').split('\n')[0]?.trim() ?? ''
        // a squash leaves one commit on the target, whose only parent is the target: the branch's own history is not kept
        const parents = options.squash ? ['-p', target] : ['-p', target, '-p', source]
        const message = options.message ?? (options.squash ? `${request.title} (!${request.number})` : `Merge branch '${request.sourceBranch}' into '${request.targetBranch}'`)
        const commit = await gitText(dir, ['commit-tree', tree, ...parents, '-m', message], { env: identity(user.username) })
        const moved = await git(dir, ['update-ref', targetRef, commit, target])
        if (moved.code !== 0) continue
      }
      if (options.deleteSourceBranch) await git(dir, ['update-ref', '-d', `refs/heads/${request.sourceBranch}`])
      await this.store.update((current) => {
        const standing = this.requestOf(this.repositoryOf(current, record.id), number)
        standing.state = 'merged'
        standing.mergedAt = new Date().toISOString()
        standing.updatedAt = standing.mergedAt
      })
      if (request.targetBranch === record.defaultBranch) {
        const messages = await git(dir, ['log', '--max-count=500', '--format=%B%x00', `${target}..${source}`])
        const commits = messages.code === 0 ? messages.stdout.toString('utf8').split('\0') : []
        await this.closeIssues(record.id, closingIssueNumbers(request.title, request.description, ...commits))
      }
      return false
    }
    throw new LocalError(`"${request.targetBranch}" kept moving while the merge request was merged: try again`, 409)
  }

  async approveMergeRequest(_args: { token: string, id: Id, number: number }): Promise<void> {
    throw new LocalError('This host has no approvals', 400)
  }

  // ── CI and hooks ─────────────────────────────────────────────────────────
  async listChangeRequestPipelines(_args: { token: string, id: Id, number: number }): Promise<Pipeline[]> {
    return []
  }

  async getCiRunners(_args: { token: string, id: Id }): Promise<CiRunners> {
    return { supported: false, instanceRunners: null, runners: [] }
  }

  async setInstanceRunners(_args: { token: string, id: Id, enabled: boolean }): Promise<void> {
    // this host runs no pipelines
  }

  async getLatestPipeline(_args: { token: string, id: Id, ref: string }): Promise<Pipeline | null> {
    return null
  }

  async listPipelines(_args: { token: string, id: Id, ref?: string, perPage?: number }): Promise<Pipeline[]> {
    return []
  }

  async getPipelineJobs(_args: { token: string, id: Id, pipelineId: Id }): Promise<PipelineJob[]> {
    return []
  }

  async retryPipeline(_args: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    // this host runs no pipelines
  }

  async enablePipelines(_args: { token: string, id: Id }): Promise<boolean> {
    return false // this host runs no pipelines
  }

  async disablePipelines(_args: { token: string, id: Id }): Promise<boolean> {
    return false // this host runs no pipelines
  }

  async pipelinesEnabled(_args: { token: string, id: Id }): Promise<boolean | null> {
    return null // this host runs no pipelines
  }

  async cancelPipeline(_args: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    // this host runs no pipelines
  }

  async cancelJob(_args: { token: string, id: Id, jobId: Id }): Promise<void> {
    // this host runs no pipelines
  }

  async getJobTrace(_args: { token: string, id: Id, jobId: Id, lines?: number }): Promise<string> {
    return ''
  }

  async ensureWebhook({ token, id, url, secret, branch }: { token: string, id: Id, url: string, secret: string, branch?: string }): Promise<{ status: 'created' | 'already_exists', hookId?: Id | null }> {
    const { record } = await this.open(token, id, ACCESS.MAINTAINER)
    return this.store.update((state) => {
      const repository = this.repositoryOf(state, record.id)
      const index = repository.hooks.findIndex((hook) => hook.url === url)
      if (index >= 0) return { status: 'already_exists' as const, hookId: index + 1 }
      repository.hooks.push({ url, secret, branch: branch ?? null })
      return { status: 'created' as const, hookId: repository.hooks.length }
    })
  }

  verifyWebhook({ headers, rawBody, secret }: Required<Delivery>): boolean {
    const given = headers['x-linea-signature'] ?? headers['X-Linea-Signature']
    if (!given) return false
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  }

  parsePushEvent({ body }: { headers: Record<string, string | undefined>, body: any }): { repositoryId: Id, branch: string } | null {
    if (body?.repositoryId === undefined || typeof body?.ref !== 'string' || !body.ref.startsWith('refs/heads/')) return null
    return { repositoryId: body.repositoryId, branch: body.ref.slice('refs/heads/'.length) }
  }

  /** Gives a person a level (reporter 20 .. maintainer 40) in a repository, or changes it. Only its owner (or an administrator) may; the owner's own level is not changed. */
  async setMember({ token, id, username, accessLevel }: { token: string, id: Id, username: string, accessLevel: number }): Promise<void> {
    const { record } = await this.open(token, id, ACCESS.OWNER)
    if (!([ACCESS.GUEST, ACCESS.REPORTER, ACCESS.DEVELOPER, ACCESS.MAINTAINER] as number[]).includes(accessLevel)) throw new LocalError(`${accessLevel} is not a level a member can have`, 400)
    if (record.owner === username) throw new LocalError('The owner of a repository is always its owner', 400)
    await this.store.addMember({ repositoryId: record.id, username, accessLevel })
  }

  /** Takes a person's level away: they go back to what everybody has here (or nothing, in a group only its owner writes in). */
  async removeMember({ token, id, username }: { token: string, id: Id, username: string }): Promise<void> {
    const { record } = await this.open(token, id, ACCESS.OWNER)
    await this.store.update((state) => {
      const repository = this.repositoryOf(state, record.id)
      repository.members = repository.members.filter((member) => member.username !== username)
    })
  }

  /**
   * Hands everything one person owns to another name (a person who leaves, a rename): the groups and repositories they made, and the
   * places they were a member of. Names that nobody can sign in with (`deleted:ana`) leave them to the administrators.
   */
  async transferOwnership({ from, to }: { from: string, to: string }): Promise<{ namespaces: number, repositories: number }> {
    return this.store.update((state) => {
      let namespaces = 0
      let repositories = 0
      for (const namespace of state.namespaces) if (namespace.owner === from) { namespace.owner = to; namespaces += 1 }
      for (const repository of state.repositories) {
        if (repository.owner === from) { repository.owner = to; repositories += 1 }
        const kept = repository.members.filter((member) => member.username !== to)
        repository.members = kept.map((member) => (member.username === from ? { ...member, username: to } : member))
      }
      return { namespaces, repositories }
    })
  }

  // ── unit of work, errors ─────────────────────────────────────────────────
  async rollback(): Promise<void> {
    while (this.undo.length) await (this.undo.pop() as () => Promise<unknown>)()
  }

  isAuthError(error: unknown): boolean {
    return (error as { status?: number })?.status === 401
  }

  isAlreadyExistsError(error: unknown): boolean {
    return (error as { code?: string })?.code === 'already_exists'
  }
}
