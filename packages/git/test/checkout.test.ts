import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeOrigin } from '@lbdudc/linea-core/workspace'
import {
  GitCommandError, changedCount, checkoutsAt, cloneRepository, git, gitOk, hasUnsent, isAuthFailure, isRepo, pullCheckout, pushCheckout, repoState,
  reviewBranch, slug
} from '../src/index.js'

const made: string[] = []
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-checkout-')))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
const commit = (dir: string, file: string, content: string, message = 'change'): void => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), content)
  gitOk(dir, ['add', '-A'])
  gitOk(dir, [...identity, 'commit', '--quiet', '-m', message])
}

/** A bare repository with one commit on `main`, as the host would have it; returns where to clone it from. */
const host = (): string => {
  const bare = path.join(tmp(), 'host.git')
  gitOk(undefined, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  const seed = tmp()
  gitOk(seed, ['init', '--quiet', '--initial-branch=main'])
  commit(seed, 'README.md', '# shop\n', 'first')
  gitOk(seed, ['push', '--quiet', bare, 'main'])
  return bare
}

// a local path is not an http address: git needs no credential for it, which is what these tests want
const NO_HELPER = '!true'

describe('words for a branch', () => {
  it('slug and reviewBranch say who, what and when', () => {
    expect(slug('Add the Auth module!')).toBe('add-the-auth-module')
    expect(slug('???')).toBe('changes')
    expect(reviewBranch('Ana Díaz', 'Fix: models', new Date('2026-01-02T03:04:05Z'))).toBe('linea/ana-d-az/fix-models-202601020304')
  })

  it('recognises what git says when the host refuses', () => {
    expect(isAuthFailure("fatal: could not read Username for 'https://host': terminal prompts disabled")).toBe(true)
    expect(isAuthFailure('fatal: not a git repository')).toBe(false)
  })
})

describe('a checkout, from clone to push', () => {
  it('clones, sees what changed, and pushes it to a branch of its own', async () => {
    const bare = host()
    const dir = path.join(tmp(), 'shop')
    const branch = await cloneRepository({ url: bare, dest: dir, helper: NO_HELPER })
    expect(branch).toBe('main')
    expect(isRepo(dir)).toBe(true)
    writeOrigin(dir, { kind: 'spl', name: 'shop', provider: 'gitlab', projectId: 1, webUrl: 'https://host/shop', defaultBranch: 'main' })

    expect(hasUnsent(repoState(dir))).toBe(false)
    fs.writeFileSync(path.join(dir, 'new.txt'), 'hello\n')
    const state = repoState(dir)
    expect(changedCount(state)).toBe(1)
    expect(hasUnsent(state)).toBe(true)

    const sent = await pushCheckout({ dir, message: 'Add new file', user: 'ana', helper: NO_HELPER })
    expect(sent.toDefault).toBe(false)
    expect(sent.branch).toMatch(/^linea\/ana\/add-new-file-\d{12}$/)
    expect(sent.changeRequest).toBeUndefined() // no provider was given to open one
    expect(git(bare, ['branch', '--list', sent.branch]).stdout).toContain(sent.branch)
  })

  it('pushes straight to the branch it is on with direct', async () => {
    const bare = host()
    const dir = path.join(tmp(), 'shop')
    await cloneRepository({ url: bare, dest: dir, helper: NO_HELPER })
    writeOrigin(dir, { kind: 'spl', name: 'shop', provider: 'gitlab', projectId: 1, webUrl: 'https://host/shop', defaultBranch: 'main' })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    const sent = await pushCheckout({ dir, message: 'a', direct: true, user: 'ana', helper: NO_HELPER })
    expect(sent).toMatchObject({ branch: 'main', toDefault: true })
  })

  it('pulls what the host has, says there is nothing new, and reports a failure instead of throwing', async () => {
    const bare = host()
    const mine = path.join(tmp(), 'mine')
    const theirs = path.join(tmp(), 'theirs')
    await cloneRepository({ url: bare, dest: mine, helper: NO_HELPER })
    await cloneRepository({ url: bare, dest: theirs, helper: NO_HELPER })
    writeOrigin(mine, { kind: 'spl', name: 'shop', provider: 'gitlab', projectId: 1, webUrl: 'https://host/shop', defaultBranch: 'main' })

    expect((await pullCheckout({ dir: mine, helper: NO_HELPER })).outcome).toBe('current')
    commit(theirs, 'x.txt', 'x\n')
    gitOk(theirs, ['push', '--quiet', 'origin', 'main'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    // the host moved and has not been asked: a fetch tells git, a pull both asks and joins
    const pulled = await pullCheckout({ dir: mine, helper: NO_HELPER })
    expect(pulled).toMatchObject({ outcome: 'current', commits: 0 }) // behind is known only after a fetch: the pull brings it in
    expect(fs.existsSync(path.join(mine, 'x.txt'))).toBe(true)

    // diverged: a commit of mine and one of theirs
    commit(mine, 'mine.txt', 'm\n')
    commit(theirs, 'y.txt', 'y\n')
    gitOk(theirs, ['push', '--quiet', 'origin', 'main'])
    const diverged = await pullCheckout({ dir: mine, helper: NO_HELPER })
    expect(diverged.outcome).toBe('failed')
    expect(diverged.denied).toBe(false)
  })

  it('a git command that fails says what git said', () => {
    expect(() => gitOk(tmp(), ['status'])).toThrow(GitCommandError)
  })
})

describe('what is where', () => {
  it('finds the SPL and its products from where you stand, and the SPLs of a workspace from outside', () => {
    const root = tmp()
    fs.mkdirSync(path.join(root, '.linea'))
    fs.writeFileSync(path.join(root, '.linea', 'workspace.json'), '{"version":1}')
    const line = path.join(root, 'shop')
    fs.mkdirSync(path.join(line, 'src', 'platform'), { recursive: true })
    gitOk(line, ['init', '--quiet'])
    const product = path.join(line, 'p1')
    fs.mkdirSync(path.join(product, '.linea'), { recursive: true })
    fs.writeFileSync(path.join(product, '.linea', 'spec.json'), '{}')
    gitOk(product, ['init', '--quiet'])

    expect(checkoutsAt(line, root).map((c) => `${c.kind}:${c.name}`)).toEqual(['spl:shop', 'product:p1'])
    expect(checkoutsAt(product, root).map((c) => `${c.kind}:${c.name}`)).toEqual(['product:p1'])
    expect(checkoutsAt(root, root).map((c) => `${c.kind}:${c.name}`)).toEqual(['spl:shop'])
  })
})
