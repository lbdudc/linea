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

// The issues of a line and of a product, on the local host: the same routes whatever the host.
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

test('issues of a line: create, list with filters, edit, close, comment', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const auth = await session(ana);
  const base = `/api/lines/${line._id}/issues`;
  const call = (method, url, body) => request(app())[method](url).set('Authorization', auth).send(body);

  const made = await call('post', base, { title: 'It breaks', description: '# hi', labels: ['bug'], assignees: ['ana'] });
  expect(made.status).toBe(201);
  expect(made.body).toMatchObject({ number: 1, title: 'It breaks', state: 'opened', labels: ['bug'], assignees: ['ana'], author: 'ana' });
  await call('post', base, { title: 'Dark mode', labels: ['feature'] });

  const listed = await call('get', `${base}?labels=bug`);
  expect(listed.body.items.map((issue) => issue.number)).toEqual([1]);
  expect((await call('get', `${base}?search=dark`)).body.items.map((issue) => issue.number)).toEqual([2]);
  expect((await call('get', `${base}?perPage=1`)).body).toMatchObject({ page: 1, perPage: 1, hasMore: true });

  const closed = await call('patch', `${base}/1`, { state: 'closed' });
  expect(closed.body).toMatchObject({ state: 'closed', title: 'It breaks' });
  expect((await call('get', base)).body.items.map((issue) => issue.number)).toEqual([2]);

  const comment = await call('post', `${base}/2/comments`, { body: 'On it' });
  expect(comment.status).toBe(201);
  expect((await call('get', `${base}/2/comments`)).body.map((c) => c.body)).toEqual(['On it']);

  const meta = await call('get', `${base}/meta`);
  expect(meta.body).toMatchObject({ host: 'local', capabilities: { issues: { labels: true, milestones: true, assignees: true } } });
  expect(meta.body.labels.map((label) => label.name)).toEqual(['bug', 'feature']);

  // who put each label on and took it off
  await call('patch', `${base}/2`, { labels: ['feature', 'agent::evolve'] });
  await call('patch', `${base}/2`, { labels: ['agent::evolve'] });
  const events = await call('get', `${base}/2/label-events`);
  expect(events.status).toBe(200);
  expect(events.body.map((e) => `${e.author} ${e.action} ${e.label}`)).toEqual(['ana added feature', 'ana added agent::evolve', 'ana removed feature']);
});

test('issues of a product live in the repository of the product', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const product = await productOf(ana, line);
  const auth = await session(ana);
  const made = await request(app()).post(`/api/products/${product._id}/issues`).set('Authorization', auth).send({ title: 'Product issue' });
  expect(made.status).toBe(201);
  // the line has none of it
  const ofLine = await request(app()).get(`/api/lines/${line._id}/issues`).set('Authorization', auth);
  expect(ofLine.body.items).toEqual([]);
  expect((await request(app()).get(`/api/products/${product._id}/issues`).set('Authorization', auth)).body.items).toHaveLength(1);
});

test('refuses what is wrong: no title, a state that does not exist, an issue that is not there, and no session', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await lineOf(ana);
  const auth = await session(ana);
  const base = `/api/lines/${line._id}/issues`;
  expect((await request(app()).post(base).set('Authorization', auth).send({ title: '  ' })).status).toBe(400);
  expect((await request(app()).get(`${base}?state=weird`).set('Authorization', auth)).status).toBe(400);
  const missing = await request(app()).get(`${base}/99`).set('Authorization', auth);
  expect(missing.status).toBe(404);
  expect((await request(app()).get(base)).status).toBe(401);
});
