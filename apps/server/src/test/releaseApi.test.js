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
const { default: ReleaseService } = await import('../model/services/ReleaseService.js');
const { onError } = await import('../rest/common/onError.js');
const { ACCESS } = await import('@lbdudc/linea-git');

const releases = Container.get(ReleaseService);
const app = express();
app.use(express.json());
app.use('/api/lines', lineRouter);
app.use('/api/products', productRouter);
app.use(onError);

const ID = '507f1f77bcf86cd799439011';
beforeEach(() => vi.restoreAllMocks());

describe.each([['lines', 'line'], ['products', 'product']])('/api/%s/:id/releases', (path, kind) => {
  test('reading is for reporters, retrying and backfilling for maintainers', async () => {
    const levels = [];
    vi.spyOn(releases.lineRepository, 'findById').mockResolvedValue({ repoId: 7, name: 'L' });
    vi.spyOn(releases.productRepository, 'findById').mockResolvedValue({ repo: { id: 7 }, spec: { basicData: { name: 'P' } } });
    vi.spyOn(releases.permissionChecker, 'checkUserExistsAndHasPrivileges').mockImplementation(async ({ accessLevel }) => {
      levels.push(accessLevel);
      return { accessToken: 't' };
    });
    vi.spyOn(releases, 'list').mockImplementation(async (args) => { await releases.permissionChecker.checkUserExistsAndHasPrivileges({ accessLevel: ACCESS.REPORTER }); return [args.kind]; });
    const retry = vi.spyOn(releases, 'retry').mockResolvedValue({ status: 'released' });
    const backfill = vi.spyOn(releases, 'backfill').mockResolvedValue({ results: [], remaining: 0 });

    expect((await request(app).get(`/api/${path}/${ID}/releases`)).body).toEqual([kind]);
    expect((await request(app).post(`/api/${path}/${ID}/releases/1.2.3/retry`)).status).toBe(200);
    expect((await request(app).post(`/api/${path}/${ID}/releases`)).body).toEqual({ results: [], remaining: 0 });
    expect(retry).toHaveBeenCalledWith({ kind, id: ID, userId: 'user-1', version: '1.2.3' });
    expect(backfill).toHaveBeenCalledWith({ kind, id: ID, userId: 'user-1' });
  });

  test('the service asks the host for the level each operation needs', async () => {
    vi.restoreAllMocks();
    vi.spyOn(releases.lineRepository, 'findById').mockResolvedValue({ repoId: 7, name: 'L' });
    vi.spyOn(releases.productRepository, 'findById').mockResolvedValue({ repo: { id: 7 }, spec: { basicData: { name: 'P' } } });
    const check = vi.spyOn(releases.permissionChecker, 'checkUserExistsAndHasPrivileges').mockRejectedValue(Object.assign(new Error('no'), { name: 'PermissionError' }));
    await request(app).get(`/api/${path}/${ID}/releases`);
    await request(app).post(`/api/${path}/${ID}/releases/1.2.3/retry`);
    await request(app).post(`/api/${path}/${ID}/releases`);
    expect(check.mock.calls.map(([args]) => args.accessLevel)).toEqual([ACCESS.REPORTER, ACCESS.MAINTAINER, ACCESS.MAINTAINER]);
  });

  test('a version that is not one is refused, and an id that is not one is not found', async () => {
    expect((await request(app).get(`/api/${path}/${ID}/releases/not-a-version`)).status).toBe(400);
    expect((await request(app).post(`/api/${path}/${ID}/releases/1.2/retry`)).status).toBe(400);
    expect((await request(app).get(`/api/${path}/nope/releases`)).status).toBe(404);
  });
});
