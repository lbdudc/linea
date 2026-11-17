import { hostDescriptor } from '../host.js'
import fs from 'node:fs'
import path from 'node:path'
import { findContext, readOrigin, writeOrigin, excludeFromGit, type Origin } from '@lbdudc/linea-core/workspace'
import type { GitProvider } from '../provider.js'
import { KIND_DEFINITIONS, type PackageKind } from '../registry/kinds.js'
import {
  GitCommandError, changedCount, cloneUrlOf, configureCredentials, credentialOptions, git, gitAsync, gitOk, gitOkAsync, isAuthFailure, isRepo, repoState,
  slug, withoutCredentials, type RepoState
} from './git.js'

/**
 * Checkouts: an SPL cloned from the host, and the products cloned inside it, as the repositories they are. What `get`, `status` and
 * `push` of a program are made of; the program says it in words. Every call takes `helper`, what git runs as its credential helper
 * (see `credentialOptions`), because what that is depends on the program.
 */

type Progress = (line: string) => void

// ---------------------------------------------------------------- what is where

export interface Checkout {
  name: string
  kind: 'spl' | 'product'
  dir: string
  /** for a product: the SPL it sits in */
  lineDir?: string
}

// a product the platform has not generated yet is a repository with a README: it has no spec, but its origin says what it is
const isProductRepo = (dir: string): boolean => isRepo(dir) && (fs.existsSync(path.join(dir, '.linea', 'spec.json')) || readOrigin(dir)?.kind === 'product')

/** The git checkouts of an SPL: itself, and the products cloned into it. */
export function checkoutsOfLine (lineDir: string): Checkout[] {
  const found: Checkout[] = []
  if (isRepo(lineDir)) found.push({ name: path.basename(lineDir), kind: 'spl', dir: lineDir })
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(lineDir, { withFileTypes: true })
  } catch {
    /* gone */
  }
  for (const e of entries.filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(lineDir, e.name)
    if (isProductRepo(dir)) found.push({ name: e.name, kind: 'product', dir, lineDir })
  }
  return found
}

/** The SPLs of a workspace that are git checkouts. */
export function splCheckouts (root: string): Checkout[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    /* none */
  }
  return entries
    .filter((e) => e.isDirectory() && isRepo(path.join(root, e.name)) && findContext(path.join(root, e.name)).line?.dir === path.join(root, e.name))
    .map((e) => ({ name: e.name, kind: 'spl' as const, dir: path.join(root, e.name) }))
}

/**
 * What a command acts on, from where you stand: the product you are in; else the SPL and its products; else the SPLs of the
 * workspace (`fallbackRoot` when the folder is in none).
 */
export function checkoutsAt (cwd: string, fallbackRoot: string): Checkout[] {
  const folder = findContext(cwd)
  if (folder.product && isRepo(folder.product.dir)) {
    return [{ name: folder.product.name, kind: 'product', dir: folder.product.dir, ...(folder.line ? { lineDir: folder.line.dir } : {}) }]
  }
  if (folder.line) return checkoutsOfLine(folder.line.dir)
  return splCheckouts(folder.workspace ?? fallbackRoot)
}

// ---------------------------------------------------------------- clone

/** Clones a repository and leaves it ready for `git pull/push` with the helper; says which branch it started on (the default one). */
export async function cloneRepository ({ url, dest, helper, onProgress }: { url: string, dest: string, helper: string, onProgress?: Progress }): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await gitOkAsync(undefined, [...credentialOptions(url, helper), 'clone', '--progress', url, dest], { ...(onProgress ? { onProgress } : {}) })
  configureCredentials(dest, url, helper)
  return git(dest, ['symbolic-ref', '--short', 'HEAD']).stdout.trim() || 'main'
}

/** What a clone remembers about where it came from, besides the repository itself. */
export type OriginBase = Pick<Origin, 'server' | 'provider' | 'lineId' | 'webUi'>

/** Clones a repository of the host as the SPL it is, and writes where it came from. */
export async function cloneLine ({ dir, base, line, helper, onProgress }: {
  dir: string
  base: OriginBase
  line: { name: string, webUrl: string, repoId: number | string }
  helper: string
  onProgress?: Progress
}): Promise<void> {
  const defaultBranch = await cloneRepository({ url: cloneUrlOf(line.webUrl), dest: dir, helper, ...(onProgress ? { onProgress } : {}) })
  writeOrigin(dir, { ...base, kind: 'spl', name: line.name, projectId: line.repoId, webUrl: line.webUrl, defaultBranch })
}

/** Clones a product of an SPL into the SPL's folder, as a repository of its own that the SPL's git leaves alone. */
export async function cloneProduct ({ lineDir, base, product, helper, onProgress }: {
  lineDir: string
  base: OriginBase
  product: { _id: string, name: string, repo: { id: number | string, webUrl: string } }
  helper: string
  onProgress?: Progress
}): Promise<string> {
  const dir = path.join(lineDir, product.name)
  const defaultBranch = await cloneRepository({ url: cloneUrlOf(product.repo.webUrl), dest: dir, helper, ...(onProgress ? { onProgress } : {}) })
  writeOrigin(dir, { ...base, kind: 'product', name: product.name, productId: product._id, projectId: product.repo.id, webUrl: product.repo.webUrl, defaultBranch })
  excludeFromGit(lineDir, `/${product.name}/`)
  return dir
}

// ---------------------------------------------------------------- pull

export interface PullResult {
  /** `updated`: new commits came; `current`: nothing new; `failed`: see `said` */
  outcome: 'updated' | 'current' | 'failed'
  /** how many commits came */
  commits: number
  /** it has changes of its own and the host moved: they have to be committed before they can be joined */
  changesAndBehind: boolean
  /** what git said when it failed, without credentials */
  said?: string
  /** the failure was the host refusing access */
  denied?: boolean
}

/** `git pull --ff-only` in a checkout. A failure is a result, not an error: the next checkout is still worth updating. */
export async function pullCheckout ({ dir, helper, onProgress }: { dir: string, helper: string, onProgress?: Progress }): Promise<PullResult> {
  const before = repoState(dir)
  const changesAndBehind = Boolean(changedCount(before) && before.behind)
  const url = readOrigin(dir)?.webUrl ?? ''
  const res = await gitAsync(dir, [...credentialOptions(url, helper), 'pull', '--ff-only', '--progress'], { ...(onProgress ? { onProgress } : {}) })
  if (res.status !== 0) {
    const said = withoutCredentials((res.stderr || res.stdout).trim())
    return { outcome: 'failed', commits: 0, changesAndBehind, said, denied: isAuthFailure(said) }
  }
  return { outcome: before.behind ? 'updated' : 'current', commits: before.behind, changesAndBehind }
}

/** Asks the host what is new, without changing anything here (`git fetch`). */
export async function fetchCheckout ({ dir, helper }: { dir: string, helper: string }): Promise<void> {
  await gitAsync(dir, [...credentialOptions(readOrigin(dir)?.webUrl ?? '', helper), 'fetch', '--quiet'])
}

// ---------------------------------------------------------------- push

export interface PushResult {
  /** the branch that was sent */
  branch: string
  /** it went to the default branch itself: there is nothing to merge */
  toDefault: boolean
  /** the merge/pull request opened for it, or why it could not be */
  changeRequest?: { url: string } | { error: string }
}

/** The branch name of changes sent for review: who, what, and when. */
export const reviewBranch = (user: string, message: string, now = new Date()): string =>
  `linea/${slug(user, 20)}/${slug(message, 30)}-${now.toISOString().replace(/[-:T]/g, '').slice(0, 12)}`

/**
 * Commits what changed in a checkout and sends it: to a branch of its own with a merge/pull request (the default), or to the branch
 * it is on (`direct`). Without `changeRequest` (a copy made without the host's help) the branch is sent and nothing is opened.
 * Throws a `GitCommandError` when git could not do something; a request that could not be opened is in the result.
 */
export async function pushCheckout ({ dir, message, direct, user, helper, onProgress, changeRequest }: {
  dir: string
  message: string
  direct?: boolean
  user: string
  helper: string
  onProgress?: Progress
  /** the host's API, to open the request with */
  changeRequest?: { provider: GitProvider, token: string }
}): Promise<PushResult> {
  const before = repoState(dir)
  const origin = readOrigin(dir)
  const defaultBranch = origin?.defaultBranch ?? 'main'
  let branch = before.branch
  if (!direct && branch === defaultBranch) {
    branch = reviewBranch(user, message)
    gitOk(dir, ['checkout', '-b', branch])
  }
  if (changedCount(before)) {
    gitOk(dir, ['add', '-A'])
    gitOk(dir, ['commit', '--quiet', '-m', message])
  }
  await gitOkAsync(dir, [...credentialOptions(origin?.webUrl ?? '', helper), 'push', '--progress', '-u', 'origin', `HEAD:refs/heads/${branch}`], { ...(onProgress ? { onProgress } : {}) })
  const toDefault = Boolean(direct) || branch === defaultBranch
  if (toDefault || !origin || !changeRequest) return { branch, toDefault }
  try {
    const request = await changeRequest.provider.createOrRenameChangeRequest({
      token: changeRequest.token, id: origin.projectId, title: message, sourceBranch: branch, targetBranch: defaultBranch
    })
    return { branch, toDefault, changeRequest: { url: request.webUrl } }
  } catch (e) {
    return { branch, toDefault, changeRequest: { error: (e as Error).message } }
  }
}

/** Whether a checkout has something to send: changes, or commits the host does not have. */
export const hasUnsent = (state: RepoState): boolean => Boolean(changedCount(state) || state.ahead)

// ---------------------------------------------------------------- adopt

const copyTree = (from: string, to: string, skip: (name: string) => boolean): number => {
  let copied = 0
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(entry.name)) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true })
      copied += copyTree(source, target, (n) => n === 'node_modules' || n === '.git')
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
      copied++
    }
  }
  return copied
}

/**
 * Local files that are not part of an SPL when it is uploaded: a repository's own, caches, installed packages, and products (they
 * are repositories of their own).
 */
const notUploaded = (lineDir: string, name: string): boolean =>
  name === '.git' || name === '.linea' || name === 'node_modules' || fs.existsSync(path.join(lineDir, name, '.linea', 'spec.json'))

/**
 * A folder made here becomes the checkout of a repository the host just made for it (with the scaffold of an SPL): what is here goes
 * on top of the scaffold, is committed and sent to the default branch, and the folder takes the repository over. Returns how many files
 * were sent and the default branch.
 */
export async function adoptFolder ({ dir, url, name, helper, onProgress }: { dir: string, url: string, name: string, helper: string, onProgress?: (what: 'getting' | 'uploading', line: string) => void }): Promise<{ copied: number, defaultBranch: string }> {
  const staging = fs.mkdtempSync(path.join(path.dirname(dir), `.${name}-link-`))
  try {
    const defaultBranch = await cloneRepository({ url, dest: staging, helper, ...(onProgress ? { onProgress: (l: string) => onProgress('getting', l) } : {}) })
    const copied = copyTree(dir, staging, (n) => notUploaded(dir, n))
    gitOk(staging, ['add', '-A'])
    if (git(staging, ['status', '--porcelain']).stdout.trim()) {
      gitOk(staging, ['commit', '--quiet', '-m', `Upload ${name} from the command line`])
      await gitOkAsync(staging, [...credentialOptions(url, helper), 'push', '--progress', 'origin', `HEAD:refs/heads/${defaultBranch}`], { ...(onProgress ? { onProgress: (l: string) => onProgress('uploading', l) } : {}) })
    }
    // the folder becomes the checkout: it takes the repository; its files are the ones just committed, plus what the scaffold had
    // that was not here (the README the host makes), which are brought into the folder
    fs.renameSync(path.join(staging, '.git'), path.join(dir, '.git'))
    gitOk(dir, ['checkout', '--quiet', '--', '.'])
    configureCredentials(dir, url, helper)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, '.linea', 'spec.json'))) excludeFromGit(dir, `/${entry.name}/`)
    }
    return { copied, defaultBranch }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- packages

/**
 * Gets a module or metamodel of the git host into a workspace to change it: a clone that remembers where it came from, and where
 * `publish` puts it back (the group on GitLab, the owner on GitHub). `repoPath` is `group/project` as the host knows it. Throws when
 * the host does not know it, or it is not a package of that kind.
 */
export async function clonePackage ({ provider, token, kind, repoPath, workdir, dest, helper, onProgress }: {
  provider: GitProvider
  token: string
  kind: PackageKind
  repoPath: string
  /** the workspace: the package goes to `<workdir>/modules/<name>` or `<workdir>/metamodels/<name>` unless `dest` says */
  workdir: string
  dest?: string
  helper: string
  onProgress?: Progress
}): Promise<{ status: 'cloned' | 'present', name: string, dir: string, publishRoot?: string }> {
  const definition = KIND_DEFINITIONS[kind]
  const repository = await provider.findRepository({ token, path: repoPath })
  if (!repository) throw new Error(`No repository ${repoPath} on ${hostDescriptor(provider.kind).label} (or you cannot see it).`)
  if (!repository.topics.includes(definition.topic)) {
    throw new Error(`${repoPath} is not a ${kind} (its topics are ${repository.topics.join(', ') || 'none'}; a ${kind} has "${definition.topic}").`)
  }
  const dir = dest ?? path.join(workdir, definition.dir, repository.name)
  if (isRepo(dir) && readOrigin(dir)) return { status: 'present', name: repository.name, dir }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} exists and is not empty.`)
  await cloneRepository({ url: cloneUrlOf(repository.webUrl), dest: dir, helper, ...(onProgress ? { onProgress } : {}) })

  // where to publish it again: GitLab keeps them under <group>/modules and <group>/metamodels, GitHub as repositories of an owner
  const parts = repository.path.split('/')
  const publishRoot = provider.kind === 'github' ? parts[0] : parts.at(-2) === definition.dir ? parts.slice(0, -2).join('/') : undefined
  writeOrigin(dir, {
    kind, name: repository.name, provider: provider.kind === 'github' ? 'github' : 'gitlab', projectId: repository.id, webUrl: repository.webUrl,
    defaultBranch: repository.defaultBranch ?? 'main', ...(publishRoot ? { publishRoot } : {})
  })
  return { status: 'cloned', name: repository.name, dir, ...(publishRoot ? { publishRoot } : {}) }
}
