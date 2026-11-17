import mongoose from 'mongoose';

// One thing at a time on a product: a generation, a sync. The lock is a document in Mongo (so two servers agree) with an
// expiry that the holder keeps pushing back; one whose holder died is taken over once it expires.
const TTL_MS = 3 * 60 * 1000;
const BEAT_MS = 60 * 1000;

const locks = () => mongoose.connection.collection('locks');

export class LockedError extends Error {
  code = 'LOCKED';
  status = 409;
  constructor(id, held) {
    super(`Locked by ${held?.kind ?? 'another operation'}`);
    this.id = id;
    this.held = held;
  }
}

/**
 * Takes the lock `id` (e.g. `product:<id>`) for `kind` (`generate`, `sync`) and returns `release()`, or throws `LockedError`.
 * `ttlMs`/`beatMs` are for tests.
 */
export const takeLock = async (id, kind, { owner = null, ttlMs = TTL_MS, beatMs = BEAT_MS } = {}) => {
  const now = Date.now();
  const doc = { kind, owner: owner ? String(owner) : null, since: new Date(now), expiresAt: new Date(now + ttlMs) };
  try {
    // an expired lock goes first, or the insert below would be refused by it
    await locks().deleteOne({ _id: id, expiresAt: { $lte: new Date(now) } });
    await locks().insertOne({ _id: id, ...doc });
  } catch (error) {
    if (error.code !== 11000) throw error;
    throw new LockedError(id, await locks().findOne({ _id: id }));
  }
  const beat = setInterval(() => {
    locks().updateOne({ _id: id, kind, since: doc.since }, { $set: { expiresAt: new Date(Date.now() + ttlMs) } }).catch(() => {});
  }, beatMs);
  beat.unref?.();
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    await locks().deleteOne({ _id: id, since: doc.since });
  };
};

/** Runs `fn` holding the lock. */
export const withLock = async (id, kind, fn, options) => {
  const release = await takeLock(id, kind, options);
  try {
    return await fn();
  } finally {
    await release();
  }
};

/** Who holds what now, for the scheduler view and the 409 answers (expired ones do not count). */
export const heldLocks = async (prefix = '') =>
  (await locks().find({ expiresAt: { $gt: new Date() } }).toArray()).filter((lock) => String(lock._id).startsWith(prefix));

export const productLockId = (productId) => `product:${productId}`;
