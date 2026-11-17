import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { setup, clear, teardown } from './setup.js';
import { runMigrations } from '../model/migrations/index.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import User from '../model/entities/user.js';

beforeAll(setup);
afterEach(clear);
afterAll(teardown);

const quiet = { info: () => {} };
const db = () => mongoose.connection.db;

const seedOldData = async () => {
  await db().collection('lines').insertOne({ name: 'Old', version: '1.0.0', kind: 'plain', gitlabProjectId: 11, gitlabNamespaceId: 3, gitlabWebUrl: 'http://gl/old', gitlabWebIdeUrl: 'http://gl/ide/old' });
  await db().collection('products').insertOne({
    lineId: new mongoose.Types.ObjectId(), spec: { basicData: { name: 'P', version: '1.0.0' } },
    gitlab: { projectId: 21, namespaceId: 4, webUrl: 'http://gl/p', webIdeUrl: 'http://gl/ide/p' }, specInGitlab: true,
  });
  await db().collection('users').insertOne({ username: 'ana', gitlabAccessToken: 'tok', gitlabRefreshToken: 'ref' });
  await db().collection('plugins').insertMany([
    { id: 'modular-plugin', installed: true, enabled: true, settings: {} },
    { id: 'gitlab-plugin', installed: true, enabled: true, settings: { url: 'http://gl', clientId: 'cid', clientSecret: 'sec', defaultNamespace: 'linea/spls' } },
    { id: 'github-plugin', installed: true, enabled: false, settings: {} },
    { id: 'analytics-plugin', installed: true, enabled: true, settings: { url: 'http://flamapy' } },
  ]);
};

test('lines, products and users take the host-neutral names, and the models read them', async () => {
  await seedOldData();
  await runMigrations({ db: db(), log: quiet });

  const line = await Line.findOne({ name: 'Old' });
  expect(line).toMatchObject({ repoId: 11, namespaceId: 3, webUrl: 'http://gl/old', webIdeUrl: 'http://gl/ide/old' });
  const raw = await db().collection('lines').findOne({ name: 'Old' });
  expect(Object.keys(raw).filter((key) => /gitlab/i.test(key))).toEqual([]);

  const product = await Product.findOne();
  expect(product.repo).toMatchObject({ id: 21, namespaceId: 4, webUrl: 'http://gl/p', webIdeUrl: 'http://gl/ide/p' });
  expect(product.specInRepo).toBe(true);
  const rawProduct = await db().collection('products').findOne();
  expect(rawProduct.gitlab).toBeUndefined();
  expect(rawProduct.repo.projectId).toBeUndefined();

  const user = await User.findOne({ username: 'ana' });
  expect(user).toMatchObject({ accessToken: 'tok', refreshToken: 'ref' });
});

test('the settings of the host plugins become the hosts\', and the three plugins\' records go', async () => {
  await seedOldData();
  await runMigrations({ db: db(), log: quiet });

  const hosts = await db().collection('githostsettings').find().toArray();
  const gitlab = hosts.find((host) => host.host === 'gitlab');
  expect(gitlab).toMatchObject({ enabled: true, settings: { url: 'http://gl', clientId: 'cid', defaultNamespace: 'linea/spls' } });
  expect(hosts.find((host) => host.host === 'github')).toMatchObject({ enabled: false });
  const left = (await db().collection('plugins').find().toArray()).map((record) => record.id);
  expect(left).toEqual(['analytics-plugin']);
});

test('it runs once: a second run changes nothing, and new data is not touched', async () => {
  await seedOldData();
  await runMigrations({ db: db(), log: quiet });
  expect((await db().collection('meta').findOne({ _id: 'schema' })).version).toBe(4);

  // data written in the new shape, then a second run (an old record that appears later is not this migration's business)
  await Line.create({ name: 'New', version: '1.0.0', repoId: 99 });
  await runMigrations({ db: db(), log: quiet });
  expect((await Line.findOne({ name: 'New' })).repoId).toBe(99);
  expect(await db().collection('githostsettings').countDocuments()).toBe(3); // gitlab, github and the primary host kept
});

test('running the steps again over migrated data is harmless', async () => {
  await seedOldData();
  const { default: up } = await import('../model/migrations/002-host-neutral.js');
  await up(db());
  const before = await db().collection('products').findOne();
  await up(db());
  expect(await db().collection('products').findOne()).toEqual(before);
});

test('every record names its git host, and the primary host is kept, once', async () => {
  await seedOldData();
  await db().collection('users').insertOne({ username: 'bea' });
  await runMigrations({ db: db(), log: quiet });
  for (const name of ['users', 'lines', 'products']) {
    expect(await db().collection(name).countDocuments({ gitHost: { $ne: 'gitlab' } })).toBe(0);
  }
  expect((await db().collection('githostsettings').findOne({ host: '_primary' })).settings.host).toBe('gitlab');
});

test('a fresh database pins nothing', async () => {
  await runMigrations({ db: db(), log: quiet });
  expect(await db().collection('githostsettings').countDocuments({ host: '_primary' })).toBe(0);
});

test('a plugin that was never installed does not switch its host off; the removed records are kept aside', async () => {
  await db().collection('plugins').insertOne({ id: 'gitlab-plugin', installed: false, enabled: false, settings: { url: 'http://gl' } });
  await runMigrations({ db: db(), log: quiet });
  const gitlab = await db().collection('githostsettings').findOne({ host: 'gitlab' });
  expect(gitlab.enabled).toBeUndefined();
  expect(await db().collection('plugins_backup').countDocuments({ id: 'gitlab-plugin' })).toBe(1);
});

test('a field that exists under both names keeps the new one', async () => {
  await db().collection('lines').insertOne({ name: 'Half', gitlabProjectId: 1, repoId: 2 });
  await runMigrations({ db: db(), log: quiet });
  expect(await db().collection('lines').findOne({ name: 'Half' })).toMatchObject({ repoId: 2 });
  expect((await db().collection('lines').findOne({ name: 'Half' })).gitlabProjectId).toBeUndefined();
});

test('two servers starting together run the migrations once', async () => {
  await seedOldData();
  let runs = 0;
  const count = { version: 9, name: 'count', up: async () => { runs += 1; await new Promise((resolve) => setTimeout(resolve, 100)); } };
  const options = { db: db(), log: quiet, migrations: [count], lock: { wait: 20 } };
  await Promise.all([runMigrations(options), runMigrations(options)]);
  expect(runs).toBe(1);
  expect(await db().collection('meta').findOne({ _id: 'migration-lock' })).toBeNull();
});

test('a setting the host does not know is left out of what a host plugin leaves behind, and said', async () => {
  const warned = [];
  const original = console.warn;
  console.warn = (message) => warned.push(message);
  try {
    await db().collection('plugins').insertOne({ id: 'gitlab-plugin', installed: true, enabled: true, settings: { url: 'http://gl', pluginOnlyKnob: 'x' } });
    await runMigrations({ db: db(), log: quiet });
  } finally {
    console.warn = original;
  }
  const gitlab = await db().collection('githostsettings').findOne({ host: 'gitlab' });
  expect(gitlab.settings).toEqual({ url: 'http://gl' });
  expect(warned.join('\n')).toMatch(/pluginOnlyKnob/);
});
