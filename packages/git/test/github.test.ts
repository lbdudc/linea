import crypto from 'node:crypto';
import { beforeAll, afterEach, afterAll, describe, it, expect } from 'vitest';
import { GitHubProvider, GitHubClient, clearGitHubCache, GitAuthError } from '../src/index.js';
import { startGithubDouble } from '../src/testing/index.js';
import { describeGitProviderContract } from '../src/testing/contract.js';

let double: Awaited<ReturnType<typeof startGithubDouble>>;
beforeAll(async () => { double = await startGithubDouble(); });
afterEach(() => { double.reset(); clearGitHubCache(); });
afterAll(async () => { await double.close(); });

const makeProvider = () =>
  new GitHubProvider({ client: new GitHubClient({ apiUrl: double.url }), pollMs: 2, pollAttempts: 50 });

// GitHub, through an in-memory GitHub: the same contract GitLab satisfies
describeGitProviderContract({
  name: 'GitHub',
  makeProvider: () => makeProvider(),
  addMember: async ({ repository, username, accessLevel }) => {
    const role = Object.entries(double.roles).find(([, level]) => level === accessLevel)?.[0] ?? 'read';
    double.setCollaborator(repository.id, username, role);
  },
  addMilestone: async ({ repository, title }) => {
    double.state.repos.get(repository.id).milestones.push({ number: 1, title, state: 'open', due_on: null });
  },
  signWebhook: ({ body, secret }) => {
    const rawBody = JSON.stringify(body);
    return { headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}` }, rawBody };
  },
  pushEvent: ({ repositoryId, branch }) => ({ headers: { 'x-github-event': 'push' }, body: { ref: `refs/heads/${branch}`, repository: { id: repositoryId } } }),
});

const token = 'gho_test';

// what GitHub does differently, and how the provider hides it
describe('GitHubProvider: the differences', () => {
  it('lists the account and the organisations the user can create repositories in, as places to put a line', async () => {
    double.addOrg('acme', 'admin');
    const places = await makeProvider().listNamespaces({ token });
    expect(places.map((place) => place.fullPath)).toEqual(['dev', 'acme']);
    expect(places[1]?.id).toBe('account:acme');
  });

  it('puts a line in the organisation that was chosen, and its products next to it, tied to it by a topic', async () => {
    const org = double.addOrg('acme', 'admin');
    const git = makeProvider();
    const lineNs = await git.createNamespace({ token, name: 'Gis', parentId: 'account:acme' });
    expect(lineNs.pending).toBe(true);
    expect(double.state.repos.size).toBe(0); // nothing is made on GitHub for a namespace
    const line = await git.createRepository({ token, name: 'Gis', namespaceId: lineNs.id, topics: ['spl'] });
    const productNs = await git.createNamespace({ token, name: 'Shop', parentId: line.namespaceId });
    const product = await git.createRepository({ token, name: 'Shop', namespaceId: productNs.id, topics: ['product'] });

    expect(line.path).toBe('acme/Gis');
    expect(product.path).toBe('acme/Gis-Shop');
    expect(product.name).toBe('Shop');
    expect(line.namespaceId).toBe(line.id);
    expect(product.parentNamespaceId).toBe(line.id);
    expect(double.state.repos.get(product.id).topics).toEqual(['product', `linea-in-${line.id}`]);
    expect(org.login).toBe('acme');
  });

  it('refuses a product whose repository name is taken, saying so', async () => {
    const git = makeProvider();
    const lineNs = await git.createNamespace({ token, name: 'Gis' });
    const line = await git.createRepository({ token, name: 'Gis', namespaceId: lineNs.id, topics: ['spl'] });
    const make = async () => {
      const ns = await git.createNamespace({ token, name: 'Shop', parentId: line.namespaceId });
      return git.createRepository({ token, name: 'Shop', namespaceId: ns.id, topics: ['product'] });
    };
    await make();
    await expect(make()).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/already exists/) });
  });

  it('renames the repository of a product, and a rename made twice is not an error', async () => {
    const git = makeProvider();
    const lineNs = await git.createNamespace({ token, name: 'Gis' });
    const line = await git.createRepository({ token, name: 'Gis', namespaceId: lineNs.id, topics: ['spl'] });
    const ns = await git.createNamespace({ token, name: 'Shop', parentId: line.namespaceId });
    const product = await git.createRepository({ token, name: 'Shop', namespaceId: ns.id, topics: ['product'] });
    await git.renameNamespace({ token, id: product.namespaceId as string | number, name: 'Store' });
    const renamed = await git.renameRepository({ token, id: product.id, name: 'Store' });
    expect(renamed.path).toBe('dev/Gis-Store');
    expect(renamed.name).toBe('Store');
  });

  it('reads the access of someone who can only read, without being allowed to list the collaborators', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id, topics: ['spl'] });
    double.setCollaborator(repo.id, 'dev', 'read');
    expect(await git.getAccessLevel({ token, id: repo.id, username: 'dev' })).toBe(20);
    double.inject({ match: /collaborators$/, status: 403, body: { message: 'Must have push access to view repository collaborators.' } });
    expect(await git.getMembers({ token, id: repo.id })).toEqual([{ username: 'dev', accessLevel: 20 }]);
  });

  it('commits with the right encoding for binary files, and refuses to create a file that exists', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id });
    const bytes = Buffer.from([0, 1, 2, 250, 251]);
    await git.commit({ token, id: repo.id, branch: 'main', message: 'bin', actions: [{ action: 'create', path: 'a.bin', content: bytes.toString('base64'), encoding: 'base64' }] });
    expect(Buffer.from((await git.readFile({ token, id: repo.id, path: 'a.bin', ref: 'main' }))!).equals(bytes)).toBe(true);
    await expect(git.commit({ token, id: repo.id, branch: 'main', message: 'again', actions: [{ action: 'create', path: 'a.bin', content: 'x' }] }))
      .rejects.toMatchObject({ status: 400 });
    await expect(git.commit({ token, id: repo.id, branch: 'main', message: 'no branch', actions: [] })).resolves.toBeDefined();
    await expect(git.commit({ token, id: repo.id, branch: 'ghost', message: 'x', actions: [] })).rejects.toMatchObject({ status: 404 });
  });

  it('turns a branch that moved while it was committing into a 409', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id });
    const racing = double.state.repos.get(repo.id);
    const original = racing.makeCommit.bind(racing);
    let moved = false;
    // another writer commits between our reading the head and moving the branch
    racing.makeCommit = (args: { message: string }) => {
      if (!moved && args.message === 'mine') {
        moved = true;
        racing.commitOn('main', [{ path: 'other.txt', sha: racing.putBlob(Buffer.from('theirs')) }], 'theirs');
      }
      return original(args);
    };
    await expect(git.commit({ token, id: repo.id, branch: 'main', message: 'mine', actions: [{ action: 'create', path: 'mine.txt', content: 'x' }] }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('puts the status of a workflow run in the words of a pipeline', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id });
    const run = (status: string, conclusion: string | null) => ({ status, conclusion, head_branch: 'main', created_at: '2026-01-01T00:00:00Z', html_url: 'https://x/run' });
    for (const [given, wanted] of [
      [run('completed', 'success'), 'success'], [run('completed', 'failure'), 'failed'], [run('completed', 'cancelled'), 'canceled'],
      [run('in_progress', null), 'running'], [run('queued', null), 'pending'],
    ]) {
      double.addRun(repo.id, given);
      expect((await git.getLatestPipeline({ token, id: repo.id, ref: 'main' }))?.status).toBe(wanted);
    }
  });

  it('works out a pull request that GitHub has not finished working out (mergeable: null) by asking again', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id });
    await git.createBranch({ token, id: repo.id, branch: 'f', ref: 'main' });
    await git.commit({ token, id: repo.id, branch: 'f', message: 'f', actions: [{ action: 'create', path: 'f.txt', content: 'f' }] });
    const request = await git.createChangeRequest({ token, id: repo.id, title: 'F', sourceBranch: 'f', targetBranch: 'main' });
    type LogEntry = { path: string, method: string };
    const before = (double.getLog() as LogEntry[]).filter((entry) => entry.path.endsWith(`/pulls/${request.number}`) && entry.method === 'GET').length;
    expect(await git.mergeChangeRequest({ token, id: repo.id, number: request.number })).toBe(false);
    const asked = (double.getLog() as LogEntry[]).filter((entry) => entry.path.endsWith(`/pulls/${request.number}`) && entry.method === 'GET').length - before;
    expect(asked).toBeGreaterThan(1);
  });

  it('answers true for a change request that is not open any more instead of merging it twice', async () => {
    const git = makeProvider();
    const ns = await git.createNamespace({ token, name: 'Gis' });
    const repo = await git.createRepository({ token, name: 'Gis', namespaceId: ns.id });
    await git.createBranch({ token, id: repo.id, branch: 'f', ref: 'main' });
    await git.commit({ token, id: repo.id, branch: 'f', message: 'f', actions: [{ action: 'create', path: 'f.txt', content: 'f' }] });
    const request = await git.createChangeRequest({ token, id: repo.id, title: 'F', sourceBranch: 'f', targetBranch: 'main' });
    await git.mergeChangeRequest({ token, id: repo.id, number: request.number });
    expect(await git.mergeChangeRequest({ token, id: repo.id, number: request.number })).toBe(false);
  });
});

describe('GitHubClient', () => {
  const client = () => new GitHubClient({ apiUrl: double.url });

  it('reads an expired token as an auth error', async () => {
    double.inject({ status: 401, body: { message: 'Bad credentials' } });
    await expect(client().json({ token, path: '/user' })).rejects.toBeInstanceOf(GitAuthError);
  });

  it('waits and tries again when GitHub says to slow down', async () => {
    double.inject({ status: 403, headers: { 'retry-after': '0' }, body: { message: 'You have exceeded a secondary rate limit.' } });
    double.inject({ status: 429, headers: { 'retry-after': '0' }, body: { message: 'slow down' } });
    expect((await client().json({ token, path: '/user' })).login).toBe('dev');
  });

  it('gives up after a few tries, saying what GitHub said', async () => {
    for (let i = 0; i < 6; i++) double.inject({ status: 429, headers: { 'retry-after': '0' }, body: { message: 'slow down' } });
    await expect(client().json({ token, path: '/user' })).rejects.toMatchObject({ status: 429, message: 'slow down' });
  });

  it('asks again with the ETag it has, so a repeated read costs nothing against the limit', async () => {
    const seen: unknown[] = [];
    const spy = (url: string | URL | Request, init?: RequestInit) => { seen.push((init?.headers as Record<string, string>)['If-None-Match']); return fetch(url, init); };
    const cached = new GitHubClient({ apiUrl: double.url, fetchImpl: spy });
    await cached.json({ token, path: '/user' });
    expect((await cached.json({ token, path: '/user' })).login).toBe('dev');
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeTruthy();
  });

  it('keeps what one user read away from another', async () => {
    const seen: unknown[] = [];
    const spy = (url: string | URL | Request, init?: RequestInit) => { seen.push((init?.headers as Record<string, string>)['If-None-Match']); return fetch(url, init); };
    const cached = new GitHubClient({ apiUrl: double.url, fetchImpl: spy });
    await cached.json({ token: 'alice', path: '/user' });
    await cached.json({ token: 'bob', path: '/user' });
    expect(seen).toEqual([undefined, undefined]);
  });
});

describe('GitHubProvider: releases and rollback', () => {
  it('takes back the releases it made, and leaves the tag to the rest of the rollback', async () => {
    const maker = makeProvider();
    const { repository } = await (async () => {
      const namespace = await maker.createNamespace({ token: 't', name: 'Shop' });
      return { repository: await maker.createRepository({ token: 't', name: 'Shop', namespaceId: namespace.id }) };
    })();
    const git = makeProvider();
    await git.createTag({ token: 't', id: repository.id, tag: 'v1.0.0', ref: 'main', message: '{}' });
    await git.createRelease({ token: 't', id: repository.id, tag: 'v1.0.0' });
    expect(await maker.getRelease({ token: 't', id: repository.id, tag: 'v1.0.0' })).not.toBeNull();
    await git.rollback();
    expect(await maker.getRelease({ token: 't', id: repository.id, tag: 'v1.0.0' })).toBeNull();
  });
});

describe('GitHubProvider: draft releases', () => {
  it('leaves out a draft, as the lookup by tag does not find it either', async () => {
    const git = makeProvider();
    const namespace = await git.createNamespace({ token: 't', name: 'Shop' });
    const repository = await git.createRepository({ token: 't', name: 'Shop', namespaceId: namespace.id });
    await git.createTag({ token: 't', id: repository.id, tag: 'v1.0.0', ref: 'main', message: '{}' });
    await git.createRelease({ token: 't', id: repository.id, tag: 'v1.0.0' });
    const stored = double.state.repos.get(repository.id).releases;
    stored.push({ id: 99, tag_name: 'v2.0.0', name: 'draft', body: '', prerelease: false, draft: true, created_at: new Date().toISOString() });
    expect((await git.listReleases({ token: 't', id: repository.id })).map((release) => release.tag)).toEqual(['v1.0.0']);
  });
});
