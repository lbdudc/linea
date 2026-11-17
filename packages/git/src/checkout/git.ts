import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The git of your machine, run as `git` does. Arguments only (never a shell line), and no prompts: a command that cannot go on says
 * why instead of waiting for a person.
 */

export interface GitResult {
  status: number
  stdout: string
  stderr: string
}

/**
 * How git is run: it never asks a person. `GIT_TERMINAL_PROMPT=0` is not enough: an editor's terminal (VS Code) sets `GIT_ASKPASS` for
 * every git it starts, and git reaches that program even with prompts off, which shows as a login box at the top of the editor, once
 * per repository. An empty `GIT_ASKPASS` takes it away (and with it `SSH_ASKPASS`), so what git cannot get from the credential helper
 * is a failure with a message, not a question.
 */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', LC_ALL: 'C' }

const notFound = (e: Error): Error =>
  new Error((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'git is not installed or not on your PATH (https://git-scm.com).' : e.message)

/** git, and wait for it (for what is quick and local: status, add, commit). Anything that goes over the network uses `gitAsync`. */
export function git (cwd: string | undefined, args: string[], opts: { input?: string } = {}): GitResult {
  const res = spawnSync('git', args, {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env, ...GIT_ENV },
    windowsHide: true
  })
  if (res.error) throw notFound(res.error)
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/**
 * git, without holding everything up (a window keeps drawing while a clone or a push runs). `onProgress` gets what git says as it
 * goes ("Receiving objects: 45%"), one line at a time: ask for it with `--progress`.
 */
export function gitAsync (cwd: string | undefined, args: string[], opts: { onProgress?: (line: string) => void, env?: Record<string, string>, input?: string } = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { ...(cwd ? { cwd } : {}), env: { ...process.env, ...GIT_ENV, ...opts.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let partial = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString('utf8')
      stderr += chunk
      if (!opts.onProgress) return
      // progress is redrawn in place with carriage returns: the last whole line is what is happening now
      const lines = (partial + chunk).split(/[\r\n]+/)
      partial = lines.pop() ?? ''
      const last = lines.filter((l) => l.trim()).pop()
      if (last) opts.onProgress(last.trim())
    })
    child.on('error', (e) => reject(notFound(e)))
    child.on('close', (code) => resolve({ status: code ?? 1, stdout, stderr }))
    child.stdin.on('error', () => { /* git did not read what it was sent */ })
    child.stdin.end(opts.input)
  })
}

/** What git says when the host did not accept who it is talking to (or nobody told it). */
const AUTH_FAILURE = /could not read (Username|Password)|Authentication failed|Access denied|terminal prompts disabled|HTTP 40[13]|returned error: 40[13]/i

/** Whether what git said is an authentication failure. */
export const isAuthFailure = (said: string): boolean => AUTH_FAILURE.test(said)

/** What git said, without the credentials of an address in it. */
export const withoutCredentials = (said: string): string => said.replace(/https?:\/\/[^@\s/]+@/g, 'https://')

/** A failed git command: what git said, and whether that was the host refusing access (`denied`). */
export class GitCommandError extends Error {
  constructor (readonly command: string, readonly said: string) {
    super(`git ${command} failed: ${said}`)
    this.name = 'GitCommandError'
  }

  get denied (): boolean {
    return isAuthFailure(this.said)
  }
}

/** The git command that was run, not the options before it: `clone` for `-c credential…=… clone …`. */
const subcommand = (args: string[]): string => {
  let i = 0
  while (args[i] === '-c') i += 2
  return args[i] ?? 'command'
}

const failure = (args: string[], res: GitResult): GitCommandError => {
  // what git says first ("Cloning into …") is not what went wrong
  const said = withoutCredentials((res.stderr || res.stdout).trim())
    .split(/\r?\n/)
    .filter((line) => !/^Cloning into /.test(line))
    .join('\n')
  return new GitCommandError(subcommand(args), said || `exit ${res.status}`)
}

/** `git`, and the output; a failure throws a `GitCommandError`. */
export function gitOk (cwd: string | undefined, args: string[]): string {
  const res = git(cwd, args)
  if (res.status !== 0) throw failure(args, res)
  return res.stdout
}

/** `gitAsync`, and the output; a failure throws a `GitCommandError`. */
export async function gitOkAsync (cwd: string | undefined, args: string[], opts: { onProgress?: (line: string) => void } = {}): Promise<string> {
  const res = await gitAsync(cwd, args, opts)
  if (res.status !== 0) throw failure(args, res)
  return res.stdout
}

/**
 * Whether git can read a repository with this username and token, as it will when it uses them: the answer to "is this token good for
 * git?", which is not the same as "is it good for the host's API?" (a GitLab token needs `read_repository`, or `api`, for git). The
 * token goes to git in its environment, not on a command line others can read, and nothing is kept.
 */
export async function checkGitAccess (url: string, username: string, token: string): Promise<{ ok: true } | { ok: false, said: string }> {
  const basic = Buffer.from(`${username}:${token}`).toString('base64')
  const res = await gitAsync(undefined, ['-c', 'credential.helper=', 'ls-remote', '--heads', url], {
    env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` }
  })
  return res.status === 0 ? { ok: true } : { ok: false, said: withoutCredentials((res.stderr || res.stdout).trim()) }
}

export function isRepo (dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'))
  } catch {
    return false
  }
}

/** The address `git` clones from for a repository the host shows at `webUrl`: the same, plus `.git` (GitLab and GitHub both). */
export const cloneUrlOf = (webUrl: string): string => `${webUrl.replace(/\/+$/, '').replace(/\.git$/, '')}.git`

// ---------------------------------------------------------------- credentials for git

const originOf = (url: string): string | undefined => {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * `-c` options that make git use a credential helper (`helper`: what git runs, as `credential.helper` says: `!program args`) for a
 * command that has no repository yet (clone). For the whole command, not for the host in it: an empty `credential.helper` forgets every
 * helper there is (the system's Git Credential Manager included, which may hold an old password for this host and answer before ours is
 * asked), and the helper given is the only one left.
 */
export function credentialOptions (url: string, helper: string): string[] {
  return originOf(url) ? ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`] : []
}

/** The same, kept in the repository's own config, so `git pull/push` there find the token as well. */
export function configureCredentials (dir: string, url: string, helper: string): void {
  const origin = originOf(url)
  if (!origin) return
  const key = `credential.${origin}.helper`
  git(dir, ['config', '--local', '--unset-all', key])
  gitOk(dir, ['config', '--local', '--add', key, '']) // an empty one forgets the helpers of the system
  gitOk(dir, ['config', '--local', '--add', key, helper])
}

// ---------------------------------------------------------------- state

export interface RepoState {
  dir: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  clean: boolean
}

/** Where a checkout stands: branch, how far from its upstream, and what is changed. */
export function repoState (dir: string): RepoState {
  const out = gitOk(dir, ['status', '--porcelain=v2', '--branch', '--untracked-files=all'])
  const state: RepoState = { dir, branch: '(detached)', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, clean: true }
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) state.branch = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.upstream ')) state.upstream = line.slice('# branch.upstream '.length)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        state.ahead = Number(m[1])
        state.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') state.staged++
      if (xy[1] !== '.') state.unstaged++
    } else if (line.startsWith('? ')) state.untracked++
  }
  state.clean = !(state.staged + state.unstaged + state.untracked)
  return state
}

export const changedCount = (s: RepoState): number => s.staged + s.unstaged + s.untracked

/** A word for a branch name out of a sentence. */
export function slug (text: string, max = 40): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, max).replace(/-+$/, '') || 'changes'
}
