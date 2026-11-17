import { test, expect, beforeAll, beforeEach, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';
import { requireAuth, requireAdmin } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';

beforeAll(setup);
beforeEach(() => { process.env.LINEA_SERVICE_KEYS = 'agents-plugin:s3cret,other:0ther'; });
afterEach(async () => { await clear(); delete process.env.LINEA_SERVICE_KEYS; });
afterAll(teardown);

const buildApp = () => {
  const app = express();
  app.get('/who', requireAuth, (req, res) => res.json({ userId: req.userId, service: req.serviceId ?? null }));
  app.get('/admin', requireAdmin, (req, res) => res.json({ userId: req.userId }));
  app.use(onError);
  return app;
};

describe('Authorization: Service <key> + X-Act-As: <username>', () => {
  test('a service with a known key acts as a person LINEA knows', async () => {
    const user = await new User({ username: 'ana' }).save();

    const res = await request(buildApp()).get('/who').set('Authorization', 'Service s3cret').set('X-Act-As', 'ana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: String(user._id), service: 'agents-plugin' });
  });

  test('a key LINEA does not know is a 401', async () => {
    await new User({ username: 'ana' }).save();
    const res = await request(buildApp()).get('/who').set('Authorization', 'Service nope').set('X-Act-As', 'ana');
    expect(res.status).toBe(401);
  });

  test('with no keys configured, no service key works', async () => {
    delete process.env.LINEA_SERVICE_KEYS;
    await new User({ username: 'ana' }).save();
    const res = await request(buildApp()).get('/who').set('Authorization', 'Service s3cret').set('X-Act-As', 'ana');
    expect(res.status).toBe(401);
  });

  test('a person that never logged in to LINEA is a 403 and is not created', async () => {
    const res = await request(buildApp()).get('/who').set('Authorization', 'Service s3cret').set('X-Act-As', 'stranger');

    expect(res.status).toBe(403);
    expect(await User.countDocuments({ username: 'stranger' })).toBe(0);
  });

  test('without X-Act-As there is nobody to act as: 401', async () => {
    const res = await request(buildApp()).get('/who').set('Authorization', 'Service s3cret');
    expect(res.status).toBe(401);
  });

  test('requireAdmin: a service acts on the routes of an administrator only with a key that says admin, and only for an administrator', async () => {
    process.env.LINEA_SERVICE_KEYS = 'agents-plugin:s3cret,ops#admin:0ps-key';
    await new User({ username: 'ana' }).save();
    await new User({ username: 'root', admin: true }).save();
    const app = buildApp();

    // the key of a plugin is not for those routes, even to act as an administrator
    expect((await request(app).get('/admin').set('Authorization', 'Service s3cret').set('X-Act-As', 'root')).status).toBe(403);
    // a key with the scope still only acts as someone who is one
    expect((await request(app).get('/admin').set('Authorization', 'Service 0ps-key').set('X-Act-As', 'ana')).status).toBe(403);
    expect((await request(app).get('/admin').set('Authorization', 'Service 0ps-key').set('X-Act-As', 'root')).status).toBe(200);
  });

  test('an id may have two keys while one is rotated, and the secret may hold a colon', async () => {
    process.env.LINEA_SERVICE_KEYS = 'agents-plugin:old-key,agents-plugin:new:key';
    await new User({ username: 'ana' }).save();
    const app = buildApp();
    expect((await request(app).get('/who').set('Authorization', 'Service old-key').set('X-Act-As', 'ana')).status).toBe(200);
    expect((await request(app).get('/who').set('Authorization', 'Service new:key').set('X-Act-As', 'ana')).status).toBe(200);
  });

  test('the keys a plugin brings count too', async () => {
    const { addServiceKeys } = await import('../rest/common/auth.js');
    addServiceKeys(() => [{ id: 'other-plugin', secret: 'from-a-setting' }]);
    await new User({ username: 'ana' }).save();
    const res = await request(buildApp()).get('/who').set('Authorization', 'Service from-a-setting').set('X-Act-As', 'ana');
    expect(res.body.service).toBe('other-plugin');
    addServiceKeys(() => []);
  });

  test('an account that was disabled is nobody, by session or by service', async () => {
    const { generateToken } = await import('../rest/common/auth.js');
    const user = await new User({ username: 'ana', disabled: true }).save();
    const token = generateToken({ userId: user._id });
    await User.updateOne({ _id: user._id }, { $push: { activeSessions: { token, expiresAt: new Date(Date.now() + 3600_000) } } });
    const app = buildApp();
    expect((await request(app).get('/who').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).get('/who').set('Authorization', 'Service s3cret').set('X-Act-As', 'ana')).status).toBe(403);
  });

  test('requireAdmin closes with the session: a logged-out administrator is a 401', async () => {
    const { generateToken } = await import('../rest/common/auth.js');
    const user = await new User({ username: 'root', admin: true }).save();
    const token = generateToken({ userId: user._id });
    // a valid JWT, but no open session: it was logged out
    expect((await request(buildApp()).get('/admin').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('never stores anything about the service on the user', async () => {
    await new User({ username: 'ana', accessToken: 'saved-at-login' }).save();
    await request(buildApp()).get('/who').set('Authorization', 'Service s3cret').set('X-Act-As', 'ana');

    const user = await User.findOne({ username: 'ana' });
    expect(user.accessToken).toBe('saved-at-login');
    expect(user.activeSessions).toHaveLength(0);
  });
});
