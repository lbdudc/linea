import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { test, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { normalizeProductSpec } from '@lbdudc/linea-core';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ProductSpecService from '../model/services/ProductSpecService.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble, gitlabDouble } from './support/withGitlabDouble.js';

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const productSpecService = Container.get(ProductSpecService);

const LPS_FIXTURE = path.resolve('src', 'test', 'mocks', 'lps');
const VALID_FEATURES = [
  'GEMA_SPL', 'DataManagement', 'GraphicalUserInterface', 'MapViewer', 'Tools',
  'DM_SpatialDatabase', 'DM_GenerationType', 'DM_DataServer', 'MV_MapServer', 'MV_Tools',
  'MV_MapManagement', 'DM_SD_PostGIS', 'MV_T_Pan', 'MV_T_Zoom', 'DM_GT_Identity',
  'MV_MS_GeoServer', 'MV_MM_UniqueMapViewer', 'MV_MM_UMV_MapCenter', 'MV_MM_UMV_MC_BBox', 'T_GIS',
];

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
  expect(a.basicData.languages).toEqual(b.basicData.languages);
  expect(a.basicData.SRID).toEqual(b.basicData.SRID);
  expect(a.basicData.database).toEqual(b.basicData.database);
  expect(a.basicData.extra).toEqual(b.basicData.extra);
  expect(a.basicData.testEnvironment).toEqual(b.basicData.testEnvironment);
  expect(a.dataModel.cells).toEqual(b.dataModel.cells);
  expect(a.features).toEqual(b.features);
  expect(a.statics).toEqual(b.statics);
  expect(a.sensor.dsl).toEqual(b.sensor.dsl);
  expect(a.sensor.parsed).toEqual(b.sensor.parsed);

  const asIso = (value) => (value instanceof Date ? value.toISOString() : value);
  expect(asIso(a.basicData.createdAt)).toEqual(asIso(b.basicData.createdAt));
}

function seedLineProjectWithFixture(name) {
  const project = gitlabDouble().seedProject({ name, topics: ['spl'] });
  const actions = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else actions.push({ action: 'create', file_path: rel.split(path.sep).join('/'), content: fs.readFileSync(full).toString('base64'), encoding: 'base64' });
    }
  };
  walk(LPS_FIXTURE, '');
  project.commit({ branch: 'main', actions, message: 'seed LPS fixture' });
  return project;
}

function seedProductProject(name) {
  const project = gitlabDouble().seedProject({ name, topics: ['product'], defaultBranch: 'bigbang' });
  project.createBranch('main', 'bigbang');
  project.default_branch = 'main';
  return project;
}

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

test('createProduct leaves a spec file whose spec round-trips through normalizeProductSpec identically to Mongo', async () => {
  const user = await createAdminUser('spec-create');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecCreateLine', version: '0.0.0', description: 'x' });

  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('SpecProduct', '0.4.0'),
  });

  const specFile = await productSpecService.readSpec({
    token: 'fake', productProjectId: product.repo.id,
  });
  expect(specFile).not.toBeNull();
  expectSpecFieldsMatch(specFile, product.toObject().spec);
});

test('updateProduct updates the spec file to match the new spec', async () => {
  const user = await createAdminUser('spec-update');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecUpdateLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('UpdateMe', '0.1.0'),
  });

  const updated = await productService.updateProduct({
    id: product._id, userId: user._id,
    spec: noFeatureSpec('UpdateMe', '0.1.0', { database: { engine: 'postgres' } }),
  });

  const specFile = await productSpecService.readSpec({
    token: 'fake', productProjectId: product.repo.id,
  });
  expectSpecFieldsMatch(specFile, updated.toObject().spec);
  expect(normalizeProductSpec({ spec: specFile }).basicData.version).toBe(updated.spec.basicData.version);
  expect(normalizeProductSpec({ spec: specFile }).basicData.database).toEqual({ engine: 'postgres' });
});

test('renameProduct updates the spec file spec.basicData.name (unlike products.json, whose repositorio stays put)', async () => {
  const user = await createAdminUser('spec-rename');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecRenameLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('OldSpecName', '0.1.0'),
  });

  const renamed = await productService.renameProduct({
    id: product._id, name: 'NewSpecName', userId: user._id,
  });

  const specFile = await productSpecService.readSpec({
    token: 'fake', productProjectId: product.repo.id,
  });
  expect(specFile).not.toBeNull();
  expect(normalizeProductSpec({ spec: specFile }).basicData.name).toBe('NewSpecName');
  // a product made with no selection starts from the model's smallest valid one, which the file keeps and the trimmed document does not
  expectSpecFieldsMatch(specFile, { ...renamed.toObject().spec, features: specFile.features });
});

test('renameProduct merges onto the CURRENT GitLab spec — a hand-edited field survives the rename', async () => {
  const user = await createAdminUser('spec-rename-handedit');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecRenameHandEditLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('OldHandEditName', '0.1.0'),
  });

  const handEdited = {
    basicData: { name: 'OldHandEditName', version: '0.1.0', database: { engine: 'oracle' }, languages: ['en'] },
    dataModel: { cells: [] },
    features: ['HandEditedBeforeRename'],
    statics: [],
  };
  await productSpecService.writeSpec({ token: 'fake', productProjectId: product.repo.id, spec: handEdited, isFiller: false });

  await productService.renameProduct({ id: product._id, name: 'NewHandEditName', userId: user._id });

  const specFile = await productSpecService.readSpec({ token: 'fake', productProjectId: product.repo.id });
  expect(specFile.basicData.name).toBe('NewHandEditName');
  expect(specFile.features).toEqual(['HandEditedBeforeRename']);
  expect(specFile.basicData.database).toEqual({ engine: 'oracle' });
});

test('generateProduct bumps the version in the spec file too', async () => {
  const user = await createAdminUser('spec-generate');

  const lineProject = seedLineProjectWithFixture('SpecGenLine');
  const line = await new Line({
    name: 'SpecGenLine', version: '0.0.0', description: 'x',
    repoId: lineProject.id, namespaceId: lineProject.namespace.id,
    webUrl: lineProject.web_url, ownerId: user._id,
  }).save();

  const productProject = seedProductProject('SpecGenProduct');
  const product = await new Product({
    spec: {
      basicData: { name: 'SpecGenProduct', version: '0.0.0', database: {}, languages: ['en'] },
      dataModel: { cells: [] },
      features: VALID_FEATURES,
      statics: [],
    },
    lineId: line._id,
    repo: { id: productProject.id, namespaceId: productProject.namespace.id, webUrl: productProject.web_url },
  }).save();

  const result = await productService.generateProduct({ id: product._id, userId: user._id }, () => {});
  expect(result.conflicts).toBe(false);

  const specFile = await productSpecService.readSpec({
    token: 'fake', productProjectId: productProject.id,
  });
  expect(specFile).not.toBeNull();
  expect(normalizeProductSpec({ spec: specFile }).basicData.version).toBe(result.spec.basicData.version);
  expect(result.spec.basicData.version).not.toBe('0.0.0');
}, 60000);

test('generateProduct derives from .linea/spec.draft.json in GitLab, not a stale Mongo cache', async () => {
  const user = await createAdminUser('spec-source-gitlab');

  const lineProject = seedLineProjectWithFixture('SpecSourceLine');
  const line = await new Line({
    name: 'SpecSourceLine', version: '0.0.0', description: 'x',
    repoId: lineProject.id, namespaceId: lineProject.namespace.id,
    webUrl: lineProject.web_url, ownerId: user._id,
  }).save();

  const productProject = seedProductProject('SpecSourceProduct');
  const product = await new Product({
    spec: {
      basicData: { name: 'SpecSourceProduct', version: '0.1.0', database: { engine: 'postgres' }, languages: ['en'] },
      dataModel: { cells: [] },
      features: VALID_FEATURES,
      statics: [],
    },
    lineId: line._id,
    repo: { id: productProject.id, namespaceId: productProject.namespace.id, webUrl: productProject.web_url },
  }).save();

  await productSpecService.writeSpec({
    token: 'fake', productProjectId: productProject.id, spec: product.toObject().spec, isFiller: false,
  });

  await Product.updateOne({ _id: product._id }, { $set: { 'spec.basicData.version': '0.0.1', 'spec.basicData.database': { engine: 'sqlite-wrong' } } });

  const result = await productService.generateProduct({ id: product._id, userId: user._id }, () => {});
  expect(result.conflicts).toBe(false);
  expect(result.spec.basicData.version).toBe('0.1.1');
  expect(result.spec.basicData.database).toEqual({ engine: 'postgres' });

  const specFile = await productSpecService.readSpec({ token: 'fake', productProjectId: productProject.id });
  const normalized = normalizeProductSpec({ spec: specFile });
  expect(normalized.basicData.version).toBe('0.1.1');
  expect(normalized.basicData.database).toEqual({ engine: 'postgres' });
}, 60000);

test('a GitLab read failure during generate must NOT overwrite the good spec file with the stale Mongo cache', async () => {
  const user = await createAdminUser('spec-infra-guard');

  const lineProject = seedLineProjectWithFixture('SpecInfraLine');
  const line = await new Line({
    name: 'SpecInfraLine', version: '0.0.0', description: 'x',
    repoId: lineProject.id, namespaceId: lineProject.namespace.id,
    webUrl: lineProject.web_url, ownerId: user._id,
  }).save();

  const productProject = seedProductProject('SpecInfraProduct');
  const product = await new Product({
    spec: {
      basicData: { name: 'SpecInfraProduct', version: '0.1.0', database: {}, languages: ['en'] },
      dataModel: { cells: [] },
      features: VALID_FEATURES,
      statics: [],
    },
    lineId: line._id,
    repo: { id: productProject.id, namespaceId: productProject.namespace.id, webUrl: productProject.web_url },
  }).save();

  await productSpecService.writeSpec({
    token: 'fake', productProjectId: productProject.id, spec: product.toObject().spec, isFiller: false,
  });
  await Product.updateOne({ _id: product._id }, { $set: { 'spec.basicData.version': '9.9.9' } });

  const readSpy = vi.spyOn(productSpecService, 'readSpec')
    .mockRejectedValue(Object.assign(new Error('502 Bad Gateway'), { status: 502 }));

  let thrown = null;
  try {
    await productService.generateProduct({ id: product._id, userId: user._id }, () => {});
  } catch (err) {
    thrown = err;
  } finally {
    readSpy.mockRestore();
  }

  expect(thrown?.constructor?.name).toBe('ProductSpecUnavailableError');

  const specFile = await productSpecService.readSpec({ token: 'fake', productProjectId: productProject.id });
  expect(specFile.basicData.version).toBe('0.1.0');
}, 60000);

test('findProductById returns the spec from .linea/spec.draft.json, not a stale Mongo cache', async () => {
  const user = await createAdminUser('spec-find-gitlab');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecFindLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('FindMeProduct', '0.1.0'),
  });

  await Product.updateOne({ _id: product._id }, { $set: { 'spec.basicData.version': '9.9.9' } });

  const found = await productService.findProductById({ id: product._id, userId: user._id });
  expect(found.spec.basicData.version).toBe('0.1.0');
});

test('accents: a spec with accented names/descriptions survives the spec-file round trip', async () => {
  const user = await createAdminUser('spec-accents');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecAccentLine', version: '0.0.0', description: 'x' });

  const product = await productService.createProduct({
    userId: user._id, lineId: line._id,
    spec: noFeatureSpec('AcentoProducto', '0.1.0', { extra: { descripcion: 'Configuración de acceso público, año 2026' } }),
  });

  const specFile = await productSpecService.readSpec({
    token: 'fake', productProjectId: product.repo.id,
  });
  const normalized = normalizeProductSpec({ spec: specFile });
  expect(normalized.basicData.extra.descripcion).toBe('Configuración de acceso público, año 2026');
  expect(normalized.basicData.extra.descripcion).not.toContain('Ã');
  expectSpecFieldsMatch(specFile, product.toObject().spec);
});

test('a product predating this tanda (no spec file yet) is backfilled by the next write, without erroring', async () => {
  const user = await createAdminUser('spec-backfill');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecBackfillLine', version: '0.0.0', description: 'x' });

  const productProject = gitlabDouble().seedProject({ name: 'PreT7Product', groupName: 'PreT7Product', topics: ['product'] });
  const product = await new Product({
    spec: noFeatureSpec('PreT7Product', '0.1.0'),
    lineId: line._id,
    repo: { id: productProject.id, namespaceId: productProject.namespace.id, webUrl: productProject.web_url },
  }).save();

  expect(await productSpecService.readSpec({ token: 'fake', productProjectId: productProject.id })).toBeNull();

  const updated = await productService.updateProduct({
    id: product._id, userId: user._id, spec: noFeatureSpec('PreT7Product', '0.1.0'),
  });

  const specFile = await productSpecService.readSpec({ token: 'fake', productProjectId: productProject.id });
  expect(specFile).not.toBeNull();
  expectSpecFieldsMatch(specFile, updated.toObject().spec);
});

test('listing paths do not re-read specs for already-known products (no N GitLab calls)', async () => {
  const user = await createAdminUser('spec-list-cost');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecListCostLine', version: '0.0.0', description: 'x' });
  await productService.createProduct({ userId: user._id, lineId: line._id, spec: noFeatureSpec('ListCostA', '0.1.0') });
  await productService.createProduct({ userId: user._id, lineId: line._id, spec: noFeatureSpec('ListCostB', '0.1.0') });
  await productService.createProduct({ userId: user._id, lineId: line._id, spec: noFeatureSpec('ListCostC', '0.1.0') });

  const readSpecSpy = vi.spyOn(productSpecService, 'readSpec');
  const readFallbackSpy = vi.spyOn(productSpecService, 'getSpecFromHostOrCache');

  const enrolled = await productService.findEnrolledProducts({ userId: user._id });
  expect(enrolled.length).toBeGreaterThanOrEqual(3);

  const reconciled = await productService.reconcileProducts({ userId: user._id });
  expect(reconciled.created).toEqual([]);

  const lineProducts = await lineService.findProductsByLineId({ id: line._id, userId: user._id });
  expect(lineProducts.length).toBe(3);

  expect(readSpecSpy).not.toHaveBeenCalled();
  expect(readFallbackSpy).not.toHaveBeenCalled();

  readSpecSpy.mockRestore();
  readFallbackSpy.mockRestore();
});

test('findProductsByLineId reads specs from GitLab only when explicitly asked (specFromRepo: true)', async () => {
  const user = await createAdminUser('spec-specFromRepo-line');
  const line = await lineService.createLine({ userId: user._id, name: 'SpecReadLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('SpecLineTarget', '0.1.0'),
  });

  await Product.updateOne({ _id: product._id }, { $set: { 'spec.basicData.version': '9.9.9' } });

  const [specFromCache] = await lineService.findProductsByLineId({ id: line._id, userId: user._id });
  expect(specFromCache.spec.basicData.version).toBe('9.9.9');

  const [fromGitlab] = await lineService.findProductsByLineId({ id: line._id, userId: user._id, specFromRepo: true });
  expect(fromGitlab.spec.basicData.version).toBe('0.1.0');
});
