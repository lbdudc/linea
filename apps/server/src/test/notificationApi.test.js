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
import notificationRouter from '../rest/routers/notificationRouter.js';

import { wireNotifications } from '../model/services/NotificationService.js';
import Notification from '../model/entities/notification.js';
import { forgetTemplates } from '../model/services/repositoryTemplates.js';

let dataDir;
beforeAll(async () => {
  await setup();
  wireNotifications();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-issues-'));
  await configureGitHosts({ file: { local: { dataDir }, gitlab: { enabled: false }, github: { enabled: false } } });
});
afterEach(async () => { forgetTemplates(); await clear(); });
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
  server.use('/api/notifications', notificationRouter);
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

const until = async (check) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
};

const inbox = async (user, filter = '') => request(app()).get(`/api/notifications${filter}`).set('Authorization', await session(user));

const twoPeople = async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bob = await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  const line = await lineOf(ana);
  return { ana, bob, line, anaAuth: await session(ana), bobAuth: await session(bob) };
};

test('an assignment tells the assignee, not the person who made it', async () => {
  const { ana, bob, line, anaAuth } = await twoPeople();
  await request(app()).post(`/api/lines/${line._id}/issues`).set('Authorization', anaAuth).send({ title: 'Fix it', assignees: ['bob', 'ana'] });
  const seen = await until(async () => (await inbox(bob)).body.items.length === 1 && (await inbox(bob)).body);
  expect(seen.items[0]).toMatchObject({ reason: 'assigned', subject: 'issue', number: 1, title: 'Fix it', actor: 'ana', read: false, target: { kind: 'line', id: String(line._id), name: 'L' } });
  expect(seen.unread).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect((await inbox(ana)).body.items).toEqual([]);
});

test('a mention in a comment tells the one mentioned, once, with the strongest reason', async () => {
  const { bob, line, anaAuth } = await twoPeople();
  const base = `/api/lines/${line._id}/issues`;
  await request(app()).post(base).set('Authorization', anaAuth).send({ title: 'Fix it', assignees: ['bob'] });
  await until(async () => (await inbox(bob)).body.items.length === 1);
  await request(app()).post(`${base}/1/comments`).set('Authorization', anaAuth).send({ body: 'ping @bob and mail@bob.example are different' });
  const seen = await until(async () => (await inbox(bob)).body.items.length === 2 && (await inbox(bob)).body);
  expect(seen.items[0]).toMatchObject({ reason: 'mentioned', excerpt: 'ping @bob and mail@bob.example are different' });
  expect(seen.items[1].reason).toBe('assigned');
});

test('a comment and a change of state reach whoever follows the issue', async () => {
  const { ana, bob, line, anaAuth, bobAuth } = await twoPeople();
  const base = `/api/lines/${line._id}/issues`;
  await request(app()).post(base).set('Authorization', bobAuth).send({ title: 'Mine' });
  await request(app()).post(`${base}/1/comments`).set('Authorization', anaAuth).send({ body: 'looking' });
  await request(app()).patch(`${base}/1`).set('Authorization', anaAuth).send({ state: 'closed' });
  const forBob = await until(async () => (await inbox(bob)).body.items.length === 2 && (await inbox(bob)).body);
  expect(forBob.items.map((item) => item.reason).sort()).toEqual(['comment', 'state']);
  await request(app()).post(`${base}/1/comments`).set('Authorization', bobAuth).send({ body: 'thanks' });
  const forAna = await until(async () => (await inbox(ana)).body.items.length === 1 && (await inbox(ana)).body);
  expect(forAna.items.map((item) => item.reason)).toEqual(['comment']);
});

test('merge request reviewers, comments and a merge notify too', async () => {
  const { ana, bob, line, anaAuth, bobAuth } = await twoPeople();
  await branchOf(ana, line.repoId, 'feature');
  const base = `/api/lines/${line._id}/mrs`;
  await request(app()).post(base).set('Authorization', anaAuth).send({ title: 'Add docs', sourceBranch: 'feature', targetBranch: 'main', reviewers: ['bob'] });
  await until(async () => (await inbox(bob)).body.items.length === 1);
  await request(app()).post(`${base}/1/threads`).set('Authorization', bobAuth).send({ body: 'looks good' });
  const merged = await request(app()).post(`${base}/1/merge`).set('Authorization', bobAuth).send({});
  expect(merged.body).toEqual({ merged: true });
  const forAna = await until(async () => (await inbox(ana)).body.items.length === 2 && (await inbox(ana)).body);
  expect(forAna.items.map((item) => `${item.subject}:${item.reason}`).sort()).toEqual(['mr:comment', 'mr:state']);
  expect((await inbox(bob)).body.items.map((item) => item.reason)).toEqual(['assigned']);
});

test('the inbox is read, filtered, cleared and kept apart per person', async () => {
  const { ana, bob, line, anaAuth, bobAuth } = await twoPeople();
  const base = `/api/lines/${line._id}/issues`;
  for (const title of ['One', 'Two', 'Three']) await request(app()).post(base).set('Authorization', anaAuth).send({ title, assignees: ['bob'] });
  const all = await until(async () => (await inbox(bob)).body.items.length === 3 && (await inbox(bob)).body);
  expect(all.items.map((item) => item.number)).toEqual([3, 2, 1]);

  const one = await request(app()).post('/api/notifications/read').set('Authorization', bobAuth).send({ ids: [all.items[0].id] });
  expect(one.body).toEqual({ unread: 2 });
  expect((await inbox(bob, '?unread=true')).body.items).toHaveLength(2);
  expect((await request(app()).post('/api/notifications/read').set('Authorization', await session(ana)).send({ ids: [all.items[1].id] })).body).toEqual({ unread: 0 });
  expect((await inbox(bob, '?unread=true')).body.items).toHaveLength(2);

  expect((await request(app()).post('/api/notifications/read').set('Authorization', bobAuth).send({})).body).toEqual({ unread: 0 });
  expect((await request(app()).delete(`/api/notifications/${all.items[0].id}`).set('Authorization', bobAuth)).body).toEqual({ unread: 0 });
  expect((await inbox(bob)).body.items).toHaveLength(2);
  expect(await Notification.countDocuments({ userId: ana._id })).toBe(0);
  expect((await request(app()).get('/api/notifications')).status).toBe(401);
  expect((await request(app()).get('/api/notifications?unread=maybe').set('Authorization', bobAuth)).status).toBe(400);
});

test('the templates of the local host are kept per repository and offered by the forms', async () => {
  const { line, anaAuth } = await twoPeople();
  const issues = `/api/lines/${line._id}/issues`;
  const requests = `/api/lines/${line._id}/mrs`;
  expect((await request(app()).get(`${issues}/meta`).set('Authorization', anaAuth)).body).toMatchObject({ templates: [], capabilities: { templates: { editable: true } } });

  expect((await request(app()).put(`${issues}/templates/Bug`).set('Authorization', anaAuth).send({ content: '## Steps' })).body).toEqual({ name: 'Bug', content: '## Steps' });
  await request(app()).put(`${issues}/templates/Idea`).set('Authorization', anaAuth).send({ content: '## Why' });
  await request(app()).put(`${requests}/templates/Default`).set('Authorization', anaAuth).send({ content: '## What changes' });
  expect((await request(app()).get(`${issues}/meta`).set('Authorization', anaAuth)).body.templates).toEqual([{ name: 'Bug', content: '## Steps' }, { name: 'Idea', content: '## Why' }]);
  expect((await request(app()).get(`${requests}/meta`).set('Authorization', anaAuth)).body.templates).toEqual([{ name: 'Default', content: '## What changes' }]);

  expect((await request(app()).delete(`${issues}/templates/Bug`).set('Authorization', anaAuth)).status).toBe(204);
  expect((await request(app()).delete(`${issues}/templates/Bug`).set('Authorization', anaAuth)).status).toBe(404);
  expect((await request(app()).get(`${issues}/meta`).set('Authorization', anaAuth)).body.templates.map((template) => template.name)).toEqual(['Idea']);
  expect((await request(app()).put(`${issues}/templates/%20`).set('Authorization', anaAuth).send({ content: 'x' })).status).toBe(400);
  expect((await request(app()).put(`${issues}/templates/Idea`).send({ content: 'x' })).status).toBe(401);
});

test('merging a request that says "Closes #N" closes the issue on the local host', async () => {
  const { ana, line, anaAuth } = await twoPeople();
  await request(app()).post(`/api/lines/${line._id}/issues`).set('Authorization', anaAuth).send({ title: 'To close' });
  await branchOf(ana, line.repoId, 'feature');
  await request(app()).post(`/api/lines/${line._id}/mrs`).set('Authorization', anaAuth).send({ title: 'Add docs', description: 'Closes #1', sourceBranch: 'feature', targetBranch: 'main' });
  expect((await request(app()).get(`/api/lines/${line._id}/issues/1`).set('Authorization', anaAuth)).body.state).toBe('opened');
  await request(app()).post(`/api/lines/${line._id}/mrs/1/merge`).set('Authorization', anaAuth).send({});
  expect((await request(app()).get(`/api/lines/${line._id}/issues/1`).set('Authorization', anaAuth)).body.state).toBe('closed');
});
