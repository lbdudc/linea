import { vi, test, expect, beforeEach, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';

vi.mock('../rest/common/auth.js', () => ({
  requireAuth: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdmin: (req, res, next) => { req.userId = 'user-1'; next(); },
  requireAdminIf: () => (req, res, next) => next(),
}));

// one fake host: tags (with annotation), releases and repositories by project id
const host = { tags: {}, releases: {}, repos: {}, generated: [] };
const gitStub = {
  kind: 'gitlab',
  getTag: async ({ id, tag }) => (host.tags[id]?.[tag] ? { name: tag, message: host.tags[id][tag] } : null),
  listTags: async ({ id }) => Object.keys(host.tags[id] ?? {}).map((name) => ({ name })),
  getRelease: async ({ id, tag }) => host.releases[`${id}:${tag}`] ?? null,
  findRepository: async ({ path }) => host.repos[path] ?? null,
};
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => gitStub }));
vi.mock('@lbdudc/linea-git', async (importOriginal) => ({
  ...(await importOriginal()),
  generateChangelog: vi.fn(async ({ id, to }) => {
    host.generated.push(`${id}:${to}`);
    const found = host.sections?.[`${id}:${to}`];
    if (!found) throw Object.assign(new Error('boom'), { status: 500 });
    return { from: null, to, truncated: false, markdown: `## ${to}`, sections: found, mergeRequests: [], issues: [] };
  }),
}));
const cache = new Map();
vi.mock('../model/services/versionReleases.js', () => ({
  findVersionRelease: async ({ projectId, version }) => cache.get(`${projectId}:${version}`) ?? null,
}));

const { default: lineRouter } = await import('../rest/routers/lineRouter.js');
const { default: productRouter } = await import('../rest/routers/productRouter.js');
const { default: ChangelogService } = await import('../model/services/ChangelogService.js');
const { changedPackages, mergeSections } = await import('../model/services/changelogs.js');
const { onError } = await import('../rest/common/onError.js');

const service = Container.get(ChangelogService);
const app = express();
app.use(express.json());
app.use('/api/lines', lineRouter);
app.use('/api/products', productRouter);
app.use(onError);

const ID = '507f1f77bcf86cd799439011';
const entry = (description, breaking = false) => ({ shortId: 'abc', webUrl: '', type: 'feat', scope: null, description, breaking, breakingNote: null, references: [] });
const released = (projectId, version, sections) => cache.set(`${projectId}:${version}`, { status: 'released', changelog: { from: null, to: `v${version}`, truncated: false, markdown: `## v${version}`, sections, mergeRequests: [], issues: [] } });
const tag = (projectId, version, message = '{}') => { (host.tags[projectId] ??= {})[`v${version}`] = message; };

beforeEach(() => {
  vi.restoreAllMocks();
  Object.assign(host, { tags: {}, releases: {}, repos: {}, generated: [], sections: {} });
  cache.clear();
  vi.spyOn(service.lineRepository, 'findById').mockResolvedValue({ _id: ID, repoId: 7, name: 'L', modular: false });
  vi.spyOn(service.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({ accessToken: 't' });
});

describe('GET /api/lines/:id/changelog', () => {
  test('a range concatenates the versions between from (exclusive) and to, grouped by section, newest first', async () => {
    for (const v of ['1.0.0', '1.1.0', '1.2.0', '1.3.0']) tag(7, v);
    released(7, '1.1.0', [{ id: 'features', title: 'Features', entries: [entry('a')] }]);
    released(7, '1.2.0', [{ id: 'breaking', title: 'B', entries: [entry('b', true)] }, { id: 'features', title: 'Features', entries: [entry('c')] }]);
    released(7, '1.3.0', [{ id: 'fixes', title: 'F', entries: [entry('d')] }]);

    const { body, status } = await request(app).get(`/api/lines/${ID}/changelog?from=1.0.0&to=1.2.0`);
    expect(status).toBe(200);
    expect(body.versions.map((v) => v.version)).toEqual(['1.2.0', '1.1.0']);
    expect(body.sections.map((s) => s.id)).toEqual(['breaking', 'features']);
    expect(body.sections[1].entries.map((e) => [e.description, e.version])).toEqual([['c', '1.2.0'], ['a', '1.1.0']]);
    expect(body.breaking).toBe(true);
    expect(body.to).toBe('1.2.0');
    expect(host.generated).toEqual([]);
  });

  test('without to it goes up to the newest version; without from it is that version alone', async () => {
    for (const v of ['1.0.0', '1.1.0']) tag(7, v);
    released(7, '1.0.0', [{ id: 'features', title: 'F', entries: [entry('old')] }]);
    released(7, '1.1.0', [{ id: 'fixes', title: 'F', entries: [entry('new')] }]);
    const { body } = await request(app).get(`/api/lines/${ID}/changelog`);
    expect(body.versions).toEqual([{ version: '1.1.0', source: 'cache' }]);
    expect(body.breaking).toBe(false);
  });

  test('a version with no release is generated from its tag; with no tag it is reported as having nothing', async () => {
    for (const v of ['1.0.0', '1.1.0']) tag(7, v);
    host.sections['7:v1.1.0'] = [{ id: 'features', title: 'F', entries: [entry('gen')] }];
    host.releases['7:v1.0.0'] = { description: 'from the host' };
    const { body } = await request(app).get(`/api/lines/${ID}/changelog?from=0.9.0&to=1.1.0`);
    expect(body.versions).toEqual([{ version: '1.1.0', source: 'generated' }, { version: '1.0.0', source: 'release' }]);
    expect(body.markdown).toContain('from the host');
    expect(body.sections[0].entries[0].description).toBe('gen');
  });

  test('a first version has no previous one: its changelog stands alone; a line without tags has an empty one', async () => {
    tag(7, '1.0.0');
    released(7, '1.0.0', [{ id: 'features', title: 'F', entries: [entry('first')] }]);
    expect((await request(app).get(`/api/lines/${ID}/changelog?to=1.0.0`)).body.sections[0].entries).toHaveLength(1);
    host.tags = {};
    const empty = await request(app).get(`/api/lines/${ID}/changelog`);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ to: null, versions: [], sections: [], breaking: false });
  });

  test('a tag whose changelog cannot be made nor released gives no changelog', async () => {
    tag(7, '1.0.0');
    const { body } = await request(app).get(`/api/lines/${ID}/changelog`);
    expect(body.versions).toEqual([{ version: '1.0.0', source: 'none' }]);
  });

  test('a malformed version or id is refused', async () => {
    expect((await request(app).get(`/api/lines/${ID}/changelog?from=banana`)).status).toBe(400);
    expect((await request(app).get(`/api/lines/nope/changelog`)).status).toBe(404);
  });

  test('a modular line adds what changed in each dependency, with its own changelog', async () => {
    service.lineRepository.findById.mockResolvedValue({ _id: ID, repoId: 7, name: 'L', modular: true });
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    const pkg = (location, version) => ({ kind: 'module', name: location, location, version });
    tag(7, '1.0.0', JSON.stringify({ packages: [pkg('gitlab:g/a', '1.0.0'), pkg('gitlab:g/gone', '1.0.0')] }));
    tag(7, '1.1.0', JSON.stringify({ packages: [pkg('gitlab:g/a', '1.2.0'), pkg('gitlab:g/new', '0.1.0')] }));
    released(7, '1.1.0', []);
    host.repos['g/a'] = { id: 20 };
    tag(20, '1.1.0'); tag(20, '1.2.0');
    released(20, '1.1.0', [{ id: 'features', title: 'F', entries: [entry('x')] }]);
    released(20, '1.2.0', [{ id: 'breaking', title: 'B', entries: [entry('y', true)] }]);

    const { body } = await request(app).get(`/api/lines/${ID}/changelog?from=1.0.0&to=1.1.0`);
    const byLocation = Object.fromEntries(body.dependencies.map((d) => [d.location, d]));
    expect(byLocation['gitlab:g/a']).toMatchObject({ change: 'upgraded', from: '1.0.0', to: '1.2.0' });
    expect(byLocation['gitlab:g/a'].changelog.breaking).toBe(true);
    expect(byLocation['gitlab:g/new'].change).toBe('added');
    expect(byLocation['gitlab:g/gone'].change).toBe('removed');
  });
});

describe('GET /api/products/:id/changelog and /api/packages/:kind/:id/changelog', () => {
  test('a product gives its own changelog and the dependencies that a sync would bring', async () => {
    vi.spyOn(service.productRepository, 'findById').mockResolvedValue({ _id: ID, lineId: 'l', repo: { id: 9 } });
    service.lineRepository.findById.mockResolvedValue({ _id: 'l', repoId: 7, modular: true, version: '1.1.0' });
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    tag(9, '2.0.0'); released(9, '2.0.0', [{ id: 'fixes', title: 'F', entries: [entry('p')] }]);
    tag(7, '1.0.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.0.0' }] }));
    tag(7, '1.1.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.0.1' }] }));
    const { body } = await request(app).get(`/api/products/${ID}/changelog?lineFrom=1.0.0`);
    expect(body.versions).toEqual([{ version: '2.0.0', source: 'cache' }]);
    expect(body).toMatchObject({ lineFrom: '1.0.0', lineTo: '1.1.0' });
    expect(body.dependencies).toMatchObject([{ location: 'gitlab:g/a', change: 'upgraded', from: '1.0.0', to: '1.0.1' }]);
  });

  test('a package: its range by repository id', async () => {
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    tag(30, '0.1.0'); tag(30, '0.2.0');
    released(30, '0.2.0', [{ id: 'features', title: 'F', entries: [entry('m')] }]);
    const { body, status } = await service.package({ id: 30, userId: 'u', from: '0.1.0' }).then((b) => ({ body: b, status: 200 }));
    expect(status).toBe(200);
    expect(body.versions).toEqual([{ version: '0.2.0', source: 'cache' }]);
  });
});

test('changedPackages and mergeSections', () => {
  expect(changedPackages([{ location: 'gitlab:g/x', kind: 'module', name: 'x', version: '2.0.0' }], [{ location: 'gitlab:g/x', kind: 'module', name: 'x', version: '1.0.0' }])[0].change).toBe('downgraded');
  expect(changedPackages(null, [])).toEqual([]);
  expect(mergeSections([])).toEqual([]);
});

describe('the description of a sync request and the changelog by location', () => {
  test('it lists the dependencies that move, with what breaks, and is empty without an earlier sync', async () => {
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    const line = { _id: 'l', repoId: 7, modular: true, version: '1.1.0' };
    const SyncRun = (await import('../model/entities/syncRun.js')).default;
    const find = vi.spyOn(SyncRun, 'findOne').mockReturnValue({ sort: async () => null });
    expect(await service.syncDescription({ product: { _id: 'p' }, line, token: 't' })).toBe('');
    find.mockReturnValue({ sort: async () => ({ lineVersion: '1.0.0' }) });
    tag(7, '1.0.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.0.0' }] }));
    tag(7, '1.1.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.1.0' }] }));
    host.repos['g/a'] = { id: 20 };
    tag(20, '1.1.0'); released(20, '1.1.0', [{ id: 'breaking', title: 'B', entries: [entry('drops x', true)] }]);
    const markdown = await service.syncDescription({ product: { _id: 'p' }, line, token: 't' });
    expect(markdown).toContain('### Modules');
    expect(markdown).toContain('**a**: v1.0.0 → v1.1.0 — ⚠ breaking changes');
    expect(markdown).toContain('**v1.1.0**');
    expect(markdown).toContain('⚠ drops x');
  });

  test('a package by location, and a location that is not one is refused', async () => {
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    host.repos['g/a'] = { id: 20 };
    tag(20, '1.0.0'); released(20, '1.0.0', []);
    const { packageRouter } = await import('../rest/routers/packageRouter.js');
    const pkgApp = express();
    pkgApp.use('/api/packages', packageRouter);
    pkgApp.use(onError);
    const ok = await request(pkgApp).get('/api/packages/module/changelog?location=gitlab:g/a');
    expect(ok.status).toBe(200);
    expect(ok.body.versions).toEqual([{ version: '1.0.0', source: 'cache' }]);
    for (const bad of ['%3Cx%3E', 'gitlab:g/../x', 'gitlab:g//a', 'gitlab:a', 'gitlab:/a/b']) {
      expect((await request(pkgApp).get(`/api/packages/module/changelog?location=${bad}`)).status).toBe(400);
    }
    // another kind of host than the one of this deployment is not looked up here
    expect((await request(pkgApp).get('/api/packages/module/changelog?location=github:g/a')).body.versions).toEqual([]);
  });
});

describe('limits and what is written for people', () => {
  test('a range keeps the newest versions it is allowed and says it was cut', async () => {
    const { rangeChangelog } = await import('../model/services/changelogs.js');
    for (let i = 0; i < 6; i++) { tag(7, `1.${i}.0`); released(7, `1.${i}.0`, []); }
    const result = await rangeChangelog({ token: 't', projectId: 7, host: '', from: '0.0.0', maxVersions: 2 });
    expect(result.versions.map((v) => v.version)).toEqual(['1.5.0', '1.4.0']);
    expect(result.truncated).toBe(true);
  });

  test('a version of a modular line that has no from is compared with the one before it', async () => {
    service.lineRepository.findById.mockResolvedValue({ _id: ID, repoId: 7, name: 'L', modular: true });
    vi.spyOn(service.userRepository, 'findById').mockResolvedValue({});
    tag(7, '1.0.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.0.0' }] }));
    tag(7, '1.1.0', JSON.stringify({ packages: [{ kind: 'module', name: 'a', location: 'gitlab:g/a', version: '1.1.0' }] }));
    released(7, '1.1.0', []);
    const { body } = await request(app).get(`/api/lines/${ID}/changelog?to=1.1.0`);
    expect(body.dependencies).toMatchObject([{ location: 'gitlab:g/a', change: 'upgraded' }]);
  });

  test('what comes from a repository is made plain: no mentions, no references, no markdown, and snapshots with odd versions or locations are left out', async () => {
    const { dependenciesMarkdown } = await import('../model/services/changelogs.js');
    const text = dependenciesMarkdown({
      from: '1.0.0', to: '1.1.0',
      dependencies: [{ name: 'a', kind: 'module', change: 'upgraded', from: '1.0.0', to: '1.1.0', changelog: { sections: [{ id: 'fixes', entries: [{ description: '@everyone see #12 and !3 [x](http://evil) :smile:', version: '1.1.0' }] }] } }],
    });
    expect(text).not.toMatch(/@everyone|#12|!3|\[x\]|:smile:/);
    expect(text.length).toBeLessThan(60_001);
    const odd = changedPackages([], [{ kind: 'module', name: 'x', location: 'gitlab:g/x', version: '1.0.0](http://evil)' }, { kind: 'module', name: 'y', location: 'gitlab:g/../y', version: '1.0.0' }]);
    expect(odd).toEqual([]);
  });
});
