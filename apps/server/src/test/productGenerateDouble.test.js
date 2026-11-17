import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import { getGitProvider } from '../model/git/index.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

vi.setConfig({ testTimeout: 120_000 });

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

// A product generated from its SPL, all the way: its repository gets the generated code, the version is raised, tagged and released.
test('a product is generated from its SPL, and its version is raised, tagged and released', async () => {
  const user = await new User({ username: `gen-${Date.now()}`, password: await bcrypt.hash('password', 10), admin: true }).save();
  const line = await lineService.createLine({ userId: user._id, name: 'GenLine', version: '1.0.0', description: 'x', kind: 'plain' });
  await lineService.saveFeatureModel({ id: line._id, userId: user._id, content: 'featuremodel GenLine\nfeature GenLine {\n  optional { feature A }\n}\n' });
  const product = await productService.createProduct({
    lineId: line._id, userId: user._id,
    spec: { basicData: { name: 'Sample', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['GenLine'], statics: [] },
  });

  const generation = await productService.generateProduct({ id: product._id, userId: user._id }, () => {});

  expect(generation.spec.basicData.name).toBe('Sample');
  expect(generation.spec.basicData.version).toBe('0.0.1');
  expect(generation.conflicts).toBe(false);
  const git = getGitProvider();
  expect(await git.getTag({ token: 'x', id: product.repo.id, tag: 'v0.0.1' })).toBeTruthy();
  expect(await git.getRelease({ token: 'x', id: product.repo.id, tag: 'v0.0.1' })).toMatchObject({ tag: 'v0.0.1' });
});
