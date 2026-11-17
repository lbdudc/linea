import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { parseProductsIndex } from '@lbdudc/linea-core';
import User from '../model/entities/user.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import { getGitProvider } from '../model/git/index.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);

async function createAdminUser(prefix) {
  const hashedPassword = await bcrypt.hash('password', 10);
  return new User({ username: `${prefix}-${Date.now()}-${Math.random()}`, password: hashedPassword, admin: true }).save();
}

const noFeatureSpec = (name, version = '0.0.0') => ({
  basicData: { name, version, database: {}, languages: ['en'] },
  dataModel: { cells: [] },
  features: [],
  statics: [],
});

async function readIndex(lineProjectId) {
  const meta = await getGitProvider().getFileRevision({ token: 'fake', id: lineProjectId, path: 'products.json', ref: 'main' });
  return parseProductsIndex({ content: Buffer.from(meta.content, 'base64').toString('utf8') });
}

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

test('createProduct: products.json contains exactly the new product', async () => {
  const user = await createAdminUser('idx-create');
  const line = await lineService.createLine({ userId: user._id, name: 'IdxCreateLine', version: '0.0.0', description: 'x' });

  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('IdxProduct', '0.3.0'),
  });

  const index = await readIndex(line.repoId);
  expect(index.productos).toEqual([
    { name: 'IdxProduct', repositorio: `IdxCreateLine/IdxProduct/IdxProduct`, version: '0.3.0' },
  ]);
  expect(product.repo.id).toBeTruthy();
});

test('renameProduct: products.json reflects the new name, keeps repositorio and version', async () => {
  const user = await createAdminUser('idx-rename');
  const line = await lineService.createLine({ userId: user._id, name: 'IdxRenameLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('OldName', '0.5.0'),
  });

  await productService.renameProduct({ id: product._id, name: 'NewName', userId: user._id });

  const index = await readIndex(line.repoId);
  expect(index.productos).toEqual([
    { name: 'NewName', repositorio: `IdxRenameLine/OldName/OldName`, version: '0.5.0' },
  ]);
});

test('deleteProduct: products.json no longer contains the product', async () => {
  const user = await createAdminUser('idx-delete');
  const line = await lineService.createLine({ userId: user._id, name: 'IdxDeleteLine', version: '0.0.0', description: 'x' });
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id, spec: noFeatureSpec('GoneProduct'),
  });
  expect((await readIndex(line.repoId)).productos).toHaveLength(1);

  await productService.deleteProduct({ id: product._id, userId: user._id });

  expect((await readIndex(line.repoId)).productos).toEqual([]);
});
