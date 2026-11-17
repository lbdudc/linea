import { beforeAll, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { GitLabProvider } from '../src/index.js';
import { startGitlabDouble } from '../src/testing/index.js';

// The jobs of a pipeline, what the failed one printed and running it again, as the provider reads them from GitLab.
// the double reads how long a job takes when it is loaded
vi.hoisted(() => { process.env['GITLAB_DOUBLE_JOB_MS'] = '40'; });
let double: any;
beforeAll(async () => { double = await startGitlabDouble(); });
afterEach(() => double.reset());
afterAll(async () => { await double.close(); });

const token = 'token';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function repositoryWithACommit(git: GitLabProvider, name: string) {
  const repository = await git.createRepository({ token, name, initializeWithReadme: true } as any);
  await git.commit({ token, id: repository.id, branch: 'main', message: 'Update', actions: [{ action: 'create', path: 'a.txt', content: 'a' }] } as any);
  return repository;
}

describe('the pipeline of a commit', () => {
  it('lists its jobs in the order they run, and they all pass', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'ok-project');
    const pipeline = await git.getLatestPipeline({ token, id: repository.id, ref: 'main' });
    expect(pipeline?.id).toBeDefined();

    await sleep(300);
    const jobs = await git.getPipelineJobs({ token, id: repository.id, pipelineId: pipeline!.id! });
    expect(jobs.map((j) => j.name)).toEqual(['build', 'test', 'deploy']);
    expect(jobs.every((j) => j.status === 'success')).toBe(true);
    expect((await git.getLatestPipeline({ token, id: repository.id, ref: 'main' }))?.status).toBe('success');
  });

  it('says which job failed and what it printed, and a retry runs it again', async () => {
    const git = new GitLabProvider({ url: double.url });
    // a project whose name says it fails: its test job does
    const repository = await repositoryWithACommit(git, 'will-fail-project');
    const pipeline = (await git.getLatestPipeline({ token, id: repository.id, ref: 'main' }))!;

    await sleep(300);
    const jobs = await git.getPipelineJobs({ token, id: repository.id, pipelineId: pipeline.id! });
    expect(jobs.map((j) => j.status)).toEqual(['success', 'failed', 'skipped']);
    const failed = jobs.find((j) => j.status === 'failed')!;
    expect(await git.getJobTrace({ token, id: repository.id, jobId: failed.id, lines: 3 })).toContain('ERROR: Job failed');

    await git.retryPipeline({ token, id: repository.id, pipelineId: pipeline.id! });
    await sleep(300);
    const again = await git.getPipelineJobs({ token, id: repository.id, pipelineId: pipeline.id! });
    expect(again.every((j) => j.status === 'success')).toBe(true);
  });
});

describe('canceling', () => {
  it('stops a pipeline that has not finished, and one job of it', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'cancel-project');
    const pipeline = (await git.getLatestPipeline({ token, id: repository.id, ref: 'main' }))!;
    await git.cancelPipeline({ token, id: repository.id, pipelineId: pipeline.id! });
    const jobs = await git.getPipelineJobs({ token, id: repository.id, pipelineId: pipeline.id! });
    expect(jobs.some((j) => j.status === 'canceled')).toBe(true);
    const job = jobs[0];
    expect(job).toBeDefined();
    await git.cancelJob({ token, id: repository.id, jobId: job!.id });
  });
});

describe('enabling pipelines', () => {
  it('switches CI/CD on for a project that has it off, and leaves one that has it on alone', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'ci-off-project');
    expect(await git.enablePipelines({ token, id: repository.id })).toBe(false);
    await (git as any).client.updateProject(token, repository.id, { builds_access_level: 'disabled' });
    expect(await git.enablePipelines({ token, id: repository.id })).toBe(true);
    expect((await (git as any).client.getProject(token, repository.id)).builds_access_level).toBe('enabled');
    expect(await git.enablePipelines({ token, id: repository.id })).toBe(false);
  });
});

describe('the checks of a change request, and the runners of a repository', () => {
  it('lists the requests of every state with their author and tip, and the pipelines that ran for one', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'mr-project');
    await git.createBranch({ token, id: repository.id, branch: 'bigbang', ref: 'main' });
    await git.commit({ token, id: repository.id, branch: 'bigbang', message: 'Change', actions: [{ action: 'create', path: 'b.txt', content: 'b' }] } as any);
    const request = await git.createChangeRequest({ token, id: repository.id, title: 'Update', sourceBranch: 'bigbang', targetBranch: 'main' });

    const [listed] = await git.listChangeRequests({ token, id: repository.id, state: 'all', targetBranch: 'main' });
    expect(listed).toMatchObject({ number: request.number, state: 'opened', sourceBranch: 'bigbang' });
    expect(listed?.headSha).toBeDefined();

    const pipelines = await git.listChangeRequestPipelines({ token, id: repository.id, number: request.number });
    expect(pipelines.every((pipeline) => pipeline.ref === 'bigbang')).toBe(true);
    expect(pipelines.length).toBeGreaterThan(0);

    await git.mergeChangeRequest({ token, id: repository.id, number: request.number, deleteSourceBranch: false });
    expect((await git.listChangeRequests({ token, id: repository.id, state: 'opened' }))).toHaveLength(0);
    expect((await git.listChangeRequests({ token, id: repository.id, state: 'all' }))[0]).toMatchObject({ state: 'merged' });
  });

  it('says whether the instance runners take its jobs, with their tags, and turns them on and off', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'runner-project');
    expect(await git.getCiRunners({ token, id: repository.id })).toMatchObject({
      supported: true, instanceRunners: true, runners: [{ shared: true, online: true, tags: ['deploy'], runsUntagged: false }]
    });
    await git.setInstanceRunners({ token, id: repository.id, enabled: false });
    expect(await git.getCiRunners({ token, id: repository.id })).toMatchObject({ instanceRunners: false, runners: [] });
  });

  it('turns CI/CD off and says how it stands, and its pipelines cannot be read then', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'switched-project');
    expect(await git.pipelinesEnabled({ token, id: repository.id })).toBe(true);
    expect(await git.disablePipelines({ token, id: repository.id })).toBe(true);
    expect(await git.disablePipelines({ token, id: repository.id })).toBe(false);
    expect(await git.pipelinesEnabled({ token, id: repository.id })).toBe(false);
    await expect(git.getLatestPipeline({ token, id: repository.id, ref: 'main' })).rejects.toThrow();
    expect(await git.enablePipelines({ token, id: repository.id })).toBe(true);
    expect(await git.pipelinesEnabled({ token, id: repository.id })).toBe(true);
  });

  it('tells a list it could not read from an empty one', async () => {
    const git = new GitLabProvider({ url: double.url });
    const repository = await repositoryWithACommit(git, 'hidden-runners-project');
    expect((await git.getCiRunners({ token, id: repository.id })).listed).toBe(true);
    vi.spyOn((git as any).client, 'getProjectRunners').mockRejectedValue(new Error('403 Forbidden'));
    expect(await git.getCiRunners({ token, id: repository.id })).toMatchObject({ supported: true, instanceRunners: true, listed: false, runners: [] });
  });
});
