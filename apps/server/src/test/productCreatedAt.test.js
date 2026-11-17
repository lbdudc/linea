import bcrypt from 'bcrypt';
import { test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import ProductService from '../model/services/ProductService.js';
import LineService from '../model/services/LineService.js';
import { setup, clear, teardown } from './setup.js';

const productService = Container.get(ProductService);
const lineService = Container.get(LineService);

const REPO_DATE = '2024-03-05T10:00:00.000Z';

const seedUser = async () => new User({ username: `user-${Math.random()}`, password: await bcrypt.hash('password', 10) }).save();
const seedLine = () => new Line({ name: `line-${Math.random()}`, version: '1.0.0', repoId: 900, namespaceId: 90 }).save();
const seedProduct = (line, repoId, createdAt) => new Product({
  lineId: line._id, spec: { basicData: { name: `product-${repoId}`, createdAt } }, repo: { id: repoId, namespaceId: repoId },
}).save();
const onHost = (id, createdAt = REPO_DATE) => ({ id, name: `product-${id}`, namespaceId: id, parentNamespaceId: 90, webUrl: `https://gitlab.example/${id}`, webIdeUrl: '', topics: ['product'], createdAt });
const hostLists = (projects) => vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue(projects);
const storedDate = async (product) => (await Product.findById(product._id)).spec.basicData.createdAt;

beforeEach(() => clearReadCache());

test.each([
  ['has no spec', null],
  ['has a spec with no date', { basicData: { name: 'product-401', createdAt: null } }],
  ['has a spec with another date', { basicData: { name: 'product-401', createdAt: '2026-11-02T09:41:25.000Z' } }],
])('a product found on the host that %s takes the date of its repository', async (_, spec) => {
  await seedLine();
  hostLists([onHost(401)]);
  vi.spyOn(productService.productSpecService, 'readSpec').mockResolvedValue(spec);
  const user = await seedUser();

  const [product] = await productService.findEnrolledProducts({ userId: user._id });

  expect(product.spec.basicData.createdAt.toISOString()).toBe(REPO_DATE);
});

test('a product found with no date anywhere is dated when it is found, not 1970', async () => {
  await seedLine();
  hostLists([onHost(407, null)]);
  vi.spyOn(productService.productSpecService, 'readSpec').mockResolvedValue({ basicData: { name: 'product-407', createdAt: null } });
  const user = await seedUser();

  const [product] = await productService.findEnrolledProducts({ userId: user._id });

  expect(product.spec.basicData.createdAt.getFullYear()).toBeGreaterThan(2000);
});

test('a product dated the day it was found is corrected, and stays so', async () => {
  const line = await seedLine();
  const stored = await seedProduct(line, 402, new Date('2026-11-02T09:41:25.000Z'));
  hostLists([onHost(402)]);
  const user = await seedUser();

  const [product] = await productService.findEnrolledProducts({ userId: user._id });

  expect(product.spec.basicData.createdAt.toISOString()).toBe(REPO_DATE);
  expect((await storedDate(stored)).toISOString()).toBe(REPO_DATE);
});

test('a product with no date gets that of its repository instead of showing 1970', async () => {
  const line = await seedLine();
  const stored = await seedProduct(line, 403, null);
  hostLists([onHost(403)]);
  const user = await seedUser();

  await productService.findEnrolledProducts({ userId: user._id });

  expect((await storedDate(stored)).toISOString()).toBe(REPO_DATE);
});

test('a product made here keeps its own date when the repository was made seconds apart', async () => {
  const line = await seedLine();
  const stored = await seedProduct(line, 404, new Date('2026-11-05T15:12:38.000Z'));
  hostLists([onHost(404, '2026-11-05T15:12:40.000Z')]);
  const user = await seedUser();

  await productService.findEnrolledProducts({ userId: user._id });

  expect((await storedDate(stored)).toISOString()).toBe('2026-11-05T15:12:38.000Z');
});

test('a host that does not say when it made a repository leaves the date as it is', async () => {
  const line = await seedLine();
  const stored = await seedProduct(line, 405, new Date('2026-11-02T09:41:25.000Z'));
  hostLists([onHost(405, null)]);
  const user = await seedUser();

  await productService.findEnrolledProducts({ userId: user._id });

  expect((await storedDate(stored)).toISOString()).toBe('2026-11-02T09:41:25.000Z');
});

test('the products of a line show the date of their repository too', async () => {
  const line = await seedLine();
  const stored = await seedProduct(line, 406, null);
  hostLists([onHost(406)]);
  const user = await seedUser();
  vi.spyOn(lineService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue(user);

  const [product] = await lineService.findProductsByLineId({ id: line._id, userId: user._id });

  expect(product.spec.basicData.createdAt.toISOString()).toBe(REPO_DATE);
  expect((await storedDate(stored)).toISOString()).toBe(REPO_DATE);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
