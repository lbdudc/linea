import { spawn } from 'node:child_process'

/** An error as the services read it: `status` is the HTTP status the same failure has on the other hosts. */
export class LocalError extends Error {
  readonly status: number
  readonly code: string | undefined
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'LocalError'
    this.status = status
    this.code = code
  }
}

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

export interface RunOptions {
  input?: Buffer | string
  env?: Record<string, string | undefined>
  cwd?: string
}

// what git is given of the server's environment: it finds itself and its home, nothing else (the server's secrets stay out of it)
const KEEP = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'LANG', 'LC_ALL', 'TZ']
export const cleanEnv = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  ...Object.fromEntries(KEEP.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
  GIT_TERMINAL_PROMPT: '0',
  ...extra
})

/** Runs git in a bare repository. A non-zero exit is a result, not an error: callers decide what it means. */
export const git = (dir: string, args: string[], { input, env, cwd }: RunOptions = {}): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: cwd ?? dir,
      env: cleanEnv({ GIT_DIR: dir, ...env }) as NodeJS.ProcessEnv,
      windowsHide: true
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }))
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

/** Like `git`, but a non-zero exit throws. */
export const gitOk = async (dir: string, args: string[], options: RunOptions = {}): Promise<Buffer> => {
  const result = await git(dir, args, options)
  if (result.code !== 0) throw new LocalError(`git ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`, 500)
  return result.stdout
}

export const gitText = async (dir: string, args: string[], options: RunOptions = {}): Promise<string> =>
  (await gitOk(dir, args, options)).toString('utf8').trim()

/** Who a commit is by: the person it was made for. */
export const identity = (username: string): Record<string, string> => ({
  GIT_AUTHOR_NAME: username,
  GIT_AUTHOR_EMAIL: `${username}@linea.local`,
  GIT_COMMITTER_NAME: username,
  GIT_COMMITTER_EMAIL: `${username}@linea.local`
})
