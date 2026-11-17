/**
 * A MongoDB for developing LINEA without Docker: the same single-node replica set the tests use (LINEA needs transactions), kept on
 * disk so what you create survives a restart.
 *
 *   node dev/mongo.js                  (port 27017; PORT=… to change it, DB_PATH=… to keep the data elsewhere)
 *
 * The server connects with  mongoUrl=mongodb://127.0.0.1:27017/splalm?replicaSet=rs0
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.PORT ?? 27017);
const dbPath = path.resolve(process.env.DB_PATH ?? '.dev-data/mongo');
fs.mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, dbName: 'splalm', storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});

console.log(`[mongo] ready: mongodb://127.0.0.1:${port}/splalm?replicaSet=rs0  (data in ${dbPath})`);

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
