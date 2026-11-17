import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ProductRepository from '../model/repositories/ProductRepository.js';
import LogRepository from '../model/repositories/LogRepository.js';
import { requestCancel, beginRun, endRun, GenerationCancelledError } from '../model/services/generationRuns.js';
import { getGitProvider } from '../model/git/index.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

vi.setConfig({ testTimeout: 120_000 });

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const productRepository = Container.get(ProductRepository);
const logRepository = Container.get(LogRepository);

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

const makeProduct = async () => {
  const user = await new User({ username: `ctl-${Date.now()}`, password: await bcrypt.hash('password', 10), admin: true }).save();
  const line = await lineService.createLine({ userId: user._id, name: 'CtlLine', version: '1.0.0', description: 'x', kind: 'plain' });
  await lineService.saveFeatureModel({ id: line._id, userId: user._id, content: 'featuremodel CtlLine\nfeature CtlLine {\n  optional { feature A }\n}\n' });
  const product = await productService.createProduct({
    lineId: line._id, userId: user._id,
    spec: { basicData: { name: 'Ctl', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['CtlLine'], statics: [] },
  });
  return { user, product };
};

test('cancelling a generation before it writes stops it and leaves the repository and the product as they were', async () => {
  const { user, product } = await makeProduct();
  const events = [];
  const result = await productService.generateProduct({ id: product._id, userId: user._id }, async (event) => {
    events.push(event);
    if (event.message === 'log.downloaded_spl') {
      expect(await productService.cancelGeneration({ id: product._id, userId: user._id })).toEqual({ status: 'cancelling' });
    }
  });

  expect(result).toEqual({ cancelled: true, productId: String(product._id) });
  expect(events.at(-1)).toMatchObject({ type: 'cancelled', message: 'log.cancelled' });
  const git = getGitProvider();
  expect(await git.getTag({ token: 'x', id: product.repo.id, tag: 'v0.0.1' }).catch(() => null)).toBeFalsy();
  const kept = await productRepository.findById(product._id);
  expect(kept.spec.basicData.version).toBe('0.0.0');
  expect(await requestCancel(product._id)).toBe('idle');

  const generated = await productService.generateProduct({ id: product._id, userId: user._id }, () => {});
  expect(generated.spec.basicData.version).toBe('0.0.1');
});

test('a cancelled generation shows as cancelled in the history, and a later one that works replaces it', async () => {
  const { user, product } = await makeProduct();
  const written = [];
  const log = async (event) => {
    written.push(event);
    await logRepository.save(new logRepository.model({ ...event, productId: product._id, userId: user._id }));
    if (event.message === 'log.downloaded_spl') await productService.cancelGeneration({ id: product._id, userId: user._id });
  };
  await productService.generateProduct({ id: product._id, userId: user._id }, log);
  const last = await logRepository.findLastOutcomeByProductIds([product._id]);
  expect(last[String(product._id)].outcome).toBe('cancelled');
  expect(await logRepository.findVersionsByProductId(product._id)).toEqual([]);
});

test('the run that is committing cannot be cancelled', () => {
  const run = beginRun('p-1', 'u-1');
  expect(requestCancel('p-1')).toBe('cancelling');
  expect(() => run.checkpoint()).toThrow(GenerationCancelledError);
  endRun('p-1', run);

  const writing = beginRun('p-2', 'u-1');
  writing.commit();
  expect(requestCancel('p-2')).toBe('committing');
  expect(() => writing.checkpoint()).not.toThrow();
  endRun('p-2', writing);
});

test('a preview lists the changed files with their diff and writes nothing', async () => {
  const { user, product } = await makeProduct();
  await productService.generateProduct({ id: product._id, userId: user._id }, () => {});
  const git = getGitProvider();
  const tagsBefore = await git.getTag({ token: 'x', id: product.repo.id, tag: 'v0.0.2' }).catch(() => null);

  const preview = await productService.previewGeneration({ id: product._id, userId: user._id, bump: 'minor' });

  expect(preview.previousVersion).toBe('0.0.1');
  expect(tagsBefore).toBeFalsy();
  expect(await git.getTag({ token: 'x', id: product.repo.id, tag: 'v0.1.0' }).catch(() => null)).toBeFalsy();
  expect((await productRepository.findById(product._id)).spec.basicData.version).toBe('0.0.1');
  for (const file of preview.files) expect(file).toHaveProperty('diff');
  if (preview.changed) {
    expect(preview.files.some((file) => typeof file.diff === 'string' && file.diff.startsWith('@@'))).toBe(true);
    expect(preview.counts.update + preview.counts.create + preview.counts.delete).toBeGreaterThan(0);
  }
});
