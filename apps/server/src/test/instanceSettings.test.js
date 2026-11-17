import { test, expect, beforeAll, beforeEach, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import AuditEntry from '../model/entities/auditEntry.js';
import { setup, clear, teardown } from './setup.js';
import { generateToken } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';
import { configureGitHosts } from '../model/git/index.js';
import { configureInstance, instance, exportInstance } from '../config/instanceSettings.js';
import { mongoInstanceStore } from '../model/entities/instanceSetting.js';
import { pruneAudit } from '../model/audit.js';
import { getJwtExpirationSeconds } from '../model/connectors/properties.js';
import { passwordProblem } from '../model/git/localAccounts.js';
import { signInLimiter } from '../rest/common/rateLimit.js';
import { loadDeployConfig, toConfigYaml } from '../config/deployConfig.js';
import settingsRouter from '../rest/routers/settingsRouter.js';
import userRouter from '../rest/routers/userRouter.js';
import { registryRouter } from '../rest/routers/packageRouter.js';

beforeAll(async () => { await setup(); await configureGitHosts({ file: { local: {} } }); });
beforeEach(async () => { await configureInstance({ store: mongoInstanceStore }); });
afterEach(async () => { await settled(); await clear(); }); // an audit entry is written after the answer
afterAll(async () => { await configureInstance({}); await configureGitHosts({}); await teardown(); });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', userRouter);
  app.use('/api/registry', registryRouter);
  app.use(onError);
  return app;
};

const signedIn = async (username, { admin = false } = {}) => {
  const user = await new User({ username, admin, gitHost: 'local' }).save();
  const token = generateToken({ userId: user._id });
  await User.updateOne({ _id: user._id }, { $push: { activeSessions: { token, expiresAt: new Date(Date.now() + 3600_000) } } });
  return `Bearer ${token}`;
};

const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('instance settings', () => {
  test('defaults, then what an administrator saves, then back to the default', async () => {
    const root = await signedIn('root', { admin: true });
    const app = buildApp();
    expect(instance('maxFailedSignIns')).toBe(10);
    const saved = await request(app).put('/api/settings/instance').set('Authorization', root).send({ maxFailedSignIns: 3 });
    expect(saved.status).toBe(200);
    expect(saved.body.values.maxFailedSignIns).toBe(3);
    expect(instance('maxFailedSignIns')).toBe(3);
    expect(exportInstance()).toEqual({ maxFailedSignIns: 3 });
    await request(app).put('/api/settings/instance').set('Authorization', root).send({ maxFailedSignIns: null });
    expect(instance('maxFailedSignIns')).toBe(10);
  });

  test('values out of range or unknown are refused, and so is everything for those who are not administrators', async () => {
    const root = await signedIn('root', { admin: true });
    const ana = await signedIn('ana');
    const app = buildApp();
    expect((await request(app).put('/api/settings/instance').set('Authorization', root).send({ maxFailedSignIns: 0 })).status).toBe(400);
    expect((await request(app).put('/api/settings/instance').set('Authorization', root).send({ nope: 1 })).status).toBe(400);
    expect((await request(app).put('/api/settings/instance').set('Authorization', root).send({ modulesPublish: 'nobody' })).status).toBe(400);
    for (const [method, url] of [['get', '/api/settings/instance'], ['put', '/api/settings/instance'], ['get', '/api/settings/audit']]) {
      expect((await request(app)[method](url).send({})).status).toBe(401);
      expect((await request(app)[method](url).set('Authorization', ana).send({})).status).toBe(403);
    }
  });

  test('the file locks what it declares', async () => {
    await configureInstance({ file: { lockMinutes: 5 }, store: mongoInstanceStore });
    const root = await signedIn('root', { admin: true });
    expect(instance('lockMinutes')).toBe(5);
    const refused = await request(buildApp()).put('/api/settings/instance').set('Authorization', root).send({ lockMinutes: 9 });
    expect(refused.status).toBe(400);
    expect(refused.body.detail).toMatch(/linea.config.yml/);
  });

  test('the settings reach what they govern: session length, password length, sign-in limits', async () => {
    const root = await signedIn('root', { admin: true });
    await request(buildApp()).put('/api/settings/instance').set('Authorization', root).send({ sessionHours: 1, minPasswordLength: 12, maxFailedSignIns: 2 });
    expect(getJwtExpirationSeconds()).toBe(3600);
    expect(passwordProblem('elevenchars')).toMatch(/12/);
    expect(passwordProblem('twelve-chars')).toBeNull();
    signInLimiter.clear();
    const attempt = { ip: '10.0.0.1', key: 'ana' };
    signInLimiter.fail(attempt);
    expect(signInLimiter.blocked(attempt)).toBeNull();
    signInLimiter.fail(attempt);
    expect(signInLimiter.blocked(attempt)).toMatch(/Too many/);
    signInLimiter.clear();
  });

  test('registering modules can be left to administrators', async () => {
    const root = await signedIn('root', { admin: true });
    const ana = await signedIn('ana');
    const app = buildApp();
    await request(app).put('/api/settings/instance').set('Authorization', root).send({ modulesRegister: 'admins' });
    expect((await request(app).post('/api/registry').set('Authorization', ana).send({ location: 'x' })).status).toBe(403);
    expect((await request(app).delete('/api/registry?location=x').set('Authorization', ana)).status).toBe(403);
  });
});

describe('audit log', () => {
  test('records who changed what, newest first, and nothing for what failed', async () => {
    const root = await signedIn('root', { admin: true });
    const app = buildApp();
    await request(app).put('/api/settings/instance').set('Authorization', root).send({ lockMinutes: 30 });
    await request(app).put('/api/settings/instance').set('Authorization', root).send({ lockMinutes: 0 }); // refused
    await request(app).post('/api/users').set('Authorization', root).send({ username: 'bea', password: 'long-enough-password' });
    await settled();
    const log = await request(app).get('/api/settings/audit').set('Authorization', root);
    expect(log.status).toBe(200);
    expect(log.body.map((entry) => entry.action)).toEqual(['user.create', 'settings.instance']);
    expect(log.body[0]).toMatchObject({ actor: 'root', target: 'bea' });
    expect(log.body[1].detail).toEqual({ changes: { lockMinutes: 30 } });
    const filtered = await request(app).get('/api/settings/audit?action=user').set('Authorization', root);
    expect(filtered.body).toHaveLength(1);
    const paged = await request(app).get(`/api/settings/audit?limit=1&before=${log.body[0].id}`).set('Authorization', root);
    expect(paged.body.map((entry) => entry.action)).toEqual(['settings.instance']);
  });

  test('forgets what is older than the retention', async () => {
    await AuditEntry.create({ action: 'old', at: new Date(Date.now() - 400 * 86_400_000) });
    await AuditEntry.create({ action: 'new' });
    expect(await pruneAudit()).toBe(1);
    expect((await AuditEntry.find()).map((entry) => entry.action)).toEqual(['new']);
  });
});

describe('the file', () => {
  test('the instance block is read, checked and exported', () => {
    const { instance: block, warnings } = loadDeployConfig({ file: new URL('./support/instance.config.yml', import.meta.url).pathname });
    expect(block).toEqual({ sessionHours: 4 });
    expect(warnings.join('\n')).toMatch(/instance.maxFailedSignIns/);
    expect(toConfigYaml({ plugins: [], instance: block })).toMatch(/instance:\n {2}sessionHours: 4/);
  });
});
