import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import mongoose from 'mongoose';

const { git } = vi.hoisted(() => ({ git: {} }));
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => git }));
vi.mock('../model/services/generatePipeline.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadContext: vi.fn(), downloadAndUnzipLine: vi.fn(), downloadOldProduct: vi.fn(),
  runEngine: vi.fn(), unzipOldProduct: vi.fn(), prettifyAndDiff: vi.fn(),
}));

const stages = await import('../model/services/generatePipeline.js');
const { default: ProductService } = await import('../model/services/ProductService.js');
const { default: Product } = await import('../model/entities/product.js');
const { default: SyncRun } = await import('../model/entities/syncRun.js');
const { takeLock, productLockId, heldLocks, LockedError } = await import('../model/services/productLock.js');
const { setup, clear, teardown } = await import('./setup.js');

const DEPLOYED = { version: '1.4.0', spec: { basicData: { name: 'shop', version: '1.4.0' } }, models: { data: {} } };
const ACTIONS = [{ action: 'update', file_path: 'a.js', content: 'x' }, { action: 'create', file_path: 'b.js', content: 'y' }];

const USER = '64b000000000000000000001';
let service;
let product;

const gitDouble = () => Object.assign(git, {
  getBranch: vi.fn().mockResolvedValue({ lastCommit: { id: 'abc123' } }),
  listChangeRequests: vi.fn().mockResolvedValue([]),
  createBranch: vi.fn().mockResolvedValue({}),
  commit: vi.fn().mockResolvedValue({}),
  createChangeRequest: vi.fn().mockResolvedValue({ number: 8, webUrl: 'https://gl/mr/8' }),
  createOrRenameChangeRequest: vi.fn().mockResolvedValue({ number: 9, webUrl: 'https://gl/mr/9' }),
  mergeChangeRequest: vi.fn().mockResolvedValue(false),
  createTag: vi.fn().mockResolvedValue({}),
  rollback: vi.fn().mockResolvedValue(),
});

beforeAll(setup);
afterAll(teardown);
beforeEach(async () => {
  gitDouble();
  product = await Product.create({ lineId: new mongoose.Types.ObjectId(), gitHost: 'gitlab', repo: { id: 5 }, spec: { basicData: { name: 'shop', version: '1.4.0' } } });
  const line = { _id: product.lineId, version: '7.0.0', repoId: 1, sync: { enabled: true, preset: '6h', behavior: 'mr' } };
  service = new ProductService();
  vi.mocked(stages.loadContext).mockResolvedValue({ product, line, token: 't', logError: vi.fn() });
  vi.mocked(stages.downloadAndUnzipLine).mockResolvedValue({ lineOutput: '/x' });
  vi.mocked(stages.downloadOldProduct).mockResolvedValue({ productZip: Buffer.alloc(0) });
  vi.mocked(stages.runEngine).mockResolvedValue({});
  vi.mocked(stages.unzipOldProduct).mockResolvedValue({ oldProductOutput: '/old' });
  vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: [] });
  service.productRepository = { findById: vi.fn().mockResolvedValue(product) };
  service.productSpecService = { readDeployed: vi.fn().mockResolvedValue(DEPLOYED), writeDeployed: vi.fn().mockResolvedValue() };
  service.modularService = { prepareDerivation: vi.fn().mockResolvedValue({ models: {}, resolved: {} }), updateProductManifest: vi.fn().mockResolvedValue(), getProductHealth: vi.fn().mockResolvedValue({ valid: false, features: [] }) };
  service.productCiService = { loadConfig: vi.fn().mockResolvedValue({ enabled: false, waitForChecks: false }) };
});
afterEach(async () => { await clear(); });

const sync = (options = {}) => service.syncProduct({ id: String(product._id), userId: USER, ...options });
const noWrites = () => {
  for (const name of ['createBranch', 'commit', 'createChangeRequest', 'createOrRenameChangeRequest', 'mergeChangeRequest', 'createTag']) expect(git[name]).not.toHaveBeenCalled();
};

describe('syncing a product with its SPL', () => {
  it('brings in the features the SPL made mandatory and drops the ones it lost, and says so in the run', async () => {
    const had = DEPLOYED.spec.features ?? [];
    service.modularService.getProductHealth.mockResolvedValue({ valid: true, features: [...had.filter((f) => f !== 'Old'), 'Gamma'] });
    service.setFeatures = vi.fn().mockResolvedValue(true);
    DEPLOYED.spec.features = [...had, 'Old'];

    const run = await sync();

    expect(run).toMatchObject({ featuresAdded: ['Gamma'], featuresRemoved: ['Old'] });
    expect(service.setFeatures).toHaveBeenCalledWith(expect.objectContaining({ features: expect.arrayContaining(['Gamma']) }));
    expect(service.productSpecService.writeDeployed).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ features: expect.arrayContaining(['Gamma']) }) }));
    DEPLOYED.spec.features = had;
  });

  it('derives what is DEPLOYED, with the models that were deployed', async () => {
    await sync();
    expect(stages.runEngine.mock.calls[0][0].product.spec.basicData.version).toBe('1.4.0');
    expect(service.modularService.prepareDerivation).toHaveBeenCalledWith(expect.objectContaining({ models: DEPLOYED.models }));
  });

  it('does nothing when the code is already in line, but notes the SPL commit it was checked against', async () => {
    const run = await sync();
    expect(run).toMatchObject({ status: 'unchanged', trigger: 'manual', behavior: 'mr', version: '1.4.0', lineVersion: '7.0.0' });
    noWrites();
    expect(service.productSpecService.writeDeployed).toHaveBeenCalledWith(expect.objectContaining({ spec: DEPLOYED.spec, lineRef: 'abc123' }));
    const stored = await Product.findById(product._id);
    expect(stored.lastSyncAt).toBeInstanceOf(Date);
    expect(stored.nextSyncAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('only reports the drift when the behavior is "check"', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    const run = await sync({ behavior: 'check' });
    expect(run).toMatchObject({ status: 'drift', files: 2 });
    noWrites();
  });

  it('"mr": brings bigbang up to date, opens the update request WITHOUT merging it, and never raises the version', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    const run = await sync();
    expect(run).toMatchObject({ status: 'mr', files: 2, version: '1.4.0', mr: { number: 9, url: 'https://gl/mr/9' } });
    expect(git.createBranch).toHaveBeenCalledWith(expect.objectContaining({ branch: expect.stringMatching(/^sync\/\d{8}T\d{6}$/), ref: 'bigbang' }));
    expect(git.commit).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sync with SPL v7.0.0' }));
    expect(git.mergeChangeRequest).toHaveBeenCalledTimes(1); // the sync branch into bigbang, not bigbang into main
    expect(git.createOrRenameChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync with SPL v7.0.0 (product v1.4.0)' }));
    expect(git.createTag).not.toHaveBeenCalled();
    expect(service.productSpecService.writeDeployed).not.toHaveBeenCalled();
    expect((await Product.findById(product._id)).spec.basicData.version).toBe('1.4.0');
  });

  it('"merge": merges the update request too, and records the SPL commit as deployed', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    const run = await sync({ behavior: 'merge' });
    expect(run.status).toBe('merged');
    expect(git.mergeChangeRequest).toHaveBeenCalledTimes(2);
    expect(git.createTag).not.toHaveBeenCalled();
    expect(service.productSpecService.writeDeployed).toHaveBeenCalledWith(expect.objectContaining({ lineRef: 'abc123' }));
  });

  it('uses the behavior the product inherits when none is forced', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    await Product.updateOne({ _id: product._id }, { $set: { 'sync.behavior': 'check' } });
    product.sync.behavior = 'check';
    expect((await sync()).status).toBe('drift');
  });

  it('a conflict leaves the request open and says so', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    git.mergeChangeRequest.mockResolvedValue(true);
    expect(await sync()).toMatchObject({ status: 'failed', reason: 'conflicts', mr: { number: 8 } });
    expect(git.createOrRenameChangeRequest).not.toHaveBeenCalled();
  });

  it('leaves alone an update that a generation did not finish', async () => {
    vi.mocked(stages.prettifyAndDiff).mockResolvedValue({ actions: ACTIONS });
    git.listChangeRequests.mockResolvedValue([{ number: 4, sourceBranch: 'bigbang', title: 'Update to product version: 1.5.0', webUrl: 'https://gl/mr/4' }]);
    expect(await sync()).toMatchObject({ status: 'skipped', reason: 'update-pending', mr: { number: 4 } });
    noWrites();
  });

  it('skips a product that was never generated', async () => {
    service.productSpecService.readDeployed.mockResolvedValue(null);
    expect(await sync()).toMatchObject({ status: 'skipped', reason: 'never-deployed' });
    expect(stages.runEngine).not.toHaveBeenCalled();
  });

  it('is refused while the product is being generated, and leaves no trace', async () => {
    const release = await takeLock(productLockId(product._id), 'generate', { owner: 'ana' });
    await expect(sync()).rejects.toBeInstanceOf(LockedError);
    expect(await SyncRun.countDocuments()).toBe(0);
    await release();
  });

  it('records a failure, rethrows it, and frees the product', async () => {
    vi.mocked(stages.runEngine).mockRejectedValue(new Error('engine exploded'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sync({ trigger: 'cron' })).rejects.toThrow('engine exploded');
    quiet.mockRestore();
    expect(await SyncRun.findOne()).toMatchObject({ status: 'failed', trigger: 'cron', reason: 'engine exploded' });
    expect(await heldLocks('product:')).toEqual([]);
    expect(git.rollback).toHaveBeenCalled();
  });

  it('lists its syncs, newest first', async () => {
    await sync();
    await sync();
    service.permissionChecker = { checkUserExistsAndHasPrivileges: vi.fn().mockResolvedValue({}) };
    const runs = await service.listSyncs({ id: String(product._id), userId: USER });
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(runs[1].startedAt.getTime());
  });
});
