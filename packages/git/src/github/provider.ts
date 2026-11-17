import crypto from 'node:crypto'
import type {
  AuthConfig, Capabilities, ChangeRequest, CiRunners, Comment, CommitSummary, Comparison, Delivery, DiffPosition, FileAction, FileDiff, GitProvider, Id, Issue, IssueChanges, IssueFilter, Label, Member,
  MergeOptions, MergeRequest, MergeRequestChanges, MergeRequestFilter, Milestone, Namespace, Page, Pipeline, PipelineJob, Release, ReleaseChanges, Repository, RepositoryFile, Template, TemplateKind, Thread, Tokens, PendingDeletion
} from '../provider.js'
import { readRepositoryTemplates } from '../templates.js'
import { GitAuthError, GitError } from '../errors.js'
import { GitHubClient } from './client.js'
import { GITHUB_SCOPE, githubApiUrl, githubWebIdeUrl, githubWebUrl, type GitHubConfig } from './config.js'

/**
 * GitHub, behind the `GitProvider` contract.
 *
 * GitHub has no groups inside groups, and LINEA's line is a group holding the line's repository and a subgroup per product. Here a
 * **namespace is its repository**: the id of the namespace of a line or a product is the numeric id of its repository, and a product
 * repository carries the topic `linea-in-<id of its line's repository>`. `createNamespace` makes nothing on GitHub (it only says where
 * and under what name the repository that follows will be made); `createRepository` is the call that creates.
 *
 * What the user can choose as the place to create things in (`listNamespaces`) is their account and the organisations they can
 * create repositories in, with ids like `account:<login>`.
 */

type Json = any

const PARENT_TOPIC = 'linea-in-'
const ACCOUNT = 'account:'
const PENDING = 'pending:'

const LEVELS: Record<string, number> = { admin: 50, maintain: 40, write: 30, push: 30, triage: 20, read: 20, pull: 20 }

const accessLevelOf = (permissions: Json = {}): number =>
  permissions.admin ? 50 : permissions.maintain ? 40 : permissions.push ? 30 : permissions.triage ? 20 : permissions.pull ? 20 : 0

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const toCommit = (item: Json): CommitSummary => ({
  shortId: item.sha.slice(0, 8),
  title: String(item.commit?.message ?? '').split('\n')[0] as string,
  authorName: item.commit?.author?.name,
  createdAt: item.commit?.author?.date,
  webUrl: item.html_url,
  message: item.commit?.message
})

/** GitHub says `success` and `failure`; LINEA keeps GitLab's words for a pipeline. */
const pipelineStatus = (run: Json): string => {
  if (run.status !== 'completed') return run.status === 'in_progress' ? 'running' : 'pending'
  const words: Record<string, string> = { success: 'success', failure: 'failed', timed_out: 'failed', startup_failure: 'failed', cancelled: 'canceled', skipped: 'skipped', neutral: 'success' }
  return words[run.conclusion] ?? 'failed'
}

export interface GitHubProviderOptions {
  config?: GitHubConfig
  client?: GitHubClient
  /** How long to wait between looks at a pull request GitHub has not finished working out. */
  pollMs?: number
  pollAttempts?: number
}

export class GitHubProvider implements GitProvider {
  readonly kind = 'github' as const
  readonly nestsNamespaces = false
  readonly webhookPath = '/api/webhooks/github'
  private readonly config: GitHubConfig
  private readonly client: GitHubClient
  private readonly undo: (() => Promise<unknown>)[] = []
  private readonly pollMs: number
  private readonly pollAttempts: number

  constructor({ config = {}, client, pollMs = 500, pollAttempts = 120 }: GitHubProviderOptions = {}) {
    this.config = config
    this.client = client ?? new GitHubClient({ apiUrl: githubApiUrl(config) })
    this.pollMs = pollMs
    this.pollAttempts = pollAttempts
  }

  // ── plumbing ─────────────────────────────────────────────────────────────
  private json(token: string, path: string, options: { method?: string, body?: unknown } = {}): Promise<Json> {
    return this.client.json({ token, path, ...options })
  }

  /** What can be undone is remembered, newest first. */
  private remember(undo: () => Promise<unknown>): void {
    this.undo.push(undo)
  }

  private repoJson(token: string, id: Id): Promise<Json> {
    return typeof id === 'string' && id.includes('/') ? this.json(token, `/repos/${id}`) : this.json(token, `/repositories/${id}`)
  }

  private parentIdOf(json: Json): number | undefined {
    const topic = ((json.topics ?? []) as string[]).find((name) => name.startsWith(PARENT_TOPIC))
    return topic === undefined ? undefined : Number(topic.slice(PARENT_TOPIC.length))
  }

  /** The name LINEA knows a repository by: a product's repository is `<line>-<product>` on GitHub. */
  private logicalName(json: Json, parentName: string | undefined): string {
    return parentName !== undefined && json.name.startsWith(`${parentName}-`) ? json.name.slice(parentName.length + 1) : json.name
  }

  private toRepository(json: Json, parentName?: string): Repository {
    return {
      id: json.id,
      name: this.logicalName(json, parentName),
      path: json.full_name,
      description: json.description ?? '',
      webUrl: json.html_url,
      createdAt: json.created_at,
      webIdeUrl: `${githubWebIdeUrl(this.config)}/${json.full_name}`,
      namespaceId: json.id,
      parentNamespaceId: this.parentIdOf(json),
      defaultBranch: json.default_branch,
      topics: ((json.topics ?? []) as string[]).filter((name) => !name.startsWith(PARENT_TOPIC))
    }
  }

  /** Names of the lines the given repositories belong to, from the repositories themselves when they are among them. */
  private async withParents(token: string, jsons: Json[]): Promise<Repository[]> {
    const names = new Map<number, string | undefined>(jsons.map((json) => [json.id as number, json.name as string]))
    const out: Repository[] = []
    for (const json of jsons) {
      const parentId = this.parentIdOf(json)
      if (parentId !== undefined && !names.has(parentId)) {
        try {
          names.set(parentId, (await this.repoJson(token, parentId)).name)
        } catch {
          names.set(parentId, undefined)
        }
      }
      out.push(this.toRepository(json, parentId === undefined ? undefined : names.get(parentId)))
    }
    return out
  }

  private async login(token: string): Promise<string> {
    return (await this.json(token, '/user')).login
  }

  /** Where a repository is to be made: the account that owns it and the name of its namespace, and the line it is in, if any. */
  private async placeOf({ token, namespaceId, name }: { token: string, namespaceId: Id | undefined | null, name: string }): Promise<{ owner: string, name: string, parentId?: number | undefined }> {
    if (typeof namespaceId === 'string' && namespaceId.startsWith(PENDING)) {
      const [owner = '', nsName = '', parent = ''] = namespaceId.slice(PENDING.length).split(':')
      return { owner, name: nsName, parentId: parent === '' ? undefined : Number(parent) }
    }
    if (typeof namespaceId === 'string' && namespaceId.startsWith(ACCOUNT)) return { owner: namespaceId.slice(ACCOUNT.length), name }
    if (namespaceId === undefined || namespaceId === null) return { owner: await this.login(token), name }
    const parent = await this.repoJson(token, namespaceId)
    return { owner: parent.owner.login, name, parentId: parent.id }
  }

  // ── identity ─────────────────────────────────────────────────────────────
  authConfig(): AuthConfig {
    return {
      kind: 'github',
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri ?? '',
      url: githubWebUrl(this.config),
      authorizeUrl: `${githubWebUrl(this.config)}/login/oauth/authorize`,
      scope: GITHUB_SCOPE
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<Tokens> {
    const response = await fetch(`${githubWebUrl(this.config)}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'linea' },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...params }),
      signal: AbortSignal.timeout(30000)
    })
    const data = (await response.json()) as Json
    if (!response.ok || data.error) throw new GitAuthError(data.error_description ?? data.error ?? 'unauthorized')
    return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null }
  }

  exchangeCode({ code, redirectUri }: { code: string, redirectUri: string }): Promise<Tokens> {
    return this.tokenRequest({ code, redirect_uri: redirectUri })
  }

  /** An OAuth App's tokens do not expire and have no refresh token: the one the user has is kept. A GitHub App's are renewed. */
  async refreshToken({ refreshToken, accessToken }: { refreshToken: string | null, accessToken: string }): Promise<Tokens> {
    return refreshToken ? this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }) : { accessToken, refreshToken: null }
  }

  async getUser({ token }: { token: string }): Promise<{ username: string, avatarUrl: string }> {
    const user = await this.json(token, '/user')
    return { username: user.login, avatarUrl: user.avatar_url }
  }

  // ── namespaces ───────────────────────────────────────────────────────────
  async listNamespaces({ token }: { token: string }): Promise<Namespace[]> {
    const login = await this.login(token)
    const memberships = await this.client.paginate({ token, path: '/user/memberships/orgs?state=active' })
    const out: Namespace[] = [{ id: `${ACCOUNT}${login}`, fullPath: login, name: login }]
    for (const { role, organization } of memberships) {
      let allowed = role === 'admin'
      if (!allowed) allowed = ((await this.json(token, `/orgs/${organization.login}`).catch(() => ({}))) as Json).members_can_create_repositories !== false
      if (allowed) out.push({ id: `${ACCOUNT}${organization.login}`, fullPath: organization.login, name: organization.login })
    }
    return out
  }

  async findNamespace({ token, fullPath }: { token: string, fullPath: string }): Promise<Namespace | null> {
    try {
      const account = await this.json(token, `/users/${fullPath}`)
      return { id: `${ACCOUNT}${account.login}`, fullPath: account.login, name: account.login }
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async createNamespace({ token, name, parentId }: { token: string, name: string, parentId?: Id | undefined }): Promise<Namespace> {
    let owner: string
    let parent = ''
    if (typeof parentId === 'string' && parentId.startsWith(ACCOUNT)) owner = parentId.slice(ACCOUNT.length)
    else if (parentId === undefined || parentId === null) owner = await this.login(token)
    else {
      const parentRepo = await this.repoJson(token, parentId)
      owner = parentRepo.owner.login
      parent = String(parentRepo.id)
    }
    return { id: `${PENDING}${owner}:${name}:${parent}`, fullPath: `${owner}/${name}`, name, pending: true }
  }

  /** The repository of a namespace is deleted with the repositories that are in it (a line takes its products with it). */
  async deleteNamespace({ token, id }: { token: string, id: Id }): Promise<unknown> {
    if (typeof id === 'string' && id.startsWith(PENDING)) return null
    const repo = await this.repoJson(token, id)
    const children = (await this.client.paginate({ token, path: '/user/repos?sort=full_name' })).filter((other) => this.parentIdOf(other) === repo.id)
    for (const child of children) await this.json(token, `/repos/${child.full_name}`, { method: 'DELETE' })
    await this.json(token, `/repos/${repo.full_name}`, { method: 'DELETE' })
    return null
  }

  async renameNamespace({ token, id, name }: { token: string, id: Id, name: string }): Promise<unknown> {
    if (typeof id === 'string' && id.startsWith(PENDING)) return null
    return this.renameRepository({ token, id, name })
  }

  // ── repositories ─────────────────────────────────────────────────────────
  async createRepository({ token, name, namespaceId, topics = [], defaultBranch }: { token: string, name: string, namespaceId?: Id | undefined, topics?: string[], defaultBranch?: string | undefined }): Promise<Repository> {
    const place = await this.placeOf({ token, namespaceId, name })
    const parent = place.parentId === undefined ? undefined : await this.repoJson(token, place.parentId)
    const repoName = parent ? `${parent.name}-${place.name}` : place.name
    const isUser = place.owner === (await this.login(token))
    const created = await this.json(token, isUser ? '/user/repos' : `/orgs/${place.owner}/repos`, { method: 'POST', body: { name: repoName, auto_init: true } })
    this.remember(() => this.json(token, `/repos/${created.full_name}`, { method: 'DELETE' }))

    const names = [...topics, ...(parent ? [`${PARENT_TOPIC}${parent.id}`] : [])]
    if (names.length) await this.json(token, `/repos/${created.full_name}/topics`, { method: 'PUT', body: { names } })
    let branch = created.default_branch as string
    if (defaultBranch && defaultBranch !== branch) {
      await this.json(token, `/repos/${created.full_name}/branches/${encodePath(branch)}/rename`, { method: 'POST', body: { new_name: defaultBranch } })
      branch = defaultBranch
    }
    return this.toRepository({ ...created, topics: names, default_branch: branch }, parent?.name)
  }

  async deleteRepository({ token, id }: { token: string, id: Id }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    return this.json(token, `/repos/${repo.full_name}`, { method: 'DELETE' })
  }

  listPendingDeletion(): Promise<PendingDeletion[]> {
    return Promise.resolve([])
  }

  restoreRepository(): Promise<unknown> {
    return Promise.reject(new GitError('GitHub deletes at once: there is nothing to restore', 400))
  }

  restoreNamespace(): Promise<unknown> {
    return Promise.reject(new GitError('GitHub deletes at once: there is nothing to restore', 400))
  }

  async renameRepository({ token, id, name }: { token: string, id: Id, name: string }): Promise<Repository> {
    const repo = await this.repoJson(token, id)
    const parentId = this.parentIdOf(repo)
    const parent = parentId === undefined ? undefined : await this.repoJson(token, parentId)
    const target = parent ? `${parent.name}-${name}` : name
    const updated = repo.name === target ? repo : await this.json(token, `/repos/${repo.full_name}`, { method: 'PATCH', body: { name: target } })
    return this.toRepository({ ...updated, topics: repo.topics }, parent?.name)
  }

  async getRepository({ token, id }: { token: string, id: Id }): Promise<Repository> {
    const json = await this.repoJson(token, id)
    return (await this.withParents(token, [json]))[0] as Repository
  }

  async findRepository({ token, path }: { token: string, path: string }): Promise<Repository | null> {
    try {
      return await this.getRepository({ token, id: path })
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async listRepositories({ token, topic }: { token: string, topic: string }): Promise<Repository[]> {
    const all = await this.client.paginate({ token, path: '/user/repos?sort=full_name' })
    return this.withParents(token, all.filter((json) => !json.archived && ((json.topics ?? []) as string[]).includes(topic)))
  }

  async addTopic({ token, id, topic }: { token: string, id: Id, topic: string }): Promise<void> {
    const repo = await this.repoJson(token, id)
    const names: string[] = repo.topics ?? []
    if (!names.includes(topic)) await this.json(token, `/repos/${repo.full_name}/topics`, { method: 'PUT', body: { names: [...names, topic] } })
  }

  async setDefaultBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    return this.json(token, `/repos/${repo.full_name}`, { method: 'PATCH', body: { default_branch: branch } })
  }

  async getMembers({ token, id }: { token: string, id: Id }): Promise<Member[]> {
    const repo = await this.repoJson(token, id)
    try {
      const collaborators = await this.client.paginate({ token, path: `/repos/${repo.full_name}/collaborators?affiliation=all` })
      return collaborators.map((member) => ({ username: member.login as string, accessLevel: LEVELS[member.role_name as string] ?? accessLevelOf(member.permissions) }))
    } catch (error) {
      // listing collaborators needs push access; someone who can only read still sees themselves
      if ((error as { status?: number }).status !== 403) throw error
      return [{ username: await this.login(token), accessLevel: accessLevelOf(repo.permissions) }]
    }
  }

  /** What the user of `token` may do on a repository (GitHub answers for the token's own user, whoever `username` is). */
  async getAccessLevel({ token, id }: { token: string, id: Id, username: string }): Promise<number> {
    return accessLevelOf((await this.repoJson(token, id)).permissions)
  }

  // ── files, commits ───────────────────────────────────────────────────────
  private async toFile(token: string, repo: Json, json: Json): Promise<RepositoryFile> {
    let content = String(json.content ?? '').replace(/\n/g, '')
    // a file over 1 MB comes without its content: the blob has it
    if (json.encoding === 'none' || (content === '' && json.size > 0)) {
      content = String((await this.json(token, `/repos/${repo.full_name}/git/blobs/${json.sha}`)).content).replace(/\n/g, '')
    }
    return { path: json.path, name: json.name, content, encoding: 'base64', revision: json.sha }
  }

  async getFileRevision({ token, id, path, ref }: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    const repo = await this.repoJson(token, id)
    return this.toFile(token, repo, await this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`))
  }

  getFile(args: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    return this.getFileRevision(args)
  }

  async readFile({ token, id, path, ref }: { token: string, id: Id, path: string, ref: string }): Promise<Buffer | null> {
    const repo = await this.repoJson(token, id)
    return this.client.raw({ token, path: `/repos/${repo.full_name}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}` })
  }

  async listFiles({ token, id, ref }: { token: string, id: Id, ref: string }): Promise<string[]> {
    const repo = await this.repoJson(token, id)
    const tree = await this.json(token, `/repos/${repo.full_name}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
    return (tree.tree as Json[]).filter((entry) => entry.type === 'blob').map((entry) => entry.path as string).sort()
  }

  async createFile({ token, id, path, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    const result = await this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: { message: `Created ${path}`, content: Buffer.from(content, 'utf8').toString('base64'), branch }
    })
    this.remember(() => this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}`, {
      method: 'DELETE', body: { message: `Undo creating ${path}`, sha: result.content.sha, branch }
    }))
    return result
  }

  async saveFile({ token, id, path, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    let before: Json = null
    try {
      before = await this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`)
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
    const result = await this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: { message: `Updated ${path}`, content: Buffer.from(content, 'utf8').toString('base64'), branch, ...(before ? { sha: before.sha } : {}) }
    })
    this.remember(() => this.json(token, `/repos/${repo.full_name}/contents/${encodePath(path)}`, before
      ? { method: 'PUT', body: { message: `Undo updating ${path}`, content: String(before.content).replace(/\n/g, ''), sha: result.content.sha, branch } }
      : { method: 'DELETE', body: { message: `Undo creating ${path}`, sha: result.content.sha, branch } }))
    return result
  }

  /**
   * One commit with all the changes, made with the git data API (blobs, a tree, a commit, then the branch is moved). A change made from
   * a revision that is no longer the file's, or a branch that moved while this was being built, fails with status 409.
   */
  async commit({ token, id, branch, message, actions, track = true }: { token: string, id: Id, branch: string, message: string, actions: FileAction[], track?: boolean }): Promise<{ id: string }> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    let ref: Json
    try {
      ref = await this.json(token, `${base}/git/ref/heads/${encodePath(branch)}`)
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw new GitError(`The branch "${branch}" does not exist`, 404)
      throw error
    }
    const head = ref.object.sha as string
    const headCommit = await this.json(token, `${base}/git/commits/${head}`)
    const current = new Map<string, string>(((await this.json(token, `${base}/git/trees/${headCommit.tree.sha}?recursive=1`)).tree as Json[]).map((entry) => [entry.path as string, entry.sha as string]))

    const tree: Json[] = []
    for (const action of actions) {
      const exists = current.has(action.path)
      if (action.action === 'create' && exists) throw new GitError(`A file with the name ${action.path} already exists`, 400)
      if (action.action !== 'create' && !exists) throw new GitError(`A file with the name ${action.path} doesn't exist`, 400)
      if (action.expectedRevision !== undefined && current.get(action.path) !== action.expectedRevision) {
        throw new GitError(`${action.path} has changed since revision ${action.expectedRevision}`, 409)
      }
      if (action.action === 'delete') {
        tree.push({ path: action.path, mode: '100644', type: 'blob', sha: null })
        continue
      }
      const blob = await this.json(token, `${base}/git/blobs`, {
        method: 'POST',
        body: { content: action.content ?? '', encoding: action.encoding === 'base64' ? 'base64' : 'utf-8' }
      })
      tree.push({ path: action.path, mode: '100644', type: 'blob', sha: blob.sha })
    }

    const newTree = await this.json(token, `${base}/git/trees`, { method: 'POST', body: { base_tree: headCommit.tree.sha, tree } })
    const commit = await this.json(token, `${base}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [head] } })
    try {
      await this.json(token, `${base}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } })
    } catch (error) {
      if ((error as { status?: number }).status === 422) throw new GitError(`The branch "${branch}" changed while the commit was made: ${(error as Error).message}`, 409)
      throw error
    }
    if (track) {
      this.remember(() => this.json(token, `${base}/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: { sha: head, force: true } }))
    }
    return { id: commit.sha }
  }

  async downloadArchive({ token, id, ref = 'main' }: { token: string, id: Id, ref?: string }): Promise<NodeJS.ReadableStream> {
    const repo = await this.repoJson(token, id)
    return this.client.stream({ token, path: `/repos/${repo.full_name}/zipball/${encodeURIComponent(ref)}` })
  }

  async compare({ token, id, from, to }: { token: string, id: Id, from: string, to: string }): Promise<Comparison> {
    const repo = await this.repoJson(token, id)
    const result = await this.json(token, `/repos/${repo.full_name}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`)
    const files = ((result.files ?? []) as Json[]).map((file): FileDiff => ({
      oldPath: file.previous_filename ?? file.filename, newPath: file.filename,
      status: file.status === 'added' ? 'added' : file.status === 'removed' ? 'deleted' : file.status === 'renamed' ? 'renamed' : 'modified',
      additions: file.additions ?? 0, deletions: file.deletions ?? 0, patch: file.patch ?? ''
    }))
    return { commits: ((result.commits ?? []) as Json[]).map(toCommit).reverse(), files }
  }

  async getCommits({ token, id, ref, perPage = 10 }: { token: string, id: Id, ref: string, perPage?: number }): Promise<CommitSummary[]> {
    const repo = await this.repoJson(token, id)
    return ((await this.json(token, `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(ref)}&per_page=${perPage}`)) as Json[]).map(toCommit)
  }

  // ── branches, tags ───────────────────────────────────────────────────────
  async createBranch({ token, id, branch, ref, track = true }: { token: string, id: Id, branch: string, ref: string, track?: boolean }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    const { sha } = await this.json(token, `/repos/${repo.full_name}/commits/${encodeURIComponent(ref)}`)
    const created = await this.json(token, `/repos/${repo.full_name}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } })
    if (track) this.remember(() => this.json(token, `/repos/${repo.full_name}/git/refs/heads/${encodePath(branch)}`, { method: 'DELETE' }))
    return created
  }

  async listBranches({ token, id }: { token: string, id: Id }): Promise<string[]> {
    const repo = await this.repoJson(token, id)
    return (await this.client.paginate({ token, path: `/repos/${repo.full_name}/branches` })).map((branch) => branch.name)
  }

  async getBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<{ name: string, lastCommit: CommitSummary | null }> {
    const repo = await this.repoJson(token, id)
    const found = await this.json(token, `/repos/${repo.full_name}/branches/${encodePath(branch)}`)
    return { name: found.name, lastCommit: found.commit ? toCommit(found.commit) : null }
  }

  async listTags({ token, id }: { token: string, id: Id }): Promise<{ name: string }[]> {
    const repo = await this.repoJson(token, id)
    return (await this.client.paginate({ token, path: `/repos/${repo.full_name}/tags` })).map((tag) => ({ name: tag.name as string }))
  }

  async getTag({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<{ name: string, commitId: string, message: string | null } | null> {
    const repo = await this.repoJson(token, id)
    try {
      const ref = await this.json(token, `/repos/${repo.full_name}/git/ref/tags/${encodePath(tag)}`)
      // an annotated tag is an object of its own, with the message; a lightweight one points straight at the commit
      if (ref.object.type !== 'tag') return { name: tag, commitId: ref.object.sha, message: null }
      const annotated = await this.json(token, `/repos/${repo.full_name}/git/tags/${ref.object.sha}`)
      return { name: tag, commitId: annotated.object.sha, message: typeof annotated.message === 'string' && annotated.message !== '' ? annotated.message : null }
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async createTag({ token, id, tag, ref, message }: { token: string, id: Id, tag: string, ref: string, message?: string }): Promise<unknown> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    const { sha } = await this.json(token, `${base}/commits/${encodeURIComponent(ref)}`)
    let target = sha as string
    if (message !== undefined) target = (await this.json(token, `${base}/git/tags`, { method: 'POST', body: { tag, message, object: sha, type: 'commit' } })).sha
    const created = await this.json(token, `${base}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: target } })
    if (message === undefined) this.remember(() => this.json(token, `${base}/git/refs/tags/${encodePath(tag)}`, { method: 'DELETE' }))
    return created
  }

  // ── releases ─────────────────────────────────────────────────────────────
  private toRelease(json: Json): Release {
    return {
      tag: json.tag_name, name: json.name || json.tag_name, description: json.body ?? '', createdAt: json.created_at ?? json.published_at,
      url: json.html_url ?? '', prerelease: Boolean(json.prerelease)
    }
  }

  private async releaseJson(token: string, base: string, tag: string): Promise<Json | null> {
    try {
      return await this.json(token, `${base}/releases/tags/${encodePath(tag)}`)
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async createRelease({ token, id, tag, name, description = '', prerelease = false }: { token: string, id: Id, tag: string, name?: string, description?: string, prerelease?: boolean }): Promise<Release> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    // GitHub would make the tag itself from the default branch: a release is of a tag that is already there
    if (!await this.getTag({ token, id, tag })) throw new GitError(`There is no tag "${tag}"`, 404)
    if (await this.releaseJson(token, base, tag)) throw new GitError(`The release of the tag "${tag}" already exists`, 422)
    const made = await this.json(token, `${base}/releases`, { method: 'POST', body: { tag_name: tag, name: name || tag, body: description, prerelease } })
    this.remember(() => this.json(token, `${base}/releases/${made.id}`, { method: 'DELETE' }))
    return this.toRelease(made)
  }

  async getRelease({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<Release | null> {
    const repo = await this.repoJson(token, id)
    const found = await this.releaseJson(token, `/repos/${repo.full_name}`, tag)
    return found ? this.toRelease(found) : null
  }

  async listReleases({ token, id }: { token: string, id: Id }): Promise<Release[]> {
    const repo = await this.repoJson(token, id)
    // (a draft is not published and `getRelease` never finds it: it is left out here too, so the list and the lookup agree)
    return (await this.client.paginate({ token, path: `/repos/${repo.full_name}/releases` })).filter((json) => !json.draft).map((json) => this.toRelease(json))
  }

  async updateRelease({ token, id, tag, changes }: { token: string, id: Id, tag: string, changes: ReleaseChanges }): Promise<Release> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    const found = await this.releaseJson(token, base, tag)
    if (!found) throw new GitError(`There is no release of the tag "${tag}"`, 404)
    const body: Json = {}
    if (changes.name !== undefined) body.name = changes.name || tag
    if (changes.description !== undefined) body.body = changes.description
    if (changes.prerelease !== undefined) body.prerelease = changes.prerelease
    return this.toRelease(await this.json(token, `${base}/releases/${found.id}`, { method: 'PATCH', body }))
  }

  // ── change requests (pull requests) ──────────────────────────────────────
  private toChangeRequest(pull: Json, hasConflicts = false): ChangeRequest {
    return {
      number: pull.number, title: pull.title, sourceBranch: pull.head.ref, targetBranch: pull.base.ref, webUrl: pull.html_url, hasConflicts,
      state: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'opened',
      author: pull.user?.login, createdAt: pull.created_at, mergedAt: pull.merged_at ?? null, headSha: pull.head.sha
    }
  }

  // ── issues ───────────────────────────────────────────────────────────────
  capabilities(): Capabilities {
    return {
      issues: { labels: true, milestones: true, assignees: true, closingWords: false },
      templates: { editable: false },
      // (GitHub resolves threads only through its GraphQL API, which LINEA does not speak)
      mergeRequests: { labels: true, reviewers: true, approvals: true, resolvableThreads: false, squash: true },
      deletion: { namespaceIsRepository: true, delayed: false },
      releases: { prerelease: true }
    }
  }

  private toIssue(json: Json): Issue {
    return {
      number: json.number,
      title: json.title,
      description: json.body ?? '',
      state: json.state === 'closed' ? 'closed' : 'opened',
      author: json.user?.login,
      assignees: ((json.assignees ?? []) as Json[]).map((user) => user.login),
      labels: ((json.labels ?? []) as Json[]).map((label) => (typeof label === 'string' ? label : label.name)),
      milestone: json.milestone?.title ?? null,
      createdAt: json.created_at,
      updatedAt: json.updated_at,
      closedAt: json.closed_at ?? null,
      webUrl: json.html_url,
      commentCount: json.comments ?? 0
    }
  }

  /** GitHub names a milestone by its number, LINEA by its title. */
  private async milestoneNumber(token: string, fullName: string, title: string): Promise<number | null> {
    const milestones = await this.client.paginate({ token, path: `/repos/${fullName}/milestones?state=all` })
    return (milestones.find((milestone) => milestone.title === title)?.number as number | undefined) ?? null
  }

  async listIssues({ token, id, filter = {} }: { token: string, id: Id, filter?: IssueFilter }): Promise<Page<Issue>> {
    const repo = await this.repoJson(token, id)
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const state = filter.state ?? 'opened'
    let found: Json[]
    if (filter.search?.trim()) {
      // the list of issues cannot search the text: the search does, with the other filters as qualifiers
      const quote = (value: string): string => `"${value.replace(/"/g, '')}"`
      const terms = [`repo:${repo.full_name}`, 'is:issue', ...(state === 'all' ? [] : [`state:${state === 'opened' ? 'open' : 'closed'}`])]
      if (filter.author) terms.push(`author:${filter.author}`)
      if (filter.assignee) terms.push(`assignee:${filter.assignee}`)
      for (const label of filter.labels ?? []) terms.push(`label:${quote(label)}`)
      if (filter.milestone) terms.push(`milestone:${quote(filter.milestone)}`)
      terms.push(filter.search.trim())
      const query = new URLSearchParams({ q: terms.join(' '), sort: 'created', order: 'desc', per_page: String(perPage), page: String(page) })
      found = (await this.json(token, `/search/issues?${query}`)).items as Json[]
    } else {
      const query = new URLSearchParams({ state: state === 'opened' ? 'open' : state, sort: 'created', direction: 'desc', per_page: String(perPage), page: String(page) })
      if (filter.author) query.set('creator', filter.author)
      if (filter.assignee) query.set('assignee', filter.assignee)
      if (filter.labels?.length) query.set('labels', filter.labels.join(','))
      if (filter.milestone) {
        const number = await this.milestoneNumber(token, repo.full_name, filter.milestone)
        if (number === null) return { items: [], page, perPage, hasMore: false }
        query.set('milestone', String(number))
      }
      found = await this.json(token, `/repos/${repo.full_name}/issues?${query}`) as Json[]
    }
    // (GitHub lists pull requests among the issues)
    return { items: found.filter((json) => !json.pull_request).map((json) => this.toIssue(json)), page, perPage, hasMore: found.length === perPage }
  }

  async getIssue({ token, id, number }: { token: string, id: Id, number: number }): Promise<Issue> {
    const repo = await this.repoJson(token, id)
    const json = await this.json(token, `/repos/${repo.full_name}/issues/${number}`)
    // (a pull request answers on the path of an issue too)
    if (json.pull_request) throw new GitError(`There is no issue ${number}`, 404)
    return this.toIssue(json)
  }

  async createIssue({ token, id, title, description, labels, assignees, milestone }: { token: string, id: Id, title: string, description?: string, labels?: string[], assignees?: string[], milestone?: string | null }): Promise<Issue> {
    const repo = await this.repoJson(token, id)
    const body: Json = { title, body: description ?? '' }
    if (labels?.length) body.labels = labels
    if (assignees?.length) body.assignees = assignees
    if (milestone) body.milestone = await this.requireMilestone(token, repo.full_name, milestone)
    return this.toIssue(await this.json(token, `/repos/${repo.full_name}/issues`, { method: 'POST', body }))
  }

  private async requireMilestone(token: string, fullName: string, title: string): Promise<number> {
    const number = await this.milestoneNumber(token, fullName, title)
    if (number === null) throw new GitError(`There is no milestone "${title}"`, 400)
    return number
  }

  async updateIssue({ token, id, number, changes }: { token: string, id: Id, number: number, changes: IssueChanges }): Promise<Issue> {
    const repo = await this.repoJson(token, id)
    const body: Json = {}
    if (changes.title !== undefined) body.title = changes.title
    if (changes.description !== undefined) body.body = changes.description
    if (changes.labels !== undefined) body.labels = changes.labels
    if (changes.assignees !== undefined) body.assignees = changes.assignees
    if (changes.milestone !== undefined) body.milestone = changes.milestone === null ? null : await this.requireMilestone(token, repo.full_name, changes.milestone)
    if (changes.state !== undefined) body.state = changes.state === 'closed' ? 'closed' : 'open'
    return this.toIssue(await this.json(token, `/repos/${repo.full_name}/issues/${number}`, { method: 'PATCH', body }))
  }

  private toComment(json: Json): Comment {
    return { id: json.id, author: json.user?.login, body: json.body ?? '', createdAt: json.created_at, updatedAt: json.updated_at ?? json.created_at }
  }

  async listIssueComments({ token, id, number }: { token: string, id: Id, number: number }): Promise<Comment[]> {
    const repo = await this.repoJson(token, id)
    return (await this.client.paginate({ token, path: `/repos/${repo.full_name}/issues/${number}/comments` })).map((json) => this.toComment(json))
  }

  async addIssueComment({ token, id, number, body }: { token: string, id: Id, number: number, body: string }): Promise<Comment> {
    const repo = await this.repoJson(token, id)
    return this.toComment(await this.json(token, `/repos/${repo.full_name}/issues/${number}/comments`, { method: 'POST', body: { body } }))
  }

  async listLabels({ token, id }: { token: string, id: Id }): Promise<Label[]> {
    const repo = await this.repoJson(token, id)
    return (await this.client.paginate({ token, path: `/repos/${repo.full_name}/labels` })).map((label) => ({ name: label.name, color: label.color ? `#${label.color}` : undefined }))
  }

  async listTemplates({ token, id, kind }: { token: string, id: Id, kind: TemplateKind }): Promise<Template[]> {
    const { defaultBranch } = await this.getRepository({ token, id })
    return readRepositoryTemplates(this, { token, id, kind, ref: defaultBranch ?? 'main', host: 'github' })
  }

  async saveTemplate(_args: { token: string, id: Id, kind: TemplateKind, name: string, content: string }): Promise<Template> {
    throw Object.assign(new Error('The templates of this host are files of the repository'), { status: 400 })
  }

  async deleteTemplate(_args: { token: string, id: Id, kind: TemplateKind, name: string }): Promise<void> {
    throw Object.assign(new Error('The templates of this host are files of the repository'), { status: 400 })
  }

  async listMilestones({ token, id }: { token: string, id: Id }): Promise<Milestone[]> {
    const repo = await this.repoJson(token, id)
    const milestones = await this.client.paginate({ token, path: `/repos/${repo.full_name}/milestones?state=all` })
    return milestones.map((milestone) => ({ title: milestone.title, state: milestone.state === 'closed' ? 'closed' as const : 'opened' as const, dueDate: milestone.due_on ?? null }))
  }

  // ── merge requests (the pages of them) ──────────────────────────────────
  private toMergeRequest(pull: Json, extra: { commentCount?: number } = {}): MergeRequest {
    return {
      number: pull.number, title: pull.title, description: pull.body ?? '',
      state: pull.merged_at ? 'merged' : pull.state === 'closed' ? 'closed' : 'opened',
      author: pull.user?.login, sourceBranch: pull.head.ref, targetBranch: pull.base.ref,
      labels: ((pull.labels ?? []) as Json[]).map((label) => (typeof label === 'string' ? label : label.name)),
      reviewers: ((pull.requested_reviewers ?? []) as Json[]).map((user) => user.login),
      assignees: ((pull.assignees ?? []) as Json[]).map((user) => user.login),
      createdAt: pull.created_at, updatedAt: pull.updated_at, mergedAt: pull.merged_at ?? null, webUrl: pull.html_url,
      hasConflicts: pull.mergeable === false || pull.mergeable_state === 'dirty',
      headSha: pull.head.sha,
      commentCount: extra.commentCount ?? (pull.comments ?? 0) + (pull.review_comments ?? 0)
    }
  }

  async listMergeRequests({ token, id, filter = {} }: { token: string, id: Id, filter?: MergeRequestFilter }): Promise<Page<MergeRequest>> {
    const repo = await this.repoJson(token, id)
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const state = filter.state ?? 'opened'
    let pulls: Json[]
    let rawCount: number
    if (filter.search?.trim() || filter.author || filter.labels?.length || filter.reviewer) {
      // the list of pull requests cannot be narrowed to a person, a label or a text: the search can, and says which ones; each is then asked for
      const quote = (value: string): string => `"${value.replace(/"/g, '')}"`
      const terms = [`repo:${repo.full_name}`, 'is:pr', ...(state === 'all' ? [] : [state === 'opened' ? 'is:open' : state === 'merged' ? 'is:merged' : 'is:closed is:unmerged'])]
      if (filter.author) terms.push(`author:${filter.author}`)
      if (filter.reviewer) terms.push(`review-requested:${filter.reviewer}`)
      for (const label of filter.labels ?? []) terms.push(`label:${quote(label)}`)
      if (filter.targetBranch) terms.push(`base:${filter.targetBranch}`)
      if (filter.sourceBranch) terms.push(`head:${filter.sourceBranch}`)
      if (filter.search?.trim()) terms.push(filter.search.trim())
      const query = new URLSearchParams({ q: terms.join(' '), sort: 'created', order: 'desc', per_page: String(perPage), page: String(page) })
      const found = (await this.json(token, `/search/issues?${query}`)).items as Json[]
      rawCount = found.length
      pulls = await Promise.all(found.map((item) => this.json(token, `/repos/${repo.full_name}/pulls/${item.number}`)))
    } else {
      const query = new URLSearchParams({ state: state === 'opened' ? 'open' : state === 'all' ? 'all' : 'closed', sort: 'created', direction: 'desc', per_page: String(perPage), page: String(page) })
      if (filter.targetBranch) query.set('base', filter.targetBranch)
      if (filter.sourceBranch) query.set('head', `${repo.owner.login}:${filter.sourceBranch}`)
      const found = await this.json(token, `/repos/${repo.full_name}/pulls?${query}`) as Json[]
      rawCount = found.length
      // (a closed one is merged or not: the list only knows closed)
      pulls = found.filter((pull) => (state === 'merged' ? Boolean(pull.merged_at) : state === 'closed' ? !pull.merged_at : true))
    }
    return { items: pulls.map((pull) => this.toMergeRequest(pull)), page, perPage, hasMore: rawCount === perPage }
  }

  async getMergeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<MergeRequest> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}/pulls/${number}`
    const pull = await this.json(token, base)
    const reviews = await this.client.paginate({ token, path: `${base}/reviews` }).catch(() => [] as Json[])
    // the last word of each person: an approval is only as good as that
    const last = new Map<string, string>()
    for (const review of reviews) if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) last.set(review.user?.login, review.state)
    const given = [...last].filter(([, review]) => review === 'APPROVED').map(([login]) => login)
    return { ...this.toMergeRequest(pull), approvals: { required: null, given } }
  }

  async createMergeRequest({ token, id, title, description, sourceBranch, targetBranch, labels, reviewers }: { token: string, id: Id, title: string, description?: string, sourceBranch: string, targetBranch: string, labels?: string[], reviewers?: string[] }): Promise<MergeRequest> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    const pull = await this.json(token, `${base}/pulls`, { method: 'POST', body: { title, body: description ?? '', head: sourceBranch, base: targetBranch } })
    if (labels?.length) await this.json(token, `${base}/issues/${pull.number}/labels`, { method: 'POST', body: { labels } })
    if (reviewers?.length) await this.json(token, `${base}/pulls/${pull.number}/requested_reviewers`, { method: 'POST', body: { reviewers } })
    return this.getMergeRequest({ token, id, number: pull.number })
  }

  async updateMergeRequest({ token, id, number, changes }: { token: string, id: Id, number: number, changes: MergeRequestChanges }): Promise<MergeRequest> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    const body: Json = {}
    if (changes.title !== undefined) body.title = changes.title
    if (changes.description !== undefined) body.body = changes.description
    if (changes.state !== undefined) body.state = changes.state === 'closed' ? 'closed' : 'open'
    if (Object.keys(body).length) await this.json(token, `${base}/pulls/${number}`, { method: 'PATCH', body })
    // labels and the people asked to review are not fields of the pull request: they are set where GitHub keeps them
    if (changes.labels !== undefined) await this.json(token, `${base}/issues/${number}/labels`, { method: 'PUT', body: { labels: changes.labels } })
    if (changes.reviewers !== undefined) {
      const current = ((await this.json(token, `${base}/pulls/${number}`)).requested_reviewers as Json[]).map((user) => user.login)
      const added = changes.reviewers.filter((login) => !current.includes(login))
      const removed = current.filter((login) => !changes.reviewers!.includes(login))
      if (added.length) await this.json(token, `${base}/pulls/${number}/requested_reviewers`, { method: 'POST', body: { reviewers: added } })
      if (removed.length) await this.json(token, `${base}/pulls/${number}/requested_reviewers`, { method: 'DELETE', body: { reviewers: removed } })
    }
    return this.getMergeRequest({ token, id, number })
  }

  async getMergeRequestDiff({ token, id, number }: { token: string, id: Id, number: number }): Promise<FileDiff[]> {
    const repo = await this.repoJson(token, id)
    const files = await this.client.paginate({ token, path: `/repos/${repo.full_name}/pulls/${number}/files` })
    return files.map((file): FileDiff => ({
      oldPath: file.previous_filename ?? file.filename, newPath: file.filename,
      status: file.status === 'added' ? 'added' : file.status === 'removed' ? 'deleted' : file.status === 'renamed' ? 'renamed' : 'modified',
      additions: file.additions ?? 0, deletions: file.deletions ?? 0, patch: file.patch ?? ''
    }))
  }

  /** A thread of the code is the first comment of a conversation and its answers; a general message is a thread of its own. */
  private reviewThreads(comments: Json[]): Thread[] {
    const threads = new Map<number, Thread>()
    for (const comment of comments) {
      const root = comment.in_reply_to_id ?? comment.id
      let thread = threads.get(root)
      if (!thread) {
        thread = {
          id: `r${root}`, resolvable: false, resolved: false,
          position: { path: comment.path, line: comment.line ?? comment.original_line ?? 0, side: comment.side === 'LEFT' ? 'old' : 'new' },
          comments: []
        }
        threads.set(root, thread)
      }
      thread.comments.push(this.toComment(comment))
    }
    return [...threads.values()]
  }

  async listMergeRequestThreads({ token, id, number }: { token: string, id: Id, number: number }): Promise<Thread[]> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    const [general, review] = await Promise.all([
      this.client.paginate({ token, path: `${base}/issues/${number}/comments` }),
      this.client.paginate({ token, path: `${base}/pulls/${number}/comments` })
    ])
    const generalThreads = general.map((comment): Thread => ({ id: `c${comment.id}`, resolvable: false, resolved: false, comments: [this.toComment(comment)] }))
    return [...generalThreads, ...this.reviewThreads(review)].sort((a, b) => String(a.comments[0]?.createdAt).localeCompare(String(b.comments[0]?.createdAt)))
  }

  async addMergeRequestComment({ token, id, number, body, position, threadId }: { token: string, id: Id, number: number, body: string, position?: DiffPosition, threadId?: Id }): Promise<Thread> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    if (threadId !== undefined && String(threadId).startsWith('r')) {
      const made = await this.json(token, `${base}/pulls/${number}/comments`, { method: 'POST', body: { body, in_reply_to: Number(String(threadId).slice(1)) } })
      const all = this.reviewThreads(await this.client.paginate({ token, path: `${base}/pulls/${number}/comments` }))
      return all.find((thread) => thread.id === threadId) ?? { id: `r${made.id}`, resolvable: false, resolved: false, comments: [this.toComment(made)] }
    }
    if (position) {
      const pull = await this.json(token, `${base}/pulls/${number}`)
      const made = await this.json(token, `${base}/pulls/${number}/comments`, {
        method: 'POST', body: { body, commit_id: pull.head.sha, path: position.path, line: position.line, side: position.side === 'old' ? 'LEFT' : 'RIGHT' }
      })
      return this.reviewThreads([made])[0] as Thread
    }
    const made = await this.json(token, `${base}/issues/${number}/comments`, { method: 'POST', body: { body } })
    return { id: `c${made.id}`, resolvable: false, resolved: false, comments: [this.toComment(made)] }
  }

  async setThreadResolved(_args: { token: string, id: Id, number: number, threadId: Id, resolved: boolean }): Promise<Thread> {
    throw new GitError('GitHub threads cannot be resolved from here', 400)
  }

  async mergeMergeRequest({ token, id, number, options = {} }: { token: string, id: Id, number: number, options?: MergeOptions }): Promise<boolean> {
    return this.mergePull(token, id, number, { method: options.squash ? 'squash' : 'merge', message: options.message, deleteSourceBranch: Boolean(options.deleteSourceBranch) })
  }

  async approveMergeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<void> {
    const repo = await this.repoJson(token, id)
    await this.json(token, `/repos/${repo.full_name}/pulls/${number}/reviews`, { method: 'POST', body: { event: 'APPROVE' } })
  }

  async createChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch: string }): Promise<ChangeRequest> {
    const repo = await this.repoJson(token, id)
    const pull = await this.json(token, `/repos/${repo.full_name}/pulls`, { method: 'POST', body: { title, head: sourceBranch, base: targetBranch } })
    this.remember(() => this.json(token, `/repos/${repo.full_name}/pulls/${pull.number}`, { method: 'PATCH', body: { state: 'closed' } }))
    return this.toChangeRequest(pull)
  }

  async createOrRenameChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch?: string }): Promise<ChangeRequest> {
    const repo = await this.repoJson(token, id)
    const target = targetBranch ?? repo.default_branch
    const open: Json[] = await this.json(token, `/repos/${repo.full_name}/pulls?state=open&base=${encodeURIComponent(target)}&head=${encodeURIComponent(`${repo.owner.login}:${sourceBranch}`)}`)
    const [standing] = open
    if (standing) {
      const renamed = standing.title === title ? standing : await this.json(token, `/repos/${repo.full_name}/pulls/${standing.number}`, { method: 'PATCH', body: { title } })
      return this.toChangeRequest(renamed)
    }
    return this.createChangeRequest({ token, id, title, sourceBranch, targetBranch: target })
  }

  async listChangeRequests({ token, id, state = 'opened', targetBranch }: { token: string, id: Id, state?: 'opened' | 'merged' | 'closed' | 'all', targetBranch?: string }): Promise<ChangeRequest[]> {
    const repo = await this.repoJson(token, id)
    const base = targetBranch ? `&base=${encodeURIComponent(targetBranch)}` : ''
    if (state === 'closed' || state === 'all') {
      const pulls = await this.client.paginate({ token, path: `/repos/${repo.full_name}/pulls?state=${state === 'all' ? 'all' : 'closed'}${base}` })
      return pulls.filter((pull) => state === 'all' || !pull.merged_at).map((pull) => this.toChangeRequest(pull))
    }
    if (state === 'merged') {
      const closed = await this.client.paginate({ token, path: `/repos/${repo.full_name}/pulls?state=closed${base}` })
      return closed.filter((pull) => pull.merged_at).map((pull) => this.toChangeRequest(pull))
    }
    const open = await this.client.paginate({ token, path: `/repos/${repo.full_name}/pulls?state=open${base}` })
    // the list does not say whether a pull request has conflicts: each one is asked for
    return Promise.all(open.map(async (pull) => {
      const detail = await this.json(token, `/repos/${repo.full_name}/pulls/${pull.number}`)
      return this.toChangeRequest(pull, detail.mergeable === false || detail.mergeable_state === 'dirty')
    }))
  }

  /**
   * Merges the pull request when it can be merged, waiting for GitHub to work out whether it can. Answers `true` when it has conflicts
   * (or is not open), `false` when it was merged: the same answer GitLab's merge gave.
   */
  async mergeChangeRequest({ token, id, number, deleteSourceBranch = true }: { token: string, id: Id, number: number, deleteSourceBranch?: boolean }): Promise<boolean> {
    return this.mergePull(token, id, number, { method: 'merge', deleteSourceBranch })
  }

  private async mergePull(token: string, id: Id, number: number, { method, message, deleteSourceBranch }: { method: 'merge' | 'squash', message?: string | undefined, deleteSourceBranch: boolean }): Promise<boolean> {
    const repo = await this.repoJson(token, id)
    const base = `/repos/${repo.full_name}`
    for (let attempt = 0; attempt < this.pollAttempts; attempt++) {
      const pull = await this.json(token, `${base}/pulls/${number}`)
      if (pull.state !== 'open') return pull.merged_at ? false : true
      if (pull.mergeable === false || pull.mergeable_state === 'dirty') return true
      if (pull.mergeable === true) {
        try {
          await this.json(token, `${base}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: method, ...(message ? { commit_message: message } : {}) } })
        } catch (error) {
          if ((error as { status?: number }).status === 409) { await sleep(this.pollMs); continue } // the branch moved: look again
          throw error
        }
        if (deleteSourceBranch) await this.json(token, `${base}/git/refs/heads/${encodePath(pull.head.ref)}`, { method: 'DELETE' }).catch(() => {})
        return false
      }
      await sleep(this.pollMs) // GitHub has not worked it out yet
    }
    throw new GitError(`Pull request ${number} did not reach a mergeable state after ${this.pollAttempts} attempts`)
  }

  async listChangeRequestPipelines({ token, id, number }: { token: string, id: Id, number: number }): Promise<Pipeline[]> {
    const repo = await this.repoJson(token, id)
    const pull = await this.json(token, `/repos/${repo.full_name}/pulls/${number}`)
    const { workflow_runs: runs } = await this.json(token, `/repos/${repo.full_name}/actions/runs?head_sha=${encodeURIComponent(pull.head.sha)}&per_page=20`)
    return (runs as Json[]).map((run) => ({ id: run.id, sha: run.head_sha, status: pipelineStatus(run), ref: run.head_branch, createdAt: run.created_at, webUrl: run.html_url }))
  }

  // ── CI, hooks ────────────────────────────────────────────────────────────
  async getLatestPipeline({ token, id, ref }: { token: string, id: Id, ref: string }): Promise<Pipeline | null> {
    const repo = await this.repoJson(token, id)
    const { workflow_runs: runs } = await this.json(token, `/repos/${repo.full_name}/actions/runs?branch=${encodeURIComponent(ref)}&per_page=1`)
    const [run] = runs as Json[]
    return run ? { id: run.id, sha: run.head_sha, status: pipelineStatus(run), ref: run.head_branch, createdAt: run.created_at, webUrl: run.html_url } : null
  }

  // the runners of GitHub Actions are the host's own (or self-hosted ones set up outside LINEA): there is nothing to ask for or turn on
  async getCiRunners(_args: { token: string, id: Id }): Promise<CiRunners> {
    return { supported: false, instanceRunners: null, runners: [] }
  }

  async setInstanceRunners(_args: { token: string, id: Id, enabled: boolean }): Promise<void> {
    // nothing to turn on
  }

  async listPipelines({ token, id, ref, perPage = 50 }: { token: string, id: Id, ref?: string, perPage?: number }): Promise<Pipeline[]> {
    const repo = await this.repoJson(token, id)
    const branch = ref ? `&branch=${encodeURIComponent(ref)}` : ''
    const { workflow_runs: runs } = await this.json(token, `/repos/${repo.full_name}/actions/runs?per_page=${perPage}${branch}`)
    return (runs as Json[]).map((run) => ({ id: run.id, sha: run.head_sha, status: pipelineStatus(run), ref: run.head_branch, createdAt: run.created_at, webUrl: run.html_url }))
  }

  async getPipelineJobs({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<PipelineJob[]> {
    const repo = await this.repoJson(token, id)
    const { jobs } = await this.json(token, `/repos/${repo.full_name}/actions/runs/${pipelineId}/jobs?per_page=100`)
    return (jobs as Json[]).map((job) => ({
      id: job.id, name: job.name, stage: 'jobs', status: pipelineStatus(job),
      duration: job.started_at ? Math.round(((job.completed_at ? Date.parse(job.completed_at) : Date.now()) - Date.parse(job.started_at)) / 1000) : null,
      webUrl: job.html_url
    }))
  }

  async retryPipeline({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    const repo = await this.repoJson(token, id)
    await this.json(token, `/repos/${repo.full_name}/actions/runs/${pipelineId}/rerun-failed-jobs`, { method: 'POST' })
  }

  async enablePipelines(_args: { token: string, id: Id }): Promise<boolean> {
    return false // Actions are on unless an organization turned them off: that is not for a repository's maintainer to change
  }

  async disablePipelines(_args: { token: string, id: Id }): Promise<boolean> {
    return false
  }

  async pipelinesEnabled(_args: { token: string, id: Id }): Promise<boolean | null> {
    return null
  }

  async cancelPipeline({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    const repo = await this.repoJson(token, id)
    await this.json(token, `/repos/${repo.full_name}/actions/runs/${pipelineId}/cancel`, { method: 'POST' })
  }

  async cancelJob(_args: { token: string, id: Id, jobId: Id }): Promise<void> {
    // GitHub Actions cancels a whole run, never one job of it
    throw new Error('GitHub cannot cancel a single job: cancel the run')
  }

  async getJobTrace({ token, id, jobId, lines = 40 }: { token: string, id: Id, jobId: Id, lines?: number }): Promise<string> {
    const repo = await this.repoJson(token, id)
    const raw = await this.client.raw({ token, path: `/repos/${repo.full_name}/actions/jobs/${jobId}/logs` })
    return raw ? raw.toString('utf8').split('\n').slice(-lines).join('\n').trim() : ''
  }

  /** GitHub sends every push, whatever the branch: the receiver looks at `ref` (see `parsePushEvent`). */
  async ensureWebhook({ token, id, url, secret }: { token: string, id: Id, url: string, secret: string, branch?: string }): Promise<{ status: 'created' | 'already_exists', hookId?: Id | null }> {
    const repo = await this.repoJson(token, id)
    const hooks: Json[] = await this.json(token, `/repos/${repo.full_name}/hooks`)
    if (hooks.some((hook) => hook.config?.url === url)) return { status: 'already_exists' }
    const hook = await this.json(token, `/repos/${repo.full_name}/hooks`, {
      method: 'POST',
      body: { name: 'web', active: true, events: ['push'], config: { url, content_type: 'json', secret, insecure_ssl: url.startsWith('http://') ? '1' : '0' } }
    })
    return { status: 'created', hookId: hook.id }
  }

  /** Whether a webhook delivery is from GitHub: the signature of the raw body with the shared secret. */
  verifyWebhook({ headers, rawBody, secret }: Required<Delivery>): boolean {
    const given = headers['x-hub-signature-256']
    if (typeof given !== 'string') return false
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  }

  parsePushEvent({ headers, body }: { headers: Record<string, string | undefined>, body: any }): { repositoryId: Id, branch: string } | null {
    if (headers['x-github-event'] !== 'push' || !body?.repository || typeof body.ref !== 'string' || !body.ref.startsWith('refs/heads/')) return null
    return { repositoryId: body.repository.id, branch: body.ref.replace(/^refs\/heads\//, '') }
  }

  // ── unit of work, errors ─────────────────────────────────────────────────
  async rollback(): Promise<void> {
    while (this.undo.length) await (this.undo.pop() as () => Promise<unknown>)()
  }

  isAuthError(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name
    return error instanceof GitAuthError || name === 'GitAuthError' || name === 'GitLabAuthError'
  }

  isAlreadyExistsError(error: unknown): boolean {
    const failure = error as { status?: number, message?: string } | null
    return failure?.status === 422 && /already[ _]exists/i.test(String(failure?.message ?? ''))
  }
}
