import { vi, test, expect, beforeEach, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';

// Authentication is covered by gitTokenAuth.test.js: here the user is whoever the test says.
vi.mock('../rest/common/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdmin: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdminIf: () => (req, res, next) => next(),
}));
vi.mock('../model/git/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGitProvider: () => ({}),
}));

const { default: lineRouter } = await import('../rest/routers/lineRouter.js');
const { default: productRouter } = await import('../rest/routers/productRouter.js');
const { default: LineService } = await import('../model/services/LineService.js');
const { default: ProductService } = await import('../model/services/ProductService.js');
const { default: ModularService } = await import('../model/services/modules/ModularService.js');
const { PermissionError } = await import('../model/errors/errors.js');
const { onError } = await import('../rest/common/onError.js');

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const modularService = Container.get(ModularService);

const app = express();
app.use(express.json());
app.use('/api/lines', lineRouter);
app.use('/api/products', productRouter);
app.use(onError);

// like a mongoose document: toObject() reflects what was assigned to it
const asDoc = (data) => ({ ...data, toObject() { const { toObject: _own, ...plain } = this; return plain; } });

beforeEach(() => vi.restoreAllMocks());

describe('GET /api/lines/:id/products', () => {
  test('reads the spec from the git host only with spec=1', async () => {
    const find = vi.spyOn(lineService, 'findProductsByLineId').mockResolvedValue([asDoc({ _id: 'p1', spec: { features: ['A'] } })]);

    const plain = await request(app).get('/api/lines/l1/products');
    const withSpec = await request(app).get('/api/lines/l1/products?spec=1');

    expect(plain.status).toBe(200);
    expect(withSpec.body).toEqual([{ _id: 'p1', spec: { features: ['A'] } }]);
    expect(find).toHaveBeenNthCalledWith(1, { id: 'l1', userId: 'user-1', specFromRepo: false, cutOnInfra: false });
    expect(find).toHaveBeenNthCalledWith(2, { id: 'l1', userId: 'user-1', specFromRepo: true, cutOnInfra: false });
  });

  test('cut=1 asks to fail instead of serving a stale spec', async () => {
    const find = vi.spyOn(lineService, 'findProductsByLineId').mockResolvedValue([]);

    await request(app).get('/api/lines/l1/products?spec=1&cut=1');

    expect(find).toHaveBeenCalledWith({ id: 'l1', userId: 'user-1', specFromRepo: true, cutOnInfra: true });
  });

  test('a user without access gets a 403', async () => {
    vi.spyOn(lineService, 'findProductsByLineId').mockRejectedValue(new PermissionError());

    const res = await request(app).get('/api/lines/l1/products');

    expect(res.status).toBe(403);
  });
});

describe('GET /api/products/by-git-project/:projectId', () => {
  test('finds the product of a git project for someone who can read it', async () => {
    vi.spyOn(productService.productRepository, 'findByRepoId').mockResolvedValue(
      asDoc({ _id: 'p1', lineId: 'l1', repo: { id: 42 }, spec: { basicData: { name: 'P', version: '1.0.0' }, features: [] } }),
    );
    const check = vi.spyOn(productService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({});

    const res = await request(app).get('/api/products/by-git-project/42');

    expect(res.status).toBe(200);
    expect(res.body._id).toBe('p1');
    expect(res.body.specSource).toBeNull();
    expect(productService.productRepository.findByRepoId).toHaveBeenCalledWith(42, undefined, 'gitlab'); // project ids are per host: the primary one when none is said
    expect(check.mock.calls[0][0]).toMatchObject({ userId: 'user-1', repoId: 42, accessLevel: 20 });
  });

  test('with spec=1 it serves the spec read from the git host, or the stored one saying why', async () => {
    const stored = { basicData: { name: 'P', version: '1.0.0' }, features: [] };
    vi.spyOn(productService.productRepository, 'findByRepoId').mockImplementation(async () => asDoc({ _id: 'p1', lineId: 'l1', repo: { id: 42 }, spec: stored }));
    vi.spyOn(productService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({ accessToken: 't' });
    const read = vi.spyOn(productService.productSpecService, 'getSpecFromHostOrCache');

    read.mockResolvedValueOnce({ spec: { ...stored, features: ['A'] }, source: 'repo', reason: null });
    const fresh = await request(app).get('/api/products/by-git-project/42?spec=1');
    read.mockResolvedValueOnce({ spec: stored, source: 'mongo', reason: 'infra' });
    const cached = await request(app).get('/api/products/by-git-project/42?spec=1');

    expect(fresh.body.spec.features).toEqual(['A']);
    expect(fresh.body.specSource).toBe('repo');
    expect(cached.body).toMatchObject({ specSource: 'mongo', specReason: 'infra' });
    expect(read.mock.calls[0][0]).toMatchObject({ token: 't', productProjectId: 42 });
  });

  test('an unknown project is a 404', async () => {
    vi.spyOn(productService.productRepository, 'findByRepoId').mockResolvedValue(null);

    const res = await request(app).get('/api/products/by-git-project/99');

    expect(res.status).toBe(404);
  });

  test('a product the caller cannot read is a 403, not its data', async () => {
    vi.spyOn(productService.productRepository, 'findByRepoId').mockResolvedValue(asDoc({ _id: 'p1', repo: { id: 42 } }));
    vi.spyOn(productService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockRejectedValue(new PermissionError());

    const res = await request(app).get('/api/products/by-git-project/42');

    expect(res.status).toBe(403);
    expect(res.body._id).toBeUndefined();
  });
});

describe('PUT /api/products/:id/selection', () => {
  test('saves the selection from feature names, and the spec follows the features it comes to', async () => {
    const save = vi.spyOn(modularService, 'saveProductSelection').mockResolvedValue({ ok: true, features: ['Root', 'A'] });
    const setFeatures = vi.spyOn(productService, 'setFeatures').mockResolvedValue(true);

    const res = await request(app).put('/api/products/p1/selection').send({ features: ['A'] });

    expect(res.status).toBe(200);
    expect(save).toHaveBeenCalledWith({ id: 'p1', userId: 'user-1', features: ['A'] });
    expect(setFeatures).toHaveBeenCalledWith({ id: 'p1', userId: 'user-1', features: ['Root', 'A'] });
  });

  test.each([
    ['not an array', 'A'],
    ['a name that is not an identifier', ['A\nselect B']],
  ])('refuses %s with a 400', async (_name, features) => {
    const save = vi.spyOn(modularService, 'saveProductSelection');

    const res = await request(app).put('/api/products/p1/selection').send({ features });

    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('brief reads', () => {
  test('GET /api/lines/:id?brief=1 is the line alone', async () => {
    vi.spyOn(lineService, 'findLineById').mockResolvedValue(asDoc({ _id: 'l1', name: 'L', repoId: 7 }));
    const members = vi.spyOn(lineService, 'findMembersByLineId');

    const res = await request(app).get('/api/lines/l1?brief=1');

    expect(res.body).toEqual({ _id: 'l1', name: 'L', repoId: 7 });
    expect(members).not.toHaveBeenCalled();
  });

  test('GET /api/products/:id?brief=1 is the stored product, after the permission check', async () => {
    vi.spyOn(productService.productRepository, 'findById').mockResolvedValue(asDoc({ _id: 'p1', repo: { id: 42 }, spec: { basicData: { name: 'P', version: '1.0.0' }, features: [] } }));
    const check = vi.spyOn(productService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({});
    const details = vi.spyOn(productService, 'findProductDetails');

    const res = await request(app).get('/api/products/p1?brief=1');

    expect(res.status).toBe(200);
    expect(res.body._id).toBe('p1');
    expect(check).toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });
});
