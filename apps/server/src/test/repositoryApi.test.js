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
import repositoryRouter from '../rest/routers/repositoryRouter.js';

// The code of a line (branches, files, commits) on the local host: the same routes whatever the host.
let dataDir;
beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-repo-'));
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
  server.use('/api/repos/:id', repositoryRouter('repo'));
  server.use(onError);
  return server;
};

test('branches, files and commits of a line', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const provider = getLocalProvider();
  const group = await provider.createNamespace({ token: localTokenOf(ana), name: 'Team' });
  const repo = await provider.createRepository({ token: localTokenOf(ana), name: 'Team', namespaceId: group.id });
  const line = await Line.create({ name: 'L', version: '1.0.0', ownerId: ana._id, gitHost: 'local', repoId: repo.id, namespaceId: group.id });
  const auth = await session(ana);
  const base = `/api/lines/${line._id}/repo`;
  const api = request(app());

  const info = await api.get(base).set('Authorization', auth).expect(200);
  const main = info.body.defaultBranch;

  const first = await api.post(`${base}/commits`).set('Authorization', auth)
    .send({ branch: main, message: 'add a', actions: [{ action: 'create', path: 'a.txt', content: 'hello' }] });
  expect(first.status).toBe(201);

  await api.post(`${base}/branches`).set('Authorization', auth).send({ branch: 'feature/x', ref: main }).expect(201);
  const branches = await api.get(`${base}/branches`).set('Authorization', auth).expect(200);
  expect(branches.body).toEqual(expect.arrayContaining([main, 'feature/x']));

  const file = await api.get(`${base}/file`).query({ path: 'a.txt', ref: 'feature/x' }).set('Authorization', auth).expect(200);
  expect(Buffer.from(file.body.content, 'base64').toString()).toBe('hello');
  await api.get(`${base}/file`).query({ path: 'nope.txt', ref: main }).set('Authorization', auth).expect(404);

  const files = await api.get(`${base}/files`).query({ ref: main }).set('Authorization', auth).expect(200);
  expect(files.body).toContain('a.txt');
  const commits = await api.get(`${base}/commits`).query({ ref: main }).set('Authorization', auth).expect(200);
  expect(commits.body.map((c) => c.title)).toContain('add a');

  // what a branch brought, by the repository's own id as well (a service knows a project, not the line)
  await api.post(`${base}/commits`).set('Authorization', auth)
    .send({ branch: 'feature/x', message: 'add b', actions: [{ action: 'create', path: 'b.txt', content: 'b' }] }).expect(201);
  const compared = await api.get(`${base}/compare`).query({ from: main, to: 'feature/x' }).set('Authorization', auth).expect(200);
  expect(compared.body.commits.map((c) => c.title)).toContain('add b');
  expect(compared.body.files.map((f) => f.newPath)).toEqual(['b.txt']);
  const byRepo = await api.get(`/api/repos/${repo.id}/branches`).query({ host: 'local' }).set('Authorization', auth).expect(200);
  expect(byRepo.body).toContain('feature/x');
  await api.get('/api/repos/99999/branches').query({ host: 'local' }).set('Authorization', auth).expect(404);
  // a branch that is there is the host's refusal, with what it said
  const again = await api.post(`${base}/branches`).set('Authorization', auth).send({ branch: 'feature/x', ref: main });
  expect(again.status).toBe(400);
  expect(again.body.detail).toMatch(/already exists/i);
  // without a public address and a secret there is no hook to ask for
  const hook = await api.post(`${base}/push-hook`).set('Authorization', auth).expect(200);
  expect(hook.body.status).toBe('unavailable');

  const archive = await api.get(`${base}/archive`).query({ ref: main }).set('Authorization', auth).buffer(true).parse((res, done) => { const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => done(null, Buffer.concat(parts))); }).expect(200);
  expect(archive.body.subarray(0, 2).toString()).toBe('PK');

  await api.get(`${base}/files`).set('Authorization', auth).expect(400);
  await api.get(base).expect(401);
});

test('who may do what: a reporter reads but gets 403 on writes, and nothing that looks like a git option gets through', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const eve = await users.createLocalUser({ username: 'eve', password: 'correct-horse' });
  const provider = getLocalProvider();
  const group = await provider.createNamespace({ token: localTokenOf(ana), name: 'Private' });
  const repo = await provider.createRepository({ token: localTokenOf(ana), name: 'Private', namespaceId: group.id });
  const line = await Line.create({ name: 'P', version: '1.0.0', ownerId: ana._id, gitHost: 'local', repoId: repo.id, namespaceId: group.id });
  // eve is a reporter of it: she reads, she does not write
  await provider.setMember({ token: localTokenOf(ana), id: repo.id, username: 'eve', accessLevel: 20 });
  const [owner, stranger] = [await session(ana), await session(eve)];
  const base = `/api/lines/${line._id}/repo`;
  const api = request(app());

  await api.get(`${base}/branches`).set('Authorization', stranger).expect(200);
  await api.post(`${base}/commits`).set('Authorization', stranger).send({ branch: 'main', message: 'x', actions: [{ action: 'create', path: 'a', content: 'x' }] }).expect(403);
  await api.post(`${base}/push-hook`).set('Authorization', stranger).expect(403);

  // option-looking refs, traversal in a commit, a host that is not one
  await api.get(`${base}/commits`).query({ ref: '--output=/tmp/pwned' }).set('Authorization', owner).expect(400);
  await api.get(`${base}/compare`).query({ from: 'main', to: '-x' }).set('Authorization', owner).expect(400);
  await api.post(`${base}/commits`).set('Authorization', owner).send({ branch: 'main', message: 'x', actions: [{ action: 'create', path: '../x', content: 'x' }] }).expect(400);
  await api.get(`${base}/branches`).query({ host: 'nowhere' }).set('Authorization', owner).expect(400);
  await api.get('/api/repos/not-a-number/branches').set('Authorization', owner).expect(404);
  await api.get('/api/lines/not-an-id/repo/branches').set('Authorization', owner).expect(404);
});
