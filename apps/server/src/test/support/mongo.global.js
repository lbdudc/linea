import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// One MongoDB for the whole run (starting a replica set per test file cost seconds of CPU each, 39 times over). Every file
// talks to a database of its own, named in setup.js, so they stay isolated from each other.
let replSet;
let packageCache;

export async function setup() {
  // The packages the server keeps on disk by name@version are the run's own: the user's real cache (or the one of a previous run, made from
  // other metamodels) would be read instead of what the test published.
  packageCache = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-package-cache-'));
  process.env.LINEA_PACKAGE_CACHE_DIR = packageCache;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.LINEA_TEST_MONGO_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
  if (packageCache) fs.rmSync(packageCache, { recursive: true, force: true });
}
