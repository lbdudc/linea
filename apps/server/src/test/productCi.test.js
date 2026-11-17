import { describe, it, expect, vi } from 'vitest';
import YAML from 'yaml';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CiConfigError, defaultCiConfig, normalizeCiConfig, parseCiConfig, renderPipeline, serializeCiConfig,
} from '../model/services/ci/pipelineConfig.js';
import ProductCiService, { waitForChecks, versionOfTitle, isFinished } from '../model/services/ProductCiService.js';
import { mergeUpdateBranch, prettifyAndDiff } from '../model/services/generatePipeline.js';
import { pruneWorkDirs, removeWorkDir } from '../model/services/workDirs.js';

const on = (patch = {}) => normalizeCiConfig({ ...defaultCiConfig(), enabled: true, ...patch });

describe('the pipeline of the checks of a generation', () => {
  const service = new ProductCiService();
  const hostWith = (requests, pipelines) => ({
    listChangeRequests: vi.fn().mockResolvedValue(requests),
    listChangeRequestPipelines: vi.fn().mockResolvedValue(pipelines),
  });

  it('is the one of the newest request from the base branch to the default one', async () => {
    const git = hostWith([
      { number: 1, sourceBranch: 'bigbang', createdAt: '2026-01-01T00:00:00Z' },
      { number: 2, sourceBranch: 'bigbang', createdAt: '2026-02-01T00:00:00Z' },
      { number: 3, sourceBranch: 'hotfix', createdAt: '2026-03-01T00:00:00Z' },
    ], [{ id: 9, status: 'running' }, { id: 8, status: 'failed' }]);
    expect(await service.latestChecksPipeline({ git, token: 't', projectId: 5 })).toEqual({ id: 9, status: 'running' });
    expect(git.listChangeRequestPipelines).toHaveBeenCalledWith({ token: 't', id: 5, number: 2 });
  });

  it('is none without such a request', async () => {
    const git = hostWith([{ number: 3, sourceBranch: 'hotfix', createdAt: '2026-03-01T00:00:00Z' }], []);
    expect(await service.latestChecksPipeline({ git, token: 't', projectId: 5 })).toBeNull();
    expect(git.listChangeRequestPipelines).not.toHaveBeenCalled();
  });
});

describe('the working folders of a generation', () => {
  it('removes only the ones left behind long ago', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-workdirs-'));
    const old = path.join(root, 'old');
    const recent = path.join(root, 'recent');
    fs.mkdirSync(old);
    fs.mkdirSync(recent);
    const dayAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, dayAgo, dayAgo);
    pruneWorkDirs(root);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not throw when a folder cannot be removed', () => {
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('EBUSY'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => removeWorkDir('somewhere')).not.toThrow();
    expect(log).toHaveBeenCalled();
    spy.mockRestore();
    log.mockRestore();
  });
});

describe('the pipeline of a product, rendered from its configuration', () => {
  it('renders nothing while CI is off', () => {
    expect(renderPipeline(defaultCiConfig())).toBeNull();
  });

  it('renders valid YAML whose jobs all ask for the runner tags and bring their own image', () => {
    const doc = YAML.parse(renderPipeline(on()));
    const jobs = Object.entries(doc).filter(([name]) => !['workflow', 'stages'].includes(name));
    expect(jobs.map(([name]) => name)).toEqual(['product_spec', 'client_lint', 'client_build', 'server_build', 'server_test']);
    for (const [, job] of jobs) {
      expect(job.tags).toEqual(['deploy']);
      expect(job.image).toBeTruthy();
      expect(doc.stages).toContain(job.stage);
    }
    expect(doc.server_test.services).toEqual([{ name: 'postgis/postgis:15-3.4', alias: 'db' }]);
    expect(doc.server_test.artifacts.reports.junit).toMatch(/TEST-/);
  });

  it('runs only on the merge request of a generation, from the base branch to the default one', () => {
    const { workflow } = YAML.parse(renderPipeline(on(), { baseBranch: 'bigbang', defaultBranch: 'main' }));
    expect(workflow.rules).toEqual([
      { if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME == "bigbang" && $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == "main"' },
      { when: 'never' },
    ]);
  });

  it('takes the names of the branches it is given', () => {
    const { workflow } = YAML.parse(renderPipeline(on(), { baseBranch: 'base', defaultBranch: 'trunk' }));
    expect(workflow.rules[0].if).toContain('SOURCE_BRANCH_NAME == "base"');
    expect(workflow.rules[0].if).toContain('TARGET_BRANCH_NAME == "trunk"');
  });

  it('leaves out the jobs that are off, and the stages nobody uses', () => {
    const config = defaultCiConfig();
    config.jobs.forEach((job) => { job.enabled = job.id === 'client_lint'; });
    const doc = YAML.parse(renderPipeline(normalizeCiConfig({ ...config, enabled: true })));
    expect(Object.keys(doc)).toEqual(['workflow', 'stages', 'client_lint']);
    expect(doc.stages).toEqual(['check']);
  });

  it('takes the file as written by hand in yaml mode', () => {
    const rendered = renderPipeline(on({ mode: 'yaml', yaml: 'a:\n  script: [echo hi]' }));
    expect(rendered).toBe('a:\n  script: [echo hi]\n');
  });

  it('refuses what cannot be a pipeline', () => {
    expect(() => on({ mode: 'yaml', yaml: 'a: [' })).toThrow(CiConfigError);
    expect(() => on({ mode: 'yaml', yaml: '- just\n- a list' })).toThrow(/mapping/);
    expect(() => on({ jobs: [{ id: 'default', image: 'x', script: 'y' }] })).toThrow(/not a valid job name/);
    expect(() => on({ jobs: [{ id: 'a', image: 'x', script: 'y' }, { id: 'a', image: 'x', script: 'y' }] })).toThrow(/same name/);
    expect(() => on({ jobs: [{ id: 'a', image: '', script: 'y' }] })).toThrow(/image of a is required/);
    expect(() => on({ jobs: defaultCiConfig().jobs.map((job) => ({ ...job, enabled: false })) })).toThrow(/at least one job/);
  });

  it('round-trips through the file kept in the repository, and treats a broken file as CI off', () => {
    const config = on({ tags: ['deploy', 'gpu'], waitMinutes: 5 });
    expect(parseCiConfig(serializeCiConfig(config))).toEqual(config);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseCiConfig('{ not json').enabled).toBe(false);
    expect(parseCiConfig(null)).toEqual(defaultCiConfig());
    quiet.mockRestore();
  });

  it('keeps the wait between one minute and four hours', () => {
    expect(on({ waitMinutes: 0 }).waitMinutes).toBe(1);
    expect(on({ waitMinutes: 99999 }).waitMinutes).toBe(240);
  });
});

describe('waiting for the checks of a merge request', () => {
  const request = { number: 3, headSha: 'b' };
  const makeGit = (answers) => {
    let call = 0;
    return {
      listChangeRequests: vi.fn().mockResolvedValue([request]),
      listChangeRequestPipelines: vi.fn().mockImplementation(async () => answers[Math.min(call++, answers.length - 1)]),
    };
  };
  const base = { token: 't', projectId: 1, number: 3, maxMs: 60_000, graceMs: 1_000, pollMs: 100 };

  it('waits until the pipeline of the tip commit is over, and says each status it passes through', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const git = makeGit([
      [{ sha: 'a', status: 'success' }], // the one of a commit the request had before
      [{ sha: 'b', status: 'pending' }],
      [{ sha: 'b', status: 'running' }],
      [{ sha: 'b', status: 'failed' }],
    ]);
    const seen = [];
    const result = await waitForChecks({ git, ...base, graceMs: 100_000, onStatus: async (p) => { seen.push(p.status); }, sleep: async (ms) => { now += ms; } });
    expect(seen).toEqual(['pending', 'running', 'failed']);
    expect(result.status).toBe('failed');
    Date.now.mockRestore();
  });

  it('does not wait for a product that has no pipeline', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const result = await waitForChecks({ git: makeGit([[]]), ...base, sleep: async (ms) => { now += ms; } });
    expect(result.status).toBe('none');
    Date.now.mockRestore();
  });

  it('gives up after the time it was given', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const result = await waitForChecks({ git: makeGit([[{ sha: 'b', status: 'running' }]]), ...base, maxMs: 1_000, sleep: async (ms) => { now += ms; } });
    expect(result.status).toBe('timeout');
    expect(result.pipeline).toMatchObject({ status: 'running' });
    Date.now.mockRestore();
  });

  it('survives the host failing to answer once', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const git = {
      listChangeRequests: vi.fn().mockResolvedValue([request]),
      listChangeRequestPipelines: vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue([{ sha: 'b', status: 'success' }]),
    };
    const result = await waitForChecks({ git, ...base, graceMs: 100_000, sleep: async (ms) => { now += ms; } });
    expect(result.status).toBe('success');
    quiet.mockRestore();
    Date.now.mockRestore();
  });

  it('a failed read after the grace period is not "no pipeline": it goes on waiting for the checks', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const git = {
      listChangeRequests: vi.fn().mockResolvedValue([request]),
      listChangeRequestPipelines: vi.fn()
        .mockResolvedValueOnce([{ sha: 'b', status: 'running' }])
        .mockRejectedValueOnce(new Error('invalid_token'))
        .mockResolvedValue([{ sha: 'b', status: 'success' }]),
    };
    // the failure comes after graceMs: it must not be taken for a product without CI
    const result = await waitForChecks({ git, ...base, graceMs: 50, sleep: async (ms) => { now += ms + 100; } });
    expect(result.status).toBe('success');
    quiet.mockRestore();
    Date.now.mockRestore();
  });

  it('asks for a new token when the host stops accepting the one it began with, and says which to go on with', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen = [];
    const git = {
      isAuthError: (error) => error.code === 'AUTH',
      listChangeRequests: vi.fn().mockImplementation(async ({ token }) => {
        seen.push(token);
        if (token === 'old') throw Object.assign(new Error('invalid_token'), { code: 'AUTH' });
        return [request];
      }),
      listChangeRequestPipelines: vi.fn().mockResolvedValue([{ sha: 'b', status: 'success' }]),
    };
    const renewToken = vi.fn().mockResolvedValue('new');
    const result = await waitForChecks({ git, ...base, token: 'old', graceMs: 100_000, renewToken, sleep: async (ms) => { now += ms; } });
    expect(renewToken).toHaveBeenCalledOnce();
    expect(seen).toEqual(['old', 'new']);
    expect(result).toMatchObject({ status: 'success', token: 'new' });
    quiet.mockRestore();
    Date.now.mockRestore();
  });

  describe('when a check fails', () => {
    const running = { id: 9, sha: 'b', status: 'running' };
    const gitWith = (jobs, pipeline = running) => ({
      listChangeRequests: vi.fn().mockResolvedValue([request]),
      listChangeRequestPipelines: vi.fn().mockResolvedValue([pipeline]),
      getPipelineJobs: vi.fn().mockResolvedValue(jobs),
      cancelPipeline: vi.fn().mockResolvedValue(),
    });
    const jobs = [{ name: 'client_lint', status: 'success' }, { name: 'client_build', status: 'failed' }, { name: 'server_build', status: 'running' }];

    it('stops the pipeline at once and says which job it was', async () => {
      const git = gitWith(jobs);
      const result = await waitForChecks({ git, ...base, stopOnFailure: true, sleep: async () => {} });
      expect(git.cancelPipeline).toHaveBeenCalledWith({ token: 't', id: 1, pipelineId: 9 });
      expect(result).toMatchObject({ status: 'failed', failedJob: 'client_build' });
    });

    it('still answers when the pipeline cannot be stopped', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const git = gitWith(jobs);
      git.cancelPipeline.mockRejectedValue(new Error('forbidden'));
      const result = await waitForChecks({ git, ...base, stopOnFailure: true, sleep: async () => {} });
      expect(result.failedJob).toBe('client_build');
      quiet.mockRestore();
    });

    it('does not stop a pipeline it was not asked to stop', async () => {
      const git = gitWith(jobs);
      git.listChangeRequestPipelines.mockResolvedValueOnce([running]).mockResolvedValue([{ ...running, status: 'failed' }]);
      const result = await waitForChecks({ git, ...base, sleep: async () => {} });
      expect(git.cancelPipeline).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'failed', failedJob: 'client_build' });
    });

    it('goes on waiting while no job has failed, or the jobs cannot be read', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const git = gitWith([{ name: 'client_lint', status: 'running' }]);
      git.getPipelineJobs.mockRejectedValueOnce(new Error('timeout'));
      git.listChangeRequestPipelines.mockResolvedValueOnce([running]).mockResolvedValueOnce([running]).mockResolvedValue([{ ...running, status: 'success' }]);
      const result = await waitForChecks({ git, ...base, stopOnFailure: true, sleep: async () => {} });
      expect(git.cancelPipeline).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'success', failedJob: null });
      quiet.mockRestore();
    });
  });

  it('knows which statuses are over, and the version a request names', () => {
    expect(['success', 'failed', 'canceled', 'skipped'].every(isFinished)).toBe(true);
    expect(['pending', 'running', 'created'].some(isFinished)).toBe(false);
    expect(versionOfTitle('Update to product version: 1.2.3')).toBe('1.2.3');
    expect(versionOfTitle('Add CI pipeline')).toBeNull();
  });
});

describe('the update merge request of a generation', () => {
  const makeGit = () => ({
    createOrRenameChangeRequest: vi.fn().mockResolvedValue({ number: 3, webUrl: 'https://gl/mr/3' }),
    mergeChangeRequest: vi.fn().mockResolvedValue(false),
  });
  const args = { token: 't', product: { repo: { id: 2 } }, newVersion: '1.0.0', logError: vi.fn() };

  it('merges at once when the product keeps no CI', async () => {
    const git = makeGit();
    const wait = vi.fn();
    await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: null, wait });
    expect(wait).not.toHaveBeenCalled();
    expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
  });

  it('waits for the checks before it merges, and leaves the request open for a person when they did not pass', async () => {
    const git = makeGit();
    const order = [];
    git.mergeChangeRequest.mockImplementation(async () => { order.push('merge'); return false; });
    const wait = vi.fn().mockImplementation(async () => { order.push('wait'); return { status: 'failed', pipeline: { webUrl: 'https://gl/p/1' } }; });
    const log = vi.fn();
    const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, waitMinutes: 7 }, wait });
    expect(order).toEqual(['wait']);
    expect(wait).toHaveBeenCalledWith(expect.objectContaining({ number: 3, maxMs: 7 * 60_000, projectId: 2 }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: 'log.checks_not_passed', params: ['failed'] }));
    expect(result.checksFailed).toEqual({ status: 'failed', job: null, url: 'https://gl/p/1' });
    expect(git.mergeChangeRequest).not.toHaveBeenCalled();
  });

  it('merges when the checks pass', async () => {
    const git = makeGit();
    const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: { waitForChecks: true }, wait: async () => ({ status: 'success', pipeline: null }) });
    expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
    expect(result.checksFailed).toBeUndefined();
  });

  it('says which check failed, and asks to stop only a pipeline LINEA wrote itself', async () => {
    const git = makeGit();
    const log = vi.fn();
    const wait = vi.fn().mockResolvedValue({ status: 'failed', failedJob: 'client_build', pipeline: { webUrl: 'https://gl/p/1' } });
    await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, mode: 'jobs' }, wait });
    expect(wait).toHaveBeenCalledWith(expect.objectContaining({ stopOnFailure: true }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: 'log.checks_job_failed', params: ['client_build'], link: 'https://gl/p/1' }));
    await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, mode: 'yaml' }, wait });
    expect(wait).toHaveBeenLastCalledWith(expect.objectContaining({ stopOnFailure: false }));
  });

  it('renews a token that stopped being good during the merge, and hands it back for what follows', async () => {
    const git = { ...makeGit(), isAuthError: (error) => error.message === 'invalid_token' };
    git.mergeChangeRequest.mockRejectedValueOnce(new Error('invalid_token'));
    const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: null, renewToken: vi.fn().mockResolvedValue('fresh') });
    expect(git.mergeChangeRequest).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'fresh' }));
    expect(result.token).toBe('fresh');
  });

  it('merges with a fresh token after a long wait, and hands it back for what follows', async () => {
    const git = makeGit();
    const renewToken = vi.fn().mockResolvedValue('fresh');
    const wait = async () => ({ status: 'success', pipeline: null, waitedMs: 20 * 60_000, token: 'old' });
    const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: { waitForChecks: true }, wait, renewToken });
    expect(git.mergeChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ token: 'fresh' }));
    expect(result.token).toBe('fresh');
  });

  describe('when the checks do not pass', () => {
    const failing = async () => ({ status: 'failed', failedJob: 'client_build', pipeline: { webUrl: 'https://gl/p/1' } });
    const messagesOf = (log) => log.mock.calls.map(([entry]) => entry.message);

    it('asks by default, and says so before and after', async () => {
      const git = makeGit();
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true }, wait: failing });
      expect(messagesOf(log)).toEqual(expect.arrayContaining(['log.checks_policy_ask', 'log.checks_job_failed', 'log.checks_await_decision']));
      expect(result.checksFailed.job).toBe('client_build');
      expect(result.rejected).toBeUndefined();
      expect(git.mergeChangeRequest).not.toHaveBeenCalled();
    });

    it('merges all the same when that is what was chosen', async () => {
      const git = makeGit();
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, onChecksFailed: 'merge' }, wait: failing });
      expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
      expect(result.checksFailed).toBeUndefined();
      expect(result.checksOverridden).toBe(true);
      expect(messagesOf(log)).toEqual(expect.arrayContaining(['log.checks_policy_merge', 'log.checks_merge_anyway', 'log.merged_merge_request']));
    });

    it('closes the request when rejecting is what was chosen', async () => {
      const git = { ...makeGit(), updateMergeRequest: vi.fn().mockResolvedValue({}) };
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, onChecksFailed: 'reject' }, wait: failing });
      expect(git.updateMergeRequest).toHaveBeenCalledWith(expect.objectContaining({ number: 3, changes: { state: 'closed' } }));
      expect(git.mergeChangeRequest).not.toHaveBeenCalled();
      expect(result.rejected).toBe(true);
      expect(messagesOf(log)).toEqual(expect.arrayContaining(['log.checks_policy_reject', 'log.update_rejected']));
    });

    it('leaves the decision to a person when the request could not be closed', async () => {
      const git = { ...makeGit(), updateMergeRequest: vi.fn().mockRejectedValue(new Error('403')) };
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, onChecksFailed: 'reject' }, wait: failing });
      expect(result.rejected).toBeUndefined();
      expect(result.checksFailed.job).toBe('client_build');
      expect(messagesOf(log)).toContain('log.checks_await_decision');
      expect(messagesOf(log)).not.toContain('log.update_rejected');
    });

    it('does nothing of that when they pass', async () => {
      const git = { ...makeGit(), updateMergeRequest: vi.fn() };
      const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: { waitForChecks: true, onChecksFailed: 'reject' }, wait: async () => ({ status: 'success', pipeline: null }) });
      expect(git.updateMergeRequest).not.toHaveBeenCalled();
      expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
      expect(result.checksOverridden).toBe(false);
    });
  });

  describe('when the wait is up before the checks are over', () => {
    const running = { id: 8, status: 'running', webUrl: 'https://gl/p/8' };
    const timedOut = async () => ({ status: 'timeout', pipeline: running });
    const makeTimeoutGit = () => ({ ...makeGit(), updateMergeRequest: vi.fn().mockResolvedValue({}), cancelPipeline: vi.fn().mockResolvedValue() });
    const messagesOf = (log) => log.mock.calls.map(([entry]) => entry.message);

    it('leaves the request open for a person when that is the option, without stopping the pipeline', async () => {
      const git = makeTimeoutGit();
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, waitMinutes: 2 }, wait: timedOut });
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'log.checks_timeout', params: [2], link: running.webUrl }));
      expect(messagesOf(log)).toContain('log.checks_await_decision');
      expect(result.checksFailed).toEqual({ status: 'timeout', job: null, url: running.webUrl });
      expect(git.mergeChangeRequest).not.toHaveBeenCalled();
      expect(git.cancelPipeline).not.toHaveBeenCalled();
    });

    it('merges when merging anyway is the option', async () => {
      const git = makeTimeoutGit();
      const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: { waitForChecks: true, onChecksFailed: 'merge' }, wait: timedOut });
      expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
      expect(result.checksOverridden).toBe(true);
      expect(result.checksFailed).toBeUndefined();
    });

    it('closes the request and stops what still runs when rejecting is the option', async () => {
      const git = makeTimeoutGit();
      const log = vi.fn();
      const result = await mergeUpdateBranch({ ...args, log, git, ci: { waitForChecks: true, onChecksFailed: 'reject' }, wait: timedOut });
      expect(git.updateMergeRequest).toHaveBeenCalledWith(expect.objectContaining({ changes: { state: 'closed' } }));
      expect(git.cancelPipeline).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: 8 }));
      expect(git.mergeChangeRequest).not.toHaveBeenCalled();
      expect(result.rejected).toBe(true);
    });

    it('still rejects when the pipeline cannot be stopped', async () => {
      const git = makeTimeoutGit();
      git.cancelPipeline.mockRejectedValue(new Error('403'));
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await mergeUpdateBranch({ ...args, log: vi.fn(), git, ci: { waitForChecks: true, onChecksFailed: 'reject' }, wait: timedOut });
      quiet.mockRestore();
      expect(result.rejected).toBe(true);
    });
  });
});

describe('the pipeline file in what a generation commits', () => {
  const dirWith = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-diff-'));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
    }
    return dir;
  };

  it('adds the file as part of the diff, and does not remove it when it is already there', async () => {
    const ciFile = renderPipeline(on());
    const oldDir = dirWith({ 'a.txt': 'a\n' });
    const first = await prettifyAndDiff({ newProductOutput: dirWith({ 'a.txt': 'a\n' }), oldProductOutput: oldDir, newVersion: '1.0.0', log: async () => {}, ciFile });
    expect(first.actions.map((action) => [action.action, action.file_path])).toContainEqual(['create', '.gitlab-ci.yml']);

    const oldWithCi = dirWith({ 'a.txt': 'a\n', '.gitlab-ci.yml': first.actions.find((action) => action.file_path === '.gitlab-ci.yml').content });
    const again = await prettifyAndDiff({ newProductOutput: dirWith({ 'a.txt': 'a\n' }), oldProductOutput: oldWithCi, newVersion: '1.0.0', log: async () => {}, ciFile });
    expect(again.actions).toEqual([]);
  });
});

describe('the update merge request of a sync', () => {
  const git = () => ({
    createOrRenameChangeRequest: vi.fn().mockResolvedValue({ number: 3, webUrl: 'https://gl/mr/3' }),
    mergeChangeRequest: vi.fn().mockResolvedValue(false),
  });
  const args = { token: 't', product: { repo: { id: 2 } }, newVersion: '1.0.0', logError: vi.fn(), log: vi.fn() };

  it('can be opened under its own title and left for a person to merge, without waiting for the checks', async () => {
    const double = git();
    const wait = vi.fn();
    const result = await mergeUpdateBranch({ ...args, git: double, ci: { waitForChecks: true }, wait, title: 'Sync with SPL v7 (product v1.0.0)', merge: false });
    expect(double.createOrRenameChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync with SPL v7 (product v1.0.0)' }));
    expect(double.mergeChangeRequest).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updateConflicts: false, updateMergeRequest: { number: 3 }, token: 't' });
  });

  it('a sync title does not read as an unfinished generation', () => {
    expect(versionOfTitle('Sync with SPL v7.0.0 (product v1.0.0)')).toBeNull();
  });
});
