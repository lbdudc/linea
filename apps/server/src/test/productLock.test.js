import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setup, clear, teardown } from './setup.js';
import { takeLock, withLock, heldLocks, LockedError, productLockId } from '../model/services/productLock.js';

beforeAll(setup);
afterEach(clear);
afterAll(teardown);

test('a second operation on the same product is refused while the first runs', async () => {
  const release = await takeLock(productLockId('p1'), 'generate', { owner: 'ana' });
  const refused = await takeLock(productLockId('p1'), 'sync').catch((error) => error);
  expect(refused).toBeInstanceOf(LockedError);
  expect(refused.status).toBe(409);
  expect(refused.held).toMatchObject({ kind: 'generate', owner: 'ana' });
  await release();
  await (await takeLock(productLockId('p1'), 'sync'))();
});

test('other products are not affected', async () => {
  const a = await takeLock(productLockId('a'), 'sync');
  const b = await takeLock(productLockId('b'), 'sync');
  expect((await heldLocks('product:')).map((lock) => lock._id).sort()).toEqual(['product:a', 'product:b']);
  await a();
  await b();
  expect(await heldLocks('product:')).toEqual([]);
});

test('a lock whose holder died is taken over once it expires', async () => {
  await takeLock(productLockId('p'), 'sync', { ttlMs: 20, beatMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(await heldLocks('product:')).toEqual([]);
  const release = await takeLock(productLockId('p'), 'generate');
  await release();
});

test('the holder keeps the lock alive while it works', async () => {
  const release = await takeLock(productLockId('p'), 'sync', { ttlMs: 60, beatMs: 15 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await expect(takeLock(productLockId('p'), 'sync')).rejects.toBeInstanceOf(LockedError);
  await release();
});

test('withLock releases when the work fails', async () => {
  await expect(withLock(productLockId('p'), 'sync', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  expect(await heldLocks('product:')).toEqual([]);
});

test('a late release does not free a lock someone else took', async () => {
  const first = await takeLock(productLockId('p'), 'sync', { ttlMs: 20, beatMs: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const second = await takeLock(productLockId('p'), 'generate');
  await first();
  await expect(takeLock(productLockId('p'), 'sync')).rejects.toBeInstanceOf(LockedError);
  await second();
});
