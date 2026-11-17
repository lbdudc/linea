import Product from '../../entities/product.js';
import Line from '../../entities/line.js';
import SyncRun from '../../entities/syncRun.js';
import { instance } from '../../../config/instanceSettings.js';
import { takeLock, heldLocks, LockedError } from '../productLock.js';
import { registerJob, recordRun } from '../../../utils/schedulerStatus.js';
import { effectiveSync, nextSyncFor } from './schedule.js';

const TICK_MS = 60_000;
const DAY_MS = 24 * 3600_000;
const RECENT = 8;

/**
 * Runs the syncs that are due. Every minute it looks for products whose `nextSyncAt` has come, oldest first, and starts as many as
 * `syncConcurrency` leaves room for (counting what is running on any server: the product locks are in Mongo). The rest wait for the next
 * minute, which is the queue. A product that is busy (a person is generating it) is not synced then: it is recorded as skipped and tried at
 * its next time, so a sync never tramples a generation, nor another sync.
 *
 * `sync` is `ProductService.syncProduct`; it is injected so this can be tested without git.
 */
export default class SyncScheduler {
  #timer = null;
  #running = new Set();

  constructor({ sync, now = () => new Date() }) {
    this.sync = sync;
    this.now = now;
  }

  start(everyMs = TICK_MS) {
    if (this.#timer) return;
    registerJob('sync-scheduler', everyMs); // read by /api/health/ready
    this.#timer = setInterval(() => this.tick().then(() => recordRun('sync-scheduler')).catch((error) => {
      recordRun('sync-scheduler', error);
      console.error('[scheduler] tick failed:', error?.message ?? error);
    }), everyMs);
    this.#timer.unref?.();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Resolves when the syncs this scheduler started are over (tests, shutdown). */
  async idle() {
    while (this.#running.size) await Promise.allSettled([...this.#running]);
  }

  // The products whose schedule is on but have no time yet (a line just turned its sync on): they get their first one a period from now,
  // not at once, so switching it on does not start every product of the line together.
  async #seed(now) {
    const lines = await Line.find({ 'sync.enabled': true, deletedAt: null }).select('_id').lean();
    const candidates = await Product.find({
      archived: { $ne: true }, nextSyncAt: null,
      $or: [{ lineId: { $in: lines.map((line) => line._id) }, 'sync.mode': { $ne: 'off' } }, { 'sync.mode': 'custom' }],
    });
    for (const product of candidates) {
      const line = await Line.findById(product.lineId);
      const at = line && !line.deletedAt && nextSyncFor(product, line, now);
      if (at) await Product.updateOne({ _id: product._id, nextSyncAt: null }, { $set: { nextSyncAt: at } });
    }
  }

  async tick() {
    if (instance('schedulerPaused')) return { started: [], waiting: 0 };
    const now = this.now();
    let release;
    try {
      release = await takeLock('scheduler:tick', 'scheduler', { ttlMs: 50_000 });
    } catch (error) {
      if (error instanceof LockedError) return { started: [], waiting: 0 }; // another server is choosing
      throw error;
    }
    try {
      await this.#seed(now);
      const busy = (await heldLocks('product:')).filter((lock) => lock.kind === 'sync').length;
      let room = Math.max(0, instance('syncConcurrency') - busy);
      const due = await Product.find({ archived: { $ne: true }, nextSyncAt: { $ne: null, $lte: now } }).sort({ nextSyncAt: 1 });
      const started = [];
      for (const product of due) {
        const line = await Line.findById(product.lineId);
        const effective = line && !line.deletedAt && effectiveSync(product, line);
        if (!effective?.enabled) {
          await Product.updateOne({ _id: product._id }, { $set: { nextSyncAt: null } });
          continue;
        }
        if (room === 0) break;
        // claimed with the time it was found at: of two servers, only one gets it
        const next = nextSyncFor(product, line, now);
        const claimed = await Product.findOneAndUpdate({ _id: product._id, nextSyncAt: product.nextSyncAt }, { $set: { nextSyncAt: next } });
        if (!claimed) continue;
        room -= 1;
        started.push(String(product._id));
        this.#launch(product, line);
      }
      return { started, waiting: Math.max(0, due.length - started.length) };
    } finally {
      await release();
    }
  }

  #launch(product, line) {
    const skip = (reason) => SyncRun.create({
      productId: product._id, lineId: product.lineId, trigger: 'cron', behavior: effectiveSync(product, line).behavior,
      status: 'skipped', reason, finishedAt: new Date(),
    });
    const work = (async () => {
      if (!line.ownerId) return skip('no-owner');
      try {
        await this.sync({ id: String(product._id), userId: String(line.ownerId), trigger: 'cron' });
      } catch (error) {
        if (error instanceof LockedError) return skip('busy');
        if (error?.syncRunRecorded) return;
        // it failed before it could record itself (the owner has no access any more, the host does not answer...)
        await SyncRun.create({
          productId: product._id, lineId: product.lineId, trigger: 'cron', userId: line.ownerId, behavior: effectiveSync(product, line).behavior,
          status: 'failed', reason: String(error?.message ?? error).slice(0, 300), finishedAt: new Date(),
        });
      }
    })().catch((error) => console.error('[scheduler] could not record a sync:', error?.message ?? error))
      .finally(() => this.#running.delete(work));
    this.#running.add(work);
  }

  /**
   * What the Scheduler view shows. `lineIds` / `productIds` limit it to those (a line's or a product's own view, or what a person may
   * see); without either it is everything.
   */
  async status({ lineIds = null, productIds = null } = {}) {
    const now = this.now();
    const scope = {
      ...(lineIds ? { lineId: { $in: lineIds } } : {}),
      ...(productIds ? { _id: { $in: productIds } } : {}),
    };
    const runScope = {
      ...(lineIds ? { lineId: { $in: lineIds } } : {}),
      ...(productIds ? { productId: { $in: productIds } } : {}),
    };
    const visible = (await Product.find(scope).select('_id').lean()).map((p) => String(p._id));
    const locks = (await heldLocks('product:')).filter((lock) => visible.includes(String(lock._id).slice('product:'.length)));
    const ids = locks.map((lock) => String(lock._id).slice('product:'.length));
    const live = { ...scope, archived: { $ne: true } };
    const [products, due, upcoming, skippedToday, recentRuns] = await Promise.all([
      Product.find({ _id: { $in: ids } }).select('spec.basicData.name lineId').lean(),
      Product.find({ ...live, nextSyncAt: { $ne: null, $lte: now } }).sort({ nextSyncAt: 1 }).select('spec.basicData.name lineId nextSyncAt').lean(),
      Product.find({ ...live, nextSyncAt: { $gt: now, $lte: new Date(now.getTime() + DAY_MS) } }).sort({ nextSyncAt: 1 }).select('spec.basicData.name lineId nextSyncAt').lean(),
      SyncRun.countDocuments({ ...runScope, status: 'skipped', startedAt: { $gte: new Date(now.getTime() - DAY_MS) } }),
      SyncRun.find({ ...runScope, status: { $ne: 'running' } }).sort({ startedAt: -1 }).limit(RECENT).lean(),
    ]);
    const names = new Map((await Product.find({ _id: { $in: recentRuns.map((run) => run.productId) } }).select('spec.basicData.name').lean()).map((p) => [String(p._id), p.spec?.basicData?.name]));
    const lines = new Map((await Line.find({ _id: { $in: [...products, ...due, ...upcoming].map((p) => p.lineId) } }).select('name').lean()).map((l) => [String(l._id), l.name]));
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const describe = (p) => ({ productId: String(p._id), product: p.spec?.basicData?.name, lineId: String(p.lineId), line: lines.get(String(p.lineId)) });
    return {
      paused: instance('schedulerPaused'),
      concurrency: instance('syncConcurrency'),
      running: locks.map((lock) => {
        const p = byId.get(String(lock._id).slice('product:'.length));
        return { ...(p ? describe(p) : { productId: String(lock._id).slice('product:'.length) }), kind: lock.kind, since: lock.since };
      }),
      // what is running is not also waiting
      queued: due.filter((p) => !ids.includes(String(p._id))).map((p) => ({ ...describe(p), dueAt: p.nextSyncAt })),
      upcoming: upcoming.map((p) => ({ ...describe(p), at: p.nextSyncAt })),
      skippedToday,
      recent: recentRuns.map((run) => ({ ...run, product: names.get(String(run.productId)) })),
    };
  }
}
