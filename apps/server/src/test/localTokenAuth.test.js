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
import { configureGitHosts } from '../model/git/index.js';
import { clearGitTokenCache, requireAdmin, requireAuth } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';

// A terminal or an MCP server signs in to a LINEA that keeps its repositories itself with the git token of an account:
// `Authorization: GitToken <token>` and `X-Git-Host` for the host that vouches for it.

let dataDir;
beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-tokenauth-'));
  await configureGitHosts({ file: { local: { dataDir }, gitlab: { enabled: false }, github: { enabled: false } } });
});
afterEach(async () => { await clear(); clearGitTokenCache(); });
afterAll(async () => {
  await configureGitHosts({});
  fs.rmSync(dataDir, { recursive: true, force: true });
  await teardown();
});

const app = () => {
  const server = express();
  server.get('/who', requireAuth, (req, res) => res.json({ userId: req.userId }));
  server.get('/admin', requireAdmin, (req, res) => res.json({ userId: req.userId }));
  server.use(onError);
  return server;
};
const users = Container.get(UserService);

test('the git token of a local account is a credential, on the routes of people and of administrators', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const boss = await users.createLocalUser({ username: 'boss', password: 'correct-horse', admin: true });

  expect((await request(app()).get('/who').set('Authorization', `GitToken ${localTokenOf(ana)}`).set('X-Git-Host', 'local')).body.userId).toBe(String(ana._id));
  expect((await request(app()).get('/admin').set('Authorization', `GitToken ${localTokenOf(ana)}`).set('X-Git-Host', 'local')).status).toBe(403);
  expect((await request(app()).get('/admin').set('Authorization', `GitToken ${localTokenOf(boss)}`).set('X-Git-Host', 'local')).status).toBe(200);
});

test('a host that is not on does not vouch, and a token that was renewed stops working at once', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  expect((await request(app()).get('/who').set('Authorization', `GitToken ${localTokenOf(ana)}`).set('X-Git-Host', 'github')).status).toBe(401);

  const old = localTokenOf(ana);
  expect((await request(app()).get('/who').set('Authorization', `GitToken ${old}`).set('X-Git-Host', 'local')).status).toBe(200);
  await users.regenerateGitToken({ userId: ana._id });
  expect((await request(app()).get('/who').set('Authorization', `GitToken ${old}`).set('X-Git-Host', 'local')).status).toBe(401);
});

test('an account that was disabled is refused with its token too', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  await users.createLocalUser({ username: 'boss', password: 'correct-horse', admin: true });
  await users.setDisabled({ userId: ana._id, disabled: true });
  expect((await request(app()).get('/who').set('Authorization', `GitToken ${localTokenOf(ana)}`).set('X-Git-Host', 'local')).status).toBe(401);
});
