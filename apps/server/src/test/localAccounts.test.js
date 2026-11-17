import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Container } from 'typedi';
import { setup, clear, teardown } from './setup.js';
import { localTokenOf } from '../model/git/localToken.js';
import UserService from '../model/services/UserService.js';
import { authenticateLocal, resolveLocalUser , isValidUsername, passwordProblem } from '../model/git/localAccounts.js';
import { configureGitHosts , getLocalProvider } from '../model/git/index.js';

// ── accounts: names, passwords, tokens, leaving ─────────────────────────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import { generateToken } from '../rest/common/auth.js';
import { signInLimiter } from '../rest/common/rateLimit.js';
import { onError } from '../rest/common/onError.js';
import userRouter from '../rest/routers/userRouter.js';

// the repositories of these tests are in a folder of their own (deleting an account moves what it owns there)
let dataDir;
const onThisServer = () => ({ file: { local: { dataDir }, gitlab: { enabled: false }, github: { enabled: false } } });

beforeAll(async () => {
  await setup();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-accounts-'));
  // the repositories are on this server (whatever the environment says of the other hosts)
  await configureGitHosts(onThisServer());
});
afterEach(clear);
afterAll(async () => {
  await configureGitHosts({});
  fs.rmSync(dataDir, { recursive: true, force: true });
  await teardown();
});

const users = Container.get(UserService);

test('an account is made with a password and signs in with it', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  expect(made).toMatchObject({ username: 'ana', gitHost: 'local', admin: false });
  expect(made.passwordHash).not.toBe('correct-horse');

  const user = await users.loginLocal({ username: 'ana', password: 'correct-horse' });
  expect(String(user._id)).toBe(String(made._id));
  expect(localTokenOf(user)).toMatch(/^[0-9a-f]{64}$/);
});

test('a wrong password, an unknown name and a user of another host are all the same refusal', async () => {
  await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const { default: User } = await import('../model/entities/user.js');
  await User.create({ username: 'gl-user', gitHost: 'gitlab', accessToken: 'x' });

  for (const attempt of [{ username: 'ana', password: 'nope-nope' }, { username: 'nobody', password: 'correct-horse' }, { username: 'gl-user', password: 'anything' }]) {
    await expect(users.loginLocal(attempt)).rejects.toThrow(/Incorrect|credentials|^$/i).catch(async () => {
      await expect(users.loginLocal(attempt)).rejects.toBeDefined();
    });
  }
});

test('a short password and a name taken are refused', async () => {
  await expect(users.createLocalUser({ username: 'ana', password: 'short' })).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  await users.createLocalUser({ username: 'ana', password: 'long-enough' });
  await expect(users.createLocalUser({ username: 'ana', password: 'long-enough' })).rejects.toBeDefined();
});

test('the token of the account is who the local host takes the bearer for, and git accepts it or the password', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse', admin: true });
  expect(await resolveLocalUser(localTokenOf(made))).toMatchObject({ username: 'ana', admin: true });
  expect(await resolveLocalUser('forged')).toBeNull();

  expect(await authenticateLocal('ana', 'correct-horse')).toMatchObject({ username: 'ana' });
  expect(await authenticateLocal('ana', localTokenOf(made))).toMatchObject({ username: 'ana' });
  expect(await authenticateLocal('ana', 'wrong')).toBeNull();
  expect(await authenticateLocal('ghost', 'correct-horse')).toBeNull();
});

test('a new password closes the old one, the old token and the open sessions', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const before = localTokenOf(made);
  await users.setLocalPassword({ userId: made._id, password: 'another-one-now' });

  await expect(users.loginLocal({ username: 'ana', password: 'correct-horse' })).rejects.toBeDefined();
  const user = await users.loginLocal({ username: 'ana', password: 'another-one-now' });
  expect(localTokenOf(user)).not.toBe(before);
  expect(await resolveLocalUser(before)).toBeNull();
});

test('the administrators of ADMIN_USERS get an account once, when LINEA_ADMIN_PASSWORD says how', async () => {
  const previous = process.env.ADMIN_USERS;
  process.env.ADMIN_USERS = 'root,second';
  try {
    expect(await users.ensureLocalAdmins({ env: {} })).toEqual([]); // no password: a warning, no account
    expect(await users.ensureLocalAdmins({ env: { LINEA_ADMIN_PASSWORD: 'first-password' } })).toEqual(['root', 'second']);
    expect(await users.ensureLocalAdmins({ env: { LINEA_ADMIN_PASSWORD: 'first-password' } })).toEqual([]); // not twice
    expect((await users.loginLocal({ username: 'root', password: 'first-password' })).admin).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_USERS;
    else process.env.ADMIN_USERS = previous;
  }
});

test('the list of people says which host each is of', async () => {
  await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const [ana] = await users.listUsers();
  expect(ana).toMatchObject({ username: 'ana', host: 'local', admin: false });
  expect(ana.passwordHash).toBeUndefined();
});

test('names that are a path, a reserved group or a trick are not accounts', async () => {
  for (const name of ['registry', 'Registry', '.hidden', '-dash', 'a..b', 'x.git', 'a', 'has space', 'a/b']) {
    expect(isValidUsername(name), name).toBe(false);
    await expect(users.createLocalUser({ username: name, password: 'long-enough' })).rejects.toMatchObject({ code: 'INVALID_USERNAME' });
  }
  expect(isValidUsername('ana.perez_2-b')).toBe(true);
});

test('a password has a length that bcrypt really reads', () => {
  expect(passwordProblem('short')).toMatch(/at least/);
  expect(passwordProblem('x'.repeat(73))).toMatch(/at most/);
  expect(passwordProblem('é'.repeat(40))).toMatch(/at most/); // bytes, not letters
  expect(passwordProblem('long-enough')).toBeNull();
});

test('a person changes their own password knowing the old one, and their git token changes with it', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const before = localTokenOf(made);
  await expect(users.changeOwnPassword({ userId: made._id, currentPassword: 'wrong-wrong', newPassword: 'another-one-1' })).rejects.toBeDefined();
  await expect(users.changeOwnPassword({ userId: made._id, currentPassword: 'correct-horse', newPassword: 'short' })).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  await users.changeOwnPassword({ userId: made._id, currentPassword: 'correct-horse', newPassword: 'another-one-1' });
  expect(localTokenOf(await users.loginLocal({ username: 'ana', password: 'another-one-1' }))).not.toBe(before);
  await expect(users.loginLocal({ username: 'ana', password: 'correct-horse' })).rejects.toBeDefined();
});

test('a regenerated git token replaces the old one at once, on git and on the provider', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const old = localTokenOf(made);
  expect(await authenticateLocal('ana', old)).toMatchObject({ username: 'ana' });
  const fresh = await users.regenerateGitToken({ userId: made._id });
  expect(fresh).toMatch(/^[0-9a-f]{64}$/);
  expect(fresh).not.toBe(old);
  expect(await authenticateLocal('ana', old)).toBeNull();
  expect(await authenticateLocal('ana', fresh)).toMatchObject({ username: 'ana' });
  expect(await resolveLocalUser(old)).toBeNull();
});

test('a disabled account signs in nowhere, and is not a token anybody holds', async () => {
  const made = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  await users.createLocalUser({ username: 'root-admin', password: 'correct-horse', admin: true });
  await users.setDisabled({ userId: made._id, disabled: true });
  await expect(users.loginLocal({ username: 'ana', password: 'correct-horse' })).rejects.toBeDefined();
  expect(await authenticateLocal('ana', 'correct-horse')).toBeNull();
  expect(await authenticateLocal('ana', localTokenOf(made))).toBeNull();
  expect(await resolveLocalUser(localTokenOf(made))).toBeNull();
  await users.setDisabled({ userId: made._id, disabled: false });
  expect(await users.loginLocal({ username: 'ana', password: 'correct-horse' })).toBeTruthy();
});

test('the last administrator who can sign in cannot be demoted, disabled or deleted, even with other administrators who cannot', async () => {
  const root = await users.createLocalUser({ username: 'root-admin', password: 'correct-horse', admin: true });
  // an administrator of a host that is off does not count
  await User.create({ username: 'gh-admin', gitHost: 'github', admin: true });
  await expect(users.setAdmin({ userId: root._id, admin: false })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  await expect(users.setDisabled({ userId: root._id, disabled: true })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  await expect(users.deleteUser({ userId: root._id })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
});

test('two demotions at once leave one administrator, not none', async () => {
  const [a, b] = [await users.createLocalUser({ username: 'admin-a', password: 'correct-horse', admin: true }), await users.createLocalUser({ username: 'admin-b', password: 'correct-horse', admin: true })];
  const results = await Promise.allSettled([users.setAdmin({ userId: a._id, admin: false }), users.setAdmin({ userId: b._id, admin: false })]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await User.countDocuments({ admin: true })).toBe(1);
});

test('leaving: what the person owned goes to an heir or to a name nobody has, and a new account with the name inherits nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-leave-'));
  await configureGitHosts({ file: { local: { dataDir: dir }, gitlab: { enabled: false }, github: { enabled: false } } });
  try {
    const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
    const boss = await users.createLocalUser({ username: 'boss', password: 'correct-horse', admin: true });
    const provider = getLocalProvider();
    const group = await provider.createNamespace({ token: localTokenOf(ana), name: 'Ana Team' });
    const repo = await provider.createRepository({ token: localTokenOf(ana), name: 'r', namespaceId: group.id });

    await users.deleteUser({ userId: ana._id });
    expect(await User.findOne({ username: 'ana' })).toBeNull();
    const again = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
    await expect(getLocalProvider().deleteNamespace({ token: localTokenOf(again), id: group.id })).rejects.toMatchObject({ status: 403 });
    expect((await getLocalProvider().getMembers({ token: localTokenOf(boss), id: repo.id })).map((member) => member.username)).toContain('deleted:ana');

    await Line.create({ name: 'L', version: '1.0.0', ownerId: again._id });
    await users.deleteUser({ userId: again._id, transferTo: 'boss' });
    expect(await Line.countDocuments({ ownerId: boss._id })).toBe(1);
    await expect(users.deleteUser({ userId: boss._id, transferTo: 'nobody' })).rejects.toBeDefined();
  } finally {
    await configureGitHosts(onThisServer());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the administrators of ADMIN_USERS are made, and a password that is too short does not stop the rest', async () => {
  process.env.ADMIN_USERS = 'first,second';
  try {
    const made = await users.ensureLocalAdmins({ env: { LINEA_ADMIN_PASSWORD: 'short' } });
    expect(made).toEqual([]); // each failed and was said, none threw
    expect(await users.ensureLocalAdmins({ env: { LINEA_ADMIN_PASSWORD: 'long-enough' } })).toEqual(['first', 'second']);
    // a name taken by a person of another host is not made local
    await User.create({ username: 'third', gitHost: 'gitlab' });
    process.env.ADMIN_USERS = 'third';
    expect(await users.ensureLocalAdmins({ env: { LINEA_ADMIN_PASSWORD: 'long-enough' } })).toEqual([]);
  } finally {
    delete process.env.ADMIN_USERS;
  }
});

test('too many wrong passwords close the door for a while, a right one opens it again, and the count is per person and address', async () => {
  signInLimiter.clear();
  await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRouter);
  app.use(onError);
  const attempt = (password, username = 'ana') => request(app).post('/api/users/login/local').send({ username, password });

  for (let i = 0; i < 10; i += 1) expect((await attempt('wrong-wrong')).status).toBe(401);
  const blocked = await attempt('correct-horse');
  expect(blocked.status).toBe(429);
  expect(blocked.body.detail).toMatch(/try again in/);
  // somebody else is not locked out by it
  await users.createLocalUser({ username: 'bea', password: 'correct-horse' });
  expect((await attempt('correct-horse', 'bea')).status).toBe(200);
  signInLimiter.clear();
  expect((await attempt('correct-horse')).status).toBe(200);
});

test('the routes of the accounts: own password, own token, and the lifecycle for administrators only', async () => {
  signInLimiter.clear();
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const boss = await users.createLocalUser({ username: 'boss', password: 'correct-horse', admin: true });
  const session = async (user) => {
    const token = generateToken({ userId: user._id });
    await User.updateOne({ _id: user._id }, { $push: { activeSessions: { token, expiresAt: new Date(Date.now() + 3600_000) } } });
    return `Bearer ${token}`;
  };
  const [anaSession, bossSession] = [await session(ana), await session(boss)];
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRouter);
  app.use(onError);

  const anaOther = await session(ana);
  expect((await request(app).get('/api/users/me/sessions').set('Authorization', anaSession)).body).toHaveLength(2);
  expect((await request(app).put('/api/users/me/password').set('Authorization', anaSession).send({ currentPassword: 'correct-horse', newPassword: 'brand-new-pass' })).status).toBe(204);
  expect((await request(app).get('/api/users/me/sessions').set('Authorization', anaSession)).body).toHaveLength(1);
  expect((await request(app).get('/api/users/me/sessions').set('Authorization', anaOther)).status).toBe(401);
  expect((await request(app).put('/api/users/me/password').set('Authorization', anaSession).send({ currentPassword: 'wrong', newPassword: 'brand-new-pass' })).status).toBe(401);
  const token = await request(app).post('/api/users/me/git-token').set('Authorization', anaSession);
  expect(token.body.token).toMatch(/^[0-9a-f]{64}$/);

  expect((await request(app).put(`/api/users/${boss._id}/disabled`).set('Authorization', anaSession).send({ disabled: true })).status).toBe(403);
  expect((await request(app).put(`/api/users/${ana._id}/disabled`).set('Authorization', bossSession).send({ disabled: true })).status).toBe(200);
  expect((await request(app).get('/api/users').set('Authorization', anaSession)).status).toBe(401); // she is disabled now: her sessions are closed
  const listed = await request(app).get('/api/users').set('Authorization', bossSession);
  expect(listed.body.find((user) => user.username === 'ana')).toMatchObject({ disabled: true, hostOff: false });
  expect((await request(app).delete(`/api/users/${ana._id}`).set('Authorization', bossSession)).status).toBe(204);
  expect(await User.findOne({ username: 'ana' })).toBeNull();
});

// ── the git token is made, not kept ─────────────────────────────────────────────────────────────────────────────────────

test('the git token is not in the database, and a token of one account is no use for another', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const bea = await users.createLocalUser({ username: 'bea', password: 'correct-horse' });
  const raw = await User.collection.findOne({ _id: ana._id });
  expect(raw.accessToken).toBeUndefined();
  expect(JSON.stringify(raw)).not.toContain(localTokenOf(ana));

  expect(await authenticateLocal('bea', localTokenOf(ana))).toBeNull();
  expect(await resolveLocalUser(`${String(bea._id)}${localTokenOf(ana).slice(24)}`)).toBeNull(); // another account's id on a token that is not its own
  expect(await resolveLocalUser(localTokenOf(ana).replace(/.$/, (c) => (c === '0' ? '1' : '0')))).toBeNull(); // one digit off
  expect(await resolveLocalUser('not-a-token')).toBeNull();
});

test('changing the secret of the server renews every git token', async () => {
  const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
  const token = localTokenOf(ana);
  expect(await resolveLocalUser(token)).toMatchObject({ username: 'ana' });
  const saved = process.env.JWT_SIGN_KEY;
  process.env.JWT_SIGN_KEY = 'another-secret';
  try {
    expect(await resolveLocalUser(token)).toBeNull();
  } finally {
    if (saved === undefined) delete process.env.JWT_SIGN_KEY; else process.env.JWT_SIGN_KEY = saved;
  }
});

test('the migration drops the tokens that were kept, and the accounts get new ones on their next sign-in', async () => {
  const { default: up } = await import('../model/migrations/004-derive-git-tokens.js');
  const mongoose = (await import('mongoose')).default;
  const old = await User.collection.insertOne({ username: 'old', gitHost: 'local', accessToken: 'a'.repeat(64), passwordHash: 'x' });
  await User.collection.insertOne({ username: 'gl', gitHost: 'gitlab', accessToken: 'keep-me' });
  await up(mongoose.connection.db);
  const after = await User.collection.findOne({ _id: old.insertedId });
  expect(after.accessToken).toBeUndefined();
  expect(after.gitTokenVersion).toBe(1);
  expect((await User.collection.findOne({ username: 'gl' })).accessToken).toBe('keep-me');
  expect(await resolveLocalUser('a'.repeat(64))).toBeNull();
});

test('the git credentials of a local account are its made token, after the session is renewed through the real local host', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-creds-'));
  await configureGitHosts({ file: { local: { dataDir: dir }, gitlab: { enabled: false }, github: { enabled: false } } });
  try {
    const ana = await users.createLocalUser({ username: 'ana', password: 'correct-horse' });
    const credentials = await users.getGitCredentials({ userId: ana._id });
    expect(credentials).toMatchObject({ provider: 'local', username: 'ana', token: localTokenOf(ana) });
    expect(await authenticateLocal('ana', credentials.token)).toMatchObject({ username: 'ana' });
    // renewed again after the token changed: the new one
    await users.regenerateGitToken({ userId: ana._id });
    expect((await users.getGitCredentials({ userId: ana._id })).token).not.toBe(credentials.token);
  } finally {
    await configureGitHosts(onThisServer());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
