import { Container } from 'typedi';
import mongoose from 'mongoose';
import Log from '../entities/log.js';
import SyncRun from '../entities/syncRun.js';
import Line from '../entities/line.js';
import Notification from '../entities/notification.js';
import NotificationRule, { RULE_DEFAULTS } from '../entities/notificationRule.js';
import User from '../entities/user.js';
import { runningGenerations } from './generationRuns.js';

const LOOKBACK_MS = 15 * 60_000;
const SWEEP_MS = 60_000;
const MIN_STUCK_MINUTES = 5;
const MAX_LINES = 200;

const KIND_OF = { failed: 'failed', conflicts: 'conflicts', stuck: 'stuck' };

const clean = (input = {}) => {
  const rule = {};
  for (const key of ['failed', 'conflicts', 'stuck']) if (typeof input[key] === 'boolean') rule[key] = input[key];
  if (input.stuckMinutes !== undefined) rule.stuckMinutes = Math.min(1440, Math.max(MIN_STUCK_MINUTES, Math.round(Number(input.stuckMinutes)) || RULE_DEFAULTS.stuckMinutes));
  if (Array.isArray(input.lineIds)) rule.lineIds = [...new Set(input.lineIds.filter((id) => typeof id === 'string' && id.length <= 40))].slice(0, MAX_LINES);
  return rule;
};

/**
 * Tells people when a run of theirs needs them: a generation or a sync that failed, a generation that ended in conflicts, a run that is
 * taking longer than they said. It looks at what the runs left (logs and sync runs) instead of hooking every place that ends one, so
 * it also sees the runs of the scheduler and of other servers, and a run is told once however many sweeps see it (`alertKey`).
 * Who hears: whoever started the run, the owner of its line, and anybody who named that line in their rules.
 */
export default class CicdAlertService {
  getRules = async ({ userId }) => {
    const stored = await NotificationRule.findOne({ userId }).lean();
    return { ...RULE_DEFAULTS, ...(stored ? { failed: stored.failed, conflicts: stored.conflicts, stuck: stored.stuck, stuckMinutes: stored.stuckMinutes, lineIds: stored.lineIds } : {}) };
  };

  setRules = async ({ userId, rules }) => {
    await NotificationRule.updateOne({ userId }, { $set: clean(rules) }, { upsert: true });
    return this.getRules({ userId });
  };

  #failedGenerations = async (since) => (await Log.aggregate([
    { $match: { type: 'error', createdAt: { $gte: since }, productId: { $ne: null } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: { productId: '$productId', version: '$version' }, log: { $last: '$$ROOT' } } },
  ])).map(({ log }) => ({
    reason: 'failed', key: `failed:g:${log._id}`, productId: String(log.productId), lineId: log.lineId ? String(log.lineId) : null,
    name: log.productName, version: log.version, actor: log.userId ? String(log.userId) : null, at: log.createdAt,
  }));

  #conflictedGenerations = async (since) => (await Log.find({ type: 'warning', message: 'log.conflicts_merge_request', createdAt: { $gte: since }, productId: { $ne: null } }).lean())
    .map((log) => ({
      reason: 'conflicts', key: `conflicts:${log._id}`, productId: String(log.productId), lineId: log.lineId ? String(log.lineId) : null,
      name: log.productName, version: log.version, actor: log.userId ? String(log.userId) : null, at: log.createdAt,
    }));

  #failedSyncs = async (since) => (await SyncRun.find({ status: 'failed', finishedAt: { $gte: since } }).lean())
    .map((run) => ({
      reason: 'failed', key: `failed:s:${run._id}`, productId: String(run.productId), lineId: String(run.lineId),
      version: run.version, actor: run.userId ? String(run.userId) : null, at: run.finishedAt, detail: run.reason, sync: true,
    }));

  #stuckRuns = async (now) => {
    const limit = new Date(now.getTime() - MIN_STUCK_MINUTES * 60_000);
    const syncs = (await SyncRun.find({ status: 'running', startedAt: { $lte: limit } }).lean()).map((run) => ({
      reason: 'stuck', key: `stuck:s:${run._id}`, productId: String(run.productId), lineId: String(run.lineId),
      actor: run.userId ? String(run.userId) : null, at: run.startedAt, sync: true,
    }));
    const generations = runningGenerations().filter((run) => run.since <= limit).map((run) => ({
      reason: 'stuck', key: `stuck:g:${run.productId}:${run.since.getTime()}`, productId: run.productId, lineId: null, actor: run.userId, at: run.since,
    }));
    return [...syncs, ...generations].map((event) => ({ ...event, minutes: Math.floor((now.getTime() - new Date(event.at).getTime()) / 60_000) }));
  };

  #describe = async (events) => {
    const products = new Map();
    const lines = new Map();
    const Product = mongoose.model('Product');
    for (const event of events) {
      if (!products.has(event.productId)) products.set(event.productId, await Product.findById(event.productId).select('spec.basicData.name lineId').lean());
      const product = products.get(event.productId);
      event.lineId ??= product?.lineId ? String(product.lineId) : null;
      event.name ??= product?.spec?.basicData?.name;
      if (event.lineId && !lines.has(event.lineId)) lines.set(event.lineId, await Line.findById(event.lineId).select('ownerId name deletedAt').lean());
      event.line = event.lineId ? lines.get(event.lineId) : null;
    }
    return events.filter((event) => products.get(event.productId) && !event.line?.deletedAt);
  };

  #listeners = async (event, rules) => {
    const people = new Set([event.actor, event.line?.ownerId ? String(event.line.ownerId) : null].filter(Boolean));
    for (const rule of rules) if (event.lineId && rule.lineIds.includes(event.lineId)) people.add(String(rule.userId));
    return [...people];
  };

  sweep = async ({ now = new Date() } = {}) => {
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const found = [
      ...await this.#failedGenerations(since), ...await this.#conflictedGenerations(since),
      ...await this.#failedSyncs(since), ...await this.#stuckRuns(now),
    ];
    if (!found.length) return { notified: 0 };
    const events = await this.#describe(found);
    const rules = await NotificationRule.find({}).lean();
    const ruleOf = new Map(rules.map((rule) => [String(rule.userId), { ...RULE_DEFAULTS, ...rule }]));
    const disabled = new Set((await User.find({ disabled: true }).select('_id').lean()).map((user) => String(user._id)));
    const docs = [];
    for (const event of events) {
      for (const userId of await this.#listeners(event, rules)) {
        if (disabled.has(userId)) continue;
        const rule = ruleOf.get(userId) ?? RULE_DEFAULTS;
        if (!rule[KIND_OF[event.reason]]) continue;
        if (event.reason === 'stuck' && event.minutes < rule.stuckMinutes) continue;
        docs.push({
          userId, reason: event.reason, subject: 'run', alertKey: event.key,
          target: { kind: 'product', id: event.productId, name: event.line?.name },
          title: [event.name, event.version].filter(Boolean).join(' '),
          excerpt: event.reason === 'stuck' ? String(event.minutes) : (event.detail ?? '').slice(0, 160),
          state: event.sync ? 'sync' : 'generation',
        });
      }
    }
    if (!docs.length) return { notified: 0 };
    try {
      const created = await Notification.insertMany(docs, { ordered: false });
      return { notified: created.length };
    } catch (error) {
      if (error?.code !== 11000 && !error?.writeErrors) throw error;
      return { notified: error.insertedDocs?.length ?? 0 };
    }
  };

  start = () => {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep().catch((error) => console.error('[alerts] sweep failed:', error?.message ?? error)), SWEEP_MS);
    this.timer.unref?.();
  };

  stop = () => {
    clearInterval(this.timer);
    this.timer = null;
  };
}

Container.set(CicdAlertService, new CicdAlertService());
