import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ProductRepository from '../model/repositories/ProductRepository.js';
import { AlreadyExistentProductError } from '../model/errors/errors.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

async function createAdminUser(prefix) {
  const hashedPassword = await bcrypt.hash('password', 10);
  return new User({ username: `${prefix}-${Date.now()}-${Math.random()}`, password: hashedPassword, admin: true }).save();
}

const specFor = (name) => ({
  basicData: { name, version: '0.0.0', database: {}, languages: ['en'] },
  dataModel: { cells: [] },
  features: [],
  statics: [],
});

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

test('ADR-032: the same product name in TWO DIFFERENT lines no longer collides', async () => {
  const lineService = Container.get(LineService);
  const productService = Container.get(ProductService);

  const user = await createAdminUser('per-line-uniqueness');
  const lineA = await lineService.createLine({ userId: user._id, name: 'PerLineUniquenessA', version: '0.0.0', description: 'x' });
  const lineB = await lineService.createLine({ userId: user._id, name: 'PerLineUniquenessB', version: '0.0.0', description: 'x' });

  await productService.createProduct({ userId: user._id, lineId: lineA._id, spec: specFor('SharedName') });

  const productB = await productService.createProduct({ userId: user._id, lineId: lineB._id, spec: specFor('SharedName') });
  expect(productB.spec.basicData.name).toBe('SharedName');
  expect(String(productB.lineId)).toBe(String(lineB._id));
});

test('unchanged: the same product name in the SAME line still collides (409)', async () => {
  const lineService = Container.get(LineService);
  const productService = Container.get(ProductService);

  const user = await createAdminUser('same-line-collision');
  const line = await lineService.createLine({ userId: user._id, name: 'SameLineCollisionLine', version: '0.0.0', description: 'x' });

  await productService.createProduct({ userId: user._id, lineId: line._id, spec: specFor('DupInSameLine') });
  await expect(
    productService.createProduct({ userId: user._id, lineId: line._id, spec: specFor('DupInSameLine') })
  ).rejects.toThrow(AlreadyExistentProductError);
});

test('ProductRepository.findByName throws TypeError when lineId is missing — no silent global fallback', async () => {
  const productRepository = Container.get(ProductRepository);
  await expect(productRepository.findByName('AnyName', undefined)).rejects.toThrow(TypeError);
  await expect(productRepository.findByName('AnyName', null)).rejects.toThrow(TypeError);
});

test('renaming a product onto a name the line already uses is refused; renaming to its own name or a free one is not', async () => {
  const lineService = Container.get(LineService);
  const productService = Container.get(ProductService);

  const user = await createAdminUser('rename-collision');
  const line = await lineService.createLine({ userId: user._id, name: 'RenameCollisionLine', version: '0.0.0', description: 'x' });
  const first = await productService.createProduct({ userId: user._id, lineId: line._id, spec: specFor('RenameFirst') });
  await productService.createProduct({ userId: user._id, lineId: line._id, spec: specFor('RenameSecond') });

  await expect(
    productService.renameProduct({ id: first._id, name: 'RenameSecond', userId: user._id })
  ).rejects.toThrow(AlreadyExistentProductError);

  const same = await productService.renameProduct({ id: first._id, name: 'RenameFirst', userId: user._id });
  expect(same.spec.basicData.name).toBe('RenameFirst');
  const free = await productService.renameProduct({ id: first._id, name: 'RenameFree', userId: user._id });
  expect(free.spec.basicData.name).toBe('RenameFree');
});
