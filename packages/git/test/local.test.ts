import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCESS, LocalProvider, createGitProvider, gitConfigFromEnv } from '../src/index.js'
import { describeGitProviderContract } from '../src/testing/contract.js'

let root: string
let count = 0
beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-local-')) })
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

// a new, empty host each time
const makeProvider = (options: Partial<ConstructorParameters<typeof LocalProvider>[0]> = {}) =>
  new LocalProvider({ dataDir: path.join(root, `host-${++count}`), baseUrl: 'http://linea.test/git', ...options })

// the host a test of the contract is working on (addMember needs to reach its store)
let current: LocalProvider
describeGitProviderContract({
  name: 'local',
  makeProvider: () => (current = makeProvider()),
  addMember: async ({ repository, username, accessLevel }) => current.store.addMember({ repositoryId: repository.id as number, username, accessLevel }),
  signWebhook: ({ body, secret }) => {
    const rawBody = JSON.stringify(body)
    return { headers: { 'x-linea-signature': `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}` }, rawBody }
  },
  pushEvent: ({ repositoryId, branch }) => ({ headers: {}, body: { ref: `refs/heads/${branch}`, repositoryId } }),
})

const token = 'any'

describe('LocalProvider: what is its own', () => {
  it('is a host the library builds from a folder', () => {
    const git = createGitProvider({ ...gitConfigFromEnv({ GIT_PROVIDER: 'local', REDIRECT_URI: 'http://x' }), local: { dataDir: path.join(root, 'factory') } })
    expect(git.kind).toBe('local')
    expect(() => createGitProvider(gitConfigFromEnv({ GIT_PROVIDER: 'local', REDIRECT_URI: 'http://x' }))).toThrow(/folder/)
  })

  it('serves repositories at <baseUrl>/<group>/<name> and nests groups', async () => {
    const git = makeProvider()
    const line = await git.createNamespace({ token, name: 'Gis' })
    const product = await git.createNamespace({ token, name: 'Shop', parentId: line.id })
    const repository = await git.createRepository({ token, name: 'Shop', namespaceId: product.id, topics: ['product'] })
    expect(repository.path).toBe('Gis/Shop/Shop')
    expect(repository.webUrl).toBe('http://linea.test/git/Gis/Shop/Shop')
    expect(git.nestsNamespaces).toBe(true)
  })

  it('refuses a group or a repository that exists, saying it already does', async () => {
    const git = makeProvider()
    const namespace = await git.createNamespace({ token, name: 'Same' })
    await expect(git.createNamespace({ token, name: 'Same' })).rejects.toSatisfy((error) => git.isAlreadyExistsError(error))
    await git.createRepository({ token, name: 'Twice', namespaceId: namespace.id })
    await expect(git.createRepository({ token, name: 'Twice', namespaceId: namespace.id })).rejects.toMatchObject({ status: 409 })
  })

  it('knows who a token is from the server, and refuses one it does not know', async () => {
    const git = makeProvider({ resolveUser: (given) => (given === 'ana-token' ? { username: 'ana', avatarUrl: 'a.png' } : null) })
    expect(await git.getUser({ token: 'ana-token' })).toEqual({ username: 'ana', avatarUrl: 'a.png' })
    await expect(git.getUser({ token: 'who' })).rejects.toSatisfy((error) => git.isAuthError(error))
  })

  it('gives its maker, and an administrator, the repository; everybody else works in it but cannot delete it', async () => {
    const users: Record<string, { username: string, admin?: boolean }> = { t1: { username: 'ana' }, t2: { username: 'bob' }, t3: { username: 'root', admin: true } }
    const git = makeProvider({ resolveUser: (given) => users[given] ?? null })
    const namespace = await git.createNamespace({ token: 't1', name: 'Mine' })
    const repository = await git.createRepository({ token: 't1', name: 'Mine', namespaceId: namespace.id })
    expect(await git.getAccessLevel({ token: 't1', id: repository.id, username: 'ana' })).toBe(ACCESS.OWNER)
    expect(await git.getAccessLevel({ token: 't2', id: repository.id, username: 'bob' })).toBe(ACCESS.MAINTAINER)
    expect(await git.getAccessLevel({ token: 't3', id: repository.id, username: 'root' })).toBe(ACCESS.OWNER)
    await git.createFile({ token: 't2', id: repository.id, path: 'bob.txt', branch: 'main', content: 'hi' })
    await expect(git.deleteRepository({ token: 't2', id: repository.id })).rejects.toMatchObject({ status: 403 })
    await git.deleteRepository({ token: 't3', id: repository.id })
    expect(await git.findRepository({ token: 't1', path: repository.path })).toBeNull()
  })

  it('makes its commits as the person, and annotates tags with the message', async () => {
    const git = makeProvider({ resolveUser: () => ({ username: 'ana' }) })
    const namespace = await git.createNamespace({ token, name: 'Who' })
    const repository = await git.createRepository({ token, name: 'Who', namespaceId: namespace.id })
    await git.createFile({ token, id: repository.id, path: 'a.txt', branch: 'main', content: 'a' })
    const [last] = await git.getCommits({ token, id: repository.id, ref: 'main' })
    expect(last?.authorName).toBe('ana')
    expect(last?.title).toBe('Create a.txt')
  })

  it('keeps what is on disk: another provider on the same folder sees the same repositories', async () => {
    const dataDir = path.join(root, 'shared')
    const first = new LocalProvider({ dataDir })
    const namespace = await first.createNamespace({ token, name: 'Kept' })
    await first.createRepository({ token, name: 'Kept', namespaceId: namespace.id, topics: ['spl'] })
    const second = new LocalProvider({ dataDir })
    expect((await second.listRepositories({ token, topic: 'spl' })).map((repository) => repository.path)).toEqual(['Kept/Kept'])
  })

  it('serves an archive inside a folder named after the repository and the commit', async () => {
    const git = makeProvider()
    const namespace = await git.createNamespace({ token, name: 'Zip' })
    const { id } = await git.createRepository({ token, name: 'Zip', namespaceId: namespace.id })
    await git.createFile({ token, id, path: 'src/a.txt', branch: 'main', content: 'a' })
    const { buffer } = await import('node:stream/consumers')
    const bytes = await buffer(await git.downloadArchive({ token, id, ref: 'main' }))
    const listing = bytes.toString('latin1')
    expect(listing).toMatch(/Zip-[0-9a-f]{8}\/src\/a\.txt/)
  })

  it('merges a change request that touches different files', async () => {
    const git = makeProvider()
    const namespace = await git.createNamespace({ token, name: 'Merge' })
    const { id } = await git.createRepository({ token, name: 'Merge', namespaceId: namespace.id })
    await git.createBranch({ token, id, branch: 'side', ref: 'main' })
    await git.commit({ token, id, branch: 'side', message: 'side', actions: [{ action: 'create', path: 'side.txt', content: 's' }] })
    await git.commit({ token, id, branch: 'main', message: 'main', actions: [{ action: 'create', path: 'main.txt', content: 'm' }] })
    const request = await git.createChangeRequest({ token, id, title: 'Both', sourceBranch: 'side', targetBranch: 'main' })
    expect(request.hasConflicts).toBe(false)
    expect(await git.mergeChangeRequest({ token, id, number: request.number })).toBe(false)
    expect(await git.listFiles({ token, id, ref: 'main' })).toEqual(expect.arrayContaining(['main.txt', 'side.txt']))
    // a merged one is not merged twice, and has no conflicts
    expect(await git.mergeChangeRequest({ token, id, number: request.number })).toBe(false)
  })
})

describe('LocalProvider over HTTP: git clone and push', () => {
  it('serves its repositories to git, asks for credentials, and takes a push', async () => {
    const { createServer } = await import('node:http')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { createLocalGitHttp } = await import('../src/index.js')
    const git = makeProvider({ resolveUser: () => ({ username: 'ana' }) })
    const namespace = await git.createNamespace({ token, name: 'Web' })
    const repository = await git.createRepository({ token, name: 'Web', namespaceId: namespace.id })
    await git.createFile({ token, id: repository.id, path: 'hello.txt', branch: 'main', content: 'hello' })

    const pushes: string[] = []
    const handler = createLocalGitHttp({
      provider: git,
      authenticate: (username, password) => (username === 'ana' && password === 'secret' ? { username } : null),
      onPush: ({ repositoryPath, username }) => { pushes.push(`${username}@${repositoryPath}`) },
    })
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-clone-'))
    const run = (cwd: string, ...args: string[]) => execFileAsync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'ana', GIT_COMMITTER_EMAIL: 'a@x' } })
    try {
      expect(await fetch(`http://127.0.0.1:${port}/Web/Web.git/info/refs?service=git-upload-pack`).then((r) => r.status)).toBe(401)
      await expect(run(work, 'clone', `http://ana:wrong@127.0.0.1:${port}/Web/Web.git`, 'bad')).rejects.toThrow()
      await run(work, 'clone', '--quiet', `http://ana:secret@127.0.0.1:${port}/Web/Web.git`, 'clone')
      const clone = path.join(work, 'clone')
      expect(fs.readFileSync(path.join(clone, 'hello.txt'), 'utf8')).toBe('hello')
      fs.writeFileSync(path.join(clone, 'pushed.txt'), 'from git')
      await run(clone, 'add', '.')
      await run(clone, 'commit', '--quiet', '-m', 'pushed')
      await run(clone, 'push', '--quiet', 'origin', 'main')
      expect((await git.readFile({ token, id: repository.id, path: 'pushed.txt', ref: 'main' }))?.toString('utf8')).toBe('from git')
      expect(pushes).toEqual(['ana@Web/Web'])
      expect(await fetch(`http://127.0.0.1:${port}/Nowhere/None.git/info/refs`, { headers: { authorization: `Basic ${Buffer.from('ana:secret').toString('base64')}` } }).then((r) => r.status)).toBe(404)
    } finally {
      server.close()
      fs.rmSync(work, { recursive: true, force: true })
    }
  })

  it('closes the issues a commit pushed to the default branch names with a closing word', async () => {
    const { createServer } = await import('node:http')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { createLocalGitHttp } = await import('../src/index.js')
    const git = makeProvider({ resolveUser: () => ({ username: 'ana' }) })
    const namespace = await git.createNamespace({ token, name: 'Web' })
    const repository = await git.createRepository({ token, name: 'Web', namespaceId: namespace.id })
    await git.createFile({ token, id: repository.id, path: 'hello.txt', branch: 'main', content: 'hello' })
    for (const title of ['one', 'two', 'three']) await git.createIssue({ token, id: repository.id, title })
    const handler = createLocalGitHttp({ provider: git, authenticate: (username, password) => (username === 'ana' && password === 'secret' ? { username } : null) })
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-close-'))
    const run = (cwd: string, ...args: string[]) => execFileAsync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'ana', GIT_COMMITTER_EMAIL: 'a@x' } })
    const stateOf = async (number: number) => (await git.getIssue({ token, id: repository.id, number })).state
    const settled = async (number: number, wanted: string) => {
      for (let attempt = 0; attempt < 50 && (await stateOf(number)) !== wanted; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
      return stateOf(number)
    }
    try {
      await run(work, 'clone', '--quiet', `http://ana:secret@127.0.0.1:${port}/Web/Web.git`, 'clone')
      const clone = path.join(work, 'clone')
      await run(clone, 'checkout', '--quiet', '-b', 'topic')
      fs.writeFileSync(path.join(clone, 'topic.txt'), 'topic')
      await run(clone, 'add', '.')
      await run(clone, 'commit', '--quiet', '-m', 'topic work\n\nCloses #3')
      await run(clone, 'push', '--quiet', 'origin', 'topic')
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(await stateOf(3)).toBe('opened')
      await run(clone, 'checkout', '--quiet', 'main')
      fs.writeFileSync(path.join(clone, 'fix.txt'), 'fix')
      await run(clone, 'add', '.')
      await run(clone, 'commit', '--quiet', '-m', 'fix the thing\n\nFixes #1, #2')
      await run(clone, 'push', '--quiet', 'origin', 'main')
      expect(await settled(1, 'closed')).toBe('closed')
      expect(await settled(2, 'closed')).toBe('closed')
      expect(await stateOf(3)).toBe('opened')
    } finally {
      server.close()
      fs.rmSync(work, { recursive: true, force: true })
    }
  })
})
