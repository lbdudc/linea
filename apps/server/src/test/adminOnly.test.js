import { test, expect, beforeAll, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';
import { generateToken } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';
import { configureGitHosts } from '../model/git/index.js';
import pluginRouter from '../rest/routers/pluginRouter.js';
import settingsRouter from '../rest/routers/settingsRouter.js';
import userRouter from '../rest/routers/userRouter.js';

// the accounts of the tests are local ones: the local host is on, whatever the environment of the machine says
beforeAll(async () => { await setup(); await configureGitHosts({ file: { local: {} } }); });
afterEach(clear);
afterAll(async () => { await configureGitHosts({}); await teardown(); });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/plugins', pluginRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', userRouter);
  app.use(onError);
  return app;
};

// a person with a live session, as the login makes one
const signedIn = async (username, { admin = false } = {}) => {
  const user = await new User({ username, admin, gitHost: 'local' }).save();
  const token = generateToken({ userId: user._id });
  await User.updateOne({ _id: user._id }, { $push: { activeSessions: { token, expiresAt: new Date(Date.now() + 3600_000) } } });
  return `Bearer ${token}`;
};

// what only an administrator may read or change: the plugins, the git hosts, the people
const ADMIN_ROUTES = [
  ['get', '/api/plugins'],
  ['get', '/api/plugins/config.yml'],
  ['get', '/api/plugins/analytics-plugin/settings'],
  ['put', '/api/plugins/analytics-plugin/settings'],
  ['post', '/api/plugins/analytics-plugin/install'],
  ['post', '/api/plugins/analytics-plugin/enable'],
  ['post', '/api/plugins/analytics-plugin/disable'],
  ['delete', '/api/plugins/analytics-plugin'],
  ['get', '/api/settings/git-hosts'],
  ['put', '/api/settings/git-hosts/github'],
  ['get', '/api/settings/instance'],
  ['put', '/api/settings/instance'],
  ['get', '/api/settings/audit'],
  ['get', '/api/users'],
  ['post', '/api/users'],
  ['put', '/api/users/000000000000000000000000/password'],
  ['put', '/api/users/000000000000000000000000/admin'],
];

describe('configuration is for administrators', () => {
  test.each(ADMIN_ROUTES)('%s %s: nobody signed in is refused', async (method, url) => {
    expect((await request(buildApp())[method](url).send({})).status).toBe(401);
  });

  test.each(ADMIN_ROUTES)('%s %s: a person who is not an administrator is refused', async (method, url) => {
    const authorization = await signedIn('ana');
    expect((await request(buildApp())[method](url).set('Authorization', authorization).send({})).status).toBe(403);
  });

  test('an administrator reads them', async () => {
    const authorization = await signedIn('root', { admin: true });
    const app = buildApp();
    for (const url of ['/api/plugins', '/api/settings/git-hosts', '/api/settings/instance', '/api/settings/audit', '/api/users']) {
      expect((await request(app).get(url).set('Authorization', authorization)).status).toBe(200);
    }
  });

  test('an administrator can make another one, and cannot take the last one away', async () => {
    const authorization = await signedIn('root', { admin: true });
    const root = await User.findOne({ username: 'root' });
    const anaSession = await signedIn('ana');
    const ana = await User.findOne({ username: 'ana' });
    const app = buildApp();
    const setAdmin = (user, admin, as = authorization) => request(app).put(`/api/users/${user._id}/admin`).set('Authorization', as).send({ admin });

    expect((await setAdmin(root, false)).status).toBe(409); // the only one
    expect((await setAdmin(ana, true)).body).toMatchObject({ username: 'ana', admin: true });
    expect((await setAdmin(root, false)).status).toBe(200); // ana is one too
    expect((await User.findById(ana._id)).admin).toBe(true);
    expect((await setAdmin(ana, false, anaSession)).status).toBe(409); // now she is the only one
    expect((await setAdmin(ana, true, authorization)).status).toBe(403); // root is no administrator any more
  });

  test('what the page needs before anyone signs in stays public, and says nothing of the settings of the plugins', async () => {
    const res = await request(buildApp()).get('/api/plugins/enabled');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/settingsSchema|health/);
  });
});
