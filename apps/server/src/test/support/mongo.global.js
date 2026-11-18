import { MongoMemoryReplSet } from 'mongodb-memory-server';

// One MongoDB for the whole run (starting a replica set per test file cost seconds of CPU each, 39 times over). Every file
// talks to a database of its own, named in setup.js, so they stay isolated from each other.
let replSet;

export async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.LINEA_TEST_MONGO_URI = replSet.getUri();
}

export async function teardown() {
  await replSet?.stop();
}
