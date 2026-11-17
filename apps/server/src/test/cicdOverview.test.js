import { vi, test, expect, beforeAll, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import mongoose from 'mongoose';

vi.mock('../rest/common/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdmin: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdminIf: () => (req, res, next) => next(),
}));

const { default: cicdRouter } = await import('../rest/routers/cicdRouter.js');
const { default: CicdService } = await import('../model/services/CicdService.js');
const { default: Log } = await import('../model/entities/log.js');
const { default: SyncRun } = await import('../model/entities/syncRun.js');
const { setup, clear, teardown } = await import('./setup.js');

const service = Container.get(CicdService);
const app = express();
app.use('/api/cicd', cicdRouter);

beforeAll(setup);
afterAll(teardown);
afterEach(async () => { vi.restoreAllMocks(); await clear(); });

const seed = async () => {
  const line = { _id: new mongoose.Types.ObjectId(), name: 'shop', version: '2.0.0' };
  const a = { _id: new mongoose.Types.ObjectId(), lineId: line._id, spec: { basicData: { name: 'p1' } } };
  const b = { _id: new mongoose.Types.ObjectId(), lineId: line._id, spec: { basicData: { name: 'p2' } } };
  vi.spyOn(service.lineService, 'findEnrolledLines').mockResolvedValue([line]);
  vi.spyOn(service.productService, 'findEnrolledProducts').mockResolvedValue([a, b]);
  const log = (product, version, type) => Log.create({ productId: product._id, productName: product.spec.basicData.name, lineId: line._id, lineName: 'shop', version, type, message: type });
  const run = (product, status, extra = {}) => SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status, version: '1.0.0', lineVersion: '2.0.0', ...extra });
  return { line, a, b, log, run };
};

describe('the CI/CD overview', () => {
  test('puts the generations and the syncs in one list, the newest first, each at the step it reached', async () => {
    const { a, b, log, run } = await seed();
    await log(a, '1.0.0', 'success');
    await log(b, '1.0.0', 'error');
    await run(a, 'mr', { mr: { number: 4, url: 'http://x/4' } });
    const res = await request(app).get('/api/cicd');
    expect(res.status).toBe(200);
    const byKind = (kind) => res.body.runs.filter((r) => r.kind === kind);
    expect(byKind('sync')).toHaveLength(1);
    expect(byKind('sync')[0]).toMatchObject({ productName: 'p1', status: 'mr', stage: 'merge', state: 'wait', mr: { number: 4 } });
    expect(byKind('generation').map((r) => [r.productName, r.stage, r.state])).toEqual(expect.arrayContaining([['p1', 'deployed', 'ok'], ['p2', 'derive', 'bad']]));
    expect(res.body.runs).toHaveLength(3);
  });

  test('counts what waits for a merge, what is out of date, what is running and what failed, by the last sync of each product', async () => {
    const { a, b, run } = await seed();
    await run(a, 'drift', { startedAt: new Date(Date.now() - 5000) });
    await run(a, 'mr');
    await run(b, 'drift');
    await run(b, 'failed', { startedAt: new Date(Date.now() - 1000) });
    const { body } = await request(app).get('/api/cicd');
    // a: its last is `mr`; b: its last (by time) is `drift`'s successor? failed is older than the drift just created
    expect(body.counts.awaitingMerge).toBe(1);
    expect(body.counts.outdated).toBe(1);
    expect(body.counts.failed).toBe(1);
    expect(body.outdated).toHaveLength(1);
  });

  test('brings how up to date the products are and the ones that fail most (what the page used to ask GET /dashboard for)', async () => {
    const { a, b, log, run } = await seed();
    await log(a, '1.0.0', 'success');
    await log(b, '1.0.0', 'error');
    await log(b, '1.0.1', 'error');
    await run(a, 'unchanged');
    const { body } = await request(app).get('/api/cicd');
    // every product has a log of its own just now: both count as recently synced, as they do on the home page
    expect(body.freshness).toEqual({ recent: 2, stale7: 0, stale30: 0, stale90: 0, never: 0 });
    expect(body.topFailing).toEqual([expect.objectContaining({ name: 'p2', lineName: 'shop', error: 2 })]);
    const one = await request(app).get(`/api/cicd?productId=${a._id}`);
    expect(one.body.freshness).toBeNull();
    expect(one.body.topFailing).toEqual([]);
  });

  test('narrows to one product and to one kind', async () => {
    const { a, b, log, run } = await seed();
    await log(a, '1.0.0', 'success');
    await run(b, 'unchanged');
    const one = await request(app).get(`/api/cicd?productId=${a._id}`);
    expect(one.body.runs.map((r) => r.productName)).toEqual(['p1']);
    const syncs = await request(app).get('/api/cicd?kind=sync');
    expect(syncs.body.runs.every((r) => r.kind === 'sync')).toBe(true);
  });

  test('counts the runs of each day, generations and syncs together', async () => {
    const { a, log, run } = await seed();
    await log(a, '1.0.0', 'success');
    await run(a, 'unchanged');
    await run(a, 'failed');
    const { body } = await request(app).get('/api/cicd?days=7');
    expect(body.series).toHaveLength(7);
    const today = body.series.at(-1);
    expect(today).toMatchObject({ success: 2, error: 1, total: 3 });
  });
});
