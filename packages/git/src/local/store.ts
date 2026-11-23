import fs from 'node:fs'
import path from 'node:path'

/**
 * What the `local` host knows about its repositories besides what git keeps: the namespaces (groups), who is in a repository, its
 * topics, its change requests and webhooks. One JSON file next to the repositories, read and written whole, one operation at a time.
 * (A host with many writers would use a database; this one is the server of one team.)
 */

export interface ThreadRecord {
  id: number
  position?: { path: string, line: number, side: 'new' | 'old' }
  resolved: boolean
  comments: CommentRecord[]
}

export interface ChangeRequestRecord {
  number: number
  title: string
  sourceBranch: string
  targetBranch: string
  state: 'opened' | 'merged' | 'closed'
  createdAt: string
  // (absent in a state written before the pages of merge requests existed)
  description?: string
  author?: string
  labels?: string[]
  reviewers?: string[]
  updatedAt?: string
  mergedAt?: string | null
  threads?: ThreadRecord[]
  nextThread?: number
  nextComment?: number
}

export interface CommentRecord {
  id: number
  author: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface IssueRecord {
  number: number
  title: string
  description: string
  state: 'opened' | 'closed'
  author: string
  assignees: string[]
  labels: string[]
  milestone: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  comments: CommentRecord[]
  nextComment: number
  /** The labels put on it and taken off it (older issues have none). */
  labelEvents?: LabelEventRecord[]
}

export interface LabelEventRecord {
  label: string
  action: 'added' | 'removed'
  author: string
  createdAt: string
}

export interface TemplateRecord {
  name: string
  content: string
}

export interface ReleaseRecord {
  tag: string
  name: string
  description: string
  prerelease: boolean
  createdAt: string
}

export interface NamespaceRecord {
  id: number
  name: string
  /** `group/sub`: what the host shows as the path. */
  path: string
  parentId: number | null
  owner: string
}

export interface RepositoryRecord {
  id: number
  name: string
  namespaceId: number
  description: string
  topics: string[]
  defaultBranch: string
  owner: string
  members: { username: string, accessLevel: number }[]
  changeRequests: ChangeRequestRecord[]
  nextChangeRequest: number
  /** (absent in a state written before issues existed) */
  issues?: IssueRecord[]
  nextIssue?: number
  /** (absent in a state written before releases existed) */
  releases?: ReleaseRecord[]
  templates?: { issue: TemplateRecord[], mergeRequest: TemplateRecord[] }
  hooks: { url: string, secret: string, branch: string | null }[]
  createdAt: string
}

export interface State {
  next: number
  namespaces: NamespaceRecord[]
  repositories: RepositoryRecord[]
}

const EMPTY: State = { next: 1, namespaces: [], repositories: [] }

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

// operations on one folder run one after another, whoever asks (the file is rewritten whole)
const queues = new Map<string, Promise<unknown>>()

// Another process on the same folder (the CLI, a second server) must not write at the same time: a lock file next to the state, taken
// for each change. A lock left by a process that died is taken over after STALE_MS.
export const STALE_MS = 30_000
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class LocalStore {
  readonly dir: string
  private readonly file: string
  private readonly lock: string

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir)
    this.file = path.join(this.dir, 'state.json')
    this.lock = `${this.file}.lock`
  }

  /** Where the bare repository of `id` is. */
  repositoryDir(id: number): string {
    return path.join(this.dir, 'repos', `${id}.git`)
  }

  // The state as it was last read, and which file that was (a rewrite is a new inode, so another process's write is seen too): a read that
  // finds the file as it was does not parse it again. Frozen, because it is shared: whoever changes the state does it in `update`, on a copy.
  private cached: { signature: string, state: State } | null = null
  private recovered = false

  private parse(file: string): State {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as State
  }

  private signature(): string | null {
    try {
      const stat = fs.statSync(this.file)
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}`
    } catch {
      return null
    }
  }

  private load(): State {
    const signature = this.signature()
    if (signature && this.cached?.signature === signature) return this.cached.state
    this.recovered = false
    const state = this.read_()
    // (a copy recovered from a file that could not be read is not remembered: the file is still damaged)
    if (signature && !this.recovered && this.signature() === signature) this.cached = { signature, state: deepFreeze(state) }
    else this.cached = null
    return this.cached?.state ?? state
  }

  private read_(): State {
    try {
      return this.parse(this.file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY)
      // a file that cannot be read (a write cut short, a disk that lied): the last good copy, if there is one, rather than a host that is down
      try {
        const recovered = this.parse(`${this.file}.bak`)
        this.recovered = true
        console.error(`[local git] ${this.file} could not be read (${(error as Error).message}): using the last good copy`)
        return recovered
      } catch {
        throw new Error(`${this.file} is damaged and there is no copy to recover from: ${(error as Error).message}`)
      }
    }
  }

  read<T>(fn: (state: State) => T): Promise<T> {
    return this.queue(() => fn(this.load()))
  }

  private async lockFile(): Promise<() => void> {
    fs.mkdirSync(this.dir, { recursive: true })
    for (let attempt = 0; ; attempt += 1) {
      try {
        const fd = fs.openSync(this.lock, 'wx')
        fs.writeSync(fd, String(process.pid))
        fs.closeSync(fd)
        return () => fs.rmSync(this.lock, { force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let age = 0
        try { age = Date.now() - fs.statSync(this.lock).mtimeMs } catch { continue }
        if (age > STALE_MS) { fs.rmSync(this.lock, { force: true }); continue }
        if (attempt > 600) throw new Error(`${this.lock} is held by another process`)
        await sleep(20)
      }
    }
  }

  /** Writes the state so that a cut leaves the old file or the new one, never half: to a temporary file, to disk, over the old. */
  private write(state: State): void {
    const tmp = `${this.file}.${process.pid}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, JSON.stringify(state, null, 2))
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    // the file that is about to be replaced is the last good one
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`)
    fs.renameSync(tmp, this.file)
    this.cached = null
    try {
      const directory = fs.openSync(this.dir, 'r')
      fs.fsyncSync(directory)
      fs.closeSync(directory)
    } catch { /* a platform that cannot sync a folder */ }
  }

  /** Changes the state: `fn` gets it and returns what the caller wants back; what it changed is saved when it is done. */
  update<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    return this.queue(async () => {
      const release = await this.lockFile()
      try {
        const state = structuredClone(this.load()) // a copy: `fn` may change it and then fail
        const before = JSON.stringify(state)
        const result = await fn(state)
        if (JSON.stringify(state) !== before) this.write(state)
        return result
      } finally {
        release()
      }
    })
  }

  private queue<T>(run: () => T | Promise<T>): Promise<T> {
    const previous = queues.get(this.file) ?? Promise.resolve()
    const current = previous.then(run, run)
    queues.set(this.file, current.catch(() => undefined))
    return current
  }

  /** Adds (or raises) a person's access to a repository: how an administrator lets someone else in. */
  addMember({ repositoryId, username, accessLevel }: { repositoryId: number | string, username: string, accessLevel: number }): Promise<void> {
    return this.update((state) => {
      const repository = state.repositories.find((candidate) => candidate.id === Number(repositoryId))
      if (!repository) throw Object.assign(new Error('There is no such repository'), { status: 404 })
      const known = repository.members.find((member) => member.username === username)
      if (known) known.accessLevel = accessLevel
      else repository.members.push({ username, accessLevel })
    })
  }
}
