import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';

const { git } = vi.hoisted(() => ({ git: {} }));
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => git }));
vi.mock('../model/services/generatePipeline.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadContext: vi.fn(), downloadAndUnzipLine: vi.fn(), downloadOldProduct: vi.fn(), runEngine: vi.fn(), unzipOldProduct: vi.fn(),
  prettifyAndDiff: vi.fn(), saveProductVersion: vi.fn(), mergeGenerationBranch: vi.fn(), createVersionTag: vi.fn(), mergeUpdateBranch: vi.fn(),
}));

const stages = await import('../model/services/generatePipeline.js');
const { default: ProductService } = await import('../model/services/ProductService.js');
const { default: Product } = await import('../model/entities/product.js');
const { heldLocks } = await import('../model/services/productLock.js');
const { setup, clear, teardown } = await import('./setup.js');

const USER = '64b000000000000000000001';
const ACTIONS = [{ action: 'update', file_path: 'a.js', content: 'x' }];
let service;
let product;

beforeAll(setup);
afterAll(teardown);
beforeEach(async () => {
  Object.assign(git, { getBranch: vi.fn().mockResolvedValue({ lastCommit: { id: 'abc' } }), rollback: vi.fn().mockResolvedValue(), listChangeRequests: vi.fn().mockResolvedValue([]), getTag: vi.fn().mockResolvedValue({}) });
  product = await Product.create({ lineId: new mongoose.Types.ObjectId(), gitHost: 'gitlab', repo: { id: 5 }, spec: { basicData: { name: 'shop', version: '1.0.0' } } });
  const toObject = () => ({ _id: product._id, lineId: product.lineId, spec: { basicData: { name: 'shop', version: '1.1.0' } } });
  const doc = { ...toObject(), repo: { id: 5 }, gitHost: 'gitlab', toObject, generation: product.generation };
  service = new ProductService();
  vi.mocked(stages.loadContext).mockResolvedValue({ product: doc, line: { _id: product.lineId, repoId: 1, version: '2.0.0' }, token: 't', newVersion: '1.1.0', previousVersion: '1.0.0', logError: vi.fn() });
  vi.mocked(stages.downloadAndUnzipLine).mockResolvedValue({ lineOutput: '/x' });
  vi.mocked(stages.downloadOldProduct).mockResolvedValue({ productZip: Buffer.alloc(0) });
  vi.mocked(stages.runEngine).mockResolvedValue({});
  vi.mocked(stages.unzipOldProduct).mockResolvedValue({ oldProductOutput: '/old' });
  vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
  vi.mocked(stages.saveProductVersion).mockImplementation(async () => ({ result: toObject() }));
  vi.mocked(stages.mergeGenerationBranch).mockResolvedValue({ generationConflicts: false });
  vi.mocked(stages.createVersionTag).mockResolvedValue();
  vi.mocked(stages.mergeUpdateBranch).mockResolvedValue({ updateConflicts: false, updateMergeRequest: { number: 9, webUrl: '' }, token: 't' });
  service.productRepository = { findById: vi.fn().mockResolvedValue(product) };
  service.productCiService = { loadConfig: vi.fn().mockResolvedValue({ enabled: false, waitForChecks: false }) };
  service.modularService = { assertProductFits: vi.fn().mockResolvedValue(), prepareDerivation: vi.fn().mockResolvedValue({ models: {}, resolved: {} }), updateProductManifest: vi.fn().mockResolvedValue(), composeProductSpec: vi.fn().mockResolvedValue(null), productManifest: vi.fn().mockReturnValue(null) };
  service.productSpecService = { writeDeployed: vi.fn().mockResolvedValue(), writeSpec: vi.fn().mockResolvedValue({}), getSpecFromHostOrCache: vi.fn().mockResolvedValue({ spec: product.spec, source: 'mongo' }) };
  service.dataSource = { startTransaction: vi.fn().mockResolvedValue({}), commitTransaction: vi.fn().mockResolvedValue(), abortTransaction: vi.fn().mockResolvedValue() };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); await clear(); });

const generate = (options = {}) => service.generateProduct({ id: String(product._id), userId: USER, ...options }, vi.fn());

describe('generating a product whose checks do not pass', () => {
  const FAILED = { status: 'failed', job: 'client_build', url: '' };
  const waitingConfig = (onChecksFailed) => ({ enabled: true, waitForChecks: true, onChecksFailed, mode: 'yaml', yaml: 'a: 1\n', tags: [], jobs: [] });
  const merged = (extra) => ({ updateConflicts: false, updateMergeRequest: { number: 9, webUrl: '' }, token: 't', ...extra });
  const askedOf = () => vi.mocked(stages.mergeUpdateBranch).mock.lastCall[0].ci.onChecksFailed;

  it('does what the product is set to, and a request cannot say otherwise', async () => {
    service.productCiService.loadConfig.mockResolvedValue(waitingConfig('merge'));
    await generate({ onChecksFailed: 'reject' });
    expect(askedOf()).toBe('merge');
  });

  it('merged anyway, it is deployed, and says it was decided', async () => {
    service.productCiService.loadConfig.mockResolvedValue(waitingConfig('merge'));
    vi.mocked(stages.mergeUpdateBranch).mockResolvedValue(merged({ checksOverridden: true }));
    const result = await generate();
    expect(result).toMatchObject({ checksDecision: 'merge', conflicts: false, deployment: { pending: false, version: '1.1.0' } });
    expect(result.checksFailed).toBeUndefined();
  });

  it('rejected, it is not deployed and nothing waits for a person', async () => {
    service.productCiService.loadConfig.mockResolvedValue(waitingConfig('reject'));
    vi.mocked(stages.mergeUpdateBranch).mockResolvedValue(merged({ checksFailed: FAILED, rejected: true }));
    const result = await generate();
    expect(result).toMatchObject({ checksDecision: 'reject', deployment: { pending: true, version: '1.0.0' } });
    expect(result.checksFailed).toBeUndefined();
    expect((await Product.findById(product._id).lean()).pendingUpdate ?? null).toBeNull();
    expect(service.productSpecService.writeDeployed).not.toHaveBeenCalled();
  });

  it('a new generation takes over what was waiting for a person', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { pendingUpdate: { number: 9, version: '1.0.1', data: '{}' } } });
    let during;
    vi.mocked(stages.mergeUpdateBranch).mockImplementation(async () => {
      during = (await Product.findById(product._id).lean()).pendingUpdate ?? null;
      return merged();
    });
    await generate();
    expect(during).toBeNull();
  });

  it('left to ask, it waits for a person as before', async () => {
    service.productCiService.loadConfig.mockResolvedValue(waitingConfig('ask'));
    vi.mocked(stages.mergeUpdateBranch).mockResolvedValue(merged({ checksFailed: FAILED }));
    const result = await generate();
    expect(result.checksFailed).toEqual(FAILED);
    expect(result.checksDecision).toBeUndefined();
    expect((await Product.findById(product._id).lean()).pendingUpdate).toMatchObject({ number: 9, version: '1.1.0' });
  });

  it('does not wait for the checks of a project with CI/CD off on the host', async () => {
    service.productCiService.loadConfig.mockResolvedValue(waitingConfig('ask'));
    git.pipelinesEnabled = vi.fn().mockResolvedValue(false);
    await generate();
    delete git.pipelinesEnabled;
    expect(vi.mocked(stages.mergeUpdateBranch).mock.lastCall[0].ci).toBeNull();
  });
});

describe('generating a product set not to merge its own updates', () => {
  it('opens the update request for a person and leaves the product pending', async () => {
    product.generation.autoMerge = false;
    const result = await generate();
    expect(stages.mergeUpdateBranch).toHaveBeenCalledWith(expect.objectContaining({ merge: false }));
    expect(result).toMatchObject({ conflicts: false, awaitingMerge: true, mergeRequest: { number: 9, url: '' }, deployment: { pending: true, version: '1.0.0' } });
    // the code is not on the default branch yet: nothing is recorded as deployed
    expect(service.productSpecService.writeDeployed).not.toHaveBeenCalled();
    expect(await heldLocks('product:')).toEqual([]);
  });

  it('merges as before when it is left on', async () => {
    const result = await generate();
    expect(stages.mergeUpdateBranch).toHaveBeenCalledWith(expect.objectContaining({ merge: true }));
    expect(result.awaitingMerge).toBeUndefined();
    expect(result.deployment).toMatchObject({ pending: false, version: '1.1.0' });
  });

  it('uses the bump the product is set to when none is asked for, and the asked one when there is', async () => {
    product.generation.bump = 'minor';
    await generate();
    expect(stages.loadContext).toHaveBeenLastCalledWith(expect.objectContaining({ bump: 'minor' }));
    await generate({ bump: 'major' });
    expect(stages.loadContext).toHaveBeenLastCalledWith(expect.objectContaining({ bump: 'major' }));
  });
});
