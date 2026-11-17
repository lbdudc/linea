import { describe, it, expect, beforeEach, vi } from 'vitest';

// A git host that remembers what is committed to it and the tags that are made, by project.
const { files, tags, git } = vi.hoisted(() => {
  const files = new Map();
  const tags = new Map();
  const key = (id, name) => `${id}:${name}`;
  const notFound = () => Object.assign(new Error('404 Not Found'), { status: 404 });
  const git = {
    getFileRevision: async ({ id, path }) => {
      const content = files.get(key(id, path));
      if (content === undefined) throw notFound();
      return { content: Buffer.from(content, 'utf8').toString('base64'), revision: `rev-${content.length}` };
    },
    commit: vi.fn(async ({ id, actions }) => {
      for (const action of actions) files.set(key(id, action.path), action.content);
      return { id: 'sha' };
    }),
    getTag: vi.fn(async ({ id, tag }) => (tags.has(key(id, tag)) ? { name: tag, commitId: 'sha', message: tags.get(key(id, tag)) } : null)),
    createTag: vi.fn(async ({ id, tag, message }) => {
      if (tags.has(key(id, tag))) throw Object.assign(new Error('Tag already exists'), { status: 400, alreadyExists: true });
      tags.set(key(id, tag), message ?? null);
      return {};
    }),
    listTags: vi.fn(async ({ id }) => [...tags.keys()].filter((k) => k.startsWith(`${id}:`)).map((k) => ({ name: k.slice(`${id}:`.length) }))),
    isAlreadyExistsError: (error) => Boolean(error?.alreadyExists),
  };
  return { files, tags, git };
});

vi.mock('../model/git/index.js', () => ({ getGitProvider: () => git }));
// the release of each tag is Mongo's and the host's; these tests are about the tags
vi.mock('../model/services/versionReleases.js', () => ({ keepVersionRelease: async () => ({ status: 'released' }), recordReleaseFailure: async () => {} }));

const { default: ProductSpecService } = await import('../model/services/ProductSpecService.js');
const { compareVersions, isVersion } = await import('../model/services/versionTags.js');

const PROJECT = 41;
const spec = (version, features = ['A']) => ({ basicData: { name: 'P', version }, features });

describe('the snapshot of every version', () => {
  let service;

  beforeEach(() => {
    files.clear();
    tags.clear();
    git.commit.mockClear();
    git.createTag.mockClear();
    git.listTags.mockClear();
    service = new ProductSpecService();
  });

  const generate = (version, models = { datamodel: `v${version}\n` }, features) =>
    service.writeDeployed({ token: 't', productProjectId: PROJECT, spec: spec(version, features), models });

  it('keeps one tag per generation and lists them newest first', async () => {
    await generate('0.1.0');
    await generate('0.1.1');
    await generate('0.10.0');
    await generate('0.2.0');

    expect(await service.listVersionSnapshots({ token: 't', productProjectId: PROJECT }))
      .toEqual(['0.10.0', '0.2.0', '0.1.1', '0.1.0']);
  });

  it('gives back what that version was generated from, whatever came after', async () => {
    await generate('0.1.0', { datamodel: 'first\n' }, ['A']);
    await generate('0.1.1', { datamodel: 'second\n' }, ['A', 'B']);

    const first = await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '0.1.0' });
    expect(first.models).toEqual({ datamodel: 'first\n' });
    expect(first.spec.features).toEqual(['A']);

    const deployed = await service.readDeployed({ token: 't', productProjectId: PROJECT });
    expect(deployed.version).toBe('0.1.1');
  });

  it('keeps a single file, the record of the last one, and the rest in tags', async () => {
    await generate('0.1.0');
    await generate('0.1.1');

    expect([...files.keys()]).toEqual([`${PROJECT}:.linea/spec.json`]);
    expect([...tags.keys()].sort()).toEqual([`${PROJECT}:v0.1.0`, `${PROJECT}:v0.1.1`]);
  });

  it('writes nothing again when the same generation is recorded twice', async () => {
    await generate('0.1.0');
    expect(git.commit).toHaveBeenCalledTimes(1);
    expect(git.createTag).toHaveBeenCalledTimes(1);

    await generate('0.1.0');
    expect(git.commit).toHaveBeenCalledTimes(1);
    expect(git.createTag).toHaveBeenCalledTimes(1);
  });

  it('does not move the tag of a version that is generated again with something else', async () => {
    await generate('0.1.0', { datamodel: 'kept\n' });
    await generate('0.1.0', { datamodel: 'other\n' });

    const snapshot = await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '0.1.0' });
    expect(snapshot.models).toEqual({ datamodel: 'kept\n' });
  });

  it('keeps the version of a record that has none yet, when only the tag is missing', async () => {
    await generate('0.1.0');
    tags.clear();

    await generate('0.1.0');
    expect(await service.listVersionSnapshots({ token: 't', productProjectId: PROJECT })).toEqual(['0.1.0']);
  });

  it('knows nothing of a version that was not kept, is not a version, or whose tag has no annotation', async () => {
    tags.set(`${PROJECT}:v3.0.0`, null);

    expect(await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '9.9.9' })).toBeNull();
    expect(await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '3.0.0' })).toBeNull();
    expect(await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '../../etc' })).toBeNull();
  });

  it('asks nothing of the host to read one version but its tag', async () => {
    await generate('0.1.0');
    git.getTag.mockClear();
    git.listTags.mockClear();

    await service.readVersionSnapshot({ token: 't', productProjectId: PROJECT, version: '0.1.0' });

    expect(git.getTag).toHaveBeenCalledTimes(1);
    expect(git.listTags).not.toHaveBeenCalled();
  });
});

describe('versions', () => {
  it('are compared by number, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('only take the X.Y.Z form', () => {
    expect(isVersion('1.2.3')).toBe(true);
    expect(['1.2', '1.2.3.4', 'v1.2.3', '../1.2.3', '', null, undefined].some(isVersion)).toBe(false);
  });
});
