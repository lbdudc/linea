import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { GitAuthError, GitError } from '../errors.js'

const TIMEOUT_MS = 30000
const MAX_RETRIES = 3
const MAX_WAIT_MS = 30000
const CACHE_LIMIT = 1000

type Json = any

// Answers to GET requests, kept with their ETag. GitHub does not count a request answered "304 not modified" against the rate limit,
// so asking again (the same repository, the same file) costs nothing. Per token: what one user may read is not for another.
const cache = new Map<string, { etag: string, json: Json }>()
const remember = (key: string, entry: { etag: string, json: Json }): void => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, entry)
}
const tokenKey = (token: string | undefined): string => crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 12)

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Whether GitHub is telling us to slow down, and for how long (ms). */
const throttle = (response: Response, message: string | undefined): number | null => {
  const retryAfter = response.headers.get('retry-after')
  const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
  const secondary = /rate limit/i.test(message ?? '')
  if (response.status !== 429 && !(response.status === 403 && (retryAfter !== null || exhausted || secondary))) return null
  if (retryAfter !== null) return Math.min(MAX_WAIT_MS, Number(retryAfter) * 1000)
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  if (exhausted && reset) return Math.min(MAX_WAIT_MS, Math.max(0, reset * 1000 - Date.now()) + 500)
  return 1000
}

export interface GitHubClientOptions {
  apiUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * The GitHub REST API: JSON in and out, errors in LINEA's terms (401 is an expired token, anything else a `GitError` with its status),
 * conditional requests for what was read before, and a wait-and-retry when GitHub says the limit has been reached.
 */
export class GitHubClient {
  private readonly apiUrl: string
  private readonly doFetch: typeof fetch
  private readonly timeoutMs: number

  constructor({ apiUrl, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }: GitHubClientOptions) {
    this.apiUrl = apiUrl.replace(/\/+$/, '')
    this.doFetch = fetchImpl
    this.timeoutMs = timeoutMs
  }

  private urlOf(path: string): string {
    return path.startsWith('http') ? path : `${this.apiUrl}${path}`
  }

  private async send({ token, method, path, body, accept }: { token: string | undefined, method: string, path: string, body?: unknown, accept?: string }): Promise<{ response: Response, json?: Json, cached?: boolean }> {
    const url = this.urlOf(path)
    const cacheKey = method === 'GET' && !accept ? `${tokenKey(token)}|${url}` : null
    const cached = cacheKey === null ? undefined : cache.get(cacheKey)
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        Accept: accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'linea',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {})
      }
      let response: Response
      try {
        response = await this.doFetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs)
        })
      } catch (error) {
        const failure = error as Error
        if (failure.name === 'TimeoutError' || failure.name === 'AbortError') {
          throw new GitError(`GitHub request timed out after ${this.timeoutMs}ms: ${method} ${path}`)
        }
        throw new GitError(failure.message ?? String(error))
      }
      if (response.status === 304 && cached) return { response, json: cached.json, cached: true }
      if (response.ok) return { response }

      let detail: Json = {}
      try {
        const text = await response.text()
        detail = text ? JSON.parse(text) : {}
      } catch {
        detail = {}
      }
      const wait = throttle(response, detail.message)
      if (wait !== null && attempt < MAX_RETRIES) {
        await sleep(wait)
        continue
      }
      if (response.status === 401) throw new GitAuthError(detail.message)
      const errors = ((detail.errors ?? []) as Json[]).map((e) => e.message ?? e.code).filter(Boolean).join('; ')
      throw new GitError(`${detail.message ?? response.statusText}${errors ? ` (${errors})` : ''}`, response.status)
    }
  }

  /** A JSON answer (`null` for "no content"). */
  async json({ token, method = 'GET', path, body }: { token: string | undefined, method?: string, path: string, body?: unknown }): Promise<Json> {
    const { response, json, cached } = await this.send({ token, method, path, body })
    if (cached) return json
    if (response.status === 204) return null
    const parsed = await response.json()
    if (method === 'GET') {
      const etag = response.headers.get('etag')
      if (etag) remember(`${tokenKey(token)}|${this.urlOf(path)}`, { etag, json: parsed })
    }
    return parsed
  }

  /** The bytes of a file (`null` when there is none). */
  async raw({ token, path }: { token: string | undefined, path: string }): Promise<Buffer | null> {
    try {
      const { response } = await this.send({ token, method: 'GET', path, accept: 'application/vnd.github.raw+json' })
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  /** A stream of the body of the answer (an archive). */
  async stream({ token, path }: { token: string | undefined, path: string }): Promise<Readable> {
    const { response } = await this.send({ token, method: 'GET', path, accept: 'application/vnd.github+json' })
    return Readable.fromWeb(response.body as never)
  }

  /** Every item of a list, page after page. */
  async paginate({ token, path, perPage = 100 }: { token: string | undefined, path: string, perPage?: number }): Promise<Json[]> {
    const all: Json[] = []
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?'
      const batch = (await this.json({ token, path: `${path}${separator}per_page=${perPage}&page=${page}` })) as Json[]
      all.push(...batch)
      if (batch.length < perPage) return all
    }
  }
}

export const clearGitHubCache = (): void => cache.clear()
