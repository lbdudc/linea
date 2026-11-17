import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import SyncRun from '../model/entities/syncRun.js';
import SyncScheduler from '../model/services/scheduler/SyncScheduler.js';
import { configureInstance } from '../config/instanceSettings.js';
import { takeLock, productLockId, LockedError } from '../model/services/productLock.js';
import { setup, clear, teardown } from './setup.js';

beforeAll(setup);
afterEach(async () => { await configureInstance({}); await clear(); });
afterAll(teardown);

const NOW = new Date('2026-03-10T12:00:00');
const OWNER = new mongoose.Types.ObjectId();

const makeLine = (sync = {}) => Line.create({ name: `line-${Math.random()}`, version: '1.0.0', ownerId: OWNER, sync: { enabled: true, preset: '6h', behavior: 'mr', ...sync } });
const makeProduct = (line, patch = {}) => Product.create({
  lineId: line._id, repo: { id: 1 }, spec: { basicData: { name: `p-${Math.random()}`, version: '1.0.0' } }, ...patch,
});
const due = (minutes = 1) => new Date(NOW.getTime() - minutes * 60_000);

const scheduler = (sync = vi.fn().mockResolvedValue({})) => ({ sync, scheduler: new SyncScheduler({ sync, now: () => NOW }) });

describe('the scheduler', () => {
  it('starts a sync of what is due, as the owner of the line, and moves the product to its next time', async () => {
    const line = await makeLine();
    const product = await makeProduct(line, { nextSyncAt: due() });
    const { sync, scheduler: s } = scheduler();
    expect((await s.tick()).started).toEqual([String(product._id)]);
    await s.idle();
    expect(sync).toHaveBeenCalledWith({ id: String(product._id), userId: String(OWNER), trigger: 'cron' });
    expect((await Product.findById(product._id)).nextSyncAt.getTime()).toBe(new Date('2026-03-10T18:00:00').getTime());
  });

  it('leaves alone what is not due yet', async () => {
    const line = await makeLine();
    await makeProduct(line, { nextSyncAt: new Date(NOW.getTime() + 60_000) });
    const { sync, scheduler: s } = scheduler();
    expect((await s.tick()).started).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('gives a product that has no time yet its first one a period from now, not at once', async () => {
    const line = await makeLine();
    const product = await makeProduct(line);
    const { sync, scheduler: s } = scheduler();
    await s.tick();
    expect(sync).not.toHaveBeenCalled();
    expect((await Product.findById(product._id)).nextSyncAt.getTime()).toBe(new Date('2026-03-10T18:00:00').getTime());
  });

  it('does not seed a product that is off, nor one of a line with sync off', async () => {
    const on = await makeLine();
    const off = await makeLine({ enabled: false });
    const a = await makeProduct(on, { sync: { mode: 'off' } });
    const b = await makeProduct(off);
    await scheduler().scheduler.tick();
    expect((await Product.findById(a._id)).nextSyncAt).toBeNull();
    expect((await Product.findById(b._id)).nextSyncAt).toBeNull();
  });

  it('a product with its own schedule runs even when its line has sync off', async () => {
    const line = await makeLine({ enabled: false });
    const product = await makeProduct(line, { sync: { mode: 'custom', preset: 'cron', cron: '30 12 * * *' } });
    await scheduler().scheduler.tick();
    expect((await Product.findById(product._id)).nextSyncAt.getTime()).toBe(new Date('2026-03-10T12:30:00').getTime());
  });

  it('stops scheduling what was switched off after it was given a time', async () => {
    const line = await makeLine({ enabled: false });
    const product = await makeProduct(line, { nextSyncAt: due() });
    const { sync, scheduler: s } = scheduler();
    await s.tick();
    expect(sync).not.toHaveBeenCalled();
    expect((await Product.findById(product._id)).nextSyncAt).toBeNull();
  });

  it('runs no more at once than the concurrency allows, oldest first; the rest wait for the next tick', async () => {
    const line = await makeLine();
    const oldest = await makeProduct(line, { nextSyncAt: due(30) });
    const middle = await makeProduct(line, { nextSyncAt: due(20) });
    await makeProduct(line, { nextSyncAt: due(10) });
    const { scheduler: s } = scheduler(); // concurrency 2 by default
    const result = await s.tick();
    expect(result.started).toEqual([String(oldest._id), String(middle._id)]);
    expect(result.waiting).toBe(1);
  });

  it('counts the syncs that are still running (here or on another server) against the concurrency', async () => {
    const line = await makeLine();
    const running = await makeProduct(line);
    await makeProduct(line, { nextSyncAt: due(2) });
    await makeProduct(line, { nextSyncAt: due(1) });
    const release = await takeLock(productLockId(running._id), 'sync');
    const { scheduler: s } = scheduler();
    expect((await s.tick()).started).toHaveLength(1);
    await release();
  });

  it('does not tick while paused', async () => {
    const line = await makeLine();
    await makeProduct(line, { nextSyncAt: due() });
    const { sync, scheduler: s } = scheduler();
    await configureInstance({ file: { schedulerPaused: true } });
    expect(await s.tick()).toEqual({ started: [], waiting: 0 });
    expect(sync).not.toHaveBeenCalled();
  });

  it('never starts the same product twice, whoever ticks', async () => {
    const line = await makeLine();
    await makeProduct(line, { nextSyncAt: due() });
    const sync = vi.fn().mockResolvedValue({});
    const one = new SyncScheduler({ sync, now: () => NOW });
    const two = new SyncScheduler({ sync, now: () => NOW });
    await Promise.all([one.tick(), two.tick()]);
    await Promise.all([one.idle(), two.idle()]);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('records as skipped a product that someone is generating, and tries again at its next time', async () => {
    const line = await makeLine();
    const product = await makeProduct(line, { nextSyncAt: due() });
    const { scheduler: s } = scheduler(vi.fn().mockRejectedValue(new LockedError('x', { kind: 'generate' })));
    await s.tick();
    await s.idle();
    expect(await SyncRun.findOne()).toMatchObject({ status: 'skipped', reason: 'busy', trigger: 'cron' });
    expect((await Product.findById(product._id)).nextSyncAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('records a failure that happened before the sync could, but not one it recorded itself', async () => {
    const line = await makeLine();
    await makeProduct(line, { nextSyncAt: due() });
    const unrecorded = new SyncScheduler({ sync: vi.fn().mockRejectedValue(new Error('no access')), now: () => NOW });
    await unrecorded.tick();
    await unrecorded.idle();
    expect(await SyncRun.find()).toHaveLength(1);
    expect(await SyncRun.findOne()).toMatchObject({ status: 'failed', reason: 'no access' });

    await clear();
    const line2 = await makeLine();
    await makeProduct(line2, { nextSyncAt: due() });
    const recorded = new SyncScheduler({ sync: vi.fn().mockRejectedValue(Object.assign(new Error('boom'), { syncRunRecorded: true })), now: () => NOW });
    await recorded.tick();
    await recorded.idle();
    expect(await SyncRun.countDocuments()).toBe(0);
  });

  it('skips the products of a line nobody owns', async () => {
    const line = await Line.create({ name: 'orphan', version: '1.0.0', sync: { enabled: true, preset: '6h' } });
    await makeProduct(line, { nextSyncAt: due() });
    const { sync, scheduler: s } = scheduler();
    await s.tick();
    await s.idle();
    expect(sync).not.toHaveBeenCalled();
    expect(await SyncRun.findOne()).toMatchObject({ status: 'skipped', reason: 'no-owner' });
  });

  it('says what is running, queued and coming in the next day', async () => {
    const line = await makeLine();
    const running = await makeProduct(line);
    await makeProduct(line, { nextSyncAt: due() });
    await makeProduct(line, { nextSyncAt: new Date(NOW.getTime() + 3600_000) });
    await makeProduct(line, { nextSyncAt: new Date(NOW.getTime() + 3 * 24 * 3600_000) });
    const release = await takeLock(productLockId(running._id), 'generate', { owner: 'ana' });
    const status = await scheduler().scheduler.status();
    expect(status).toMatchObject({ paused: false, concurrency: 2 });
    expect(status.running).toEqual([expect.objectContaining({ productId: String(running._id), kind: 'generate' })]);
    expect(status.queued).toHaveLength(1);
    expect(status.upcoming).toHaveLength(1);
    await release();
  });
});
