import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { Readable } from 'node:stream'
import { GitLabAuthError, GitLabError } from 'gitlab-commando'

/**
 * The parts of the GitLab REST API that `gitlab-commando` (which keeps what it created, to undo it) does not cover: reads, and writes
 * that are not undone. Each takes the address of the GitLab it talks to.
 */

const REQUEST_TIMEOUT_MS = 30000

type Json = any

interface Request {
  url: string
  token: string
  method: string
  path: string
  body?: unknown
  json?: boolean
  api?: string
}

// Without a limit, a GitLab call that never gets a response (dropped connection, overloaded instance) hangs until the OS gives up:
// that took 5+ minutes, showing only as a generic 500 with no clue which call stalled. Fail fast instead, as a proper GitLabError.
const appFetch = async ({ url, token, method, path, body, json = true, api = 'api/v4' }: Request): Promise<Json> => {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }
  let res: Response
  const started = Date.now()
  try {
    res = await fetch(`${url}/${api}/${path}`, init)
    // LINEA_GIT_TRACE=1: one line per GitLab call, to see where the time of a slow resolution goes
    if (process.env['LINEA_GIT_TRACE']) console.log(`[gitlab] ${method} ${path.split('?')[0]} ${res.status} ${Date.now() - started}ms`)
  } catch (error) {
    const failure = error as Error
    if (failure.name === 'TimeoutError' || failure.name === 'AbortError') {
      throw new GitLabError(`GitLab request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`)
    }
    throw new GitLabError(failure.message ?? String(error))
  }
  if (!json) return res
  if (res.ok) {
    // a DELETE answers 204 with no body
    const raw = await res.text()
    return raw ? JSON.parse(raw) : null
  }
  let detail: Json = {}
  try {
    const raw = await res.text()
    detail = raw ? JSON.parse(raw) : {}
  } catch {
    detail = {}
  }
  const error = res.status === 401 ? new GitLabAuthError(detail.error) : new GitLabError(detail.message ?? res.statusText)
  error.status = res.status
  throw error
}

export interface GitLabClient {
  readonly url: string
  get: (token: string, path: string) => Promise<Json>
  send: (token: string, method: string, path: string, body?: unknown) => Promise<Json>
  listPaged: (token: string, path: string, perPage?: number) => Promise<Json[]>
  getGroups: (token: string, minAccessLevel?: number) => Promise<Json[]>
  getGroup: (token: string, idOrPath: number | string) => Promise<Json | null>
  getEnrolledProjects: (token: string, topic: string) => Promise<Json[]>
  getProject: (token: string, id: number | string) => Promise<Json>
  getProjectsPendingDeletion: (token: string, topic: string) => Promise<Json[]>
  getDeletionDates: (token: string, ids: number[]) => Promise<Map<number, string>>
  updateProject: (token: string, id: number | string, body: unknown) => Promise<Json>
  getTags: (token: string, id: number | string) => Promise<Json[]>
  getTag: (token: string, id: number | string, tag: string) => Promise<Json | null>
  createTag: (token: string, id: number | string, tag: string, ref: string, message?: string) => Promise<Json>
  getFilePaths: (token: string, id: number | string, ref: string) => Promise<string[]>
  getRawFile: (token: string, id: number | string, path: string, ref: string) => Promise<Buffer | null>
  getFileMeta: (token: string, id: number | string, path: string, ref: string) => Promise<Json>
  commitActions: (token: string, id: number | string, branch: string, message: string, actions: unknown[]) => Promise<Json>
  downloadArchive: (token: string, id: number | string, ref: string) => Promise<Response['body']>
  getCommits: (token: string, id: number | string, ref: string, perPage?: number) => Promise<Json[]>
  getBranch: (token: string, id: number | string, branch: string) => Promise<Json>
  createBranch: (token: string, id: number | string, branch: string, ref: string) => Promise<Json>
  getMergeRequests: (token: string, id: number | string, state: string, targetBranch?: string) => Promise<Json[]>
  getMergeRequest: (token: string, id: number | string, iid: number | string) => Promise<Json>
  listMergeRequestPipelines: (token: string, id: number | string, iid: number | string) => Promise<Json[]>
  getProjectRunners: (token: string, id: number | string) => Promise<Json[]>
  getRunner: (token: string, runnerId: number | string) => Promise<Json>
  getPipelines: (token: string, id: number | string, ref: string, perPage?: number) => Promise<Json[]>
  listPipelines: (token: string, id: number | string, ref: string | undefined, perPage: number) => Promise<Json[]>
  getPipelineJobs: (token: string, id: number | string, pipelineId: number | string) => Promise<Json[]>
  retryPipeline: (token: string, id: number | string, pipelineId: number | string) => Promise<Json>
  cancelPipeline: (token: string, id: number | string, pipelineId: number | string) => Promise<Json>
  cancelJob: (token: string, id: number | string, jobId: number | string) => Promise<Json>
  getJobTrace: (token: string, id: number | string, jobId: number | string) => Promise<string>
  listHooks: (token: string, id: number | string) => Promise<Json[]>
  createHook: (token: string, id: number | string, hook: { url: string, secret: string, branch?: string }) => Promise<Json>
}

const enc = encodeURIComponent
const DELETION_SCHEDULED = /-deletion_scheduled-\d+/
// GitLab refuses a query with three `parent` in a row ("Recursive query")
const DELETION_FIELDS = 'isSelfDeletionScheduled permanentDeletionDate'
export const DELETION_DATES_QUERY = `query($ids: [ID!]) { projects(ids: $ids, first: 100) { nodes { id ${DELETION_FIELDS} group { ${DELETION_FIELDS} parent { ${DELETION_FIELDS} parent { ${DELETION_FIELDS} } } } } } }`

export const createGitLabClient = ({ url }: { url: string }): GitLabClient => {
  const base = url.replace(/\/+$/, '')
  const send: GitLabClient['send'] = (token, method, path, body) => appFetch({ url: base, token, method, path, body })
  const get: GitLabClient['get'] = (token, path) => send(token, 'GET', path)

  const listPaged: GitLabClient['listPaged'] = async (token, path, perPage = 100) => {
    const all: Json[] = []
    for (let page = 1; ; page++) {
      const batch = await get(token, `${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`)
      all.push(...batch)
      if (batch.length < perPage) return all
    }
  }

  return {
    url: base,
    get,
    send,
    listPaged,

    // Groups the user is a member of at `minAccessLevel` or above: the candidate parents for a new line's group. 30 (developer) is the
    // lowest level GitLab ever allows group content creation at; each group's own subgroup_creation_level has the final say.
    async getGroups(token, minAccessLevel = 30) {
      const all: Json[] = []
      for (let page = 1; ; page++) {
        const batch = await get(token, `groups?min_access_level=${minAccessLevel}&per_page=100&page=${page}&order_by=path&sort=asc`)
        if (batch.length === 0) return all
        all.push(...batch)
      }
    },

    async getGroup(token, idOrPath) {
      try {
        return await get(token, `groups/${typeof idOrPath === 'string' ? enc(idOrPath) : idOrPath}`)
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null
        throw error
      }
    },

    async getEnrolledProjects(token, topic) {
      const all: Json[] = []
      for (let page = 1; ; page++) {
        const batch = await get(token, `projects?membership=true&topic=${enc(topic)}&per_page=100&simple=true&archived=false&page=${page}`)
        all.push(...batch)
        // a short page is the last one: asking for the next only to be told it is empty is one more round trip per list
        if (batch.length < 100) break
      }
      // A project whose own `marked_for_deletion_at` is unset can still be effectively gone: delayed group deletion renames the parent
      // namespace to `<name>-deletion_scheduled-<id>` immediately, but does not set that flag on every project underneath until the
      // group is purged. Catch that via the renamed namespace path rather than a field GitLab may not have propagated yet.
      // `simple=true` (a quarter of the time of the full project payload) leaves `marked_for_deletion_at` out: the path says it too
      const pendingDeletion = (p: Json): boolean => /-deletion_scheduled-\d+/.test(p.path_with_namespace ?? p.namespace?.full_path ?? p.namespace?.path ?? '')
      return all.filter((p) => !p.archived && !p.marked_for_deletion_at && !pendingDeletion(p))
    },

    getProject: (token, id) => get(token, `projects/${typeof id === 'string' && id.includes('/') ? enc(id) : id}`),

    // the whole payload, not `simple=true`: the date of the deletion is not in the short one
    async getProjectsPendingDeletion(token, topic) {
      const all = await listPaged(token, `projects?membership=true&topic=${enc(topic)}`)
      return all.filter((p) => p.marked_for_deletion_on || p.marked_for_deletion_at || DELETION_SCHEDULED.test(p.path_with_namespace ?? ''))
    },

    // `permanentDeletionDate` answers a theoretical date for whatever is not itself scheduled: a project in a group that waits to be
    // deleted takes the date of that group, not its own
    async getDeletionDates(token, ids) {
      const dates = new Map<number, string>()
      for (let at = 0; at < ids.length; at += 100) {
        const variables = { ids: ids.slice(at, at + 100).map((id) => `gid://gitlab/Project/${id}`) }
        const answer = await appFetch({ url: base, token, method: 'POST', api: 'api', path: 'graphql', body: { query: DELETION_DATES_QUERY, variables } })
        for (const node of answer?.data?.projects?.nodes ?? []) {
          let scheduled = node
          if (!scheduled.isSelfDeletionScheduled) {
            scheduled = node.group
            while (scheduled && !scheduled.isSelfDeletionScheduled) scheduled = scheduled.parent
          }
          if (scheduled?.permanentDeletionDate) dates.set(Number(String(node.id).split('/').pop()), scheduled.permanentDeletionDate)
        }
      }
      return dates
    },
    updateProject: (token, id, body) => send(token, 'PUT', `projects/${id}`, body),

    getTags: (token, id) => listPaged(token, `projects/${id}/repository/tags`),
    async getTag(token, id, tag) {
      try {
        return await get(token, `projects/${id}/repository/tags/${enc(tag)}`)
      } catch (error) {
        if ((error as { status?: number }).status === 404) return null
        throw error
      }
    },
    createTag: (token, id, tag, ref, message) =>
      send(token, 'POST', `projects/${id}/repository/tags`, { tag_name: tag, ref, ...(message ? { message } : {}) }),

    // Every file (blob) of a repository at `ref`, as paths relative to the repository root.
    async getFilePaths(token, id, ref) {
      const tree = await listPaged(token, `projects/${id}/repository/tree?recursive=true&ref=${enc(ref)}`)
      return tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path as string).sort()
    },

    // The bytes of a file at `ref`, or null when there is no such file.
    async getRawFile(token, id, path, ref) {
      const res: Response = await appFetch({ url: base, token, method: 'GET', path: `projects/${id}/repository/files/${enc(path)}/raw?ref=${enc(ref)}`, json: false })
      if (res.status === 404) return null
      if (res.status === 401) throw Object.assign(new GitLabAuthError('unauthorized'), { status: 401 })
      if (!res.ok) throw Object.assign(new GitLabError(res.statusText), { status: res.status })
      return Buffer.from(await res.arrayBuffer())
    },

    getFileMeta: (token, id, path, ref) => get(token, `projects/${id}/repository/files/${enc(path)}?ref=${enc(ref)}`),
    commitActions: (token, id, branch, message, actions) =>
      send(token, 'POST', `projects/${id}/repository/commits`, { branch, commit_message: message, actions }),

    // node:http(s) rather than fetch: undici adds `Sec-Fetch-Mode: cors`, which GitLab answers with 406 for an archive (and it
    // cannot be overridden); the same request without it is fine
    async downloadArchive(token, id, ref) {
      const target = new URL(`${base}/api/v4/projects/${id}/repository/archive.zip?sha=${enc(ref)}`)
      const get = target.protocol === 'http:' ? httpGet : httpsGet
      return await new Promise<Response['body']>((resolve, reject) => {
        const request = get(target, { headers: { Authorization: `Bearer ${token}` }, timeout: REQUEST_TIMEOUT_MS }, (res) => {
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            const parts: Buffer[] = []
            res.on('data', (part: Buffer) => parts.push(part))
            res.on('end', () => reject(new Error(`Unexpected response ${res.statusCode} ${res.statusMessage}: ${Buffer.concat(parts).toString('utf8').slice(0, 300)}`)))
            return
          }
          resolve(Readable.toWeb(res) as unknown as Response['body'])
        })
        request.on('timeout', () => request.destroy(new Error(`GitLab request timed out after ${REQUEST_TIMEOUT_MS}ms: GET projects/${id}/repository/archive.zip`)))
        request.on('error', reject)
      })
    },

    getCommits: (token, id, ref, perPage = 7) => get(token, `projects/${id}/repository/commits?ref_name=${enc(ref)}&per_page=${perPage}`),
    getBranch: (token, id, branch) => get(token, `projects/${id}/repository/branches/${enc(branch)}`),
    createBranch: (token, id, branch, ref) => send(token, 'POST', `projects/${id}/repository/branches`, { branch, ref }),

    getMergeRequest: (token, id, iid) => get(token, `projects/${id}/merge_requests/${iid}`),
    getMergeRequests(token, id, state, targetBranch) {
      let path = `projects/${id}/merge_requests?state=${state}&per_page=20`
      if (targetBranch) path += `&target_branch=${enc(targetBranch)}`
      return get(token, path)
    },
    listMergeRequestPipelines: (token, id, iid) => get(token, `projects/${id}/merge_requests/${iid}/pipelines?per_page=20`),
    getProjectRunners: (token, id) => get(token, `projects/${id}/runners?per_page=50`),
    getRunner: (token, runnerId) => get(token, `runners/${runnerId}`),
    getPipelines: (token, id, ref, perPage = 1) => get(token, `projects/${id}/pipelines?ref=${enc(ref)}&per_page=${perPage}`),
    listPipelines: (token, id, ref, perPage) => get(token, `projects/${id}/pipelines?per_page=${perPage}${ref ? `&ref=${enc(ref)}` : ''}`),
    getPipelineJobs: (token, id, pipelineId) => get(token, `projects/${id}/pipelines/${pipelineId}/jobs?per_page=100`),
    retryPipeline: (token, id, pipelineId) => send(token, 'POST', `projects/${id}/pipelines/${pipelineId}/retry`),
    cancelPipeline: (token, id, pipelineId) => send(token, 'POST', `projects/${id}/pipelines/${pipelineId}/cancel`),
    cancelJob: (token, id, jobId) => send(token, 'POST', `projects/${id}/jobs/${jobId}/cancel`),
    async getJobTrace(token, id, jobId) {
      const res: Response = await appFetch({ url: base, token, method: 'GET', path: `projects/${id}/jobs/${jobId}/trace`, json: false })
      return res.ok ? await res.text() : ''
    },

    listHooks: (token, id) => get(token, `projects/${id}/hooks?per_page=100`),
    // `secret` is GitLab's "Secret Token": it is sent back as the `X-Gitlab-Token` header, which the receiver compares with it.
    createHook: (token, id, { url: hookUrl, secret, branch = 'main' }) =>
      send(token, 'POST', `projects/${id}/hooks`, {
        url: hookUrl,
        token: secret,
        push_events: true,
        push_events_branch_filter: branch,
        enable_ssl_verification: !hookUrl.startsWith('http://')
      })
  }
}

/** A failure that says a branch already exists (GitLab answers 400, 409 or 422 with that message). */
export const isBranchAlreadyExistsError = (error: unknown): boolean => {
  const failure = error as { response?: { status?: number }, status?: number, message?: string } | undefined
  const status = failure?.response?.status ?? failure?.status ?? 0
  if (![400, 409, 422].includes(status)) return false
  return /already exists/i.test(String(failure?.message ?? ''))
}
