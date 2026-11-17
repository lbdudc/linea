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
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => ({}) }));

const { default: lineRouter } = await import('../rest/routers/lineRouter.js');
const { default: productRouter } = await import('../rest/routers/productRouter.js');
const { default: schedulerRouter } = await import('../rest/routers/schedulerRouter.js');
const { default: AutomationService } = await import('../model/services/AutomationService.js');
const { default: Line } = await import('../model/entities/line.js');
const { default: Product } = await import('../model/entities/product.js');
const { default: SyncRun } = await import('../model/entities/syncRun.js');
const { PermissionError } = await import('../model/errors/errors.js');
const { onError } = await import('../rest/common/onError.js');
const { setup, clear, teardown } = await import('./setup.js');

const service = Container.get(AutomationService);
const app = express();
app.use(express.json());
app.use('/api/lines', lineRouter);
app.use('/api/products', productRouter);
app.use('/api/scheduler', schedulerRouter);
app.use(onError);

let allowed;
beforeAll(setup);
afterAll(teardown);
afterEach(async () => { vi.restoreAllMocks(); await clear(); });

const seed = async (lineSync = { enabled: true, preset: '6h', behavior: 'mr' }) => {
  allowed = vi.spyOn(service.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({});
  const line = await Line.create({ name: 'shop', version: '2.0.0', repoId: 1, gitHost: 'gitlab', sync: lineSync });
  const product = await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 7 }, spec: { basicData: { name: 'p1', version: '1.0.0' } } });
  return { line, product };
};

describe('the sync defaults of a line', () => {
  test('are read with how many products follow them, have their own, or are off', async () => {
    const { line, product } = await seed();
    await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 8 }, spec: { basicData: { name: 'p2' } }, sync: { mode: 'custom' } });
    await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 9 }, spec: { basicData: { name: 'p3' } }, sync: { mode: 'off' } });
    const res = await request(app).get(`/api/lines/${line._id}/sync`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sync: { enabled: true, preset: '6h', behavior: 'mr' }, products: { total: 3, own: 1, off: 1 } });
    expect(product).toBeTruthy();
  });

  test('are saved, and the products that follow the line get a time that fits (not the ones with their own)', async () => {
    const { line, product } = await seed({ enabled: false });
    const own = await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 8 }, spec: { basicData: { name: 'p2' } }, sync: { mode: 'custom', preset: '1h' } });
    const res = await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { enabled: true, preset: '12h', behavior: 'merge' } });
    expect(res.status).toBe(200);
    expect(res.body.sync).toMatchObject({ enabled: true, preset: '12h', behavior: 'merge' });
    const followed = await Product.findById(product._id);
    expect(followed.nextSyncAt.getTime()).toBeGreaterThan(Date.now());
    expect(followed.nextSyncAt.getHours() % 12).toBe(0);
    expect((await Product.findById(own._id)).nextSyncAt).toBeNull();
  });

  test('refuse a schedule that is not valid, and turning it off clears the times', async () => {
    const { line, product } = await seed();
    const bad = await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { preset: 'cron', cron: '61 * * * *' } });
    expect(bad.status).toBe(400);
    expect((await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { preset: 'every-now-and-then' } })).status).toBe(400);
    expect((await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { preset: 'cron', cron: '0 4 * * 1-5' } })).status).toBe(200);
    await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { enabled: false } });
    expect((await Product.findById(product._id)).nextSyncAt).toBeNull();
  });

  test('a person without access gets a 403', async () => {
    const { line } = await seed();
    allowed.mockRejectedValue(new PermissionError());
    expect((await request(app).put(`/api/lines/${line._id}/sync`).send({ sync: { enabled: false } })).status).toBe(403);
  });
});

describe('the automation of a product', () => {
  test('says what applies and where it comes from', async () => {
    const { product } = await seed();
    const res = await request(app).get(`/api/products/${product._id}/automation`);
    expect(res.body).toMatchObject({
      sync: { mode: 'inherit', behavior: 'inherit' },
      generation: { bump: 'patch', autoMerge: true },
      effective: { enabled: true, source: 'line', preset: '6h', behavior: 'mr' },
    });
  });

  test('keeps the schedule of the line but decides on its own what a sync does', async () => {
    const { product } = await seed();
    const res = await request(app).put(`/api/products/${product._id}/automation`).send({ sync: { behavior: 'check' }, generation: { bump: 'minor', autoMerge: false } });
    expect(res.status).toBe(200);
    expect(res.body.effective).toMatchObject({ source: 'line', behavior: 'check' });
    expect(res.body.generation).toEqual({ bump: 'minor', autoMerge: false });
    expect(res.body.nextSyncAt).toBeTruthy();
  });

  test('an own schedule replaces the line\'s; "off" removes the time', async () => {
    const { product } = await seed();
    const own = await request(app).put(`/api/products/${product._id}/automation`).send({ sync: { mode: 'custom', preset: 'cron', cron: '15 2 * * *' } });
    expect(own.body.effective).toMatchObject({ source: 'product', cron: '15 2 * * *' });
    expect(new Date(own.body.nextSyncAt).getHours()).toBe(2);
    const off = await request(app).put(`/api/products/${product._id}/automation`).send({ sync: { mode: 'off' } });
    expect(off.body.effective.enabled).toBe(false);
    expect(off.body.nextSyncAt).toBeNull();
  });

  test('refuses what makes no sense', async () => {
    const { product } = await seed();
    const put = (body) => request(app).put(`/api/products/${product._id}/automation`).send(body);
    expect((await put({ sync: { mode: 'sometimes' } })).status).toBe(400);
    expect((await put({ generation: { bump: 'huge' } })).status).toBe(400);
    expect((await put({ sync: { mode: 'custom', preset: 'cron', cron: 'nope' } })).status).toBe(400);
  });

  test('lists its syncs, newest first', async () => {
    const { line, product } = await seed();
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status: 'unchanged', startedAt: new Date('2026-01-01') });
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'manual', behavior: 'mr', status: 'mr', startedAt: new Date('2026-02-01') });
    const res = await request(app).get(`/api/products/${product._id}/syncs`);
    expect(res.body.map((run) => run.status)).toEqual(['mr', 'unchanged']);
    const all = await request(app).get(`/api/lines/${line._id}/syncs`);
    expect(all.body).toHaveLength(2);
  });

  test('a missing product is a 404', async () => {
    await seed();
    expect((await request(app).get(`/api/products/${new mongoose.Types.ObjectId()}/automation`)).status).toBe(404);
  });
});

describe('a busy product', () => {
  test('is answered with 409 and who holds it', async () => {
    const { product } = await seed();
    const { takeLock, productLockId } = await import('../model/services/productLock.js');
    const release = await takeLock(productLockId(product._id), 'generate', { owner: 'ana' });
    const { default: ProductService } = await import('../model/services/ProductService.js');
    vi.spyOn(Container.get(ProductService).productRepository, 'findById').mockResolvedValue(product);
    vi.spyOn(Container.get(ProductService).lineRepository, 'findById').mockResolvedValue({ _id: product.lineId, repoId: 1, gitHost: 'gitlab', version: '2.0.0' });
    vi.spyOn(Container.get(ProductService).permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({ gitTokens: {} });
    vi.spyOn(Container.get(ProductService).productSpecService, 'getSpecFromHostOrCache').mockResolvedValue({ spec: product.spec, source: 'mongo' });
    const res = await request(app).post(`/api/products/${product._id}/sync`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'error_messages.product_locked', kind: 'generate' });
    await release();
  });
});

describe('the scheduler view', () => {
  const soon = (minutes) => new Date(Date.now() + minutes * 60_000);

  test('of an SPL only has its products; of a product only that one', async () => {
    const { line, product } = await seed();
    const other = await Line.create({ name: 'other', version: '1.0.0', repoId: 2, gitHost: 'gitlab' });
    await Product.updateOne({ _id: product._id }, { $set: { nextSyncAt: soon(90) } });
    const second = await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 8 }, spec: { basicData: { name: 'p2' } }, nextSyncAt: soon(120) });
    await Product.create({ lineId: other._id, gitHost: 'gitlab', repo: { id: 9 }, spec: { basicData: { name: 'elsewhere' } }, nextSyncAt: soon(60) });

    const ofLine = await request(app).get(`/api/scheduler?lineId=${line._id}`);
    expect(ofLine.status).toBe(200);
    expect(ofLine.body.upcoming.map((entry) => entry.product)).toEqual(['p1', 'p2']);
    const ofProduct = await request(app).get(`/api/scheduler?productId=${second._id}`);
    expect(ofProduct.body.upcoming.map((entry) => entry.product)).toEqual(['p2']);
  });

  test('shows what is queued and what is running for that SPL only', async () => {
    const { line, product } = await seed();
    await Product.updateOne({ _id: product._id }, { $set: { nextSyncAt: new Date(Date.now() - 60_000) } });
    await Product.create({ lineId: line._id, gitHost: 'gitlab', repo: { id: 8 }, spec: { basicData: { name: 'waiting' } }, nextSyncAt: new Date(Date.now() - 30_000) });
    const { takeLock, productLockId } = await import('../model/services/productLock.js');
    const release = await takeLock(productLockId(product._id), 'sync');
    const res = await request(app).get(`/api/scheduler?lineId=${line._id}`);
    expect(res.body.running).toEqual([expect.objectContaining({ product: 'p1', kind: 'sync', line: 'shop' })]);
    // what is running is not also waiting
    expect(res.body.queued.map((entry) => entry.product)).toEqual(['waiting']);
    const elsewhere = await Line.create({ name: 'quiet', version: '1.0.0', repoId: 3, gitHost: 'gitlab' });
    const quiet = await request(app).get(`/api/scheduler?lineId=${elsewhere._id}`);
    expect(quiet.body).toMatchObject({ running: [], queued: [], upcoming: [], skippedToday: 0 });
    await release();
  });

  test('lists the latest syncs, newest first, with the product they were of', async () => {
    const { line, product } = await seed();
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status: 'unchanged', startedAt: new Date('2026-01-01') });
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'manual', behavior: 'mr', status: 'drift', files: 2, startedAt: new Date('2026-02-01') });
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status: 'running' });
    const res = await request(app).get(`/api/scheduler?lineId=${line._id}`);
    expect(res.body.recent.map((run) => [run.status, run.product])).toEqual([['drift', 'p1'], ['unchanged', 'p1']]);
  });

  test('is refused to someone who cannot see the SPL', async () => {
    const { line, product } = await seed();
    allowed.mockRejectedValue(new PermissionError());
    expect((await request(app).get(`/api/scheduler?lineId=${line._id}`)).status).toBe(403);
    expect((await request(app).get(`/api/scheduler?productId=${product._id}`)).status).toBe(403);
  });
});
