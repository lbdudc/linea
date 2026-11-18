import { test, expect, beforeAll, afterEach, afterAll, describe } from 'vitest';
import { Container } from 'typedi';
import mongoose from 'mongoose';
import { setup, clear, teardown } from './setup.js';
import CicdAlertService from '../model/services/CicdAlertService.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import User from '../model/entities/user.js';
import Log from '../model/entities/log.js';
import SyncRun from '../model/entities/syncRun.js';
import Notification from '../model/entities/notification.js';

const alerts = Container.get(CicdAlertService);

beforeAll(setup);
afterAll(teardown);
afterEach(clear);

const seed = async () => {
  const owner = await User.create({ username: 'owner' });
  const other = await User.create({ username: 'other' });
  const line = await Line.create({ name: 'shop', version: '1.0.0', ownerId: owner._id, repoId: 1, namespaceId: 1 });
  const product = await Product.create({ lineId: line._id, spec: { basicData: { name: 'p1', version: '0.0.1' } }, repo: { id: 7 } });
  const log = (type, message = type, extra = {}) => Log.create({ productId: product._id, productName: 'p1', lineId: line._id, lineName: 'shop', version: '0.0.2', type, message, ...extra });
  return { owner, other, line, product, log };
};

describe('CI/CD alerts', () => {
  test('tell the owner of the line once about a generation that failed, however many sweeps see it', async () => {
    const { owner, log } = await seed();
    await log('error');
    expect((await alerts.sweep()).notified).toBe(1);
    expect((await alerts.sweep()).notified).toBe(0);
    const [note] = await Notification.find({ userId: owner._id }).lean();
    expect(note).toMatchObject({ reason: 'failed', subject: 'run', state: 'generation', title: 'p1 0.0.2' });
  });

  test('tell about conflicts and about a failed sync with its reason', async () => {
    const { owner, line, product, log } = await seed();
    await log('warning', 'log.conflicts_merge_request');
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status: 'failed', reason: 'host down', finishedAt: new Date() });
    await alerts.sweep();
    const notes = await Notification.find({ userId: owner._id }).lean();
    expect(notes.map((n) => n.reason).sort()).toEqual(['conflicts', 'failed']);
    expect(notes.find((n) => n.state === 'sync').excerpt).toBe('host down');
  });

  test('tell a person who named the line, and nobody who did not', async () => {
    const { owner, other, line, log } = await seed();
    await log('error');
    await alerts.setRules({ userId: other._id, rules: { lineIds: [String(line._id)] } });
    await alerts.sweep();
    expect(await Notification.countDocuments({ userId: other._id })).toBe(1);
    expect(await Notification.countDocuments({ userId: owner._id })).toBe(1);
  });

  test('keep quiet for a kind a person switched off', async () => {
    const { owner, log } = await seed();
    await alerts.setRules({ userId: owner._id, rules: { failed: false } });
    await log('error');
    expect((await alerts.sweep()).notified).toBe(0);
  });

  test('tell about a sync running for longer than the person said', async () => {
    const { owner, line, product } = await seed();
    await SyncRun.create({ productId: product._id, lineId: line._id, trigger: 'cron', behavior: 'mr', status: 'running', startedAt: new Date(Date.now() - 40 * 60_000) });
    await alerts.setRules({ userId: owner._id, rules: { stuckMinutes: 60 } });
    expect((await alerts.sweep()).notified).toBe(0);
    await alerts.setRules({ userId: owner._id, rules: { stuckMinutes: 30 } });
    expect((await alerts.sweep()).notified).toBe(1);
    const [note] = await Notification.find({ userId: owner._id }).lean();
    expect(note).toMatchObject({ reason: 'stuck', excerpt: '40' });
  });

  test('ignore old failures and the products that are gone', async () => {
    const { log } = await seed();
    await log('error', 'error', { createdAt: new Date(Date.now() - 3600_000) });
    await Log.create({ productId: new mongoose.Types.ObjectId(), version: '1.0.0', type: 'error', message: 'x' });
    expect((await alerts.sweep()).notified).toBe(0);
  });

  test('keep the rules in range and with the defaults for a person who set none', async () => {
    const { owner, other } = await seed();
    expect(await alerts.getRules({ userId: other._id })).toMatchObject({ failed: true, conflicts: true, stuck: true, stuckMinutes: 30, lineIds: [] });
    expect((await alerts.setRules({ userId: owner._id, rules: { stuckMinutes: 1 } })).stuckMinutes).toBe(5);
  });
});
