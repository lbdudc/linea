import bcrypt from 'bcrypt';
import { test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ModularService from '../model/services/modules/ModularService.js';
import { AlreadyExistentLineError, LineDeletedError, LineNotFoundError, PermissionError, ProductNotFoundError, RestoreBlockedError } from '../model/errors/errors.js';
import { setup, clear, teardown } from './setup.js';

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const modularService = Container.get(ModularService);

const seedUser = async () => new User({ username: `user-${Math.random()}`, password: await bcrypt.hash('password', 10) }).save();
const seedLine = (overrides = {}) => new Line({ name: 'Gis', version: '1.0.0', repoId: 100, namespaceId: 10, ...overrides }).save();
const seedProduct = (line, repoId, name = `product-${repoId}`) => new Product({
  lineId: line._id,
  spec: { basicData: { name } },
  repo: { id: repoId, namespaceId: repoId * 10, webUrl: `https://gitlab.example/${name}` },
}).save();

let deleteRepository;
let deleteNamespace;
let allowed;

beforeEach(() => {
  clearReadCache();
  deleteRepository = vi.spyOn(GitLabProvider.prototype, 'deleteRepository').mockResolvedValue(undefined);
  deleteNamespace = vi.spyOn(GitLabProvider.prototype, 'deleteNamespace').mockResolvedValue(undefined);
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([]);
  allowed = vi.fn(async ({ userId }) => User.findById(userId));
  lineService.permissionChecker.checkUserExistsAndHasPrivileges = allowed;
  productService.permissionChecker.checkUserExistsAndHasPrivileges = allowed;
  modularService.permissionChecker.checkUserExistsAndHasPrivileges = allowed;
});

test('by default a line goes with all its products, through the namespace that holds them', async () => {
  const line = await seedLine();
  await seedProduct(line, 201);
  await seedProduct(line, 202);
  const user = await seedUser();

  await lineService.deleteLine({ id: line._id, userId: user._id });

  expect(deleteNamespace.mock.calls.map(([args]) => args.id)).toEqual([10]);
  expect(deleteRepository).not.toHaveBeenCalled();
  expect(await Line.findById(line._id)).toBeNull();
  expect(await Product.countDocuments({ lineId: line._id })).toBe(0);
});

test('a product kept stays where it is, without a line; the others and the repository of the line go', async () => {
  const line = await seedLine();
  const gone = await seedProduct(line, 201);
  const kept = await seedProduct(line, 202);
  const user = await seedUser();

  await lineService.deleteLine({ id: line._id, userId: user._id, keepProductIds: [String(kept._id)] });

  expect(deleteRepository.mock.calls.map(([args]) => args.id)).toEqual([201, 100]);
  expect(deleteNamespace.mock.calls.map(([args]) => args.id)).toEqual([2010]);
  expect(await Product.findById(gone._id)).toBeNull();
  expect(await Product.findById(kept._id)).not.toBeNull();
  expect(await Line.findById(line._id)).toMatchObject({ deletedName: 'Gis', archived: true });
  expect((await Line.findById(line._id)).deletedAt).toBeInstanceOf(Date);
});

test('a deleted line gives its name back, and its product still says which one it was', async () => {
  const line = await seedLine();
  const kept = await seedProduct(line, 202);
  const user = await seedUser();

  await lineService.deleteLine({ id: line._id, userId: user._id, keepProductIds: [String(kept._id)] });

  expect(await lineService.lineRepository.findByName('Gis')).toBeNull();
  expect(await lineService.describeLineOfProduct({ lineId: line._id, userId: user._id })).toEqual({ name: 'Gis', deleted: true });
});

test('a product whose line is gone altogether says it has none', async () => {
  const user = await seedUser();

  expect(await lineService.describeLineOfProduct({ lineId: '64b000000000000000000000', userId: user._id })).toEqual({ name: null, deleted: true });
});

test('asking to keep a product of another line deletes nothing', async () => {
  const line = await seedLine();
  await seedProduct(line, 201);
  const user = await seedUser();

  await expect(lineService.deleteLine({ id: line._id, userId: user._id, keepProductIds: ['64b000000000000000000000'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

  expect(deleteRepository).not.toHaveBeenCalled();
  expect(deleteNamespace).not.toHaveBeenCalled();
  expect(await Line.findById(line._id)).not.toBeNull();
});

test('without rights over a product to delete, nothing is touched', async () => {
  const line = await seedLine();
  await seedProduct(line, 201);
  const kept = await seedProduct(line, 202);
  const user = await seedUser();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([{ id: 201 }, { id: 202 }]);
  allowed.mockImplementation(async ({ repoId, userId }) => {
    if (repoId === 201) throw new PermissionError();
    return User.findById(userId);
  });

  await expect(lineService.deleteLine({ id: line._id, userId: user._id, keepProductIds: [String(kept._id)] })).rejects.toBeInstanceOf(PermissionError);

  expect(deleteRepository).not.toHaveBeenCalled();
  expect((await Line.findById(line._id)).deletedAt).toBeNull();
});

test('a failure on the host leaves the records as they were', async () => {
  const line = await seedLine();
  const product = await seedProduct(line, 201);
  const user = await seedUser();
  deleteNamespace.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

  await expect(lineService.deleteLine({ id: line._id, userId: user._id })).rejects.toThrow('boom');

  expect(await Line.findById(line._id)).not.toBeNull();
  expect(await Product.findById(product._id)).not.toBeNull();
});

test('a line already deleted cannot be deleted again', async () => {
  const line = await seedLine({ deletedAt: new Date() });
  const user = await seedUser();

  await expect(lineService.deleteLine({ id: line._id, userId: user._id })).rejects.toThrow();

  expect(deleteNamespace).not.toHaveBeenCalled();
});

test('a deleted line is not among the lines of a person', async () => {
  const line = await seedLine({ deletedAt: new Date() });
  const user = await seedUser();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([{ id: line.repoId, name: 'Gis', namespaceId: 10, topics: ['spl'] }]);
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(null);

  expect(await lineService.findEnrolledLines({ userId: user._id })).toEqual([]);
});

test.each([
  ['sync', (product, user) => productService.syncProduct({ id: product._id, userId: user._id })],
  ['zip', (product, user) => productService.generateZip({ id: product._id, userId: user._id })],
  ['rename', (product, user) => productService.renameProduct({ id: product._id, name: 'Other', userId: user._id })],
  ['features', (product, user) => productService.setFeatures({ id: product._id, userId: user._id, features: [] })],
])('a product whose line is deleted refuses to %s', async (_, act) => {
  const line = await seedLine({ deletedAt: new Date() });
  const product = await seedProduct(line, 202);
  const user = await seedUser();

  await expect(act(product, user)).rejects.toBeInstanceOf(LineDeletedError);
});

test('generating a product whose line is deleted is refused before anything is done', async () => {
  const line = await seedLine({ deletedAt: new Date() });
  const product = await seedProduct(line, 202);
  const user = await seedUser();
  const emit = vi.fn();

  await expect(productService.generateProduct({ id: product._id, userId: user._id, emit })).rejects.toBeInstanceOf(LineDeletedError);
});

test('the last product of a deleted line takes with it what was left of the line', async () => {
  const line = await seedLine({ deletedAt: new Date(), deletedName: 'Gis', ownerId: undefined });
  const product = await seedProduct(line, 202);
  const user = await seedUser();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([{ id: 202 }]);

  await productService.deleteProduct({ id: product._id, userId: user._id });

  expect(deleteRepository.mock.calls.map(([args]) => args.id)).toEqual([202]);
  expect(deleteNamespace.mock.calls.map(([args]) => args.id)).toEqual([2020, 10]);
  expect(await Line.findById(line._id)).toBeNull();
});

test('while another product of the deleted line remains, what is left of the line stays', async () => {
  const line = await seedLine({ deletedAt: new Date(), deletedName: 'Gis' });
  const product = await seedProduct(line, 202);
  await seedProduct(line, 203);
  const user = await seedUser();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([{ id: 202 }, { id: 203 }]);

  await productService.deleteProduct({ id: product._id, userId: user._id });

  expect(await Line.findById(line._id)).not.toBeNull();
  expect(deleteNamespace.mock.calls.map(([args]) => args.id)).toEqual([2020]);
});

test('whoever deletes knows whether the host keeps it for a while', async () => {
  expect(lineService.deletesLater({ gitHost: 'gitlab' })).toBe(true);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);

test('a product without a line still shows its models, read from its own repository, and cannot save them', async () => {
  const line = await seedLine({ deletedAt: new Date(), deletedName: 'Gis' });
  const product = await seedProduct(line, 202);
  const user = await seedUser();
  vi.spyOn(GitLabProvider.prototype, 'listFiles').mockResolvedValue(['spec.json', '.linea/models/featureselection.fs', '.linea/models/basic.basic']);
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockImplementation(async ({ path }) => Buffer.from(`text of ${path}`));

  const answer = await modularService.getProductModels({ id: product._id, userId: user._id });

  expect(answer.readOnly).toBe(true);
  expect(answer.metamodels).toEqual([
    { name: 'featureselection', extension: 'fs', model: 'text of .linea/models/featureselection.fs', requires: [] },
    { name: 'basic', extension: 'basic', model: 'text of .linea/models/basic.basic', requires: [] },
  ]);
  expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ repoId: 202 }), expect.anything());
  await expect(modularService.saveProductModel({ id: product._id, userId: user._id, metamodel: 'basic', content: 'x' })).rejects.toBeInstanceOf(LineDeletedError);
});

test('says which lines and products a person can delete, with the check the deletion itself makes', async () => {
  const line = await seedLine();
  const other = await seedLine({ name: 'Other', repoId: 101, namespaceId: 11 });
  const product = await seedProduct(line, 201);
  const user = await seedUser();
  allowed.mockImplementation(async ({ repoId, userId }) => {
    if (repoId === 101 || repoId === 201) throw new PermissionError();
    return User.findById(userId);
  });

  expect(await lineService.getLinesDeletable({ ids: [String(line._id), String(other._id)], userId: user._id })).toEqual({ [line._id]: true, [other._id]: false });
  expect(await productService.getProductsDeletable({ ids: [String(product._id)], userId: user._id })).toEqual({ [product._id]: false });
  expect(allowed).toHaveBeenCalledWith(expect.objectContaining({ repoId: 100, accessLevel: 50 }), expect.anything());
});

test('a line or product that cannot be looked up is left out of the answer, not refused', async () => {
  const user = await seedUser();
  expect(await lineService.getLinesDeletable({ ids: ['not-an-id'], userId: user._id })).toEqual({});
  expect(await productService.getProductsDeletable({ ids: ['not-an-id'], userId: user._id })).toEqual({});
});

const pendingItem = (id, name, namespaceId, parentNamespaceId, scheduled = {}) => ({
  id, name, path: `group/${name}`, webUrl: `https://gitlab.example/${name}`, namespaceId, parentNamespaceId, deletesOn: null,
  repositoryScheduled: false, namespaceScheduled: false, ancestorScheduled: false, ...scheduled,
});

const hostWithPending = ({ lines = [], products = [] }) => {
  vi.spyOn(GitLabProvider.prototype, 'listPendingDeletion').mockImplementation(async ({ topic }) => (topic === 'spl' ? lines : products));
  vi.spyOn(GitLabProvider.prototype, 'getRepository').mockImplementation(async ({ id }) => ({ id, name: `repo-${id}`, webUrl: `https://gitlab.example/back/${id}`, webIdeUrl: `https://gitlab.example/ide/${id}`, namespaceId: 70, description: 'back' }));
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(Buffer.from(JSON.stringify({ name: 'gis', version: '1.4.0', kind: 'project', metamodels: {} })));
  return {
    restoreRepository: vi.spyOn(GitLabProvider.prototype, 'restoreRepository').mockResolvedValue(undefined),
    restoreNamespace: vi.spyOn(GitLabProvider.prototype, 'restoreNamespace').mockResolvedValue(undefined),
  };
};

test('a line LINEA forgot comes back as it was on the host, and a product left out of its group is scheduled again', async () => {
  const { restoreNamespace, restoreRepository } = hostWithPending({
    lines: [pendingItem(7, 'Gis', 70, 1, { namespaceScheduled: true })],
    products: [pendingItem(71, 'Uno', 710, 70, { ancestorScheduled: true }), pendingItem(72, 'Dos', 720, 70, { ancestorScheduled: true })],
  });
  const user = await seedUser();

  const answer = await lineService.restoreLine({ repoId: 7, productRepoIds: [71], userId: user._id });

  expect(restoreNamespace.mock.calls.map(([args]) => args.id)).toEqual([70]);
  expect(restoreRepository).not.toHaveBeenCalled();
  expect(deleteRepository.mock.calls.map(([args]) => args.id)).toEqual([72]);
  expect(deleteNamespace.mock.calls.map(([args]) => args.id)).toEqual([720]);
  expect(answer).toMatchObject({ restoredProductIds: ['71'], pendingProductIds: ['72'] });
  expect(await Line.findOne({ repoId: 7 })).toMatchObject({ name: 'Gis', version: '1.4.0', kind: 'project', webUrl: 'https://gitlab.example/back/7', ownerId: user._id });
});

test('a line deleted keeping products gets its name back, and its products are maintained again', async () => {
  const { restoreRepository } = hostWithPending({ lines: [pendingItem(100, 'Gis', 10, 1, { repositoryScheduled: true })] });
  const line = await seedLine({ name: 'Gis~deleted-x', deletedName: 'Gis', deletedAt: new Date(), archived: true });
  const kept = await seedProduct(line, 202);
  const user = await seedUser();

  await lineService.restoreLine({ repoId: 100, userId: user._id });

  expect(restoreRepository.mock.calls.map(([args]) => args.id)).toEqual([100]);
  const back = await Line.findById(line._id);
  expect(back).toMatchObject({ name: 'Gis', archived: false, deletedAt: null, deletedName: null });
  expect(await lineService.describeLineOfProduct({ lineId: kept.lineId, userId: user._id })).not.toMatchObject({ deleted: true });
});

test('a line whose name another one took is refused before anything is done on the host', async () => {
  const { restoreRepository, restoreNamespace } = hostWithPending({ lines: [pendingItem(7, 'Gis', 70, 1, { namespaceScheduled: true })] });
  await seedLine({ name: 'Gis', repoId: 999 });
  const user = await seedUser();

  await expect(lineService.restoreLine({ repoId: 7, userId: user._id })).rejects.toBeInstanceOf(AlreadyExistentLineError);

  expect(restoreRepository).not.toHaveBeenCalled();
  expect(restoreNamespace).not.toHaveBeenCalled();
});

test('restoring a line asks for the Owner role, and a line that is not waiting is not found', async () => {
  const { restoreNamespace } = hostWithPending({ lines: [pendingItem(7, 'Gis', 70, 1, { namespaceScheduled: true })] });
  allowed.mockRejectedValue(new PermissionError());
  const user = await seedUser();

  await expect(lineService.restoreLine({ repoId: 7, userId: user._id })).rejects.toBeInstanceOf(PermissionError);
  await expect(lineService.restoreLine({ repoId: 8, userId: user._id })).rejects.toBeInstanceOf(LineNotFoundError);
  expect(restoreNamespace).not.toHaveBeenCalled();
});

test('a product on its own comes back; one inside a line that waits asks for the line first', async () => {
  const { restoreRepository, restoreNamespace } = hostWithPending({
    lines: [pendingItem(7, 'Gis', 70, 1, { repositoryScheduled: true })],
    products: [
      pendingItem(71, 'Suelto', 710, 80, { repositoryScheduled: true, namespaceScheduled: true }),
      pendingItem(72, 'EnLinea', 720, 70, { repositoryScheduled: true, namespaceScheduled: true }),
      pendingItem(73, 'EnGrupo', 730, 90, { ancestorScheduled: true }),
    ],
  });
  const user = await seedUser();

  await lineService.restoreProduct({ repoId: 71, userId: user._id });
  expect(restoreNamespace.mock.calls.map(([args]) => args.id)).toEqual([710]);
  expect(restoreRepository.mock.calls.map(([args]) => args.id)).toEqual([71]);

  await expect(lineService.restoreProduct({ repoId: 72, userId: user._id })).rejects.toBeInstanceOf(RestoreBlockedError);
  await expect(lineService.restoreProduct({ repoId: 73, userId: user._id })).rejects.toBeInstanceOf(RestoreBlockedError);
  await expect(lineService.restoreProduct({ repoId: 74, userId: user._id })).rejects.toBeInstanceOf(ProductNotFoundError);
});

test('the inactive lists say what can be restored', async () => {
  hostWithPending({
    lines: [pendingItem(7, 'Gis', 70, 1, { repositoryScheduled: true })],
    products: [pendingItem(71, 'EnLinea', 710, 70, { repositoryScheduled: true, namespaceScheduled: true }), pendingItem(72, 'Suelto', 720, 80, { repositoryScheduled: true, namespaceScheduled: true })],
  });
  vi.spyOn(lineService.productSpecService, 'readSpec').mockResolvedValue(null);
  allowed.mockImplementation(async ({ repoId, userId }) => {
    if (repoId === 72) throw new PermissionError();
    return User.findById(userId);
  });
  const user = await seedUser();

  expect(await lineService.findInactiveLines({ userId: user._id })).toMatchObject([{ repoId: 7, namespaceId: 70, canRestore: true }]);
  expect(await lineService.findInactiveProducts({ userId: user._id })).toMatchObject([
    { repoId: 71, parentNamespaceId: 70, canRestore: true, lineFirst: true },
    { repoId: 72, parentNamespaceId: 80, canRestore: false, lineFirst: false },
  ]);
});
