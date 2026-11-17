import mongoose from 'mongoose';
import hostNeutral from './002-host-neutral.js';
import pinHosts from './003-pin-hosts.js';
import deriveGitTokens from './004-derive-git-tokens.js';

/**
 * Changes to what is kept in MongoDB that existing data needs. Each runs once, in order, and is written so that running it again does
 * nothing; the version reached is kept in `meta` (`_id: 'schema'`). They use the driver's collections, not the models: the models
 * describe the data as it is now, and these read it as it was.
 */
export const MIGRATIONS = [
  { version: 2, name: 'host-neutral names', up: hostNeutral },
  { version: 3, name: 'every record names its git host', up: pinHosts },
  { version: 4, name: 'local git tokens are made, not kept', up: deriveGitTokens },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// two servers starting together must not run the same migration: the one that holds the lock runs, the other waits and then finds it done
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const takeLock = async (meta, { wait = 500, tries = 600 } = {}) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      await meta.insertOne({ _id: 'migration-lock', at: new Date() });
      return;
    } catch (error) {
      if (error.code !== 11000) throw error;
      const held = await meta.findOne({ _id: 'migration-lock' });
      // a lock left by a process that died
      if (held && Date.now() - held.at.getTime() > LOCK_TIMEOUT_MS) await meta.deleteOne({ _id: 'migration-lock' });
      else await sleep(wait);
    }
  }
  throw new Error('Another process is running the migrations and did not finish.');
};

/** `context` goes to every migration as its second argument (the file's `gitHosts:` block, for the one that needs the primary host). */
export const runMigrations = async ({ db = mongoose.connection.db, migrations = MIGRATIONS, log = console, context = {}, lock = {} } = {}) => {
  const meta = db.collection('meta');
  await takeLock(meta, lock);
  try {
    const done = (await meta.findOne({ _id: 'schema' }))?.version ?? 1;
    for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
      if (migration.version <= done) continue;
      log.info(`[migrations] ${migration.version}: ${migration.name}`);
      await migration.up(db, context);
      await meta.updateOne({ _id: 'schema' }, { $set: { version: migration.version } }, { upsert: true });
    }
  } finally {
    await meta.deleteOne({ _id: 'migration-lock' });
  }
};
