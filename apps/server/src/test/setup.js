import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Container } from 'typedi';
import { vi } from 'vitest'
import DataSource from '../model/connectors/DataSource.js';

const dataSource = Container.get(DataSource);
let mongoInstance;

export async function setup() {
    let url;
    if (process.env.LINEA_TEST_MONGO_URI) {
      // the shared instance of mongo.global.js, with a database of this file's own
      const shared = new URL(process.env.LINEA_TEST_MONGO_URI);
      shared.pathname = `/test_${randomUUID().replaceAll('-', '')}`;
      url = shared.toString();
    } else {
      mongoInstance = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      url = mongoInstance.getUri();
    }
    await dataSource.connect({url}).catch(error => {
        console.error('MongoDB connection error:', error.message);
      });

    await Promise.all(
      Object.values(mongoose.connection.models).map((model) => model.init())
    );
}

export async function teardown() {
    await dataSource.disconnect();
    await mongoInstance?.stop();
}

export async function clear() {
    // emptied, not dropped: dropping the database costs ~110 ms of MongoDB's storage work after every test, and loses the indexes
    const { db } = mongoose.connection;
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name);
    await Promise.all(names.map((name) => db.collection(name).deleteMany({})));
    vi.restoreAllMocks();
}