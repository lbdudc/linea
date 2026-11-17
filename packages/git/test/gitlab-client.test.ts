import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { createGitLabClient, GitLabProvider, isBranchAlreadyExistsError, type GitLabClient } from '../src/index.js'
import { startGitlabDouble } from '../src/testing/index.js'

let double: any
let client: GitLabClient
beforeAll(async () => {
  double = await startGitlabDouble()
  client = createGitLabClient({ url: double.url })
})
afterEach(() => double.reset())
afterAll(async () => { await double.close() })

const seedProjectWithFile = () => {
  const project = double.seedProject({ name: 'LastCommitIdLine', topics: ['spl'] })
  const commit = project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: 'products.json', content: '{"productos":[]}' }],
    message: 'seed products.json'
  })
  return { project, seedCommitId: commit.id as string }
}

test('the double mirrors real GitLab: "branch already exists" is a 400, not a 409', async () => {
  const project = double.seedProject({ name: 'CreateBranchStatusLine', topics: ['spl'] })
  await client.createBranch('fake', project.id, 'plan/dup', 'main')
  const caught = await client.createBranch('fake', project.id, 'plan/dup', 'main').catch((error: Error) => error) as Error & { status?: number }
  expect(caught).toBeInstanceOf(Error)
  expect(caught.status).toBe(400)
  expect(caught.message).toMatch(/already exists/i)
})

test('isBranchAlreadyExistsError recognises the real GitLab shape (400) and the historical ones (409/422), all needing a matching message', () => {
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Branch already exists' })).toBe(true)
  expect(isBranchAlreadyExistsError({ status: 409, message: 'Branch already exists' })).toBe(true)
  expect(isBranchAlreadyExistsError({ status: 422, message: 'Branch already exists' })).toBe(true)
  expect(isBranchAlreadyExistsError({ response: { status: 400 }, message: 'Branch already exists' })).toBe(true)
})

test('isBranchAlreadyExistsError does NOT swallow a genuine 400 validation error (e.g. an invalid reference name)', () => {
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Invalid reference name' })).toBe(false)
  expect(isBranchAlreadyExistsError({ status: 400, message: 'Bad Request' })).toBe(false)
  expect(isBranchAlreadyExistsError({ status: 403, message: 'Branch already exists' })).toBe(false)
  expect(isBranchAlreadyExistsError({ status: 500, message: 'Internal Server Error' })).toBe(false)
  expect(isBranchAlreadyExistsError(null)).toBe(false)
})

test('getFileMeta returns base64 content and last_commit_id', async () => {
  const { project, seedCommitId } = seedProjectWithFile()
  const meta = await client.getFileMeta('fake', project.id, 'products.json', 'main')
  expect(meta.encoding).toBe('base64')
  expect(Buffer.from(meta.content, 'base64').toString('utf8')).toBe('{"productos":[]}')
  expect(meta.last_commit_id).toBe(seedCommitId)
})

test('commitActions: a stale last_commit_id on an update action is rejected with 400', async () => {
  const { project, seedCommitId } = seedProjectWithFile()
  project.commit({
    branch: 'main',
    actions: [{ action: 'update', file_path: 'products.json', content: '{"productos":[{"name":"a"}]}' }],
    message: 'writer A updates products.json'
  })
  await expect(client.commitActions('fake', project.id, 'main', 'writer B updates products.json (stale)', [
    { action: 'update', file_path: 'products.json', content: '{"productos":[{"name":"b"}]}', last_commit_id: seedCommitId }
  ])).rejects.toThrow()
})

test('commitActions: a fresh last_commit_id on an update action succeeds', async () => {
  const { project } = seedProjectWithFile()
  const meta = await client.getFileMeta('fake', project.id, 'products.json', 'main')
  const commit = await client.commitActions('fake', project.id, 'main', 'writer B updates products.json (fresh)', [
    { action: 'update', file_path: 'products.json', content: '{"productos":[{"name":"b"}]}', last_commit_id: meta.last_commit_id }
  ])
  expect(commit.id).toBeTruthy()
  const after = await client.getFileMeta('fake', project.id, 'products.json', 'main')
  expect(Buffer.from(after.content, 'base64').toString('utf8')).toContain('"b"')
  expect(after.last_commit_id).toBe(commit.id)
})

const gid = (id: number): string => `gid://gitlab/Project/${id}`

test('lists what waits to be deleted, with the name it had and the address that opens', async () => {
  const provider = new GitLabProvider({ url: double.url })
  double.seedProject({ name: 'LiveLine', topics: ['spl'] })
  const own = double.seedProject({ name: 'OwnDate', topics: ['spl'] })
  own.marked_for_deletion_on = '2026-11-01'
  const inGroup = double.seedProject({ name: 'InGroup', topics: ['spl'] })
  inGroup.path_with_namespace = 'group-deletion_scheduled-7/ingroup'
  inGroup.web_url = 'https://gitlab.example/group-deletion_scheduled-7/ingroup'
  const notALine = double.seedProject({ name: 'NotALine', topics: ['product'] })
  notALine.marked_for_deletion_on = '2026-11-03'
  double.state.graphqlAnswer = { data: { projects: { nodes: [
    { id: gid(own.id), isSelfDeletionScheduled: true, permanentDeletionDate: '2026-11-08', group: null },
    { id: gid(inGroup.id), isSelfDeletionScheduled: false, permanentDeletionDate: '2026-12-30', group: { isSelfDeletionScheduled: false, permanentDeletionDate: '2026-12-30', parent: { isSelfDeletionScheduled: true, permanentDeletionDate: '2026-11-15', parent: null } } },
  ] } } }

  const pending = await provider.listPendingDeletion({ token: 'fake', topic: 'spl' })

  expect(pending.map(({ name, path, webUrl, deletesOn }) => ({ name, path, webUrl, deletesOn }))).toEqual([
    { name: 'OwnDate', path: own.path_with_namespace, webUrl: own.web_url, deletesOn: '2026-11-08' },
    { name: 'InGroup', path: 'group/ingroup', webUrl: 'https://gitlab.example/group-deletion_scheduled-7/ingroup', deletesOn: '2026-11-15' },
  ])
})

test('what waits to be deleted says when the host made it', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const own = double.seedProject({ name: 'OwnDate', topics: ['spl'] })
  own.marked_for_deletion_on = '2026-11-01'
  own.created_at = '2024-03-05T10:00:00.000Z'

  const [pending] = await provider.listPendingDeletion({ token: 'fake', topic: 'spl' })

  expect(pending?.createdAt).toBe('2024-03-05T10:00:00.000Z')
})

test('a project that is not scheduled, nor anything above it, has no date: the one GitLab gives it is theoretical', async () => {
  const dates = await (async () => {
    double.state.graphqlAnswer = { data: { projects: { nodes: [
      { id: gid(5), isSelfDeletionScheduled: false, permanentDeletionDate: '2026-12-30', group: { isSelfDeletionScheduled: false, permanentDeletionDate: '2026-12-30', parent: null } },
    ] } } }
    return client.getDeletionDates('fake', [5])
  })()
  expect(dates.size).toBe(0)
})

test('an instance whose GraphQL does not have the dates still lists what waits to be deleted', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const own = double.seedProject({ name: 'OwnDate', topics: ['spl'] })
  own.marked_for_deletion_on = '2026-11-01'

  const pending = await provider.listPendingDeletion({ token: 'fake', topic: 'spl' })

  expect(pending.map(({ name, deletesOn }) => ({ name, deletesOn }))).toEqual([{ name: 'OwnDate', deletesOn: null }])
})

test('a repository says when the host made it', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const project = double.seedProject({ name: 'OldLine', topics: ['spl'] })
  project.created_at = '2024-03-05T10:00:00.000Z'

  const [listed] = await provider.listRepositories({ token: 'fake', topic: 'spl' })

  expect(listed?.createdAt).toBe('2024-03-05T10:00:00.000Z')
})

test('what waits to be deleted says where it is, which is how a product is told from the line it belongs to', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const lineGroup = double.state.createGroup({ name: 'line' })
  const productGroup = double.state.createGroup({ name: 'product', parent_id: lineGroup.id })
  const product = double.state.createProject({ name: 'Product', namespace_id: productGroup.id, topics: ['product'] })
  product.marked_for_deletion_on = '2026-11-01'

  const [pending] = await provider.listPendingDeletion({ token: 'fake', topic: 'product' })

  expect(pending).toMatchObject({ namespaceId: productGroup.id, parentNamespaceId: lineGroup.id })
})

test('what waits to be deleted says what was scheduled: itself, its group or something above', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const own = double.seedProject({ name: 'Own', topics: ['spl'] })
  own.path_with_namespace = 'top/line/own-deletion_scheduled-1'
  own.marked_for_deletion_on = '2026-11-01'
  const line = double.seedProject({ name: 'Line', topics: ['spl'] })
  line.path_with_namespace = 'top/line-deletion_scheduled-2/line'
  const product = double.seedProject({ name: 'Product', topics: ['spl'] })
  product.path_with_namespace = 'top/line-deletion_scheduled-2/product/product'
  product.marked_for_deletion_at = '2026-11-01'

  const pending = await provider.listPendingDeletion({ token: 'fake', topic: 'spl' })
  const flags = Object.fromEntries(pending.map(({ name, repositoryScheduled, namespaceScheduled, ancestorScheduled }) => [name, [repositoryScheduled, namespaceScheduled, ancestorScheduled]]))

  expect(flags).toEqual({ Own: [true, false, false], Line: [false, true, false], Product: [false, false, true] })
})

test('restoring asks GitLab for the project and for the group', async () => {
  const provider = new GitLabProvider({ url: double.url })
  const send = vi.spyOn((provider as unknown as { client: { send: (...args: unknown[]) => Promise<unknown> } }).client, 'send').mockResolvedValue({})

  await provider.restoreRepository({ token: 'fake', id: 5 })
  await provider.restoreNamespace({ token: 'fake', id: 6 })

  expect(send.mock.calls).toEqual([['fake', 'POST', 'projects/5/restore'], ['fake', 'POST', 'groups/6/restore']])
})
