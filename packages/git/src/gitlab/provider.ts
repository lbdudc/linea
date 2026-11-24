import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { GitLabAuthError, GitLabSession } from 'gitlab-commando'
import type {
  DeviceAuthorization, DevicePoll,
  AccessEntry, AuthConfig, Capabilities, ChangeRequest, CiRunners, Comment, CommitSummary, Comparison, Delivery, DiffPosition, FileAction, FileDiff, GitProvider, Id, Issue, IssueChanges, IssueFilter, HostUser, Label, LabelEvent, Member,
  MergeOptions, MergeRequest, MergeRequestChanges, MergeRequestFilter, Milestone, Namespace, Page, Pipeline, PipelineJob, Release, ReleaseChanges, Repository, RepositoryFile, Runner, Template, TemplateKind, Thread, Tokens, PendingDeletion
} from '../provider.js'
import { ACCESS } from '../access.js'
import { readRepositoryTemplates } from '../templates.js'
import { pollDevice, startDevice } from '../device.js'
import { createGitLabClient, isBranchAlreadyExistsError, type GitLabClient } from './client.js'

/**
 * GitLab, behind the `GitProvider` contract. Namespaces are groups, repositories are projects, change requests are merge requests.
 * What it remembers for `rollback()` is what `gitlab-commando`'s session remembers.
 */

const MERGE_WAIT_MS = 5 * 60 * 1000
const MERGE_POLL_MS = 500
// a merge GitLab cannot do yet (it is still checking the request), or did not get to answer
const mergeNotYet = (status: number) => status === 0 || status >= 500 || [404, 405, 409, 422].includes(status)

export interface GitLabConfig {
  /** Address of the GitLab, e.g. https://gitlab.example.com */
  url: string
  /** The OAuth application LINEA logs in with. */
  clientId?: string | undefined
  clientSecret?: string | undefined
  /** How long a merge waits for GitLab to take it, before it is given up on. */
  mergeWaitMs?: number | undefined
  /** Where the browser comes back to after logging in. */
  redirectUri?: string | undefined
}

type Json = any

const toNamespace = (group: Json): Namespace => ({ id: group.id, fullPath: group.full_path, name: group.full_name ?? group.name })

const toFile = (file: Json): RepositoryFile => ({
  path: file.file_path,
  name: file.file_name,
  content: file.content,
  encoding: 'base64',
  revision: file.last_commit_id ?? file.commit_id
})

const toCommit = (commit: Json): CommitSummary => ({
  shortId: commit.short_id,
  title: commit.title,
  authorName: commit.author_name,
  createdAt: commit.created_at,
  webUrl: commit.web_url,
  message: commit.message
})

const toRelease = (release: Json): Release => ({
  tag: release.tag_name,
  name: release.name || release.tag_name,
  description: release.description ?? '',
  createdAt: release.created_at ?? release.released_at,
  url: release._links?.self ?? '',
  // (GitLab has no prerelease: a release dated in the future is its "upcoming" one, which is not the same thing)
  prerelease: false
})

const toChangeRequest = (mr: Json): ChangeRequest => ({
  number: mr.iid,
  title: mr.title,
  sourceBranch: mr.source_branch,
  targetBranch: mr.target_branch,
  webUrl: mr.web_url,
  hasConflicts: Boolean(mr.has_conflicts),
  state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'opened',
  author: mr.author?.username,
  createdAt: mr.created_at,
  mergedAt: mr.merged_at ?? null,
  headSha: mr.sha
})

const toIssue = (issue: Json): Issue => ({
  number: issue.iid,
  title: issue.title,
  description: issue.description ?? '',
  state: issue.state === 'closed' ? 'closed' : 'opened',
  author: issue.author?.username,
  assignees: ((issue.assignees ?? []) as Json[]).map((user) => user.username),
  labels: (issue.labels ?? []).map((label: Json) => (typeof label === 'string' ? label : label.name)),
  milestone: issue.milestone?.title ?? null,
  createdAt: issue.created_at,
  updatedAt: issue.updated_at,
  closedAt: issue.closed_at ?? null,
  webUrl: issue.web_url,
  commentCount: issue.user_notes_count ?? 0
})

const toComment = (note: Json): Comment => ({ id: note.id, author: note.author?.username, body: note.body, createdAt: note.created_at, updatedAt: note.updated_at ?? note.created_at })

const toMergeRequest = (mr: Json): MergeRequest => ({
  number: mr.iid,
  title: mr.title,
  description: mr.description ?? '',
  state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : 'opened',
  author: mr.author?.username,
  sourceBranch: mr.source_branch,
  targetBranch: mr.target_branch,
  labels: (mr.labels ?? []).map((label: Json) => (typeof label === 'string' ? label : label.name)),
  reviewers: ((mr.reviewers ?? []) as Json[]).map((user) => user.username),
  assignees: ((mr.assignees ?? []) as Json[]).map((user) => user.username),
  createdAt: mr.created_at,
  updatedAt: mr.updated_at,
  mergedAt: mr.merged_at ?? null,
  webUrl: mr.web_url,
  hasConflicts: Boolean(mr.has_conflicts),
  headSha: mr.sha,
  commentCount: mr.user_notes_count ?? 0
})

const countLines = (patch: string, mark: '+' | '-'): number => patch.split('\n').filter((line) => line.startsWith(mark) && !line.startsWith(`${mark}${mark}${mark} `)).length

const toFileDiff = (change: Json): FileDiff => ({
  oldPath: change.old_path,
  newPath: change.new_path,
  status: change.new_file ? 'added' : change.deleted_file ? 'deleted' : change.renamed_file ? 'renamed' : 'modified',
  additions: countLines(change.diff ?? '', '+'),
  deletions: countLines(change.diff ?? '', '-'),
  patch: change.diff ?? ''
})

/** A GitLab discussion is a thread: the notes it has, minus the ones GitLab writes by itself. */
const toThread = (discussion: Json): Thread | null => {
  const notes = ((discussion.notes ?? []) as Json[]).filter((note) => !note.system)
  const [first] = notes
  if (!first) return null
  const at = first.position
  return {
    id: discussion.id,
    resolvable: Boolean(first.resolvable),
    resolved: Boolean(first.resolvable) && notes.filter((note) => note.resolvable).every((note) => note.resolved),
    position: at ? { path: at.new_path ?? at.old_path, line: at.new_line ?? at.old_line, side: at.new_line ? 'new' : 'old' } : undefined,
    comments: notes.map(toComment)
  }
}

const toPipeline = (p: Json): Pipeline => ({ id: p.id, sha: p.sha, status: p.status, ref: p.ref, createdAt: p.created_at, webUrl: p.web_url })

const toTokens = (data: Json): Tokens => ({ accessToken: data.access_token, refreshToken: data.refresh_token ?? null })

/** `last_commit_id` is the GitLab way to say "only if the file is still as I read it". */
const toGitLabAction = (action: FileAction): Json => ({
  action: action.action,
  file_path: action.path,
  ...(action.content === undefined ? {} : { content: action.content }),
  ...(action.encoding === undefined ? {} : { encoding: action.encoding }),
  ...(action.expectedRevision === undefined ? {} : { last_commit_id: action.expectedRevision })
})

/** A repository can be named by its id or by its path: the path travels URL-encoded. */
const idOf = (id: Id): Id => (typeof id === 'string' && id.includes('/') ? encodeURIComponent(id) : id)

export class GitLabProvider implements GitProvider {
  readonly kind = 'gitlab' as const
  readonly nestsNamespaces = true
  readonly webhookPath = '/api/webhooks/gitlab'
  private readonly config: GitLabConfig
  private readonly client: GitLabClient
  private readonly session: GitLabSession
  private readonly releaseUndo: (() => Promise<unknown>)[] = []

  constructor(config: GitLabConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, '') }
    this.client = createGitLabClient({ url: this.config.url })
    this.session = new GitLabSession(this.config.url)
  }

  private toRepository(project: Json): Repository {
    return {
      id: project.id,
      name: project.name,
      path: project.path_with_namespace,
      description: project.description ?? '',
      webUrl: project.web_url,
      webIdeUrl: `${this.config.url}/-/ide/project/${project.path_with_namespace}/edit/main/-/`,
      namespaceId: project.namespace?.id,
      parentNamespaceId: project.namespace?.parent_id,
      defaultBranch: project.default_branch,
      topics: project.topics ?? project.tag_list ?? [],
      createdAt: project.created_at
    }
  }

  // ── identity ─────────────────────────────────────────────────────────────
  authConfig(): AuthConfig {
    return {
      kind: 'gitlab',
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri ?? '',
      url: this.config.url,
      authorizeUrl: `${this.config.url}/oauth/authorize`,
      scope: 'api'
    }
  }

  async exchangeCode({ code, redirectUri }: { code: string, redirectUri: string }): Promise<Tokens> {
    return toTokens(await this.session.requestAccessToken(code, this.config.clientId, this.config.clientSecret, redirectUri))
  }

  startDeviceAuthorization({ scope = 'api' }: { scope?: string } = {}): Promise<DeviceAuthorization> {
    return startDevice(`${this.config.url}/oauth/authorize_device`, { client_id: this.config.clientId, scope })
  }

  pollDeviceAuthorization({ deviceCode, interval }: { deviceCode: string, interval?: number }): Promise<DevicePoll> {
    return pollDevice(`${this.config.url}/oauth/token`, { device_code: deviceCode, client_id: this.config.clientId, client_secret: this.config.clientSecret }, interval)
  }

  async refreshToken({ refreshToken }: { refreshToken: string | null, accessToken: string }): Promise<Tokens> {
    return toTokens(await this.session.refreshAccessToken(refreshToken ?? '', this.config.clientId, this.config.clientSecret, this.config.redirectUri ?? ''))
  }

  async getUser({ token }: { token: string }): Promise<{ username: string, avatarUrl: string }> {
    const user = await this.session.getUserData(token)
    return { username: user.username, avatarUrl: user.avatar_url }
  }

  // ── namespaces ───────────────────────────────────────────────────────────
  async listNamespaces({ token }: { token: string }): Promise<Namespace[]> {
    return (await this.client.getGroups(token)).map(toNamespace)
  }

  async findNamespace({ token, fullPath }: { token: string, fullPath: string }): Promise<Namespace | null> {
    const group = await this.client.getGroup(token, fullPath)
    return group === null ? null : toNamespace(group)
  }

  async createNamespace({ token, name, parentId }: { token: string, name: string, parentId?: Id | undefined }): Promise<Namespace> {
    return toNamespace(await this.session.createGroup(token, name, parentId))
  }

  deleteNamespace({ token, id }: { token: string, id: Id }): Promise<unknown> {
    return this.session.deleteGroup(token, id)
  }

  renameNamespace({ token, id, name }: { token: string, id: Id, name: string }): Promise<unknown> {
    return this.session.renameGroup(token, id, name)
  }

  // ── repositories ─────────────────────────────────────────────────────────
  async createRepository({ token, name, namespaceId, topics, defaultBranch }: { token: string, name: string, namespaceId?: Id | undefined, topics?: string[], defaultBranch?: string | undefined }): Promise<Repository> {
    return this.toRepository(await this.session.createProject(token, name, namespaceId, topics, defaultBranch))
  }

  deleteRepository({ token, id }: { token: string, id: Id }): Promise<unknown> {
    return this.session.deleteProject(token, id)
  }

  async listPendingDeletion({ token, topic }: { token: string, topic: string }): Promise<PendingDeletion[]> {
    const projects = await this.client.getProjectsPendingDeletion(token, topic)
    const named = (text: string): string => text.replace(/-deletion_scheduled-\d+/g, '')
    const scheduled = (segment: string | undefined): boolean => /-deletion_scheduled-\d+$/.test(segment ?? '')
    // the dates are something more to show: an instance whose GraphQL does not have them still lists what waits to be deleted
    const dates = await this.client.getDeletionDates(token, projects.map((project) => project.id)).catch(() => new Map<number, string>())
    return projects.map((project) => {
      const segments: string[] = (project.path_with_namespace ?? '').split('/')
      const namespaceScheduled = scheduled(segments[segments.length - 2])
      const ancestorScheduled = segments.slice(0, -2).some(scheduled)
      return {
      id: project.id,
      name: named(project.name),
      path: named(project.path_with_namespace ?? ''),
      webUrl: project.web_url ?? '',
      namespaceId: project.namespace?.id,
      parentNamespaceId: project.namespace?.parent_id,
      deletesOn: dates.get(project.id) ?? null,
      createdAt: project.created_at,
      repositoryScheduled: scheduled(segments[segments.length - 1]) || (!namespaceScheduled && !ancestorScheduled),
      namespaceScheduled,
      ancestorScheduled,
      }
    })
  }

  restoreRepository({ token, id }: { token: string, id: Id }): Promise<unknown> {
    return this.client.send(token, 'POST', `projects/${id}/restore`)
  }

  restoreNamespace({ token, id }: { token: string, id: Id }): Promise<unknown> {
    return this.client.send(token, 'POST', `groups/${id}/restore`)
  }

  async renameRepository({ token, id, name }: { token: string, id: Id, name: string }): Promise<Repository> {
    return this.toRepository(await this.session.renameProject(token, id, name))
  }

  async getRepository({ token, id }: { token: string, id: Id }): Promise<Repository> {
    return this.toRepository(await this.client.getProject(token, id))
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
    return (await this.client.getEnrolledProjects(token, topic)).map((project) => this.toRepository(project))
  }

  async addTopic({ token, id, topic }: { token: string, id: Id, topic: string }): Promise<void> {
    const project = await this.client.getProject(token, id)
    const topics: string[] = project.topics ?? []
    if (!topics.includes(topic)) await this.client.updateProject(token, project.id, { topics: [...topics, topic] })
  }

  setDefaultBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<unknown> {
    return this.session.setDefaultBranch(token, id, branch)
  }

  async getMembers({ token, id }: { token: string, id: Id }): Promise<Member[]> {
    return (await this.session.getProjectMembers(token, id)).map((member: Json) => ({ username: member.username, accessLevel: member.access_level }))
  }

  /** What the user may do on a repository: the level GitLab gives them there (inherited from the group included), 0 when none. */
  async getAccessLevel({ token, id, username }: { token: string, id: Id, username: string }): Promise<number> {
    return (await this.getMembers({ token, id })).find((member) => member.username === username)?.accessLevel ?? 0
  }

  async listAccess({ token, id }: { token: string, id: Id }): Promise<AccessEntry[]> {
    const project = await this.client.getProject(token, id)
    const [everybody, direct] = await Promise.all([
      this.client.listPaged(token, `projects/${project.id}/members/all`),
      this.client.listPaged(token, `projects/${project.id}/members`)
    ])
    const own = new Map<string, number>(direct.map((member: Json) => [member.username, member.access_level]))
    return everybody
      .filter((member: Json) => member.access_level >= ACCESS.REPORTER)
      .map((member: Json) => ({ username: member.username, accessLevel: member.access_level, source: own.get(member.username) === member.access_level ? 'direct' as const : 'inherited' as const }))
  }

  async setAccess({ token, id, username, accessLevel }: { token: string, id: Id, username: string, accessLevel: number }): Promise<void> {
    const project = await this.client.getProject(token, id)
    const user = await this.userByName(token, username)
    const direct = await this.client.listPaged(token, `projects/${project.id}/members`)
    const exists = direct.some((member: Json) => member.id === user.id)
    await this.client.send(token, exists ? 'PUT' : 'POST', `projects/${project.id}/members${exists ? `/${user.id}` : ''}`, exists ? { access_level: accessLevel } : { user_id: user.id, access_level: accessLevel })
  }

  async removeAccess({ token, id, username }: { token: string, id: Id, username: string }): Promise<void> {
    const project = await this.client.getProject(token, id)
    const user = await this.userByName(token, username)
    await this.client.send(token, 'DELETE', `projects/${project.id}/members/${user.id}`).catch((error: { status?: number }) => { if (error.status !== 404) throw error })
  }

  async searchUsers({ token, query }: { token: string, query: string }): Promise<HostUser[]> {
    const found = await this.client.get(token, `users?search=${encodeURIComponent(query)}&per_page=10&active=true`)
    return found.map((user: Json) => ({ username: user.username, name: user.name ?? user.username, avatarUrl: user.avatar_url ?? null }))
  }

  private async userByName(token: string, username: string): Promise<Json> {
    const found = await this.client.get(token, `users?username=${encodeURIComponent(username)}`)
    if (!found[0]) throw Object.assign(new Error(`${username} is not a user of this GitLab`), { status: 404 })
    return found[0]
  }

  // ── files, commits ───────────────────────────────────────────────────────
  async getFile({ token, id, path, ref }: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    return toFile(await this.session.getFile(token, id, path, ref))
  }

  async getFileRevision({ token, id, path, ref }: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile> {
    return toFile(await this.client.getFileMeta(token, idOf(id), path, ref))
  }

  readFile({ token, id, path, ref }: { token: string, id: Id, path: string, ref: string }): Promise<Buffer | null> {
    return this.client.getRawFile(token, idOf(id), path, ref)
  }

  listFiles({ token, id, ref }: { token: string, id: Id, ref: string }): Promise<string[]> {
    return this.client.getFilePaths(token, idOf(id), ref)
  }

  createFile({ token, id, path, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    return this.session.createFile(token, id, path, branch, content)
  }

  saveFile({ token, id, path, branch, content }: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown> {
    return this.session.saveFile(token, id, path, branch, content)
  }

  async commit({ token, id, branch, message, actions, track = true }: { token: string, id: Id, branch: string, message: string, actions: FileAction[], track?: boolean }): Promise<{ id: string }> {
    const gitlabActions = actions.map(toGitLabAction)
    return track
      ? this.session.commit(token, id, gitlabActions, message, branch)
      : this.client.commitActions(token, idOf(id), branch, message, gitlabActions)
  }

  async downloadArchive({ token, id, ref = 'main' }: { token: string, id: Id, ref?: string }): Promise<NodeJS.ReadableStream> {
    return Readable.fromWeb((await this.client.downloadArchive(token, idOf(id), ref)) as never)
  }

  async compare({ token, id, from, to }: { token: string, id: Id, from: string, to: string }): Promise<Comparison> {
    const result = await this.client.get(token, `projects/${idOf(id)}/repository/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&straight=false`)
    return { commits: ((result.commits ?? []) as Json[]).map(toCommit).reverse(), files: ((result.diffs ?? []) as Json[]).map(toFileDiff) }
  }

  async getCommits({ token, id, ref, perPage = 10 }: { token: string, id: Id, ref: string, perPage?: number }): Promise<CommitSummary[]> {
    return (await this.client.getCommits(token, idOf(id), ref, perPage)).map(toCommit)
  }

  // ── branches, tags ───────────────────────────────────────────────────────
  createBranch({ token, id, branch, ref, track = true }: { token: string, id: Id, branch: string, ref: string, track?: boolean }): Promise<unknown> {
    return track ? this.session.createBranch(token, id, branch, ref) : this.client.createBranch(token, idOf(id), branch, ref)
  }

  async listBranches({ token, id }: { token: string, id: Id }): Promise<string[]> {
    return (await this.client.listPaged(token, `projects/${idOf(id)}/repository/branches`)).map((branch) => branch.name)
  }

  async getBranch({ token, id, branch }: { token: string, id: Id, branch: string }): Promise<{ name: string, lastCommit: CommitSummary | null }> {
    const found = await this.client.getBranch(token, idOf(id), branch)
    return { name: found.name, lastCommit: found.commit ? toCommit(found.commit) : null }
  }

  async listTags({ token, id }: { token: string, id: Id }): Promise<{ name: string }[]> {
    return (await this.client.getTags(token, idOf(id))).map((tag) => ({ name: tag.name as string }))
  }

  async getTag({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<{ name: string, commitId: string, message: string | null } | null> {
    const found = await this.client.getTag(token, idOf(id), tag)
    return found ? { name: found.name, commitId: found.commit?.id, message: typeof found.message === 'string' && found.message !== '' ? found.message : null } : null
  }

  createTag({ token, id, tag, ref, message }: { token: string, id: Id, tag: string, ref: string, message?: string }): Promise<unknown> {
    return message === undefined ? this.session.createTag(token, id, tag, ref) : this.client.createTag(token, idOf(id), tag, ref, message)
  }

  // ── releases ─────────────────────────────────────────────────────────────
  async createRelease({ token, id, tag, name, description = '' }: { token: string, id: Id, tag: string, name?: string, description?: string, prerelease?: boolean }): Promise<Release> {
    // GitLab would make the tag itself from a `ref`: a release is of a tag that is already there
    if (!await this.client.getTag(token, idOf(id), tag)) throw Object.assign(new Error(`There is no tag "${tag}"`), { status: 404 })
    const made = toRelease(await this.client.send(token, 'POST', `projects/${idOf(id)}/releases`, { tag_name: tag, name: name || tag, description }))
    this.releaseUndo.push(() => this.client.send(token, 'DELETE', `projects/${idOf(id)}/releases/${encodeURIComponent(tag)}`))
    return made
  }

  async getRelease({ token, id, tag }: { token: string, id: Id, tag: string }): Promise<Release | null> {
    try {
      return toRelease(await this.client.get(token, `projects/${idOf(id)}/releases/${encodeURIComponent(tag)}`))
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  async listReleases({ token, id }: { token: string, id: Id }): Promise<Release[]> {
    return (await this.client.listPaged(token, `projects/${idOf(id)}/releases`)).map(toRelease)
  }

  async updateRelease({ token, id, tag, changes }: { token: string, id: Id, tag: string, changes: ReleaseChanges }): Promise<Release> {
    const body: Json = {}
    if (changes.name !== undefined) body.name = changes.name || tag
    if (changes.description !== undefined) body.description = changes.description
    return toRelease(await this.client.send(token, 'PUT', `projects/${idOf(id)}/releases/${encodeURIComponent(tag)}`, body))
  }

  // ── change requests ──────────────────────────────────────────────────────
  async createChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch: string }): Promise<ChangeRequest> {
    return toChangeRequest(await this.session.createMergeRequest(token, id, title, sourceBranch, targetBranch))
  }

  async createOrRenameChangeRequest({ token, id, title, sourceBranch, targetBranch }: { token: string, id: Id, title: string, sourceBranch: string, targetBranch?: string }): Promise<ChangeRequest> {
    return toChangeRequest(await this.session.createOrRenameMergeRequest(token, id, title, sourceBranch, targetBranch))
  }

  async listChangeRequests({ token, id, state = 'opened', targetBranch }: { token: string, id: Id, state?: 'opened' | 'merged' | 'closed' | 'all', targetBranch?: string }): Promise<ChangeRequest[]> {
    return (await this.client.getMergeRequests(token, idOf(id), state, targetBranch)).map(toChangeRequest)
  }

  async listChangeRequestPipelines({ token, id, number }: { token: string, id: Id, number: number }): Promise<Pipeline[]> {
    return (await this.client.listMergeRequestPipelines(token, idOf(id), number)).map(toPipeline)
  }

  async mergeChangeRequest({ token, id, number, deleteSourceBranch = true }: { token: string, id: Id, number: number, deleteSourceBranch?: boolean }): Promise<boolean> {
    const rethrowAuth = (error: unknown) => {
      if (this.isAuthError(error)) throw error
    }
    const read = () => this.client.getMergeRequest(token, idOf(id), number).catch((error: unknown) => {
      rethrowAuth(error)
      return null
    })
    const deadline = Date.now() + (this.config.mergeWaitMs ?? MERGE_WAIT_MS)
    const path = `projects/${idOf(id)}/merge_requests/${number}/merge`
    for (;;) {
      const answered = await this.client.send(token, 'PUT', path, { should_remove_source_branch: deleteSourceBranch }).then(() => 200, (error: unknown) => {
        rethrowAuth(error)
        return (error as { status?: number }).status ?? 0
      })
      const mr = await read()
      if (mr?.state === 'merged') return false
      const stuck = mr !== null && (mr.state !== 'opened' || ['conflict', 'broken_status'].includes(String(mr.detailed_merge_status ?? '')))
      if (stuck || (mr !== null && !mergeNotYet(answered))) break
      if (Date.now() >= deadline) throw new Error(`GitLab did not take the merge of !${number} in time`)
      await new Promise((resolve) => setTimeout(resolve, MERGE_POLL_MS))
    }
    // GitLab merges asynchronously: a merge that went through reads as `merging` for a moment. Look again before telling anyone it conflicted.
    for (let attempt = 0; attempt < 30; attempt++) {
      const mr = await read()
      if (mr === null) return true
      if (mr.state === 'merged') return false
      const status = String(mr.detailed_merge_status ?? '')
      const settling = mr.state === 'opened' && ['merging', 'checking', 'unchecked', 'preparing', 'ci_still_running'].includes(status)
      if (!settling) return true
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return true
  }

  // ── CI, hooks ────────────────────────────────────────────────────────────
  // ── issues ───────────────────────────────────────────────────────────────
  capabilities(): Capabilities {
    return {
      issues: { labels: true, milestones: true, assignees: true, closingWords: false },
      templates: { editable: false },
      mergeRequests: { labels: true, reviewers: true, approvals: true, resolvableThreads: true, squash: true },
      deletion: { namespaceIsRepository: false, delayed: true },
      releases: { prerelease: false }
    }
  }

  /** GitLab takes the ids of people and of milestones, LINEA speaks of usernames and titles. */
  private async userIds(token: string, usernames: string[]): Promise<number[]> {
    return Promise.all(usernames.map(async (username) => {
      const [found] = await this.client.get(token, `users?username=${encodeURIComponent(username)}`) as Json[]
      if (!found) throw Object.assign(new Error(`There is no user "${username}"`), { status: 400 })
      return found.id as number
    }))
  }

  private async milestoneId(token: string, id: Id, title: string): Promise<number> {
    const [found] = await this.client.get(token, `projects/${idOf(id)}/milestones?title=${encodeURIComponent(title)}`) as Json[]
    if (!found) throw Object.assign(new Error(`There is no milestone "${title}"`), { status: 400 })
    return found.id as number
  }

  async listIssues({ token, id, filter = {} }: { token: string, id: Id, filter?: IssueFilter }): Promise<Page<Issue>> {
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const query = new URLSearchParams({ state: filter.state ?? 'opened', order_by: 'created_at', sort: 'desc', per_page: String(perPage), page: String(page) })
    if (filter.author) query.set('author_username', filter.author)
    if (filter.assignee) query.set('assignee_username', filter.assignee)
    if (filter.labels?.length) query.set('labels', filter.labels.join(','))
    if (filter.milestone) query.set('milestone', filter.milestone)
    if (filter.search) query.set('search', filter.search)
    const found = await this.client.get(token, `projects/${idOf(id)}/issues?${query}`) as Json[]
    return { items: found.map(toIssue), page, perPage, hasMore: found.length === perPage }
  }

  async getIssue({ token, id, number }: { token: string, id: Id, number: number }): Promise<Issue> {
    return toIssue(await this.client.get(token, `projects/${idOf(id)}/issues/${number}`))
  }

  async createIssue({ token, id, title, description, labels, assignees, milestone }: { token: string, id: Id, title: string, description?: string, labels?: string[], assignees?: string[], milestone?: string | null }): Promise<Issue> {
    const body: Json = { title, description: description ?? '' }
    if (labels?.length) body.labels = labels.join(',')
    if (assignees?.length) body.assignee_ids = await this.userIds(token, assignees)
    if (milestone) body.milestone_id = await this.milestoneId(token, id, milestone)
    return toIssue(await this.client.send(token, 'POST', `projects/${idOf(id)}/issues`, body))
  }

  async updateIssue({ token, id, number, changes }: { token: string, id: Id, number: number, changes: IssueChanges }): Promise<Issue> {
    const body: Json = {}
    if (changes.title !== undefined) body.title = changes.title
    if (changes.description !== undefined) body.description = changes.description
    if (changes.labels !== undefined) body.labels = changes.labels.join(',')
    if (changes.assignees !== undefined) body.assignee_ids = await this.userIds(token, changes.assignees)
    // (0 takes the issue out of its milestone)
    if (changes.milestone !== undefined) body.milestone_id = changes.milestone === null ? 0 : await this.milestoneId(token, id, changes.milestone)
    if (changes.state !== undefined) body.state_event = changes.state === 'closed' ? 'close' : 'reopen'
    return toIssue(await this.client.send(token, 'PUT', `projects/${idOf(id)}/issues/${number}`, body))
  }

  async listIssueComments({ token, id, number }: { token: string, id: Id, number: number }): Promise<Comment[]> {
    const notes = await this.client.listPaged(token, `projects/${idOf(id)}/issues/${number}/notes?sort=asc&order_by=created_at`)
    return notes.filter((note) => !note.system).map(toComment)
  }

  async listIssueLabelEvents({ token, id, number }: { token: string, id: Id, number: number }): Promise<LabelEvent[]> {
    const events = await this.client.listPaged(token, `projects/${idOf(id)}/issues/${number}/resource_label_events`)
    return events
      // (a label deleted since has no name left)
      .filter((event) => event.label?.name)
      .map((event): LabelEvent => ({ label: event.label.name, action: event.action === 'remove' ? 'removed' : 'added', author: event.user?.username, createdAt: event.created_at }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async addIssueComment({ token, id, number, body }: { token: string, id: Id, number: number, body: string }): Promise<Comment> {
    return toComment(await this.client.send(token, 'POST', `projects/${idOf(id)}/issues/${number}/notes`, { body }))
  }

  async listLabels({ token, id }: { token: string, id: Id }): Promise<Label[]> {
    const labels = await this.client.listPaged(token, `projects/${idOf(id)}/labels`)
    return labels.map((label) => ({ name: label.name, color: label.color }))
  }

  async listTemplates({ token, id, kind }: { token: string, id: Id, kind: TemplateKind }): Promise<Template[]> {
    const { defaultBranch } = await this.getRepository({ token, id })
    return readRepositoryTemplates(this, { token, id, kind, ref: defaultBranch ?? 'main', host: 'gitlab' })
  }

  async saveTemplate(_args: { token: string, id: Id, kind: TemplateKind, name: string, content: string }): Promise<Template> {
    throw Object.assign(new Error('The templates of this host are files of the repository'), { status: 400 })
  }

  async deleteTemplate(_args: { token: string, id: Id, kind: TemplateKind, name: string }): Promise<void> {
    throw Object.assign(new Error('The templates of this host are files of the repository'), { status: 400 })
  }

  async listMilestones({ token, id }: { token: string, id: Id }): Promise<Milestone[]> {
    const milestones = await this.client.listPaged(token, `projects/${idOf(id)}/milestones`)
    return milestones.map((milestone) => ({ title: milestone.title, state: milestone.state === 'closed' ? 'closed' as const : 'opened' as const, dueDate: milestone.due_date ?? null }))
  }

  // ── merge requests (the pages of them) ──────────────────────────────────
  async listMergeRequests({ token, id, filter = {} }: { token: string, id: Id, filter?: MergeRequestFilter }): Promise<Page<MergeRequest>> {
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100)
    const page = Math.max(filter.page ?? 1, 1)
    const query = new URLSearchParams({ state: filter.state ?? 'opened', order_by: 'created_at', sort: 'desc', per_page: String(perPage), page: String(page) })
    if (filter.author) query.set('author_username', filter.author)
    if (filter.reviewer) query.set('reviewer_username', filter.reviewer)
    if (filter.labels?.length) query.set('labels', filter.labels.join(','))
    if (filter.search) query.set('search', filter.search)
    if (filter.sourceBranch) query.set('source_branch', filter.sourceBranch)
    if (filter.targetBranch) query.set('target_branch', filter.targetBranch)
    const found = await this.client.get(token, `projects/${idOf(id)}/merge_requests?${query}`) as Json[]
    return { items: found.map(toMergeRequest), page, perPage, hasMore: found.length === perPage }
  }

  async getMergeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<MergeRequest> {
    const base = `projects/${idOf(id)}/merge_requests/${number}`
    const [mr, approvals] = await Promise.all([this.client.get(token, base), this.client.get(token, `${base}/approvals`).catch(() => null)])
    return {
      ...toMergeRequest(mr),
      ...(approvals ? { approvals: { required: approvals.approvals_required ?? null, given: ((approvals.approved_by ?? []) as Json[]).map((entry) => entry.user?.username) } } : {})
    }
  }

  async createMergeRequest({ token, id, title, description, sourceBranch, targetBranch, labels, reviewers }: { token: string, id: Id, title: string, description?: string, sourceBranch: string, targetBranch: string, labels?: string[], reviewers?: string[] }): Promise<MergeRequest> {
    const body: Json = { title, description: description ?? '', source_branch: sourceBranch, target_branch: targetBranch }
    if (labels?.length) body.labels = labels.join(',')
    if (reviewers?.length) body.reviewer_ids = await this.userIds(token, reviewers)
    return toMergeRequest(await this.client.send(token, 'POST', `projects/${idOf(id)}/merge_requests`, body))
  }

  async updateMergeRequest({ token, id, number, changes }: { token: string, id: Id, number: number, changes: MergeRequestChanges }): Promise<MergeRequest> {
    const body: Json = {}
    if (changes.title !== undefined) body.title = changes.title
    if (changes.description !== undefined) body.description = changes.description
    if (changes.labels !== undefined) body.labels = changes.labels.join(',')
    if (changes.reviewers !== undefined) body.reviewer_ids = await this.userIds(token, changes.reviewers)
    if (changes.state !== undefined) body.state_event = changes.state === 'closed' ? 'close' : 'reopen'
    return toMergeRequest(await this.client.send(token, 'PUT', `projects/${idOf(id)}/merge_requests/${number}`, body))
  }

  async getMergeRequestDiff({ token, id, number }: { token: string, id: Id, number: number }): Promise<FileDiff[]> {
    const mr = await this.client.get(token, `projects/${idOf(id)}/merge_requests/${number}/changes`)
    return ((mr.changes ?? []) as Json[]).map(toFileDiff)
  }

  async listMergeRequestThreads({ token, id, number }: { token: string, id: Id, number: number }): Promise<Thread[]> {
    const discussions = await this.client.listPaged(token, `projects/${idOf(id)}/merge_requests/${number}/discussions`)
    return discussions.map(toThread).filter((thread): thread is Thread => thread !== null)
  }

  private async thread(token: string, id: Id, number: number, discussionId: Id): Promise<Thread> {
    const found = toThread(await this.client.get(token, `projects/${idOf(id)}/merge_requests/${number}/discussions/${discussionId}`))
    if (!found) throw Object.assign(new Error('There is no such thread'), { status: 404 })
    return found
  }

  async addMergeRequestComment({ token, id, number, body, position, threadId }: { token: string, id: Id, number: number, body: string, position?: DiffPosition, threadId?: Id }): Promise<Thread> {
    const base = `projects/${idOf(id)}/merge_requests/${number}`
    if (threadId !== undefined) {
      await this.client.send(token, 'POST', `${base}/discussions/${threadId}/notes`, { body })
      return this.thread(token, id, number, threadId)
    }
    const payload: Json = { body }
    if (position) {
      // a note on a line is told which versions of the code the line is in: the three commits of the merge request
      const refs = (await this.client.get(token, base)).diff_refs ?? {}
      payload.position = {
        position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha, new_path: position.path, old_path: position.path,
        ...(position.side === 'new' ? { new_line: position.line } : { old_line: position.line })
      }
    }
    const made = toThread(await this.client.send(token, 'POST', `${base}/discussions`, payload))
    if (!made) throw Object.assign(new Error('The comment was not kept'), { status: 400 })
    return made
  }

  async setThreadResolved({ token, id, number, threadId, resolved }: { token: string, id: Id, number: number, threadId: Id, resolved: boolean }): Promise<Thread> {
    const made = toThread(await this.client.send(token, 'PUT', `projects/${idOf(id)}/merge_requests/${number}/discussions/${threadId}`, { resolved }))
    if (!made) throw Object.assign(new Error('There is no such thread'), { status: 404 })
    return made
  }

  async mergeMergeRequest({ token, id, number, options = {} }: { token: string, id: Id, number: number, options?: MergeOptions }): Promise<boolean> {
    const body: Json = { should_remove_source_branch: Boolean(options.deleteSourceBranch), squash: Boolean(options.squash) }
    if (options.message) body[options.squash ? 'squash_commit_message' : 'merge_commit_message'] = options.message
    try {
      await this.client.send(token, 'PUT', `projects/${idOf(id)}/merge_requests/${number}/merge`, body)
      return false
    } catch (error) {
      // 405: it cannot be merged (not open, checks, conflicts); 406: it has conflicts
      if ([405, 406].includes((error as { status?: number }).status ?? 0)) return true
      throw error
    }
  }

  async approveMergeRequest({ token, id, number }: { token: string, id: Id, number: number }): Promise<void> {
    await this.client.send(token, 'POST', `projects/${idOf(id)}/merge_requests/${number}/approve`)
  }

  async getLatestPipeline({ token, id, ref }: { token: string, id: Id, ref: string }): Promise<Pipeline | null> {
    const [latest] = await this.client.getPipelines(token, idOf(id), ref, 1)
    return latest ? { id: latest.id, sha: latest.sha, status: latest.status, ref: latest.ref, createdAt: latest.created_at, webUrl: latest.web_url } : null
  }

  async listPipelines({ token, id, ref, perPage = 50 }: { token: string, id: Id, ref?: string, perPage?: number }): Promise<Pipeline[]> {
    const found = await this.client.listPipelines(token, idOf(id), ref, perPage)
    return found.map((p) => ({ id: p.id, sha: p.sha, status: p.status, ref: p.ref, createdAt: p.created_at, webUrl: p.web_url }))
  }

  async getPipelineJobs({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<PipelineJob[]> {
    const jobs = await this.client.getPipelineJobs(token, idOf(id), pipelineId)
    // GitLab lists the newest first; they are shown in the order they run
    return [...jobs].reverse().map((job) => ({
      id: job.id, name: job.name, stage: job.stage ?? '', status: job.status,
      duration: typeof job.duration === 'number' ? Math.round(job.duration) : null, webUrl: job.web_url ?? ''
    }))
  }

  async retryPipeline({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    await this.client.retryPipeline(token, idOf(id), pipelineId)
  }

  async cancelPipeline({ token, id, pipelineId }: { token: string, id: Id, pipelineId: Id }): Promise<void> {
    await this.client.cancelPipeline(token, idOf(id), pipelineId)
  }

  async enablePipelines({ token, id }: { token: string, id: Id }): Promise<boolean> {
    const project = await this.client.getProject(token, idOf(id))
    // 'private' and 'enabled' both run pipelines; only a project that has them off needs the change
    if (project.builds_access_level !== 'disabled') return false
    await this.client.updateProject(token, idOf(id), { builds_access_level: 'enabled' })
    return true
  }

  async disablePipelines({ token, id }: { token: string, id: Id }): Promise<boolean> {
    const project = await this.client.getProject(token, idOf(id))
    if (project.builds_access_level === 'disabled') return false
    await this.client.updateProject(token, idOf(id), { builds_access_level: 'disabled' })
    return true
  }

  async pipelinesEnabled({ token, id }: { token: string, id: Id }): Promise<boolean | null> {
    const { builds_access_level: level } = await this.client.getProject(token, idOf(id))
    return level === undefined ? null : level !== 'disabled'
  }

  async cancelJob({ token, id, jobId }: { token: string, id: Id, jobId: Id }): Promise<void> {
    await this.client.cancelJob(token, idOf(id), jobId)
  }

  async getCiRunners({ token, id }: { token: string, id: Id }): Promise<CiRunners> {
    let allowed = true
    const [project, listed] = await Promise.all([
      this.client.getProject(token, idOf(id)),
      this.client.getProjectRunners(token, idOf(id)).catch(() => {
        allowed = false
        return [] as Json[]
      })
    ])
    // the list says nothing of the tags: each runner is asked for
    const runners = await Promise.all(listed.map(async (runner): Promise<Runner> => {
      const detail = await this.client.getRunner(token, runner.id).catch(() => ({} as Json))
      return {
        id: runner.id,
        description: runner.description ?? '',
        online: Boolean(runner.online),
        paused: Boolean(runner.paused),
        shared: Boolean(runner.is_shared),
        tags: detail.tag_list ?? [],
        runsUntagged: detail.run_untagged ?? true
      }
    }))
    return { supported: true, instanceRunners: Boolean(project.shared_runners_enabled), listed: allowed, runners }
  }

  async setInstanceRunners({ token, id, enabled }: { token: string, id: Id, enabled: boolean }): Promise<void> {
    await this.client.updateProject(token, idOf(id), { shared_runners_enabled: enabled })
  }

  async getJobTrace({ token, id, jobId, lines = 40 }: { token: string, id: Id, jobId: Id, lines?: number }): Promise<string> {
    const trace = await this.client.getJobTrace(token, idOf(id), jobId)
    // the colors the runner prints are not for this, nor the time and stream GitLab puts before each line (when it keeps them) and the
    // markers that open and close the sections of a job
    return trace
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \d{2}[OE0-9]\+? ?/gm, '')
      .split('\n')
      .filter((line) => !/^section_(start|end):\d+:\S+\s*$/.test(line))
      .slice(-lines).join('\n').trim()
  }

  async ensureWebhook({ token, id, url, secret, branch }: { token: string, id: Id, url: string, secret: string, branch?: string }): Promise<{ status: 'created' | 'already_exists', hookId?: Id | null }> {
    const existing = await this.client.listHooks(token, idOf(id))
    if (Array.isArray(existing) && existing.some((hook) => hook.url === url)) return { status: 'already_exists' }
    const hook = await this.client.createHook(token, idOf(id), { url, secret, ...(branch === undefined ? {} : { branch }) })
    return { status: 'created', hookId: hook?.id ?? null }
  }

  /** Whether a webhook delivery is from GitLab: it repeats the secret in a header. */
  verifyWebhook({ headers, secret }: Required<Delivery>): boolean {
    const given = headers['x-gitlab-token']
    return typeof given === 'string' && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  }

  parsePushEvent({ body }: { headers: Record<string, string | undefined>, body: any }): { repositoryId: Id, branch: string } | null {
    return body?.object_kind === 'push' && body.project && String(body.ref).startsWith('refs/heads/') ? { repositoryId: body.project.id, branch: String(body.ref).replace(/^refs\/heads\//, '') } : null
  }

  // ── unit of work, errors ─────────────────────────────────────────────────
  async rollback(): Promise<void> {
    // the releases first: a release is of a tag, and the tag is what the session removes
    while (this.releaseUndo.length) await (this.releaseUndo.pop() as () => Promise<unknown>)().catch(() => undefined)
    return this.session.rollback()
  }

  isAuthError(error: unknown): boolean {
    return error instanceof GitLabAuthError || (error as { name?: string } | null)?.name === 'GitAuthError'
  }

  isAlreadyExistsError(error: unknown): boolean {
    return isBranchAlreadyExistsError(error)
  }
}
