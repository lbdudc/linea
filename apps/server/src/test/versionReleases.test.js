import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import VersionRelease from '../model/entities/versionRelease.js';
import LineService from '../model/services/LineService.js';
import ModularService from '../model/services/modules/ModularService.js';
import ReleaseService from '../model/services/ReleaseService.js';
import Product from '../model/entities/product.js';
import Log from '../model/entities/log.js';
import ProductSpecService from '../model/services/ProductSpecService.js';
import { backfillVersionReleases } from '../model/services/versionReleases.js';
import { LineNotFoundError } from '../model/errors/errors.js';
import { GitLabProvider } from '@lbdudc/linea-git';
import { getGitProvider } from '../model/git/index.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

vi.setConfig({ testTimeout: 90_000 });

const lineService = Container.get(LineService);
const modularService = Container.get(ModularService);
const releaseService = Container.get(ReleaseService);

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

const admin = async () => new User({
  username: `release-${Date.now()}-${Math.random()}`,
  password: await bcrypt.hash('password', 10),
  admin: true,
}).save();

const releaseOf = (line, version) => getGitProvider().getRelease({ token: 'x', id: line.repoId, tag: `v${version}` });

// a feature model with the features asked for: each different one is a new version
const bumpPlain = async (user, line, ...features) => {
  const root = line.name.replace(/\W/g, '');
  const content = `featuremodel ${root}\nfeature ${root} {\n  optional { ${features.map((f) => `feature ${f}`).join(' ')} }\n}\n`;
  return lineService.saveFeatureModel({ id: line._id, userId: user._id, content });
};

test.each(['plain', 'project', 'modular'])('a %s SPL that reaches a version gets its tag and a release with the changelog, once', async (kind) => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: `Rel-${kind}`, version: '1.0.0', description: 'x', kind });
  const bump = kind === 'modular'
    ? () => modularService.saveLineModules({ id: line._id, userId: user._id, modules: {} })
    : () => bumpPlain(user, line, 'Extra');

  await bump();
  const version = (await lineService.findLineById({ id: line._id, userId: user._id }))?.version ?? '1.1.0';
  const release = await releaseOf(line, version);
  expect(release).toMatchObject({ tag: `v${version}` });
  const record = await VersionRelease.findOne({ projectId: line.repoId, version });
  expect(record).toMatchObject({ status: 'released', kind: 'line', tag: `v${version}` });
  expect(record.changelog.markdown).toBe(release.description);

  // doing it again does not make another one
  const createRelease = vi.spyOn(GitLabProvider.prototype, 'createRelease');
  await releaseService.retry({ kind: 'line', id: line._id, userId: user._id, version });
  expect(await VersionRelease.countDocuments({ projectId: line.repoId, version })).toBe(1);
  expect(createRelease).not.toHaveBeenCalled();
});

test('when the host cannot make the release the version is saved, the failure is recorded and a retry makes it', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-fails', version: '1.0.0', description: 'x', kind: 'project' });
  const proto = GitLabProvider.prototype;
  const failing = vi.spyOn(proto, 'createRelease').mockRejectedValue(new Error('release API is down'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const saved = await bumpPlain(user, line, 'Extra');
  expect(saved.bumped).toBe(true);
  const record = await VersionRelease.findOne({ projectId: line.repoId, version: saved.version });
  expect(record).toMatchObject({ status: 'failed', step: 'release', error: 'release API is down' });
  expect(await releaseOf(line, saved.version)).toBeNull();
  expect((await releaseService.list({ kind: 'line', id: line._id, userId: user._id })).map((r) => [r.version, r.status])).toEqual([[saved.version, 'failed'], ['1.0.0', 'released']]); // (the version a line is created with has its release too)

  failing.mockRestore();
  const retried = await releaseService.retry({ kind: 'line', id: line._id, userId: user._id, version: saved.version });
  expect(retried).toMatchObject({ status: 'released', created: true });
  expect(await releaseOf(line, saved.version)).toMatchObject({ tag: `v${saved.version}` });
  expect(await VersionRelease.findOne({ projectId: line.repoId, version: saved.version })).toMatchObject({ status: 'released' });
});

test('the version a line is created with has its tag and its release', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-creation', version: '1.0.0', description: 'x', kind: 'project' });
  expect(await getGitProvider().getTag({ token: 'x', id: line.repoId, tag: 'v1.0.0' })).toBeTruthy();
  expect(await releaseOf(line, '1.0.0')).toMatchObject({ tag: 'v1.0.0' });
  expect((await releaseService.list({ kind: 'line', id: line._id, userId: user._id })).map((r) => [r.version, r.status])).toEqual([['1.0.0', 'released']]);
});

test('a failed tag is recorded too, and does not fail the save', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-notag', version: '1.0.0', description: 'x', kind: 'project' });
  const failingTag = vi.spyOn(GitLabProvider.prototype, 'createTag').mockRejectedValue(new Error('no tags today'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const saved = await bumpPlain(user, line, 'Extra');
  expect(saved.bumped).toBe(true);
  expect(await VersionRelease.findOne({ projectId: line.repoId, version: saved.version })).toMatchObject({ status: 'failed', step: 'tag' });
  failingTag.mockRestore(); // the reset after the test publishes with tags
});

test('the backfill releases the tags that have none, oldest first', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-backfill', version: '1.0.0', description: 'x', kind: 'project' });
  const proto = GitLabProvider.prototype;
  const failing = vi.spyOn(proto, 'createRelease').mockRejectedValue(new Error('down'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const first = await bumpPlain(user, line, 'A');
  const second = await bumpPlain(user, line, 'A', 'B');
  failing.mockRestore();
  await VersionRelease.deleteMany({});

  const { results: done, remaining } = await releaseService.backfill({ kind: 'line', id: line._id, userId: user._id });
  expect(remaining).toBe(0);
  expect(done.map((r) => [r.version, r.status, r.created])).toEqual([['1.0.0', 'released', false], [first.version, 'released', true], [second.version, 'released', true]]); // (1.0.0 kept its release from the creation)
  expect((await VersionRelease.findOne({ projectId: line.repoId, version: second.version })).changelog.from).toBe(`v${first.version}`);
  expect((await releaseService.backfill({ kind: 'line', id: line._id, userId: user._id })).results.every((r) => !r.created)).toBe(true);
});

test('a failed backfill does not take more than the limit per call, and the next call continues', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-cap', version: '1.0.0', description: 'x', kind: 'project' });
  const git = getGitProvider();
  for (const v of ['1.0.1', '1.0.2', '1.0.3']) await git.createTag({ token: 'x', id: line.repoId, tag: `v${v}`, ref: 'main', message: '{}' });
  const args = { token: 'x', projectId: line.repoId, kind: 'line', name: 'Rel-cap', versions: ['1.0.3', '1.0.2', '1.0.1'], limit: 2 };
  const first = await backfillVersionReleases(args);
  expect(first.results.map((r) => r.version)).toEqual(['1.0.1', '1.0.2']);
  expect(first.remaining).toBe(1);
  const second = await backfillVersionReleases(args);
  expect(second.remaining).toBe(0);
  expect(second.results.map((r) => [r.version, r.created])).toEqual([['1.0.1', false], ['1.0.2', false], ['1.0.3', true]]);
});

test('a retry brings the description of an existing release up to date, and a changelog that cannot be generated is a failure of that step', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-force', version: '1.0.0', description: 'x', kind: 'project' });
  const saved = await bumpPlain(user, line, 'Extra');
  const git = getGitProvider();
  await git.updateRelease({ token: 'x', id: line.repoId, tag: `v${saved.version}`, changes: { description: 'stale' } });
  expect((await releaseOf(line, saved.version)).description).toBe('stale');

  await releaseService.retry({ kind: 'line', id: line._id, userId: user._id, version: saved.version });
  const record = await VersionRelease.findOne({ projectId: line.repoId, version: saved.version });
  expect((await releaseOf(line, saved.version)).description).toBe(record.changelog.markdown);

  vi.spyOn(GitLabProvider.prototype, 'getCommits').mockRejectedValue(new Error('commits are down'));
  vi.spyOn(GitLabProvider.prototype, 'compare').mockRejectedValue(new Error('compare is down'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await releaseService.retry({ kind: 'line', id: line._id, userId: user._id, version: saved.version })).toMatchObject({ status: 'failed', step: 'changelog' });
});

test('what the host said is neither markup nor an address when it is kept, and a concurrent duplicate is not a failure', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-safe', version: '1.0.0', description: 'x', kind: 'project' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failing = vi.spyOn(GitLabProvider.prototype, 'createRelease').mockRejectedValue(Object.assign(new Error('<img src=x onerror=alert(1)> at https://gitlab.internal:8443/api/v4/x'), { status: 502 }));
  const saved = await bumpPlain(user, line, 'Extra');
  const record = await VersionRelease.findOne({ projectId: line.repoId, version: saved.version });
  expect(record.error).not.toMatch(/[<>]|internal|https?:/);
  expect(record.error).toMatch(/^Host error 502/);
  failing.mockRestore();

  // another save wrote the row between the read and the write
  const realFind = VersionRelease.findOneAndUpdate.bind(VersionRelease);
  const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  vi.spyOn(VersionRelease, 'findOneAndUpdate').mockRejectedValueOnce(duplicate).mockImplementation(realFind);
  expect(await releaseService.retry({ kind: 'line', id: line._id, userId: user._id, version: saved.version })).toMatchObject({ status: 'released' });
});

test('a missing or malformed id is not found', async () => {
  const user = await admin();
  await expect(releaseService.list({ kind: 'line', id: 'nope', userId: user._id })).rejects.toBeInstanceOf(LineNotFoundError);
  await expect(releaseService.list({ kind: 'line', id: '507f1f77bcf86cd799439011', userId: user._id })).rejects.toBeInstanceOf(LineNotFoundError);
});

test('a product that reaches a version gets its tag and release, named after it; a failure goes to its log without breaking the generation', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'Rel-product-line', version: '1.0.0', description: 'x', kind: 'project' });
  // any repository of the host will do as the product's
  const repoId = line.repoId;
  const product = await new Product({ spec: { basicData: { name: 'Shop', version: '0.0.1' } }, repo: { id: repoId }, lineId: line._id }).save();
  const specService = Container.get(ProductSpecService);
  const spec = (version) => ({ basicData: { name: 'Shop', version }, features: ['A'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  await specService.writeDeployed({ token: 'x', productProjectId: repoId, spec: spec('0.0.1'), isFiller: false });
  expect(await getGitProvider().getRelease({ token: 'x', id: repoId, tag: 'v0.0.1' })).toMatchObject({ name: 'Shop 0.0.1' });
  expect(await VersionRelease.findOne({ projectId: repoId, version: '0.0.1' })).toMatchObject({ kind: 'product', status: 'released' });

  // the release fails: the generation goes on and the log of the product says so
  const failing = vi.spyOn(GitLabProvider.prototype, 'createRelease').mockRejectedValue(new Error('release API is down'));
  await specService.writeDeployed({ token: 'x', productProjectId: repoId, spec: spec('0.0.2') });
  expect(await VersionRelease.findOne({ projectId: repoId, version: '0.0.2' })).toMatchObject({ kind: 'product', status: 'failed', step: 'release' });
  expect(await Log.findOne({ productId: product._id, version: '0.0.2', type: 'error' })).toMatchObject({ message: expect.stringContaining('release') });
  failing.mockRestore();

  // so does a tag that cannot be made
  const noTag = vi.spyOn(GitLabProvider.prototype, 'createTag').mockRejectedValue(new Error('no tags'));
  await specService.writeDeployed({ token: 'x', productProjectId: repoId, spec: spec('0.0.3') });
  expect(await VersionRelease.findOne({ projectId: repoId, version: '0.0.3' })).toMatchObject({ status: 'failed', step: 'tag' });
  noTag.mockRestore();
});
