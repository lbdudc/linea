import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { GitLabProvider } from '@lbdudc/linea-git';
import { startGitlabDouble } from '@lbdudc/linea-git/testing';

const holder = {};
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => holder.git }));
const { default: ProductCiService } = await import('../model/services/ProductCiService.js');
const { default: ProductService } = await import('../model/services/ProductService.js');
const { defaultCiConfig } = await import('../model/services/ci/pipelineConfig.js');
const { mergeGenerationBranch } = await import('../model/services/generatePipeline.js');

const token = 'token';
const user = { username: 'ana', gitTokens: { gitlab: { accessToken: token } } };
const access = { checkUserExistsAndHasPrivileges: vi.fn().mockResolvedValue(user), hasPrivileges: vi.fn().mockResolvedValue(true) };
const CONFIG = '.linea/ci.json';
const FILE = '.gitlab-ci.yml';

let double;
beforeAll(async () => { double = await startGitlabDouble(); holder.git = new GitLabProvider({ url: double.url }); });
afterEach(() => double.reset());
afterAll(async () => { await double.close(); });

const projectNamed = async (name, { base = true } = {}) => {
  const { git } = holder;
  const repository = await git.createRepository({ token, name, initializeWithReadme: true });
  await git.commit({ token, id: repository.id, branch: 'main', message: 'Start', actions: [{ action: 'create', path: 'a.txt', content: 'a' }] });
  if (base) await git.createBranch({ token, id: repository.id, branch: 'bigbang', ref: 'main' });
  const service = new ProductCiService();
  service.productRepository = { findById: vi.fn().mockResolvedValue({ repo: { id: repository.id }, gitHost: 'gitlab' }) };
  service.permissionChecker = access;
  return { id: repository.id, service };
};
const has = async (id, path, ref) => holder.git.getFileRevision({ token, id, path, ref }).then(() => true, () => false);
const save = (service, enabled) => service.saveCi({ id: 'x', userId: 'u', config: { ...defaultCiConfig(), enabled } });

describe('the CI/CD switch of a product', () => {
  it('turned on, turns the project on and puts the pipeline file in both branches', async () => {
    const { id, service } = await projectNamed('switch-on');
    await holder.git.disablePipelines({ token, id });
    const answer = await save(service, true);
    expect(answer.config.enabled).toBe(true);
    expect(answer.fileInRepository).toBe(true);
    expect(await holder.git.pipelinesEnabled({ token, id })).toBe(true);
    for (const branch of ['main', 'bigbang']) expect(await has(id, FILE, branch)).toBe(true);
    expect(await has(id, CONFIG, 'main')).toBe(true);
  });

  it('turned off, turns the project off and takes the file out of both branches, keeping the settings', async () => {
    const { id, service } = await projectNamed('switch-off');
    await save(service, true);
    const answer = await save(service, false);
    expect(answer.config.enabled).toBe(false);
    expect(answer.fileInRepository).toBe(false);
    expect(await holder.git.pipelinesEnabled({ token, id })).toBe(false);
    for (const branch of ['main', 'bigbang']) expect(await has(id, FILE, branch)).toBe(false);
    expect(await has(id, CONFIG, 'main')).toBe(true);
  });

  it('can go back and forth', async () => {
    const { id, service } = await projectNamed('switch-again');
    await save(service, true);
    await save(service, false);
    const answer = await save(service, true);
    expect(answer.config.enabled).toBe(true);
    expect(await holder.git.pipelinesEnabled({ token, id })).toBe(true);
    for (const branch of ['main', 'bigbang']) expect(await has(id, FILE, branch)).toBe(true);
  });

  it('keeps the same file in both branches when the checks change', async () => {
    const { id, service } = await projectNamed('switch-edit');
    await save(service, true);
    await service.saveCi({ id: 'x', userId: 'u', config: { ...defaultCiConfig(), enabled: true, tags: ['other'] } });
    const [main, base] = await Promise.all(['main', 'bigbang'].map((ref) => holder.git.getFileRevision({ token, id, path: FILE, ref })));
    expect(Buffer.from(main.content, 'base64').toString()).toContain('other');
    expect(main.content).toBe(base.content);
  });

  it('commits nothing when nothing changed', async () => {
    const { id, service } = await projectNamed('switch-same');
    await save(service, true);
    const commit = vi.spyOn(holder.git, 'commit');
    await save(service, true);
    expect(commit).not.toHaveBeenCalled();
    commit.mockRestore();
    expect(await holder.git.pipelinesEnabled({ token, id })).toBe(true);
  });

  it('works on a product that has no base branch yet', async () => {
    const { id, service } = await projectNamed('switch-new', { base: false });
    const answer = await save(service, true);
    expect(answer.config.enabled).toBe(true);
    expect(await has(id, FILE, 'main')).toBe(true);
  });

  it('shows off when CI/CD was turned off on the host', async () => {
    const { id, service } = await projectNamed('switch-outside');
    await save(service, true);
    await holder.git.disablePipelines({ token, id });
    expect((await service.getCi({ id: 'x', userId: 'u' })).config.enabled).toBe(false);
  });
});

describe('what a product does when its checks do not pass', () => {
  const saveWith = (service, config) => service.saveCi({ id: 'x', userId: 'u', config: { ...defaultCiConfig(), enabled: true, ...config } });

  it('is kept with the settings', async () => {
    const { service } = await projectNamed('policy-kept');
    const answer = await saveWith(service, { onChecksFailed: 'reject' });
    expect(answer.config.onChecksFailed).toBe('reject');
    expect((await service.getCi({ id: 'x', userId: 'u' })).config.onChecksFailed).toBe('reject');
  });

  it('touches neither the pipeline nor the base branch when it is all that changes', async () => {
    const { service } = await projectNamed('policy-only');
    await saveWith(service, {});
    const commit = vi.spyOn(holder.git, 'commit');
    await saveWith(service, { onChecksFailed: 'merge' });
    expect(commit.mock.calls.map(([args]) => args.branch)).toEqual(['main']);
    commit.mockRestore();
  });

});

describe('a generation of a version that was cut short before', () => {
  const generate = (id, log = vi.fn()) => mergeGenerationBranch({
    actions: [{ action: 'create', path: 'made.txt', content: 'made' }], token, product: { repo: { id } }, newVersion: '0.0.4', log, logError: vi.fn(), git: holder.git,
  });

  it('goes on in a branch of its own, closes the request left open and deletes nothing', async () => {
    const { git } = holder;
    const { id } = await projectNamed('cut-short');
    await git.createBranch({ token, id, branch: 'generation/0.0.4', ref: 'bigbang' });
    await git.commit({ token, id, branch: 'generation/0.0.4', message: 'Generated', actions: [{ action: 'create', path: 'left.txt', content: 'left' }] });
    const left = await git.createChangeRequest({ token, id, title: 'Merge', sourceBranch: 'generation/0.0.4', targetBranch: 'bigbang' });

    const log = vi.fn();
    const { generationConflicts } = await generate(id, log);

    expect(generationConflicts).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'log.generation_branch_taken', params: ['generation/0.0.4', 'generation/0.0.4-2'] }));
    expect(await has(id, 'made.txt', 'bigbang')).toBe(true);
    expect(await has(id, 'left.txt', 'bigbang')).toBe(false);
    expect(await git.getBranch({ token, id, branch: 'generation/0.0.4' })).toBeTruthy();
    const all = await git.listChangeRequests({ token, id, state: 'all', targetBranch: 'bigbang' });
    expect(all.find((request) => request.number === left.number).state).toBe('closed');
  });

  it('uses the usual branch when nothing is in the way', async () => {
    const { id } = await projectNamed('not-cut-short');
    const log = vi.fn();
    await generate(id, log);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'log.created_branch', params: ['generation/0.0.4', 'bigbang'] }));
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'log.generation_branch_taken' }));
  });

  it('can be cut short more than once', async () => {
    const { git } = holder;
    const { id } = await projectNamed('cut-short-twice');
    await git.createBranch({ token, id, branch: 'generation/0.0.4', ref: 'bigbang' });
    await git.createBranch({ token, id, branch: 'generation/0.0.4-2', ref: 'bigbang' });
    const log = vi.fn();
    await generate(id, log);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'log.created_branch', params: ['generation/0.0.4-3', 'bigbang'] }));
  });
});

describe('the pipeline of a merge request that received a new commit', () => {
  const old = { id: 1, status: 'failed', sha: 'old', createdAt: '2026-01-01T00:00:00Z' };
  const fresh = { id: 2, status: 'running', sha: 'new', createdAt: '2026-01-02T00:00:00Z' };
  const spies = [];
  const opened = { number: 9, state: 'opened', sourceBranch: 'bigbang', targetBranch: 'main', title: 'Update to product version: 0.0.5', headSha: 'new', createdAt: '2026-01-02T00:00:00Z' };
  const withPipelines = async (pipelines, request = opened) => {
    const { service } = await projectNamed(`pipelines-${pipelines.length}-${request.state}`);
    spies.push(vi.spyOn(holder.git, 'listChangeRequests').mockResolvedValue([request]));
    spies.push(vi.spyOn(holder.git, 'listChangeRequestPipelines').mockResolvedValue(pipelines));
    const jobs = vi.spyOn(holder.git, 'getPipelineJobs').mockImplementation(async ({ pipelineId }) => [{ id: pipelineId * 100, name: 'client_build', status: 'running' }]);
    spies.push(jobs);
    return { service, jobs };
  };
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  it('is the one of its tip, in whatever order the host lists them', async () => {
    const { service, jobs } = await withPipelines([old, fresh]);
    const answer = await service.getMergeRequest({ id: 'x', userId: 'u', number: 9 });
    expect(answer.pipeline.id).toBe(2);
    expect(jobs).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: 2 }));
    expect(answer.jobs[0].id).toBe(200);
    expect((await service.listMergeRequests({ id: 'x', userId: 'u' }))[0].pipeline.id).toBe(2);
  });

  it('is none while the new commit has none yet: not the failure of the one before', async () => {
    const { service, jobs } = await withPipelines([old]);
    const answer = await service.getMergeRequest({ id: 'x', userId: 'u', number: 9 });
    expect(answer.pipeline).toBeNull();
    expect(answer.jobs).toEqual([]);
    expect(answer.failed).toBeNull();
    expect(jobs).not.toHaveBeenCalled();
  });

  it('is the latest of one that is over, when its tip has none', async () => {
    const { service } = await withPipelines([old], { ...opened, state: 'merged' });
    expect((await service.getMergeRequest({ id: 'x', userId: 'u', number: 9 })).pipeline.id).toBe(1);
  });
});

describe('a merge request left for a person', () => {
  it('says so while it is open, whatever its pipeline is doing', async () => {
    const { id, service } = await projectNamed('awaiting');
    await holder.git.commit({ token, id, branch: 'bigbang', message: 'Change', actions: [{ action: 'create', path: 'b.txt', content: 'b' }] });
    const request = await holder.git.createChangeRequest({ token, id, title: 'Update to product version: 1.0.1', sourceBranch: 'bigbang', targetBranch: 'main' });
    expect((await service.listMergeRequests({ id: 'x', userId: 'u' }))[0].awaitingDecision).toBe(false);
    service.productRepository.findById.mockResolvedValue({ repo: { id }, gitHost: 'gitlab', pendingUpdate: { number: request.number } });
    expect((await service.listMergeRequests({ id: 'x', userId: 'u' }))[0].awaitingDecision).toBe(true);
    expect((await service.getMergeRequest({ id: 'x', userId: 'u', number: request.number })).awaitingDecision).toBe(true);
    await holder.git.mergeChangeRequest({ token, id, number: request.number, deleteSourceBranch: false });
    expect((await service.listMergeRequests({ id: 'x', userId: 'u' }))[0].awaitingDecision).toBe(false);
  });
});

describe('a product with CI/CD off', () => {
  it('has no pipeline to follow, and that is no error', async () => {
    const { id } = await projectNamed('switch-pipeline');
    await holder.git.disablePipelines({ token, id });
    const service = new ProductService();
    service.productRepository = { findById: vi.fn().mockResolvedValue({ repo: { id }, gitHost: 'gitlab' }) };
    service.permissionChecker = access;
    service.productCiService = { latestChecksPipeline: vi.fn().mockRejectedValue(new Error('403')) };
    expect(await service.getProductPipeline({ id: 'x', userId: 'u' })).toEqual({ pipeline: null, jobs: [], failed: null });
  });
});
