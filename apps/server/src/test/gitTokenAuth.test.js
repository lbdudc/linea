import { vi, test, expect, beforeAll, beforeEach, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';
import { requireAuth, requireAdmin, clearGitTokenCache } from '../rest/common/auth.js';
import { onError } from '../rest/common/onError.js';

const getUser = vi.fn();
vi.mock('../model/git/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGitProvider: () => ({ getUser }),
}));

beforeAll(setup);
beforeEach(() => { getUser.mockReset(); clearGitTokenCache(); });
afterEach(clear);
afterAll(teardown);

const buildApp = () => {
  const app = express();
  app.get('/who', requireAuth, (req, res) => res.json({ userId: req.userId }));
  app.get('/admin', requireAdmin, (req, res) => res.json({ userId: req.userId }));
  app.use(onError);
  return app;
};

describe('Authorization: GitToken <token>', () => {
  test('a token of a host user that exists in LINEA authenticates as that user', async () => {
    const user = await new User({ username: 'ana' }).save();
    getUser.mockResolvedValue({ username: 'ana' });

    const res = await request(buildApp()).get('/who').set('Authorization', 'GitToken glpat-1');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(String(user._id));
    expect(getUser).toHaveBeenCalledWith({ token: 'glpat-1' });
  });

  test('is cached: the host is asked once for repeated requests with the same token', async () => {
    await new User({ username: 'ana' }).save();
    getUser.mockResolvedValue({ username: 'ana' });
    const app = buildApp();

    await request(app).get('/who').set('Authorization', 'GitToken glpat-1');
    await request(app).get('/who').set('Authorization', 'GitToken glpat-1');

    expect(getUser).toHaveBeenCalledTimes(1);
  });

  test('a token the host rejects is a 401', async () => {
    getUser.mockRejectedValue(new Error('401 Unauthorized'));

    const res = await request(buildApp()).get('/who').set('Authorization', 'GitToken nope');

    expect(res.status).toBe(401);
  });

  test('a host user that never logged in to LINEA is a 403 and is not created', async () => {
    getUser.mockResolvedValue({ username: 'stranger' });

    const res = await request(buildApp()).get('/who').set('Authorization', 'GitToken glpat-2');

    expect(res.status).toBe(403);
    expect(await User.countDocuments({ username: 'stranger' })).toBe(0);
  });

  test('an empty credential is a 401 without asking the host', async () => {
    const res = await request(buildApp()).get('/who').set('Authorization', 'GitToken');

    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  test('never stores the presented token', async () => {
    await new User({ username: 'ana', accessToken: 'saved-at-login' }).save();
    getUser.mockResolvedValue({ username: 'ana' });

    await request(buildApp()).get('/who').set('Authorization', 'GitToken glpat-1');

    const user = await User.findOne({ username: 'ana' });
    expect(user.accessToken).toBe('saved-at-login');
    expect(user.activeSessions).toHaveLength(0);
  });

  test('requireAdmin accepts it only for an admin', async () => {
    await new User({ username: 'ana' }).save();
    await new User({ username: 'root', admin: true }).save();
    const app = buildApp();

    getUser.mockResolvedValue({ username: 'ana' });
    expect((await request(app).get('/admin').set('Authorization', 'GitToken a')).status).toBe(403);

    getUser.mockResolvedValue({ username: 'root' });
    expect((await request(app).get('/admin').set('Authorization', 'GitToken b')).status).toBe(200);
  });

  test('a Bearer token still goes through the session check', async () => {
    const res = await request(buildApp()).get('/who').set('Authorization', 'Bearer not-a-jwt');

    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });
});
