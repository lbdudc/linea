import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { setup, clear, teardown } from './setup.js';
import { localTokenOf } from '../model/git/localToken.js';
import UserService from '../model/services/UserService.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import User from '../model/entities/user.js';
import { configureGitHosts, getLocalProvider } from '../model/git/index.js';
import { generateToken } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';
import lineRouter from '../rest/routers/lineRouter.js';
import productRouter from '../rest/routers/productRouter.js';

// The merge requests of a line and of a product, on the local host: the same routes whatever the host.
let dataDir;
beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-issues-'));
  await configureGitHosts({ file: { local: { dataDir }, gitlab: { enabled: false }, github: { enabled: false } } });
});
afterEach(clear);
afterAll(async () => {
  await configureGitHosts({});
  fs.rmSync(dataDir, { recursive: true, force: true });
  await teardown();
});

const users = Container.get(UserService);
const session = async (user) => {
  const token = generateToken({ userId: user._id });
  await User.updateOne({ _id: user._id }, { $push: { activeSessions: { token, expiresAt: new Date(Date.now() + 3600_000) } } });
  return `Bearer ${token}`;
};
const app = () => {
  const server = express();
  server.use(express.json());
  server.use('/api/lines', lineRouter);
  server.use('/api/products', productRouter);
  server.use(onError);
  return server;
};

let counter = 0;
const repoFor = async (owner, base) => {
  const provider = getLocalProvider();
  const name = `${base}${++counter}`;
  const group = await provider.createNamespace({ token: localTokenOf(owner), name });
  const repo = await provider.createRepository({ token: localTokenOf(owner), name, namespaceId: group.id });
  return { group, repo };
};
const lineOf = async (owner) => {
  const { group, repo } = await repoFor(owner, 'Team');
  return Line.create({ name: 'L', version: '1.0.0', ownerId: owner._id, gitHost: 'local', repoId: repo.id, namespaceId: group.id });
};
const productOf = async (owner, line) => {
  const { repo } = await repoFor(owner, 'Shop');
  return Product.create({ lineId: line._id, gitHost: 'local', spec: { basicData: { name: 'Shop', version: '1.0.0' } }, repo: { id: repo.id } });
};


// a branch that adds a file, made on the host with the token of the owner
const branchOf = async (owner, repoId, branch, path = 'docs/a.md', content = 'line one\nline two\n') => {
  const provider = getLocalProvider();
  const token = localTokenOf(owner);
  await provider.createBranch({ token, id: repoId, branch, ref: 'main' });
  await provider.commit({ token, id: repoId, branch, message: `add ${path}`, actions: [{ action: 'create', path, content }] });
};

test('merge requests of a line: open, list by origin, read the code, talk about it, edit, merge', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const auth = await session(ana);
  const base = `/api/lines/${line._id}/mrs`;
  const call = (method, url, payload) => request(app())[method](url).set('Authorization', auth).send(payload);
  await branchOf(ana, line.repoId, 'feature');
  await branchOf(ana, line.repoId, 'sync/20261030', 'sync.txt', 's');
  await branchOf(ana, line.repoId, 'bigbang', 'gen.txt', 'g');

  const made = await call('post', base, { title: 'Add the docs', description: '# Why', sourceBranch: 'feature', targetBranch: 'main', labels: ['bug'] });
  expect(made.status).toBe(201);
  expect(made.body).toMatchObject({ number: 1, state: 'opened', origin: 'manual', labels: ['bug'], author: 'ana' });
  const sync = (await call('post', base, { title: 'Sync with SPL', sourceBranch: 'sync/20261030', targetBranch: 'main' })).body;
  const generation = (await call('post', base, { title: 'Generation 1.0.1', sourceBranch: 'bigbang', targetBranch: 'main' })).body;
  expect([sync.origin, generation.origin]).toEqual(['sync', 'generation']);

  const origins = async (origin) => (await call('get', `${base}?origin=${origin}`)).body.items.map((item) => item.number);
  expect(await origins('all')).toEqual([3, 2, 1]);
  expect(await origins('manual')).toEqual([1]);
  expect(await origins('sync')).toEqual([2]);
  expect(await origins('generation')).toEqual([3]);

  const meta = await call('get', `${base}/meta`);
  expect(meta.body).toMatchObject({ host: 'local', defaultBranch: 'main', capabilities: { mergeRequests: { squash: true, approvals: false } } });
  expect(meta.body.branches).toEqual(expect.arrayContaining(['main', 'feature']));

  const files = (await call('get', `${base}/1/diff`)).body;
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ newPath: 'docs/a.md', status: 'added', additions: 2 });

  const thread = (await call('post', `${base}/1/threads`, { body: 'Why this word?', position: { path: 'docs/a.md', line: 2, side: 'new' } })).body;
  expect(thread).toMatchObject({ resolvable: true, resolved: false, position: { path: 'docs/a.md', line: 2, side: 'new' } });
  const answered = await call('post', `${base}/1/threads`, { body: 'To be clearer', threadId: thread.id });
  expect(answered.body.comments).toHaveLength(2);
  expect((await call('put', `${base}/1/threads/${thread.id}/resolved`, { resolved: true })).body.resolved).toBe(true);
  expect((await call('get', `${base}/1/threads`)).body).toHaveLength(1);

  expect((await call('patch', `${base}/1`, { title: 'Renamed', state: 'closed' })).body).toMatchObject({ title: 'Renamed', state: 'closed' });
  expect((await call('patch', `${base}/1`, { state: 'opened' })).body.state).toBe('opened');

  expect((await call('post', `${base}/1/approve`)).status).toBe(400);
  const merged = await call('post', `${base}/1/merge`, { squash: true, deleteSourceBranch: true });
  expect(merged).toMatchObject({ status: 200, body: { merged: true } });
  expect((await call('get', `${base}/1`)).body.state).toBe('merged');
  // already merged: it cannot be merged again
  expect((await call('post', `${base}/1/merge`, {})).status).toBe(409);
});

test('merge requests of a product live in the repository of the product', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const product = await productOf(ana, line);
  const auth = await session(ana);
  await branchOf(ana, product.repo.id, 'feature');
  const made = await request(app()).post(`/api/products/${product._id}/mrs`).set('Authorization', auth).send({ title: 'In the product', sourceBranch: 'feature', targetBranch: 'main' });
  expect(made.status).toBe(201);
  expect((await request(app()).get(`/api/lines/${line._id}/mrs`).set('Authorization', auth)).body.items).toEqual([]);
  expect((await request(app()).get(`/api/products/${product._id}/mrs`).set('Authorization', auth)).body.items).toHaveLength(1);
});

test('refuses what is wrong: no title, no such branch, a state that does not exist, a request that is not there, no session', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const auth = await session(ana);
  const base = `/api/lines/${line._id}/mrs`;
  expect((await request(app()).post(base).set('Authorization', auth).send({ title: ' ', sourceBranch: 'a', targetBranch: 'main' })).status).toBe(400);
  expect((await request(app()).post(base).set('Authorization', auth).send({ title: 'x', sourceBranch: 'nope', targetBranch: 'main' })).status).toBe(404);
  expect((await request(app()).get(`${base}?state=weird`).set('Authorization', auth)).status).toBe(400);
  expect((await request(app()).get(`${base}/99`).set('Authorization', auth)).status).toBe(404);
  expect((await request(app()).get(base)).status).toBe(401);
});
