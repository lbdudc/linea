import { test, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { getGitProvider } from '../model/git/index.js';
import ProductSpecService, { ProductSpecFileError, ProductSpecFillerRejectedError } from '../model/services/ProductSpecService.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble, gitlabDouble } from './support/withGitlabDouble.js';

beforeAll(setupGitlabDouble);
afterEach(resetGitlabDouble);
afterEach(() => vi.restoreAllMocks());
afterAll(teardownGitlabDouble);

async function readRawSpecContent(projectId) {
  const meta = await getGitProvider().getFileRevision({ token: 'fake', id: projectId, path: '.linea/spec.draft.json', ref: 'main' });
  return Buffer.from(meta.content, 'base64').toString('utf8');
}

test('writeSpec creates .linea/spec.draft.json when absent (create, no last_commit_id)', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecFreshProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const spec = { basicData: { name: 'P1', version: '0.1.0' } };

  const result = await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false });

  expect(result.attempts).toBe(1);
  expect(result.committed).toBe(true);
  const raw = JSON.parse(await readRawSpecContent(project.id));
  expect(raw).toEqual({ spec });
});

test('writeSpec updates with last_commit_id on the second write', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecUpdateProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: { basicData: { name: 'P1', version: '0.1.0' } }, isFiller: false });

  gitlabDouble().clearLog();
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: { basicData: { name: 'P1', version: '0.2.0' } }, isFiller: false });

  const commitCall = gitlabDouble().getLog().find((l) => l.method === 'POST' && l.path.includes('repository/commits'));
  expect(commitCall.body.actions[0].action).toBe('update');
  expect(typeof commitCall.body.actions[0].last_commit_id).toBe('string');

  const raw = JSON.parse(await readRawSpecContent(project.id));
  expect(raw.spec.basicData.version).toBe('0.2.0');
});

test('writeSpec is a no-op when the content would not change (no commit, no webhook noise)', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecNoopProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const spec = { basicData: { name: 'P1', version: '0.1.0' } };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false });

  gitlabDouble().clearLog();
  const result = await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false });

  expect(result.committed).toBe(false);
  const commitCall = gitlabDouble().getLog().find((l) => l.method === 'POST' && l.path.includes('repository/commits'));
  expect(commitCall).toBeUndefined();
});

test('readSpec returns null when the file is absent', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecAbsentProduct', topics: ['product'] });
  const svc = new ProductSpecService();

  expect(await svc.readSpec({ token: 'fake', productProjectId: project.id })).toBeNull();
});

test('readSpec returns the stored spec when present', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecPresentProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const spec = { basicData: { name: 'P1', version: '0.1.0' }, features: ['A', 'B'] };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false });

  expect(await svc.readSpec({ token: 'fake', productProjectId: project.id })).toEqual(spec);
});

test('readSpec throws ProductSpecFileError on invalid JSON — corrupt is not mistaken for absent', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecCorruptProduct', topics: ['product'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: '.linea/spec.draft.json', content: '{ not valid json' }],
    message: 'corrupt seed',
  });
  const svc = new ProductSpecService();

  await expect(svc.readSpec({ token: 'fake', productProjectId: project.id })).rejects.toThrow(ProductSpecFileError);
});

test.each([
  ['an empty object', '{}'],
  ['an empty array', '[]'],
  ['a bare null', 'null'],
  ['an object with spec: null', '{"spec":null}'],
  ['a future format without a spec key', '{"version":2,"productSpec":{"basicData":{"name":"x"}}}'],
])('readSpec throws ProductSpecFileError on %s — valid JSON, wrong shape', async (_label, content) => {
  const project = gitlabDouble().seedProject({ name: 'SpecWrongShapeProduct', topics: ['product'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: '.linea/spec.draft.json', content }],
    message: 'wrong-shape seed',
  });
  const svc = new ProductSpecService();

  await expect(svc.readSpec({ token: 'fake', productProjectId: project.id })).rejects.toThrow(ProductSpecFileError);
});

test('writeSpec refuses to write over a corrupt spec file — no self-healing', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecHealProduct', topics: ['product'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: '.linea/spec.draft.json', content: '{ not valid json' }],
    message: 'corrupt seed',
  });
  const svc = new ProductSpecService();
  const spec = { basicData: { name: 'Healed', version: '1.0.0' } };

  await expect(
    svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false })
  ).rejects.toThrow(ProductSpecFileError);

  expect(await readRawSpecContent(project.id)).toBe('{ not valid json');
});

test('writeSpec with `mutate` merges onto the CURRENT GitLab spec, not a stale fixed value', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecMutateProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const original = { basicData: { name: 'Original', version: '1.0.0' }, features: ['A'] };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: original, isFiller: false });

  const handEdited = { basicData: { name: 'HandEdited', version: '1.0.0' }, features: ['A', 'B'] };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: handEdited, isFiller: false });

  const result = await svc.writeSpec({
    token: 'fake', productProjectId: project.id,
    mutate: (current) => ({ ...current, basicData: { ...current.basicData, version: '2.0.0' } }),
    isFiller: false,
  });

  expect(result.committed).toBe(true);
  const raw = JSON.parse(await readRawSpecContent(project.id));
  expect(raw.spec).toEqual({ basicData: { name: 'HandEdited', version: '2.0.0' }, features: ['A', 'B'] });
});

test('writeSpec with `mutate` receives null ONLY when the file is absent — a corrupt file throws instead', async () => {
  const svc = new ProductSpecService();

  const absentProject = gitlabDouble().seedProject({ name: 'SpecMutateAbsentProduct', topics: ['product'] });
  let receivedCurrent = 'not called';
  await svc.writeSpec({
    token: 'fake', productProjectId: absentProject.id,
    mutate: (current) => { receivedCurrent = current; return { basicData: { name: 'New', version: '0.1.0' } }; },
    isFiller: false,
  });
  expect(receivedCurrent).toBeNull();

  const corruptProject = gitlabDouble().seedProject({ name: 'SpecMutateCorruptProduct', topics: ['product'] });
  corruptProject.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: '.linea/spec.draft.json', content: '{ not valid json' }],
    message: 'corrupt seed',
  });
  receivedCurrent = 'not called';
  await expect(
    svc.writeSpec({
      token: 'fake', productProjectId: corruptProject.id,
      mutate: (current) => { receivedCurrent = current; return { basicData: { name: 'Healed', version: '0.1.0' } }; },
      isFiller: false,
    })
  ).rejects.toThrow(ProductSpecFileError);
  expect(receivedCurrent).toBe('not called');
});

test('writeSpec rejects overwriting an existing file when isFiller is true', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecFillerRejectProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const realSpec = { basicData: { name: 'Real', version: '1.0.0' }, features: ['A'] };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: realSpec, isFiller: false });

  gitlabDouble().clearLog();
  const fillerSpec = { basicData: { name: 'Real', version: '0.0.0' } };
  await expect(
    svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: fillerSpec, isFiller: true })
  ).rejects.toThrow(ProductSpecFillerRejectedError);

  const commitCall = gitlabDouble().getLog().find((l) => l.method === 'POST' && l.path.includes('repository/commits'));
  expect(commitCall).toBeUndefined();
  const raw = JSON.parse(await readRawSpecContent(project.id));
  expect(raw).toEqual({ spec: realSpec });
});

test('writeSpec still creates the file with isFiller when genuinely absent', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecFillerCreateProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const fillerSpec = { basicData: { name: 'New', version: '0.0.0' } };

  const result = await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: fillerSpec, isFiller: true });

  expect(result.committed).toBe(true);
  const raw = JSON.parse(await readRawSpecContent(project.id));
  expect(raw).toEqual({ spec: fillerSpec });
});

test('writeSpec rejects a call that omits isFiller — the safeguard cannot be disabled by forgetting', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecNoFlagProduct', topics: ['product'] });
  const svc = new ProductSpecService();

  await expect(
    svc.writeSpec({ token: 'fake', productProjectId: project.id, spec: { basicData: { name: 'P1', version: '0.1.0' } } })
  ).rejects.toThrow(TypeError);

  const commits = gitlabDouble().getLog().filter((l) => l.method === 'POST' && l.path.includes('repository/commits'));
  expect(commits).toHaveLength(0);
});

test('getSpecFromHostOrCache returns the GitLab spec with source "gitlab" when the file is present', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecPresentProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const spec = { basicData: { name: 'P1', version: '0.5.0' } };
  await svc.writeSpec({ token: 'fake', productProjectId: project.id, spec, isFiller: false });

  const result = await svc.getSpecFromHostOrCache({
    token: 'fake', productProjectId: project.id, fallbackSpec: { basicData: { name: 'Stale', version: '0.0.1' } }, context: 'test',
  });

  expect(result).toEqual({ spec, source: 'repo', reason: null });
});

test('getSpecFromHostOrCache falls back to Mongo (source "mongo") and logs at info level when the file is absent', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecAbsentProduct', topics: ['product'] });
  const svc = new ProductSpecService();
  const fallbackSpec = { basicData: { name: 'Fallback', version: '0.0.1' } };
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const result = await svc.getSpecFromHostOrCache({ token: 'fake', productProjectId: project.id, fallbackSpec, context: 'test-absent' });

  expect(result).toEqual({ spec: fallbackSpec, source: 'mongo', reason: 'absent' });
  expect(infoSpy).toHaveBeenCalledTimes(1);
  expect(infoSpy.mock.calls[0][0]).toContain('test-absent');
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
});

test('getSpecFromHostOrCache throws on a corrupt file — it does NOT quietly serve the Mongo cache', async () => {
  const project = gitlabDouble().seedProject({ name: 'SpecCorruptProduct', topics: ['product'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: '.linea/spec.draft.json', content: '{ not valid json' }],
    message: 'corrupt seed',
  });
  const svc = new ProductSpecService();
  const fallbackSpec = { basicData: { name: 'Fallback', version: '0.0.1' } };
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(
    svc.getSpecFromHostOrCache({ token: 'fake', productProjectId: project.id, fallbackSpec, context: 'test-corrupt' })
  ).rejects.toThrow(ProductSpecFileError);

  expect(infoSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
});

test('getSpecFromHostOrCache falls back to Mongo and logs at error level ("infra") when GitLab is unreachable — distinct from "absent"/"corrupt"', async () => {
  const svc = new ProductSpecService();
  const fallbackSpec = { basicData: { name: 'Fallback', version: '0.0.1' } };
  vi.spyOn(svc, 'readSpec').mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { status: 0 }));
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const result = await svc.getSpecFromHostOrCache({ token: 'fake', productProjectId: 999, fallbackSpec, context: 'test-infra' });

  expect(result).toEqual({ spec: fallbackSpec, source: 'mongo', reason: 'infra' });
  expect(errorSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy.mock.calls[0][0]).toContain('test-infra');
  expect(infoSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
});

test('getSpecFromHostOrCache rethrows an unrecognised error instead of misclassifying it as "infra"', async () => {
  const svc = new ProductSpecService();
  const bug = new TypeError("Cannot read properties of undefined (reading 'content')");
  vi.spyOn(svc, 'readSpec').mockRejectedValue(bug);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

  await expect(
    svc.getSpecFromHostOrCache({ token: 'fake', productProjectId: 999, fallbackSpec: {}, context: 'test-bug' })
  ).rejects.toBe(bug);

  expect(errorSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(infoSpy).not.toHaveBeenCalled();
});
