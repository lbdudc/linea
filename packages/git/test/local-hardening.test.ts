import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCESS, LocalProvider, createLocalGitHttp } from '../src/index.js'
import { cleanEnv } from '../src/local/git.js'
import { LocalStore } from '../src/local/store.js'

const run = promisify(execFile)
let root: string
let count = 0
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-hard-')) })
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

// people by token = username; ana, dan and the registry's owner are administrators where it matters
const PEOPLE: Record<string, { username: string, admin?: boolean }> = {
  ana: { username: 'ana' }, bob: { username: 'bob' }, cy: { username: 'cy' }, dan: { username: 'dan' }, root: { username: 'root', admin: true },
}
const make = (options: Partial<ConstructorParameters<typeof LocalProvider>[0]> = {}) =>
  new LocalProvider({ dataDir: path.join(root, `host-${++count}`), baseUrl: 'http://linea.test/git', resolveUser: (token) => PEOPLE[token] ?? null, ...options })

const serve = async (provider: LocalProvider, options: Partial<Parameters<typeof createLocalGitHttp>[0]> = {}) => {
  const handler = createLocalGitHttp({ provider, authenticate: (username, password) => (PEOPLE[username] && password === 'pw' ? PEOPLE[username] as { username: string } : null), ...options })
  const server = http.createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as { port: number }).port }
}
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' } })
const rejects = async (promise: Promise<unknown>): Promise<string> => { try { await promise } catch (error) { return String((error as { stderr?: string }).stderr ?? error) } throw new Error('it should have failed') }

describe('git over HTTP obeys the levels of the host', () => {
  it('lets a reporter read and not push, a developer push to branches and not to the default one, a maintainer to both', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'Team' })
    const repo = await provider.createRepository({ token: 'ana', name: 'App', namespaceId: group.id })
    await provider.createFile({ token: 'ana', id: repo.id, path: 'a.txt', branch: 'main', content: 'a' })
    await provider.store.addMember({ repositoryId: repo.id as number, username: 'bob', accessLevel: ACCESS.REPORTER })
    await provider.store.addMember({ repositoryId: repo.id as number, username: 'dan', accessLevel: ACCESS.DEVELOPER })
    const { server, port } = await serve(provider)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-hard-work-'))
    const url = (who: string) => `http://${who}:pw@127.0.0.1:${port}/Team/App.git`
    try {
      // bob reads, cannot push
      await git(work, 'clone', '--quiet', url('bob'), 'bob')
      fs.writeFileSync(path.join(work, 'bob', 'b.txt'), 'b')
      await git(path.join(work, 'bob'), 'add', '.'); await git(path.join(work, 'bob'), 'commit', '--quiet', '-m', 'b')
      expect(await rejects(git(path.join(work, 'bob'), 'push', 'origin', 'main'))).toMatch(/403|not allowed/i)

      // dan pushes a branch, and is refused the default one by the host's rule
      await git(work, 'clone', '--quiet', url('dan'), 'dan')
      const dan = path.join(work, 'dan')
      fs.writeFileSync(path.join(dan, 'd.txt'), 'd')
      await git(dan, 'add', '.'); await git(dan, 'commit', '--quiet', '-m', 'd')
      await git(dan, 'push', '--quiet', 'origin', 'HEAD:refs/heads/feature')
      expect(await rejects(git(dan, 'push', 'origin', 'main'))).toMatch(/maintainer access/)

      // cy has no record: everybody works here (maintainer)
      await git(work, 'clone', '--quiet', url('cy'), 'cy')
      const cy = path.join(work, 'cy')
      fs.writeFileSync(path.join(cy, 'c.txt'), 'c')
      await git(cy, 'add', '.'); await git(cy, 'commit', '--quiet', '-m', 'c')
      await git(cy, 'push', '--quiet', 'origin', 'main')
      expect((await provider.readFile({ token: 'ana', id: repo.id, path: 'c.txt', ref: 'main' }))?.toString()).toBe('c')
    } finally {
      server.close(); fs.rmSync(work, { recursive: true, force: true })
    }
  })

  it('never lets the default branch be deleted or rewritten, even by the owner, and leaves other branches free', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'App' })
    await provider.createFile({ token: 'ana', id: repo.id, path: 'a.txt', branch: 'main', content: 'a' })
    const { server, port } = await serve(provider)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-hard-work-'))
    try {
      await git(work, 'clone', '--quiet', `http://ana:pw@127.0.0.1:${port}/ana/App.git`, 'c')
      const c = path.join(work, 'c')
      fs.writeFileSync(path.join(c, 'a.txt'), 'rewritten')
      await git(c, 'commit', '--quiet', '-a', '--amend', '-m', 'rewrite')
      expect(await rejects(git(c, 'push', '--force', 'origin', 'main'))).toMatch(/force-pushed/)
      expect(await rejects(git(c, 'push', 'origin', ':main'))).toMatch(/cannot be deleted/)
      // a branch is the pusher's own: it can be created, rewritten and deleted
      await git(c, 'push', '--quiet', 'origin', 'HEAD:refs/heads/topic')
      await git(c, 'push', '--quiet', '--force', 'origin', 'HEAD:refs/heads/topic')
      await git(c, 'push', '--quiet', 'origin', ':topic')
    } finally {
      server.close(); fs.rmSync(work, { recursive: true, force: true })
    }
  })

  it('makes a group only its owner writes in (the registry) read-only for everybody else, in the API and over git', async () => {
    const provider = make({ readOnlyGroups: ['registry'] })
    const group = await provider.createNamespace({ token: 'root', name: 'registry' })
    const repo = await provider.createRepository({ token: 'root', name: 'index', namespaceId: group.id })
    await provider.createFile({ token: 'root', id: repo.id, path: 'registry.json', branch: 'main', content: '{}' })
    // the API: a reader, not a writer
    expect(await provider.getFile({ token: 'cy', id: repo.id, path: 'registry.json', ref: 'main' })).toBeTruthy()
    await expect(provider.saveFile({ token: 'cy', id: repo.id, path: 'registry.json', branch: 'main', content: 'x' })).rejects.toMatchObject({ status: 403 })
    await expect(provider.createRepository({ token: 'cy', name: 'evil', namespaceId: group.id })).rejects.toMatchObject({ status: 403 })
    await expect(provider.createNamespace({ token: 'cy', name: 'evil', parentId: group.id })).rejects.toMatchObject({ status: 403 })
    await expect(provider.deleteNamespace({ token: 'cy', id: group.id })).rejects.toMatchObject({ status: 403 })
    expect(await provider.getAccessLevel({ token: 'cy', id: repo.id, username: 'cy' })).toBe(ACCESS.REPORTER)
    // git: clone yes, push no
    const { server, port } = await serve(provider)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-hard-work-'))
    try {
      await git(work, 'clone', '--quiet', `http://cy:pw@127.0.0.1:${port}/registry/index.git`, 'c')
      const c = path.join(work, 'c')
      fs.writeFileSync(path.join(c, 'registry.json'), 'poisoned')
      await git(c, 'commit', '--quiet', '-a', '-m', 'x')
      expect(await rejects(git(c, 'push', 'origin', 'main'))).toMatch(/403|not allowed/i)
    } finally {
      server.close(); fs.rmSync(work, { recursive: true, force: true })
    }
  })
})

describe('git over HTTP: requests that are not right', () => {
  it('answers 400 to a malformed address, 404 to what is not a repository, and finds a group called a.git', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'a.git' })
    const repo = await provider.createRepository({ token: 'ana', name: 'r', namespaceId: group.id })
    const { server, port } = await serve(provider)
    const auth = { authorization: `Basic ${Buffer.from('ana:pw').toString('base64')}` }
    try {
      expect((await fetch(`http://127.0.0.1:${port}/%E0%A4%A.git/info/refs`, { headers: auth })).status).toBe(400)
      expect((await fetch(`http://127.0.0.1:${port}/nothing`, { headers: auth })).status).toBe(404)
      const found = await fetch(`http://127.0.0.1:${port}/${group.fullPath}/r.git/info/refs?service=git-upload-pack`, { headers: auth })
      expect(repo.path).toBe(`${group.fullPath}/r`)
      expect(found.status).toBe(200)
    } finally {
      server.close()
    }
  })

  it('counts the failures and refuses what the throttle refuses', async () => {
    const provider = make()
    const failures: string[] = []
    const { server, port } = await serve(provider, { onFailure: ({ username }) => failures.push(username), throttle: ({ username }) => (username === 'locked' ? 'Too many attempts' : null) })
    try {
      const basic = (credentials: string) => ({ authorization: `Basic ${Buffer.from(credentials).toString('base64')}` })
      expect((await fetch(`http://127.0.0.1:${port}/a/b.git/info/refs`, { headers: basic('ana:wrong') })).status).toBe(401)
      expect((await fetch(`http://127.0.0.1:${port}/a/b.git/info/refs`, { headers: basic('locked:pw') })).status).toBe(429)
      expect(failures).toEqual(['ana'])
    } finally {
      server.close()
    }
  })

  it('cuts a transfer that stops moving, so no git waits for ever', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'App' })
    expect(repo.id).toBeTruthy()
    const { server, port } = await serve(provider, { idleTimeoutMs: 300 })
    try {
      const closed = await new Promise<string>((resolve) => {
        const request = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/ana/App.git/git-receive-pack', headers: { authorization: `Basic ${Buffer.from('ana:pw').toString('base64')}`, 'content-type': 'application/x-git-receive-pack-request', 'transfer-encoding': 'chunked' } }, (res) => {
          res.resume(); res.on('end', () => resolve(`ended ${res.statusCode}`)); res.on('close', () => resolve('closed'))
        })
        request.on('error', () => resolve('error'))
        request.write('0000') // and never ends
      })
      expect(['ended 500', 'closed', 'error', 'ended 200']).toContain(closed)
    } finally {
      server.close()
    }
  }, 10_000)

  it('gives git nothing of the server\'s environment but what it needs', () => {
    process.env['LINEA_SECRET_FOR_TEST'] = 'hunter2'
    const env = cleanEnv({ GIT_DIR: '/x' })
    expect(env['LINEA_SECRET_FOR_TEST']).toBeUndefined()
    expect(env['PATH']).toBeDefined()
    expect(env['GIT_DIR']).toBe('/x')
    delete process.env['LINEA_SECRET_FOR_TEST']
  })
})

describe('the state of the host', () => {
  it('goes back to the last good copy when the file is cut, and says when there is none', async () => {
    const dir = path.join(root, `state-${++count}`)
    const store = new LocalStore(dir)
    await store.update((state) => { state.next = 5 })
    await store.update((state) => { state.next = 9 })
    fs.writeFileSync(path.join(dir, 'state.json'), '{"next": 1, "namespa') // cut short
    expect((await store.read((state) => state.next))).toBe(5) // the copy of the file that was replaced last
    fs.rmSync(path.join(dir, 'state.json.bak'))
    await expect(store.read((state) => state.next)).rejects.toThrow(/damaged/)
  })

  it('takes over a lock left by a process that died, and waits for one that is alive', async () => {
    const dir = path.join(root, `lock-${++count}`)
    fs.mkdirSync(dir, { recursive: true })
    const lock = path.join(dir, 'state.json.lock')
    fs.writeFileSync(lock, '999999')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(lock, old, old)
    const store = new LocalStore(dir)
    await store.update((state) => { state.next = 3 })
    expect(await store.read((state) => state.next)).toBe(3)
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('does not lose changes made through two providers on the same folder', async () => {
    const dataDir = path.join(root, `shared-${++count}`)
    const a = make({ dataDir }); const b = make({ dataDir })
    await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).createNamespace({ token: 'ana', name: `g${i}` })))
    expect((await a.listNamespaces({ token: 'ana' })).length).toBe(10)
  })

  it('has a repository only once its git is there, and names that end in .git lose it', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'g.git' })
    expect(group.fullPath).toBe('g')
    const repo = await provider.createRepository({ token: 'ana', name: 'thing.git', namespaceId: group.id })
    expect(repo.path).toBe('g/thing')
    await expect(provider.createRepository({ token: 'ana', name: 'thing', namespaceId: group.id })).rejects.toMatchObject({ code: 'already_exists' })
  })
})

describe('groups and merges', () => {
  it('lets only the owner, an administrator or whoever owns everything in a group delete or rename it', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'Mine' })
    await provider.createRepository({ token: 'ana', name: 'r', namespaceId: group.id })
    await expect(provider.deleteNamespace({ token: 'bob', id: group.id })).rejects.toMatchObject({ status: 403 })
    await expect(provider.renameNamespace({ token: 'bob', id: group.id, name: 'Yours' })).rejects.toMatchObject({ status: 403 })
    await provider.renameNamespace({ token: 'root', id: group.id, name: 'Ours' })
    await provider.deleteNamespace({ token: 'ana', id: group.id })
    expect(await provider.findNamespace({ token: 'ana', fullPath: 'Ours' })).toBeNull()
  })

  it('closes a change request whose branch is already in the target without making a merge commit, and says conflicts only for conflicts', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'M' })
    await provider.createFile({ token: 'ana', id: repo.id, path: 'f.txt', branch: 'main', content: 'base' })
    await provider.createBranch({ token: 'ana', id: repo.id, branch: 'a', ref: 'main' })
    await provider.createBranch({ token: 'ana', id: repo.id, branch: 'b', ref: 'main' })
    await provider.saveFile({ token: 'ana', id: repo.id, path: 'f.txt', branch: 'a', content: 'from a' })
    await provider.saveFile({ token: 'ana', id: repo.id, path: 'f.txt', branch: 'b', content: 'from b' })
    const [first, second] = [
      await provider.createChangeRequest({ token: 'ana', id: repo.id, title: 'a', sourceBranch: 'a', targetBranch: 'main' }),
      await provider.createChangeRequest({ token: 'ana', id: repo.id, title: 'b', sourceBranch: 'b', targetBranch: 'main' }),
    ]
    expect(await provider.mergeChangeRequest({ token: 'ana', id: repo.id, number: first.number })).toBe(false)
    // b now conflicts with what main has
    expect(await provider.mergeChangeRequest({ token: 'ana', id: repo.id, number: second.number })).toBe(true)
    // an extra change request over the same, already merged branch: nothing to merge, so no new commit
    const before = (await provider.getBranch({ token: 'ana', id: repo.id, branch: 'main' })).lastCommit
    const again = await provider.createChangeRequest({ token: 'ana', id: repo.id, title: 'a again', sourceBranch: 'a', targetBranch: 'main' })
    expect(await provider.mergeChangeRequest({ token: 'ana', id: repo.id, number: again.number })).toBe(false)
    expect((await provider.getBranch({ token: 'ana', id: repo.id, branch: 'main' })).lastCommit).toEqual(before)
  })

  it('streams the archive of a repository as a zip', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'A' })
    const stream = await provider.downloadArchive({ token: 'ana', id: repo.id })
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK')
  })
})

describe('people who leave', () => {
  it('hands what they own to someone else, or to a name nobody can sign in with', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'Ana' })
    const repo = await provider.createRepository({ token: 'ana', name: 'r', namespaceId: group.id })
    await provider.store.addMember({ repositoryId: repo.id as number, username: 'bob', accessLevel: ACCESS.DEVELOPER })
    expect(await provider.transferOwnership({ from: 'ana', to: 'deleted:ana' })).toEqual({ namespaces: 1, repositories: 1 })
    // a new "ana" is nobody to it: she does not inherit, but still works there like everybody (open by default)
    expect(await provider.getAccessLevel({ token: 'ana', id: repo.id, username: 'ana' })).toBe(ACCESS.MAINTAINER)
    await expect(provider.deleteNamespace({ token: 'ana', id: group.id })).rejects.toMatchObject({ status: 403 })
    await provider.transferOwnership({ from: 'bob', to: 'cy' })
    expect((await provider.getMembers({ token: 'root', id: repo.id })).map((member) => member.username)).toContain('cy')
  })
})

describe('the trash', () => {
  it('keeps what is deleted until the work that deleted it is done, and gives it back on rollback', async () => {
    const provider = make()
    const group = await provider.createNamespace({ token: 'ana', name: 'Doomed' })
    const repo = await provider.createRepository({ token: 'ana', name: 'r', namespaceId: group.id })
    await provider.createFile({ token: 'ana', id: repo.id, path: 'a.txt', branch: 'main', content: 'precious' })
    const deleter = make({ dataDir: provider.store.dir })
    await deleter.deleteNamespace({ token: 'ana', id: group.id })
    expect(await provider.findNamespace({ token: 'ana', fullPath: 'Doomed' })).toBeNull()
    expect(fs.readdirSync(path.join(provider.store.dir, 'trash'))).toHaveLength(1)
    // the bookkeeping of the caller failed: everything comes back
    await deleter.rollback()
    expect((await provider.readFile({ token: 'ana', id: repo.id, path: 'a.txt', ref: 'main' }))?.toString()).toBe('precious')
    expect(fs.readdirSync(path.join(provider.store.dir, 'trash'))).toHaveLength(0)
  })

  it('forgets what has been there too long, and an undone creation leaves nothing', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'r' })
    await provider.deleteRepository({ token: 'ana', id: repo.id })
    const trash = path.join(provider.store.dir, 'trash')
    const [entry] = fs.readdirSync(trash) as [string]
    const old = new Date(Date.now() - 8 * 24 * 3600_000)
    fs.utimesSync(path.join(trash, entry), old, old)
    provider.purgeTrash()
    expect(fs.readdirSync(trash)).toHaveLength(0)

    const fresh = make()
    const created = await fresh.createRepository({ token: 'ana', name: 'gone' })
    await fresh.rollback()
    expect(await fresh.findRepository({ token: 'ana', path: created.path })).toBeNull()
    expect(fs.existsSync(path.join(fresh.store.dir, 'repos', `${created.id}.git`))).toBe(false)
  })
})

describe('limits', () => {
  it('refuses a push bigger than the limit', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'App' })
    expect(repo.id).toBeTruthy()
    const { server, port } = await serve(provider, { maxPushBytes: 2000 })
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-hard-work-'))
    try {
      await git(work, 'clone', '--quiet', `http://ana:pw@127.0.0.1:${port}/ana/App.git`, 'c')
      const c = path.join(work, 'c')
      fs.writeFileSync(path.join(c, 'big.bin'), (await import('node:crypto')).randomBytes(50_000))
      await git(c, 'add', '.'); await git(c, 'commit', '--quiet', '-m', 'big')
      expect(await rejects(git(c, 'push', 'origin', 'HEAD:refs/heads/big'))).toBeTruthy()
    } finally {
      server.close(); fs.rmSync(work, { recursive: true, force: true })
    }
  })
})

describe('members', () => {
  it('are set and taken away by the owner, with levels a member can have, and change what the person can do', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'App' })
    await provider.setMember({ token: 'ana', id: repo.id, username: 'bob', accessLevel: ACCESS.REPORTER })
    expect(await provider.getAccessLevel({ token: 'bob', id: repo.id, username: 'bob' })).toBe(ACCESS.REPORTER)
    await expect(provider.saveFile({ token: 'bob', id: repo.id, path: 'x', branch: 'main', content: 'x' })).rejects.toMatchObject({ status: 403 })
    // not by someone who is not the owner, not to a level that is not a member's, not to the owner
    await expect(provider.setMember({ token: 'cy', id: repo.id, username: 'bob', accessLevel: ACCESS.MAINTAINER })).rejects.toMatchObject({ status: 403 })
    await expect(provider.setMember({ token: 'ana', id: repo.id, username: 'bob', accessLevel: ACCESS.OWNER })).rejects.toMatchObject({ status: 400 })
    await expect(provider.setMember({ token: 'ana', id: repo.id, username: 'ana', accessLevel: ACCESS.DEVELOPER })).rejects.toMatchObject({ status: 400 })
    await provider.removeMember({ token: 'ana', id: repo.id, username: 'bob' })
    expect(await provider.getAccessLevel({ token: 'bob', id: repo.id, username: 'bob' })).toBe(ACCESS.MAINTAINER) // like everybody
  })
})

describe('change requests that are over', () => {
  it('are closed without merging, are not listed as open, and the old ones are forgotten', async () => {
    const provider = make()
    const repo = await provider.createRepository({ token: 'ana', name: 'CR' })
    await provider.createBranch({ token: 'ana', id: repo.id, branch: 'topic', ref: 'main' })
    const request = await provider.createChangeRequest({ token: 'ana', id: repo.id, title: 't', sourceBranch: 'topic', targetBranch: 'main' })
    await provider.closeChangeRequest({ token: 'ana', id: repo.id, number: request.number })
    expect(await provider.listChangeRequests({ token: 'ana', id: repo.id })).toEqual([])
    await expect(provider.closeChangeRequest({ token: 'ana', id: repo.id, number: 99 })).rejects.toMatchObject({ status: 404 })

    // closed a long time ago: the next change request makes room
    await provider.store.update((state) => { state.repositories[0]!.changeRequests[0]!.createdAt = new Date(Date.now() - 100 * 24 * 3600_000).toISOString() })
    await provider.createChangeRequest({ token: 'ana', id: repo.id, title: 'u', sourceBranch: 'topic', targetBranch: 'main' })
    expect(await provider.store.read((state) => state.repositories[0]!.changeRequests.map((r) => r.title))).toEqual(['u'])
  })
})
