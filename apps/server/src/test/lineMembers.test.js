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
import User from '../model/entities/user.js';
import { configureGitHosts, getLocalProvider } from '../model/git/index.js';
import { generateToken } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';
import lineRouter from '../rest/routers/lineRouter.js';

// Who works on a line of the local host is managed here (the other hosts have their own members to manage).
let dataDir;
beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-members-'));
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
  server.use(onError);
  return server;
};

const lineOf = async (owner) => {
  const provider = getLocalProvider();
  const group = await provider.createNamespace({ token: localTokenOf(owner), name: 'Team' });
  const repo = await provider.createRepository({ token: localTokenOf(owner), name: 'app', namespaceId: group.id });
  return Line.create({ name: 'L', version: '1.0.0', ownerId: owner._id, gitHost: 'local', repoId: repo.id, namespaceId: group.id });
};

test('the owner of a line gives a person a level, changes it, and takes it away; others cannot', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bob = await users.createLocalUser({ username: 'bob', password: 'correct-horse' });
  const line = await lineOf(ana);
  const [anaAuth, bobAuth] = [await session(ana), await session(bob)];

  const given = await request(app()).put(`/api/lines/${line._id}/members/bob`).set('Authorization', anaAuth).send({ role: 20 });
  expect(given.status).toBe(200);
  expect(given.body).toContainEqual({ username: 'bob', role: 20 });
  const raised = await request(app()).put(`/api/lines/${line._id}/members/bob`).set('Authorization', anaAuth).send({ role: 40 });
  expect(raised.body).toContainEqual({ username: 'bob', role: 40 });

  // a member is not the owner
  expect((await request(app()).put(`/api/lines/${line._id}/members/bob`).set('Authorization', bobAuth).send({ role: 40 })).status).toBe(403);
  // a level a member cannot have, and a person who has no account here
  expect((await request(app()).put(`/api/lines/${line._id}/members/bob`).set('Authorization', anaAuth).send({ role: 50 })).status).toBe(400);
  expect((await request(app()).put(`/api/lines/${line._id}/members/nobody`).set('Authorization', anaAuth).send({ role: 30 })).status).toBe(404);

  const listed = await request(app()).get(`/api/lines/${line._id}/members`).set('Authorization', bobAuth);
  expect(listed.body.map((member) => member.username).sort()).toEqual(['ana', 'bob']);
  const removed = await request(app()).delete(`/api/lines/${line._id}/members/bob`).set('Authorization', anaAuth);
  expect(removed.status).toBe(200);
});

test('a line of another host has its members managed there', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const line = await Line.create({ name: 'Remote', version: '1.0.0', ownerId: ana._id, gitHost: 'gitlab', repoId: 7 });
  const res = await request(app()).put(`/api/lines/${line._id}/members/bob`).set('Authorization', await session(ana)).send({ role: 30 });
  expect(res.status).toBe(409);
  expect(res.body.error).toBe('error_messages.members_on_host');
});
