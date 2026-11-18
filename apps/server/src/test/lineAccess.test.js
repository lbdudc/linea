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
import AuditEntry from '../model/entities/auditEntry.js';
import { configureGitHosts, getLocalProvider } from '../model/git/index.js';
import { generateToken } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';
import lineRouter from '../rest/routers/lineRouter.js';
import productRouter from '../rest/routers/productRouter.js';

// LINEA writes who reaches the repositories of a line and of its products to the git host (here the local one, which has real levels).
let dataDir;
beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-access-'));
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

let groups = 0;
const lineWithProduct = async (owner) => {
  const provider = getLocalProvider();
  const token = localTokenOf(owner);
  const group = await provider.createNamespace({ token, name: `Team-${++groups}` });
  const repo = await provider.createRepository({ token, name: 'app', namespaceId: group.id });
  const line = await Line.create({ name: 'L', version: '1.0.0', ownerId: owner._id, gitHost: 'local', repoId: repo.id, namespaceId: group.id });
  const productRepo = await provider.createRepository({ token, name: 'p1', namespaceId: group.id });
  const product = await Product.create({ lineId: line._id, gitHost: 'local', repo: { id: productRepo.id }, spec: { basicData: { name: 'p1' } } });
  return { line, product, provider, token, repo, productRepo };
};

test('access given to a line reaches its products, a product can differ, and every change is in the audit log', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bob = await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  const { line, product, provider, token, repo, productRepo } = await lineWithProduct(ana);
  const auth = await session(ana);
  const levelOf = async (id) => (await provider.getMembers({ token, id })).find((member) => member.username === 'bob')?.accessLevel;

  const given = await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', auth).send({ role: 30 });
  expect(given.status).toBe(200);
  expect(given.body.failures).toEqual([]);
  expect(given.body.access.entries).toContainEqual({ username: 'bob', accessLevel: 30, source: 'direct', managed: true });
  expect(given.body.access.drift).toEqual({ missing: [], unknown: [] });
  expect([await levelOf(repo.id), await levelOf(productRepo.id)]).toEqual([30, 30]);

  // one product closes itself to bob, and the line no longer reaches it
  const closed = await request(app()).put(`/api/products/${product._id}/access/bob`).set('Authorization', auth).send({ role: 0 });
  expect(closed.status).toBe(200);
  expect(await levelOf(productRepo.id)).toBeUndefined();
  await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', auth).send({ role: 40 });
  expect([await levelOf(repo.id), await levelOf(productRepo.id)]).toEqual([40, undefined]);

  // it follows the line again
  await request(app()).delete(`/api/products/${product._id}/access/bob`).set('Authorization', auth);
  expect(await levelOf(productRepo.id)).toBe(40);

  const removed = await request(app()).delete(`/api/lines/${line._id}/access/bob`).set('Authorization', auth);
  expect(removed.status).toBe(200);
  expect([await levelOf(repo.id), await levelOf(productRepo.id)]).toEqual([undefined, undefined]);

  const actions = (await AuditEntry.find().sort({ _id: 1 }).lean()).map((entry) => entry.action);
  expect(actions).toEqual(['access.set', 'access.product.set', 'access.set', 'access.product.clear', 'access.remove']);
});

test('a change made on the host is seen as drift and re-applied, and unknown access is only removed when asked', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  await users.createLocalUser({ username: 'eve', password: 'correct-horse' });
  const { line, provider, token, repo } = await lineWithProduct(ana);
  const auth = await session(ana);
  await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', auth).send({ role: 30 });

  await provider.setMember({ token, id: repo.id, username: 'bob', accessLevel: 20 });
  await provider.setMember({ token, id: repo.id, username: 'eve', accessLevel: 40 });
  const seen = await request(app()).get(`/api/lines/${line._id}/access`).set('Authorization', auth);
  expect(seen.body.drift).toEqual({ missing: [{ username: 'bob', level: 30, found: 20 }], unknown: [{ username: 'eve', level: 40 }] });

  const kept = await request(app()).post(`/api/lines/${line._id}/access/reapply`).set('Authorization', auth).send({});
  expect(kept.body.access.drift).toEqual({ missing: [], unknown: [{ username: 'eve', level: 40 }] });
  const cleaned = await request(app()).post(`/api/lines/${line._id}/access/reapply`).set('Authorization', auth).send({ removeUnknown: true });
  expect(cleaned.body.access.drift).toEqual({ missing: [], unknown: [] });
});

test('only people who can manage access change it, the host\'s people are searched, and a level the host cannot give is refused', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bob = await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  const { line } = await lineWithProduct(ana);
  const [anaAuth, bobAuth] = [await session(ana), await session(bob)];
  await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', anaAuth).send({ role: 30 });

  expect((await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', bobAuth).send({ role: 40 })).status).toBe(403);
  expect((await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', anaAuth).send({ role: 50 })).status).toBe(400);
  expect((await request(app()).put(`/api/lines/${line._id}/access/nobody`).set('Authorization', anaAuth).send({ role: 30 })).status).toBe(404);
  const asBob = await request(app()).get(`/api/lines/${line._id}/access`).set('Authorization', bobAuth);
  expect(asBob.status).toBe(200);
  expect(asBob.body.canManage).toBe(false);
  const found = await request(app()).get(`/api/lines/${line._id}/access/users?q=bo`).set('Authorization', anaAuth);
  expect(found.body.map((user) => user.username)).toEqual(['bob']);
});

test('the merge request page is told the level of the person, so it can say why merging is off', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bob = await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  const { line } = await lineWithProduct(ana);
  const anaAuth = await session(ana);
  await request(app()).put(`/api/lines/${line._id}/access/bob`).set('Authorization', anaAuth).send({ role: 20 });
  const asBob = await request(app()).get(`/api/lines/${line._id}/mrs/meta`).set('Authorization', await session(bob));
  expect(asBob.status).toBe(200);
  expect(asBob.body.myLevel).toBe(20);
  expect((await request(app()).get(`/api/lines/${line._id}/mrs/meta`).set('Authorization', anaAuth)).body.myLevel).toBe(50);
});
