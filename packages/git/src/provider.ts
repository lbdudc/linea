/**
 * The git host LINEA works on (GitLab, or GitHub): everything LINEA needs from it, in the host's own words left out.
 *
 * A deployment talks to ONE host. The server and the CLI never speak a host's API: they take a `GitProvider` (`createGitProvider`) and
 * use only the methods below, with the shapes below. What differs between hosts is hidden in the provider: GitLab calls the same things
 * groups, projects and merge requests; GitHub calls them organisations, repositories and pull requests, and has no groups inside
 * groups (see docs/git-provider.md for how each difference is absorbed).
 *
 * A provider object is also a unit of work: what it creates (namespaces, repositories, files, commits, branches, tags) is remembered,
 * and `rollback()` undoes it, newest first. Make one per operation.
 *
 * Every method takes the user's access `token` first. `id` is the repository id (or its `path`), `namespaceId` the id of a namespace.
 */

export type Id = number | string

export interface Repository {
  id: Id
  name: string
  /** Full path as the host shows it: `group/sub/name`, `owner/name`. */
  path: string
  description: string
  webUrl: string
  webIdeUrl: string
  namespaceId: Id | undefined
  /** The namespace that contains this repository's namespace (for a product: the one that is its line). */
  parentNamespaceId?: Id | undefined
  defaultBranch?: string | undefined
  topics: string[]
  /** When the host made it (a host that does not keep it says nothing). */
  createdAt?: string | undefined
}

export interface Namespace {
  id: Id
  fullPath: string
  name: string
  /** Made by `createNamespace` but not yet on the host: the repository that follows is what creates it. */
  pending?: boolean
}

export interface Member {
  username: string
  /** 10 guest, 20 reporter/read, 30 developer/write, 40 maintainer, 50 owner/admin. */
  accessLevel: number
}

/** Who has access to a repository, at what level and where the access comes from. */
export interface AccessEntry {
  username: string
  /** One of the four levels of LINEA: 20 reporter, 30 developer, 40 maintainer, 50 owner. */
  accessLevel: number
  /** `direct`: set on the repository itself; `inherited`: from the group or organization that holds it. */
  source: 'direct' | 'inherited'
}

/** A person of a host, as `searchUsers` finds them. */
export interface HostUser {
  username: string
  name: string
  avatarUrl: string | null
}

export interface RepositoryFile {
  path: string
  name: string
  /** base64 */
  content: string
  encoding: 'base64'
  /** What to quote to say "I changed this file starting from this version" (GitLab: last commit id; GitHub: blob sha). */
  revision: string
}

export interface CommitSummary {
  shortId: string
  title: string
  authorName: string
  createdAt: string
  webUrl?: string | undefined
  /** The whole message (title, blank line, body), when the host gives it. */
  message?: string | undefined
}

/** A merge request (GitLab) or a pull request (GitHub). */
export interface ChangeRequest {
  number: number
  title: string
  sourceBranch: string
  targetBranch: string
  webUrl: string
  hasConflicts: boolean
  /** `opened`, `merged` or `closed`. Only the lists that ask for every state fill what follows. */
  state?: 'opened' | 'merged' | 'closed' | undefined
  author?: string | undefined
  createdAt?: string | undefined
  mergedAt?: string | null | undefined
  /** The commit at the tip of the source branch: the one its checks are for. */
  headSha?: string | undefined
}

/** An issue, as every host shows it. `number` is the one of the repository (GitLab `iid`, GitHub `number`). */
/** The difference between two refs: what `to` brought since it left `from`. */
export interface Comparison {
  commits: CommitSummary[]
  files: FileDiff[]
}

export interface Issue {
  number: number
  title: string
  /** Markdown. */
  description: string
  state: 'opened' | 'closed'
  author: string | undefined
  assignees: string[]
  labels: string[]
  /** The title of the milestone it belongs to. */
  milestone: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  /** The page of the issue on the host (empty for a host that has no pages). */
  webUrl: string
  commentCount: number
}

/** One message of the thread of an issue. */
export interface Comment {
  id: Id
  author: string | undefined
  /** Markdown. */
  body: string
  createdAt: string
  updatedAt: string
}

/** A label put on an issue or taken off it: by whom and when. */
export interface LabelEvent {
  label: string
  action: 'added' | 'removed'
  author: string | undefined
  createdAt: string
}

/** A release of a tag: what the host shows as the release notes of a version. `tag` is its key (one release per tag). */
export interface Release {
  tag: string
  name: string
  /** Markdown. */
  description: string
  createdAt: string
  /** The page of it on the host (empty for a host that has no pages). */
  url: string
  prerelease: boolean
}

export interface ReleaseChanges {
  name?: string
  description?: string
  prerelease?: boolean
}

export interface Label {
  name: string
  /** `#rrggbb`, when the host has colours for labels. */
  color?: string | undefined
}

export interface Milestone {
  title: string
  state: 'opened' | 'closed'
  dueDate?: string | null | undefined
}

export interface IssueFilter {
  /** Default `opened`. */
  state?: 'opened' | 'closed' | 'all'
  author?: string
  assignee?: string
  /** All of them. */
  labels?: string[]
  /** The title of a milestone. */
  milestone?: string
  /** Text in the title or the description. */
  search?: string
  /** From 1. */
  page?: number
  /** Default 20, at most 100. */
  perPage?: number
}

/** One page of a list. A host does not always know how many there are in all: `hasMore` is what every host can say. */
export interface Page<T> {
  items: T[]
  page: number
  perPage: number
  hasMore: boolean
}

export interface IssueChanges {
  title?: string
  description?: string
  labels?: string[]
  assignees?: string[]
  /** The title of a milestone; `null` takes the issue out of its milestone. */
  milestone?: string | null
  state?: 'opened' | 'closed'
}

/**
 * What a host can do beyond the common part. The UI offers only what is `true`, and a call for something that is not is refused with
 * status 400 rather than ignored.
 */
/** A repository the host is about to delete for good. */
export interface PendingDeletion {
  id: Id
  name: string
  /** Where it was, as it was called before the host renamed it for the deletion. */
  path: string
  /** Its page now, with whatever name the host gave it for the deletion: the only address that opens. */
  webUrl: string
  namespaceId: Id | undefined
  /** The namespace that contains this repository's namespace (for a product: the one that is its line). */
  parentNamespaceId?: Id | undefined
  /** The day the host deletes it for good; `null` when the host does not say. */
  deletesOn: string | null
  /** When the host made the repository, if it says. */
  createdAt?: string
  repositoryScheduled: boolean
  namespaceScheduled: boolean
  /** Something above its namespace waits to be deleted: it cannot come back before that does. */
  ancestorScheduled: boolean
}

export type TemplateKind = 'issue' | 'mergeRequest'

export interface Template {
  name: string
  content: string
}

export interface Capabilities {
  issues: {
    labels: boolean
    milestones: boolean
    assignees: boolean
    closingWords: boolean
  }
  templates: {
    editable: boolean
  }
  mergeRequests: {
    labels: boolean
    reviewers: boolean
    /** Approvals can be given (and counted). */
    approvals: boolean
    /** A thread of the code can be marked resolved. */
    resolvableThreads: boolean
    /** A merge can leave one commit. */
    squash: boolean
  }
  deletion: {
    namespaceIsRepository: boolean
    delayed: boolean
  }
  releases: {
    /** A release can be marked as a prerelease (GitLab has no such mark: it ignores it and always says `false`). */
    prerelease: boolean
  }
}

/** A merge request (GitLab) or a pull request (GitHub) as the pages of LINEA show it: more than `ChangeRequest`, which is what the code needs. */
export interface MergeRequest {
  number: number
  title: string
  /** Markdown. */
  description: string
  state: 'opened' | 'merged' | 'closed'
  author: string | undefined
  sourceBranch: string
  targetBranch: string
  labels: string[]
  reviewers: string[]
  assignees: string[]
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  /** The page of it on the host (empty for a host that has no pages). */
  webUrl: string
  hasConflicts: boolean
  /** The commit at the tip of the source branch: the one its checks are for. */
  headSha: string | undefined
  /** Messages of people in all its threads. */
  commentCount: number
  /** Who approved it, and how many approvals it asks for (`null`: it does not say). Only on a host that has approvals. */
  approvals?: { required: number | null, given: string[] } | undefined
}

export interface MergeRequestFilter {
  /** Default `opened`. */
  state?: 'opened' | 'merged' | 'closed' | 'all'
  author?: string
  reviewer?: string
  labels?: string[]
  search?: string
  sourceBranch?: string
  targetBranch?: string
  page?: number
  perPage?: number
}

/** One file of the code a merge request proposes. `patch` is the unified diff from the first `@@` on (empty for a file git cannot show, as a binary one). */
export interface FileDiff {
  oldPath: string
  newPath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  patch: string
}

/** A line of the code of a merge request: of the new version of the file, or (`old`) of the one it replaces. */
export interface DiffPosition {
  path: string
  line: number
  side: 'new' | 'old'
}

/** A conversation of a merge request: a message of its own, or a line of the code with what was said about it. */
export interface Thread {
  id: Id
  /** The host can mark it resolved (GitHub can only through an API LINEA does not use). */
  resolvable: boolean
  resolved: boolean
  /** The line it is about; none for a general message. */
  position?: DiffPosition | undefined
  comments: Comment[]
}

export interface MergeOptions {
  /** One commit in the target instead of the history of the branch. */
  squash?: boolean
  deleteSourceBranch?: boolean
  /** The message of the commit that is made. */
  message?: string
}

export interface MergeRequestChanges {
  title?: string
  description?: string
  labels?: string[]
  reviewers?: string[]
  /** Closing and reopening are `state`. */
  state?: 'opened' | 'closed'
}

export interface FileAction {
  action: 'create' | 'update' | 'delete'
  path: string
  content?: string
  /** How `content` is written (default text). */
  encoding?: 'text' | 'base64'
  /** Refuse the change when the file moved on from this revision (status 409). */
  expectedRevision?: string
}

export interface Pipeline {
  /** The id the host gives it, for asking about its jobs or running it again. */
  id?: Id
  /** The commit it ran for. */
  sha?: string
  /** `success`, `failed`, `running`, `pending`, `canceled`, `skipped`. */
  status: string
  ref: string
  createdAt: string
  webUrl: string
}

/** One step of a pipeline (a job of GitLab, a job of a workflow run of GitHub). */
export interface PipelineJob {
  id: Id
  name: string
  /** The stage it belongs to (GitHub has none: its jobs are all `jobs`). */
  stage: string
  /** `success`, `failed`, `running`, `pending`, `canceled`, `skipped`. */
  status: string
  /** Seconds, when it has started. */
  duration: number | null
  webUrl: string
}

/** A runner of the host's CI, as it shows for a repository. */
export interface Runner {
  id: Id
  description: string
  online: boolean
  paused: boolean
  /** A runner shared by the whole instance (not one of the repository). */
  shared: boolean
  /** Jobs that ask for none of these tags are not run by it, unless it takes untagged jobs. */
  tags: string[]
  runsUntagged: boolean
}

/** What the host's CI offers a repository: whether it has runners to take its jobs. */
export interface CiRunners {
  /** `false` for a host that runs no pipelines (or whose runners cannot be asked for). */
  supported: boolean
  /** Whether the runners of the whole instance take this repository's jobs (`null`: not asked, or not a thing of this host). */
  instanceRunners: boolean | null
  /** `false` when the host would not list them for this token: `runners` being empty then says nothing. */
  listed?: boolean
  runners: Runner[]
}

export interface Tokens {
  accessToken: string
  refreshToken: string | null
}

/** What the person is shown to approve a sign-in from a machine with no browser (the OAuth device authorization grant). */
export interface DeviceAuthorization {
  /** Kept by the client and given back to poll; useless without the host's OAuth app secret on confidential apps. */
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string | undefined
  /** Seconds the codes last. */
  expiresIn: number
  /** Seconds to wait between polls. */
  interval: number
}

export type DevicePoll =
  | { status: 'pending', interval: number }
  | { status: 'done', tokens: Tokens }

export interface AuthConfig {
  kind: GitHostKind
  clientId: string | undefined
  redirectUri: string
  /** The address of the host's website. */
  url: string
  /** Where a browser is sent to log in; add `client_id`, `redirect_uri`, `response_type=code`, `scope` and `state`. */
  authorizeUrl: string
  /** What to ask the user to allow. */
  scope: string
}

export type GitHostKind = 'local' | 'gitlab' | 'github'

export interface Delivery {
  headers: Record<string, string | undefined>
  rawBody?: Buffer | string
  secret?: string
}

export interface GitProvider {
  readonly kind: GitHostKind
  /** Whether a namespace can hold namespaces (GitLab groups do; a GitHub account cannot). */
  readonly nestsNamespaces: boolean
  readonly webhookPath: string

  // Identity
  authConfig(): AuthConfig
  exchangeCode(args: { code: string, redirectUri: string }): Promise<Tokens>
  /** Keeps `accessToken` when the host's tokens do not expire. */
  refreshToken(args: { refreshToken: string | null, accessToken: string }): Promise<Tokens>
  getUser(args: { token: string }): Promise<{ username: string, avatarUrl: string }>
  /**
   * Device authorization: for hosts that have it (GitLab, GitHub), not part of GIT_PROVIDER_METHODS. Rejects with `GitDeviceFlowError`
   * (`unsupported` when the host has no such flow); polling rejects with `expired_token` / `access_denied` when it cannot go on.
   */
  startDeviceAuthorization?(args?: { scope?: string }): Promise<DeviceAuthorization>
  pollDeviceAuthorization?(args: { deviceCode: string, interval?: number }): Promise<DevicePoll>

  // Namespaces: the place repositories live in
  /** Where the user may create things. */
  listNamespaces(args: { token: string }): Promise<Namespace[]>
  findNamespace(args: { token: string, fullPath: string }): Promise<Namespace | null>
  createNamespace(args: { token: string, name: string, parentId?: Id | undefined }): Promise<Namespace>
  /** With everything in it. */
  deleteNamespace(args: { token: string, id: Id }): Promise<unknown>
  renameNamespace(args: { token: string, id: Id, name: string }): Promise<unknown>

  // Repositories
  createRepository(args: { token: string, name: string, namespaceId?: Id | undefined, topics?: string[], defaultBranch?: string | undefined }): Promise<Repository>
  deleteRepository(args: { token: string, id: Id }): Promise<unknown>
  /** The repositories with this topic the user reaches that wait to be deleted; a host that deletes at once has none. */
  listPendingDeletion(args: { token: string, topic: string }): Promise<PendingDeletion[]>
  restoreRepository(args: { token: string, id: Id }): Promise<unknown>
  restoreNamespace(args: { token: string, id: Id }): Promise<unknown>
  renameRepository(args: { token: string, id: Id, name: string }): Promise<Repository>
  getRepository(args: { token: string, id: Id }): Promise<Repository>
  /** By its full path; `null` when there is none. */
  findRepository(args: { token: string, path: string }): Promise<Repository | null>
  /** The live repositories of the user that have a topic. */
  listRepositories(args: { token: string, topic: string }): Promise<Repository[]>
  addTopic(args: { token: string, id: Id, topic: string }): Promise<void>
  setDefaultBranch(args: { token: string, id: Id, branch: string }): Promise<unknown>
  getMembers(args: { token: string, id: Id }): Promise<Member[]>
  /** The level of the user of `token` on the repository (0: none). */
  getAccessLevel(args: { token: string, id: Id, username: string }): Promise<number>
  /** Everybody with access to the repository, each with the level and where it comes from (needs Maintainer to read the whole list). */
  listAccess(args: { token: string, id: Id }): Promise<AccessEntry[]>
  /** Gives a person a level (20, 30, 40 or 50) on the repository, or changes it. */
  setAccess(args: { token: string, id: Id, username: string, accessLevel: number }): Promise<void>
  /** Takes the access set on the repository itself from a person (one inherited from a group stays: it is the group's). */
  removeAccess(args: { token: string, id: Id, username: string }): Promise<void>
  /** People of the host whose username or name matches `query`. */
  searchUsers(args: { token: string, query: string }): Promise<HostUser[]>

  // Files, commits, archives
  getFile(args: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile>
  /** Like `getFile`, never remembered for rollback. */
  getFileRevision(args: { token: string, id: Id, path: string, ref: string }): Promise<RepositoryFile>
  /** The bytes, or `null` when there is no such file. */
  readFile(args: { token: string, id: Id, path: string, ref: string }): Promise<Buffer | null>
  /** Every file of a repository at `ref`. */
  listFiles(args: { token: string, id: Id, ref: string }): Promise<string[]>
  createFile(args: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown>
  saveFile(args: { token: string, id: Id, path: string, branch: string, content: string }): Promise<unknown>
  commit(args: { token: string, id: Id, branch: string, message: string, actions: FileAction[], track?: boolean }): Promise<{ id: string }>
  /** A zip of the repository at `ref`. */
  downloadArchive(args: { token: string, id: Id, ref?: string }): Promise<NodeJS.ReadableStream>
  getCommits(args: { token: string, id: Id, ref: string, perPage?: number }): Promise<CommitSummary[]>
  /** What `to` has that `from` has not: its commits (newest first) and the files they change, as the host's own comparison shows them. */
  compare(args: { token: string, id: Id, from: string, to: string }): Promise<Comparison>

  // Branches and tags
  createBranch(args: { token: string, id: Id, branch: string, ref: string, track?: boolean }): Promise<unknown>
  /** The names of the branches of a repository. */
  listBranches(args: { token: string, id: Id }): Promise<string[]>
  getBranch(args: { token: string, id: Id, branch: string }): Promise<{ name: string, lastCommit: CommitSummary | null }>
  listTags(args: { token: string, id: Id }): Promise<{ name: string }[]>
  /** `message` is the annotation of the tag (null for one that has none): what `createTag` was given. */
  getTag(args: { token: string, id: Id, tag: string }): Promise<{ name: string, commitId: string, message: string | null } | null>
  createTag(args: { token: string, id: Id, tag: string, ref: string, message?: string }): Promise<unknown>

  // Releases: one per tag. Creating the release of a tag that has one fails with an "already exists" error (`isAlreadyExistsError`) and
  // leaves it as it was; `updateRelease` is the way to change it. A tag that does not exist is refused with status 404.
  /** `name` defaults to the tag. `prerelease` is ignored by a host whose `capabilities().releases.prerelease` is `false`. */
  createRelease(args: { token: string, id: Id, tag: string, name?: string, description?: string, prerelease?: boolean }): Promise<Release>
  /** `null` when the tag has no release. */
  getRelease(args: { token: string, id: Id, tag: string }): Promise<Release | null>
  /** Newest first. */
  listReleases(args: { token: string, id: Id }): Promise<Release[]>
  /** Only what is in `changes` is touched (`prerelease` only where the host has it); status 404 when the tag has no release. */
  updateRelease(args: { token: string, id: Id, tag: string, changes: ReleaseChanges }): Promise<Release>

  // Change requests
  createChangeRequest(args: { token: string, id: Id, title: string, sourceBranch: string, targetBranch: string }): Promise<ChangeRequest>
  createOrRenameChangeRequest(args: { token: string, id: Id, title: string, sourceBranch: string, targetBranch?: string }): Promise<ChangeRequest>
  listChangeRequests(args: { token: string, id: Id, state?: 'opened' | 'merged' | 'closed' | 'all', targetBranch?: string }): Promise<ChangeRequest[]>
  /** The pipelines that ran for a change request (its checks), newest first. */
  listChangeRequestPipelines(args: { token: string, id: Id, number: number }): Promise<Pipeline[]>
  /** Merges it when it can; `true` when it has conflicts (or is not open). */
  mergeChangeRequest(args: { token: string, id: Id, number: number, deleteSourceBranch?: boolean }): Promise<boolean>

  // Issues
  capabilities(): Capabilities
  listIssues(args: { token: string, id: Id, filter?: IssueFilter }): Promise<Page<Issue>>
  getIssue(args: { token: string, id: Id, number: number }): Promise<Issue>
  createIssue(args: { token: string, id: Id, title: string, description?: string, labels?: string[], assignees?: string[], milestone?: string | null }): Promise<Issue>
  /** Only what is in `changes` is touched. Closing and reopening are `state`. */
  updateIssue(args: { token: string, id: Id, number: number, changes: IssueChanges }): Promise<Issue>
  /** The messages the people wrote, oldest first (what the host writes by itself, "changed the label", is left out). */
  listIssueComments(args: { token: string, id: Id, number: number }): Promise<Comment[]>
  /** The labels put on an issue and taken off it, oldest first (those it was opened with too): who and when. */
  listIssueLabelEvents(args: { token: string, id: Id, number: number }): Promise<LabelEvent[]>
  addIssueComment(args: { token: string, id: Id, number: number, body: string }): Promise<Comment>
  listLabels(args: { token: string, id: Id }): Promise<Label[]>
  listMilestones(args: { token: string, id: Id }): Promise<Milestone[]>

  listTemplates(args: { token: string, id: Id, kind: TemplateKind }): Promise<Template[]>
  saveTemplate(args: { token: string, id: Id, kind: TemplateKind, name: string, content: string }): Promise<Template>
  deleteTemplate(args: { token: string, id: Id, kind: TemplateKind, name: string }): Promise<void>

  // Merge requests (the part of them the pages need; `createChangeRequest` and the rest are what the code needs)
  listMergeRequests(args: { token: string, id: Id, filter?: MergeRequestFilter }): Promise<Page<MergeRequest>>
  getMergeRequest(args: { token: string, id: Id, number: number }): Promise<MergeRequest>
  createMergeRequest(args: { token: string, id: Id, title: string, description?: string, sourceBranch: string, targetBranch: string, labels?: string[], reviewers?: string[] }): Promise<MergeRequest>
  /** Only what is in `changes` is touched. */
  updateMergeRequest(args: { token: string, id: Id, number: number, changes: MergeRequestChanges }): Promise<MergeRequest>
  /** The files it changes, as the target would see them after the merge. */
  getMergeRequestDiff(args: { token: string, id: Id, number: number }): Promise<FileDiff[]>
  /** Every conversation, oldest first: the general messages and the ones about lines of the code. */
  listMergeRequestThreads(args: { token: string, id: Id, number: number }): Promise<Thread[]>
  /** A general message, one about a line (`position`), or an answer in a thread (`threadId`). Answers with the thread it is in. */
  addMergeRequestComment(args: { token: string, id: Id, number: number, body: string, position?: DiffPosition, threadId?: Id }): Promise<Thread>
  setThreadResolved(args: { token: string, id: Id, number: number, threadId: Id, resolved: boolean }): Promise<Thread>
  /** Merges it; `true` when it has conflicts (or is not open), as `mergeChangeRequest`. */
  mergeMergeRequest(args: { token: string, id: Id, number: number, options?: MergeOptions }): Promise<boolean>
  /** Gives the approval of the user of `token` (a host with no approvals refuses with status 400). */
  approveMergeRequest(args: { token: string, id: Id, number: number }): Promise<void>

  // CI and hooks
  getLatestPipeline(args: { token: string, id: Id, ref: string }): Promise<Pipeline | null>
  /** The last pipelines of a branch (or of the repository, without `ref`), newest first. */
  listPipelines(args: { token: string, id: Id, ref?: string, perPage?: number }): Promise<Pipeline[]>
  /** The jobs of a pipeline, in the order they run. */
  getPipelineJobs(args: { token: string, id: Id, pipelineId: Id }): Promise<PipelineJob[]>
  /** Runs the failed jobs of a pipeline again. */
  retryPipeline(args: { token: string, id: Id, pipelineId: Id }): Promise<void>
  /** Stops a pipeline that has not finished: its running and waiting jobs are canceled. */
  cancelPipeline(args: { token: string, id: Id, pipelineId: Id }): Promise<void>
  /** Makes sure a repository can run pipelines (a project made with CI/CD switched off gets it switched on). Answers whether it changed anything. */
  enablePipelines(args: { token: string, id: Id }): Promise<boolean>
  /** Turns CI/CD off for a repository; `true` when it had to be changed. A host where that is not the repository's to choose does nothing. */
  disablePipelines(args: { token: string, id: Id }): Promise<boolean>
  /** Whether CI/CD is on for a repository; `null` when the host does not say, or it is not a thing of this host. */
  pipelinesEnabled(args: { token: string, id: Id }): Promise<boolean | null>
  /** Stops one job that has not finished (hosts that cannot cancel a single job say so). */
  cancelJob(args: { token: string, id: Id, jobId: Id }): Promise<void>
  /** The runners that can take the jobs of a repository, and whether the instance's own are turned on for it. */
  getCiRunners(args: { token: string, id: Id }): Promise<CiRunners>
  /** Turns on (or off) the runners of the whole instance for a repository. */
  setInstanceRunners(args: { token: string, id: Id, enabled: boolean }): Promise<void>
  /** The end of what a job printed (the last `lines`). */
  getJobTrace(args: { token: string, id: Id, jobId: Id, lines?: number }): Promise<string>
  ensureWebhook(args: { token: string, id: Id, url: string, secret: string, branch?: string }): Promise<{ status: 'created' | 'already_exists', hookId?: Id | null }>
  verifyWebhook(args: Required<Delivery>): boolean
  parsePushEvent(args: { headers: Record<string, string | undefined>, body: any }): { repositoryId: Id, branch: string } | null

  // Unit of work, errors
  rollback(): Promise<void>
  /** The token is expired or revoked. */
  isAuthError(error: unknown): boolean
  /** A branch (or other ref) that exists already. */
  isAlreadyExistsError(error: unknown): boolean
}

/** The methods a provider has to have: what the contract test checks and what a new host has to fill in. */
export const GIT_PROVIDER_METHODS = [
  'authConfig', 'exchangeCode', 'refreshToken', 'getUser',
  'listNamespaces', 'findNamespace', 'createNamespace', 'deleteNamespace', 'renameNamespace',
  'createRepository', 'deleteRepository', 'listPendingDeletion', 'restoreRepository', 'restoreNamespace', 'renameRepository', 'getRepository', 'findRepository', 'listRepositories', 'addTopic',
  'setDefaultBranch', 'getMembers', 'getAccessLevel', 'listAccess', 'setAccess', 'removeAccess', 'searchUsers',
  'getFile', 'getFileRevision', 'readFile', 'listFiles', 'createFile', 'saveFile', 'commit', 'downloadArchive', 'getCommits', 'compare',
  'createBranch', 'listBranches', 'getBranch', 'listTags', 'getTag', 'createTag',
  'createRelease', 'getRelease', 'listReleases', 'updateRelease',
  'createChangeRequest', 'createOrRenameChangeRequest', 'listChangeRequests', 'listChangeRequestPipelines', 'mergeChangeRequest',
  'getLatestPipeline', 'listPipelines', 'getPipelineJobs', 'retryPipeline', 'cancelPipeline', 'cancelJob', 'enablePipelines', 'disablePipelines', 'pipelinesEnabled', 'getCiRunners', 'setInstanceRunners', 'getJobTrace', 'ensureWebhook', 'verifyWebhook', 'parsePushEvent',
  'listMergeRequests', 'getMergeRequest', 'createMergeRequest', 'updateMergeRequest', 'getMergeRequestDiff', 'listMergeRequestThreads', 'addMergeRequestComment', 'setThreadResolved', 'mergeMergeRequest', 'approveMergeRequest',
  'capabilities', 'listIssues', 'getIssue', 'createIssue', 'updateIssue', 'listIssueComments', 'listIssueLabelEvents', 'addIssueComment', 'listLabels', 'listMilestones', 'listTemplates', 'saveTemplate', 'deleteTemplate',
  'rollback', 'isAuthError', 'isAlreadyExistsError'
] as const
