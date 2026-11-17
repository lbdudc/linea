import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

import healthRouter from '../rest/routers/healthRouter.js';
import { registerJob, recordRun, resetJobs } from '../utils/schedulerStatus.js';
import { resetReadinessCache } from '../rest/controllers/HealthController.js';

const hosts = { enabled: ['gitlab'] };
vi.mock('../model/git/index.js', () => ({
  enabledHosts: () => hosts.enabled,
  hostSettings: (kind) => (kind === 'local' ? { dataDir: '/data/repos' } : { url: 'http://gitlab.test' }),
}));

const local = { result: null };
vi.mock('@lbdudc/linea-git', () => ({
  version: '9.9.9',
  inspectLocalStore: vi.fn(() => local.result),
}));

const plugins = { list: [] };
vi.mock('../plugins/index.js', () => ({ pluginHost: { list: async () => plugins.list } }));

vi.mock('../rest/common/auth.js', () => ({
  // Test double: admin iff the x-test-admin header is present.
  requireAdmin: (req, res, next) =>
    req.headers['x-test-admin'] ? next() : res.status(401).json({ error: 'unauthorized' }),
}));

const mongoUp = () => {
  Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true });
  Object.defineProperty(mongoose.connection, 'db', {
    get: () => ({ admin: () => ({ ping: async () => ({ ok: 1 }) }) }),
    configurable: true,
  });
};
const mongoReset = () => {
  delete mongoose.connection.readyState;
  delete mongoose.connection.db;
};

const app = express();
app.use('/api/health', healthRouter);

beforeEach(() => {
  hosts.enabled = ['gitlab'];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 302 }));
  resetJobs();
  resetReadinessCache();
  plugins.list = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  mongoReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/health', () => {
  test('liveness is 200 without touching Mongo (mongo down)', async () => {
    expect(mongoose.connection.readyState).not.toBe(1);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('readiness is 503 when Mongo is down, with booleans only', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.mongo).toEqual({ ok: false });
  });

  test('readiness 200 exposes only booleans (no host, errors or job names)', async () => {
    mongoUp();
    registerJob('line-health', 1000);
    recordRun('line-health');
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { mongo: { ok: true }, gitHosts: { gitlab: { ok: true } }, scheduler: { ok: true } },
    });
    expect(JSON.stringify(res.body)).not.toContain('gitlab.test');
  });

  test('git host probe does not follow redirects', async () => {
    mongoUp();
    await request(app).get('/api/health/ready');
    expect(fetch).toHaveBeenCalledWith('http://gitlab.test', expect.objectContaining({ redirect: 'manual', method: 'HEAD' }));
  });

  test('readiness is 503 and hides the error when the git host is unreachable', async () => {
    mongoUp();
    fetch.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:443'));
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.gitHosts.gitlab).toEqual({ ok: false });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  test('the local host is checked with inspectLocalStore; the public body stays booleans', async () => {
    mongoUp();
    hosts.enabled = ['local'];
    const { inspectLocalStore } = await import('@lbdudc/linea-git');
    local.result = { dir: '/data/repos', ok: true, writable: true, lock: { held: false, stale: false } };
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(inspectLocalStore).toHaveBeenCalledWith('/data/repos');
    expect(fetch).not.toHaveBeenCalled();
    expect(res.body.checks.gitHosts).toEqual({ local: { ok: true } });
    expect(JSON.stringify(res.body)).not.toContain('/data/repos');

    resetReadinessCache();
    local.result = { dir: '/data/repos', ok: false, writable: true, lock: { held: true, stale: true, pid: 4242 } };
    const bad = await request(app).get('/api/health/ready');
    expect(bad.status).toBe(503);
    expect(bad.body.checks.gitHosts.local).toEqual({ ok: false });
    expect(JSON.stringify(bad.body)).not.toContain('4242');

    const details = await request(app).get('/api/health/details').set('x-test-admin', '1');
    expect(details.body.readiness.gitHosts[0]).toMatchObject({ name: 'local', ok: false, error: 'stale state lock', local: { lock: { stale: true, pid: 4242 } } });
  });

  test('a single scheduler failure stays ready; two in a row do not', async () => {
    mongoUp();
    registerJob('line-health', 1000);
    recordRun('line-health');
    recordRun('line-health', new Error('boom'));
    expect((await request(app).get('/api/health/ready')).status).toBe(200);
    resetReadinessCache();
    recordRun('line-health', new Error('boom'));
    expect((await request(app).get('/api/health/ready')).status).toBe(503);
  });

  test('a stale scheduler job (no run for >3 intervals) makes readiness 503', async () => {
    mongoUp();
    vi.useFakeTimers({ toFake: ['Date'] });
    registerJob('line-health', 1000);
    recordRun('line-health');
    vi.advanceTimersByTime(4000);
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.scheduler).toEqual({ ok: false });
  });

  test('readiness is cached: repeated calls probe once', async () => {
    mongoUp();
    await request(app).get('/api/health/ready');
    await request(app).get('/api/health/ready');
    await request(app).get('/api/health/ready');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('details rejects non-admins', async () => {
    const res = await request(app).get('/api/health/details');
    expect(res.status).toBe(401);
  });

  test('details returns versions and full readiness detail for admins', async () => {
    mongoUp();
    plugins.list = [
      { id: 'mcp', version: '1.2.0', enabled: true, health: 'up', loadError: null, secret: 'x' },
      { id: 'off', version: '1.0.0', enabled: false },
    ];
    registerJob('line-health', 1000);
    recordRun('line-health');
    const res = await request(app).get('/api/health/details').set('x-test-admin', '1');
    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveProperty('@lbdudc/linea-core'); // null when not installed
    expect(res.body.packages['@lbdudc/linea-git']).toBe('9.9.9');
    expect(res.body.plugins).toEqual([{ id: 'mcp', version: '1.2.0', health: 'up', loadError: null }]);
    expect(res.body).toMatchObject({
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
      node: process.version,
      readiness: {
        ok: true,
        mongo: { ok: true },
        gitHosts: [expect.objectContaining({ name: 'gitlab', host: 'http://gitlab.test', ok: true })],
        scheduler: { ok: true, jobs: [expect.objectContaining({ name: 'line-health', lastOk: true, intervalMs: 1000 })] },
      },
    });
  });
});
