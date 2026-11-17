import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { normalizeProductSpec } from '@lbdudc/linea-core';
import User from '../model/entities/user.js';
import Product from '../model/entities/product.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ProductSpecService, { ProductSpecFillerRejectedError } from '../model/services/ProductSpecService.js';
import ProductRepository from '../model/repositories/ProductRepository.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble, gitlabDouble } from './support/withGitlabDouble.js';

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const productSpecService = Container.get(ProductSpecService);
const productRepository = Container.get(ProductRepository);

async function createAdminUser(prefix) {
  const hashedPassword = await bcrypt.hash('password', 10);
  return new User({ username: `${prefix}-${Date.now()}-${Math.random()}`, password: hashedPassword, admin: true }).save();
}

const noFeatureSpec = (name, version = '0.0.0', extra = {}) => ({
  basicData: { name, version, database: {}, languages: ['en'], ...extra },
  dataModel: { cells: [] },
  features: [],
  statics: [],
});

function expectSpecFieldsMatch(fromSpecFile, fromMongo) {
  const a = normalizeProductSpec({ spec: fromSpecFile });
  const b = normalizeProductSpec({ spec: fromMongo });
  expect(a.basicData.name).toEqual(b.basicData.name);
  expect(a.basicData.version).toEqual(b.basicData.version);
  expect(a.basicData.database).toEqual(b.basicData.database);
  expect(a.features).toEqual(b.features);
  expect(a.statics).toEqual(b.statics);
}

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

test('reconcileProducts on a project WITH .linea/spec.draft.json seeds Mongo with the real spec, field by field, not the filler', async () => {
  const user = await createAdminUser('reconcile-real');
  const line = await lineService.createLine({ userId: user._id, name: 'ReconcileRealLine', version: '0.0.0', description: 'x' });
  const created = await productService.createProduct({
    userId: user._id, lineId: line._id,
    spec: noFeatureSpec('ReconcileRealProduct', '0.7.0', { database: { engine: 'postgres' } }),
  });
  const goodSpec = created.toObject().spec;

  await Product.deleteOne({ _id: created._id });

  const result = await productService.reconcileProducts({ userId: user._id });
  expect(result.created).toHaveLength(1);

  const [rebuilt] = await productRepository.findByRepoIdsOrderByCreatedAtDesc([created.repo.id]);
  expect(rebuilt.specFiller).toBe(false);
  expectSpecFieldsMatch(goodSpec, rebuilt.toObject().spec);
});

test('the reconcile scenario that proves ADR-033: real spec survives Mongo being wiped AND a subsequent automatic write', async () => {
  const user = await createAdminUser('reconcile-survive');
  const line = await lineService.createLine({ userId: user._id, name: 'ReconcileSurviveLine', version: '0.0.0', description: 'x' });
  const created = await productService.createProduct({
    userId: user._id, lineId: line._id,
    spec: noFeatureSpec('ReconcileSurviveProduct', '0.3.0', { database: { engine: 'mysql' } }),
  });
  const goodSpec = created.toObject().spec;

  await Product.deleteOne({ _id: created._id });

  await productService.reconcileProducts({ userId: user._id });
  const [rebuilt] = await productRepository.findByRepoIdsOrderByCreatedAtDesc([created.repo.id]);
  expect(rebuilt.specFiller).toBe(false);

  await productSpecService.writeSpec({
    token: 'fake', productProjectId: rebuilt.repo.id, spec: rebuilt.toObject().spec,
    isFiller: Boolean(rebuilt.specFiller),
  });

  const finalSpec = await productSpecService.readSpec({ token: 'fake', productProjectId: created.repo.id });
  expectSpecFieldsMatch(goodSpec, finalSpec);
});

test('reconcileProducts on a project WITHOUT .linea/spec.draft.json does not crash, and the filler it creates cannot stomp a real file that appears afterwards', async () => {
  const user = await createAdminUser('reconcile-filler');
  const line = await lineService.createLine({ userId: user._id, name: 'ReconcileFillerLine', version: '0.0.0', description: 'x' });

  const productGroup = gitlabDouble().state.createGroup({ name: 'PreT7ReconcileProduct', parent_id: line.namespaceId });
  const productProject = gitlabDouble().state.createProject({
    name: 'PreT7ReconcileProduct', namespace_id: productGroup.id, topics: ['product'],
  });

  const result = await productService.reconcileProducts({ userId: user._id });
  expect(result.unlinked).toEqual([]);
  expect(result.created).toHaveLength(1);

  const [rebuilt] = await productRepository.findByRepoIdsOrderByCreatedAtDesc([productProject.id]);
  expect(rebuilt.specFiller).toBe(true);
  expect(rebuilt.spec.basicData.name).toBe('PreT7ReconcileProduct');

  const realSpec = { basicData: { name: 'PreT7ReconcileProduct', version: '9.9.9' }, features: ['RealFeature'] };
  await productSpecService.writeSpec({ token: 'fake', productProjectId: productProject.id, spec: realSpec, isFiller: false });

  await expect(
    productSpecService.writeSpec({
      token: 'fake', productProjectId: productProject.id, spec: rebuilt.toObject().spec,
      isFiller: Boolean(rebuilt.specFiller),
    })
  ).rejects.toThrow(ProductSpecFillerRejectedError);

  const finalSpec = await productSpecService.readSpec({ token: 'fake', productProjectId: productProject.id });
  expect(finalSpec).toEqual(realSpec);
});
