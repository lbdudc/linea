import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { ACCESS } from '../access.js'
import { cleanEnv } from './git.js'
import { ensureHooks } from './hooks.js'
import { LocalProvider, slug, type LocalUser } from './provider.js'

export interface LocalGitHttpOptions {
  provider: LocalProvider
  /** Whose git credentials these are (the account's username, and the password or personal git token it gave): `null` refuses. */
  authenticate: (username: string, password: string) => LocalUser | null | Promise<LocalUser | null>
  /** Called after a push was received, with the repository and who pushed. */
  onPush?: ((push: { repositoryId: number, repositoryPath: string, username: string }) => void | Promise<void>) | undefined
  /** Called when credentials were wrong, to count attempts (`ip`, the username tried). */
  onFailure?: ((attempt: { ip: string, username: string }) => void) | undefined
  /** Refuses a request before anything is checked (a rate limit): the reason to answer 429 with, or null. */
  throttle?: ((request: { ip: string, username: string }) => string | null) | undefined
  /** A transfer that moves nothing for this long is cut (default 10 minutes). */
  idleTimeoutMs?: number | undefined
  /** The most a single push may send (git's `receive.maxInputSize`); none by default. */
  maxPushBytes?: number | undefined
}

// the repository ends at the last `.git` that is followed by what git asks for (so a group may be called `a.git`)
const REQUEST = /^\/(.+)\.git(\/(?:info\/refs|git-upload-pack|git-receive-pack|HEAD|objects\/.*))?$/

const refuse = (res: ServerResponse, status: number, message: string, challenge = false): void => {
  res.writeHead(status, { 'Content-Type': 'text/plain', ...(challenge ? { 'WWW-Authenticate': 'Basic realm="LINEA git"' } : {}) })
  res.end(`${message}\n`)
}

/**
 * Git over HTTP for the repositories of the local host, so `git clone`, `git pull` and `git push` (and the CLI, and the agents) work on
 * them as on any other host. The transport is `git http-backend`, the CGI git ships with: the protocol is git's own. It is mounted at
 * a path (`/git`) and sees the rest of the URL: `/<group>/<name>.git/info/refs?service=git-upload-pack`.
 *
 * Every request asks for credentials (Basic); `authenticate` says whose they are.
 */
export const createLocalGitHttp = ({ provider, authenticate, onPush, onFailure, throttle, idleTimeoutMs = 10 * 60 * 1000, maxPushBytes }: LocalGitHttpOptions) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return refuse(res, 400, 'Malformed address')
    }
    const match = REQUEST.exec(pathname)
    if (!match) return refuse(res, 404, 'Not a repository')

    const header = req.headers.authorization ?? ''
    const [scheme, encoded] = header.split(' ')
    if (scheme?.toLowerCase() !== 'basic' || !encoded) return refuse(res, 401, 'Sign in to fetch or push', true)
    const [username = '', ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':')
    const ip = req.socket.remoteAddress ?? '127.0.0.1'
    const blocked = throttle?.({ ip, username })
    if (blocked) return refuse(res, 429, blocked)
    const user = await authenticate(username, rest.join(':'))
    if (!user) {
      onFailure?.({ ip, username })
      return refuse(res, 401, 'Wrong username or password', true)
    }

    const repositoryPath = match[1] as string
    const lookup = await provider.store.read((state) => {
      for (const repository of state.repositories) {
        const namespace = state.namespaces.find((candidate) => candidate.id === repository.namespaceId)
        if (namespace && `${namespace.path}/${slug(repository.name)}` === repositoryPath) return { state, repository }
      }
      return null
    })
    if (!lookup) return refuse(res, 404, 'There is no such repository')
    const found = lookup.repository

    // the same levels the API uses: reading needs a reporter, pushing a developer; the hook adds the rules of the default branch
    const isPush = pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack'
    const level = provider.levelFor(lookup.state, found, user)
    if (level < (isPush ? ACCESS.DEVELOPER : ACCESS.REPORTER)) return refuse(res, 403, isPush ? 'You are not allowed to push here' : 'You are not allowed to read this repository')

    const root = path.join(provider.store.dir, 'repos')
    const env = cleanEnv({
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: `/${found.id}.git${match[2] ?? ''}`,
      REQUEST_METHOD: req.method ?? 'GET',
      QUERY_STRING: url.searchParams.toString(),
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      REMOTE_USER: user.username,
      REMOTE_ADDR: ip,
      GIT_COMMITTER_NAME: user.username,
      GIT_COMMITTER_EMAIL: `${user.username}@linea.local`,
      // the rules every push meets, set here and not in each repository (so repositories made before them have them too)
      GIT_CONFIG_COUNT: maxPushBytes ? '2' : '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: ensureHooks(provider.store.dir),
      ...(maxPushBytes ? { GIT_CONFIG_KEY_1: 'receive.maxInputSize', GIT_CONFIG_VALUE_1: String(maxPushBytes) } : {}),
      LINEA_PUSH_LEVEL: String(level)
    }) as Record<string, string>
    if (req.headers['content-length']) env['CONTENT_LENGTH'] = req.headers['content-length']
    if (req.headers['content-encoding']) env['HTTP_CONTENT_ENCODING'] = String(req.headers['content-encoding'])

    const closesIssues = isPush && req.method === 'POST'
    const headBefore = closesIssues ? await provider.defaultBranchHead(found.id).catch(() => null) : null

    const child = spawn('git', ['http-backend'], { env, windowsHide: true })
    child.stderr.resume()
    child.stdin.on('error', () => undefined)

    // a client that goes away takes its git with it, and a transfer that stops is cut: nothing is left waiting for ever
    let idle: NodeJS.Timeout | undefined
    const touch = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => child.kill('SIGKILL'), idleTimeoutMs)
    }
    touch()
    const stop = (): void => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
    req.on('aborted', stop)
    res.on('close', () => { if (!res.writableEnded) stop() })
    req.on('data', touch)
    req.pipe(child.stdin)

    // the CGI answers with its headers (one of them `Status`), a blank line and the body
    let head = Buffer.alloc(0)
    let sent = false
    const send = (chunk: Buffer): void => {
      // a slow client slows git down, not the memory of the server
      if (!res.write(chunk)) {
        child.stdout.pause()
        res.once('drain', () => child.stdout.resume())
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      touch()
      if (sent) { send(chunk); return }
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) return
      const headers: Record<string, string> = {}
      let status = 200
      for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const name = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim()
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10) || 200
        else headers[name] = value
      }
      res.writeHead(status, headers)
      sent = true
      send(head.subarray(end + 4))
    })
    child.on('error', () => { clearTimeout(idle); if (!sent) refuse(res, 500, 'git is not available') })
    child.on('close', (code) => {
      clearTimeout(idle)
      if (!sent) refuse(res, 500, 'git http-backend answered nothing')
      else res.end()
      // only a push that git accepted is an event
      if (code === 0 && closesIssues) {
        void provider.defaultBranchHead(found.id)
          .then((headAfter) => (headAfter && headAfter !== headBefore ? provider.closeIssuesOfPush({ repositoryId: found.id, before: headBefore, after: headAfter }) : []))
          .catch(() => undefined)
      }
      if (code === 0 && isPush && onPush && req.method === 'POST') void Promise.resolve(onPush({ repositoryId: found.id, repositoryPath, username: user.username })).catch(() => undefined)
    })
  }
