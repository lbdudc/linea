import { Container } from 'typedi';
import { ACCESS } from '@lbdudc/linea-git';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor } from '../git/hosts.js';
import { properties } from '../connectors/properties.js';
import ProductRepository from '../repositories/ProductRepository.js';
import PermissionChecker from './PermissionChecker.js';
import { mapLimit } from './recent.js';
import { ProductNotFoundError } from '../errors/errors.js';
import {
  CI_CONFIG_PATH, CI_FILE_PATH, normalizeCiConfig, parseCiConfig, renderPipeline, serializeCiConfig,
} from './ci/pipelineConfig.js';

// What a pipeline of GitLab is when it is over: `manual` and `skipped` wait for nobody.
const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);
export const isFinished = (status) => FINISHED.has(status);

const MR_LIMIT = 20;
const MAX_TRACE_LINES = 500;
const MR_CONCURRENCY = 5;
const NOT_SUPPORTED = { supported: false, instanceRunners: null, runners: [] };

const isNotFound = (error) => error?.status === 404 || /not found|404|there is no file/i.test(String(error?.message ?? ''));

/** The version a merge request of the generation names in its title (`Update to product version: 1.2.3`). */
export const versionOfTitle = (title) => /(\d+\.\d+\.\d+)\s*$/.exec(String(title ?? ''))?.[1] ?? null;

/** What opened a request: a `sync` with the SPL (see ProductService.syncProduct) or a `generation` of a new version. */
export const kindOfTitle = (title) => (/^Sync with SPL\b/.test(String(title ?? '')) ? 'sync' : 'generation');

/** Whether a generation left this request open for a person: its checks did not pass, or were not over when the wait was up. */
const awaitsDecision = (product, request) => request.state === 'opened' && product?.pendingUpdate?.number === request.number;

/**
 * The pipeline that tells of what a request holds now: the one of its tip. An open request whose new commit has no pipeline yet has none, not the
 * one of a commit it had before.
 */
const pipelineOf = (request, pipelines) => {
  if (!request.headSha) return pipelines[0] ?? null;
  return pipelines.find((pipeline) => pipeline.sha === request.headSha) ?? (request.state === 'opened' ? null : pipelines[0] ?? null);
};

const pipelineSummary = (pipeline) => (pipeline ? { id: pipeline.id, status: pipeline.status, webUrl: pipeline.webUrl, createdAt: pipeline.createdAt } : null);

/**
 * The CI/CD of a product: how its pipeline is made (kept in `.linea/ci.json` and rendered into the code a generation derives), the
 * runners that take its jobs, and the merge requests of its generations with the checks that ran for them.
 */
export default class ProductCiService {
  productRepository = Container.get(ProductRepository);
  permissionChecker = Container.get(PermissionChecker);

  #access = async ({ id, userId, accessLevel = ACCESS.REPORTER }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const host = hostOf(product);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel }, git);
    return { product, git, host, token: tokenFor(user, host), projectId: product.repo.id };
  };

  /** The configuration kept in the repository (the default one when there is none). */
  loadConfig = async ({ git, token, projectId, ref = properties.git.defaultBranch }) => {
    const file = await git.getFileRevision({ token, id: projectId, path: CI_CONFIG_PATH, ref }).catch((error) => {
      if (isNotFound(error)) return null;
      throw error;
    });
    return parseCiConfig(file ? Buffer.from(file.content, 'base64').toString('utf8') : null);
  };

  getCi = async ({ id, userId }) => {
    const { git, host, token, projectId } = await this.#access({ id, userId });
    const [canEdit, config, runners, file, onHost] = await Promise.all([
      this.permissionChecker.hasPrivileges({ userId, repoId: projectId, accessLevel: ACCESS.MAINTAINER }, git),
      this.loadConfig({ git, token, projectId }),
      git.getCiRunners({ token, id: projectId }).catch(() => NOT_SUPPORTED),
      git.getFileRevision({ token, id: projectId, path: CI_FILE_PATH, ref: properties.git.defaultBranch }).catch(() => null),
      Promise.resolve(git.pipelinesEnabled?.({ token, id: projectId })).catch(() => null),
    ]);
    return {
      host,
      canEdit,
      // only the pipeline of GitLab is generated for now
      supported: host === 'gitlab',
      // CI/CD turned off on the host is off, whatever the settings kept in the repository say
      config: onHost === false ? { ...config, enabled: false } : config,
      rendered: renderPipeline({ ...config, enabled: true }, properties.git),
      pipelineFile: CI_FILE_PATH,
      fileInRepository: Boolean(file),
      runners,
    };
  };

  #revision = ({ git, token, projectId }, path, ref) => git.getFileRevision({ token, id: projectId, path, ref }).catch((error) => {
    if (isNotFound(error)) return null;
    throw error;
  });

  /** What makes a file of a branch hold `content` (`null`: no such file), none when it already does. */
  #fileActions = async (access, path, ref, content) => {
    const current = await this.#revision(access, path, ref);
    if (content === null) return current ? [{ action: 'delete', path }] : [];
    if (!current) return [{ action: 'create', path, content }];
    return Buffer.from(current.content, 'base64').toString('utf8') === content ? [] : [{ action: 'update', path, content, expectedRevision: current.revision }];
  };

  /**
   * Makes the repository what the configuration says: CI/CD on or off for the project, the settings in the default branch, and the pipeline
   * file in the default branch and in the base one. The file changes in both at once, and a generation renders the same one from the same
   * settings, so the merge request between them has nothing to disagree on.
   */
  saveCi = async ({ id, userId, config }) => {
    const { git, host, token, projectId } = await this.#access({ id, userId, accessLevel: ACCESS.MAINTAINER });
    const access = { git, token, projectId };
    const next = normalizeCiConfig(config);
    const { defaultBranch, baseBranch } = properties.git;
    const commit = (branch, actions) => (actions.length
      ? git.commit({ token, id: projectId, branch, message: 'Update CI configuration', track: false, actions })
      : null);
    const hasPipeline = host === 'gitlab';
    const file = hasPipeline ? renderPipeline(next, properties.git) : null;

    // on before the file arrives, off after it has gone: the host never holds a pipeline it has been told not to run
    if (next.enabled) await git.enablePipelines?.({ token, id: projectId });
    await commit(defaultBranch, [
      ...await this.#fileActions(access, CI_CONFIG_PATH, defaultBranch, serializeCiConfig(next)),
      ...(hasPipeline ? await this.#fileActions(access, CI_FILE_PATH, defaultBranch, file) : []),
    ]);
    // a product that has generated nothing yet has no base branch: its first generation starts from what the settings say
    const base = hasPipeline ? await git.getBranch({ token, id: projectId, branch: baseBranch }).catch(() => null) : null;
    if (base) await commit(baseBranch, await this.#fileActions(access, CI_FILE_PATH, baseBranch, file));
    if (!next.enabled) await git.disablePipelines?.({ token, id: projectId });
    return this.getCi({ id, userId });
  };

  setInstanceRunners = async ({ id, userId, enabled }) => {
    const { git, token, projectId } = await this.#access({ id, userId, accessLevel: ACCESS.MAINTAINER });
    await git.setInstanceRunners({ token, id: projectId, enabled: Boolean(enabled) });
    return (await git.getCiRunners({ token, id: projectId }).catch(() => NOT_SUPPORTED));
  };

  /** The merge requests of the generations (base branch to default branch), newest first, each with the state of its checks. */
  listMergeRequests = async ({ id, userId }) => {
    const { product, git, token, projectId } = await this.#access({ id, userId });
    const { baseBranch, defaultBranch } = properties.git;
    const all = await git.listChangeRequests({ token, id: projectId, state: 'all', targetBranch: defaultBranch });
    const requests = all.filter((request) => request.sourceBranch === baseBranch)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MR_LIMIT);
    return mapLimit(requests, MR_CONCURRENCY, async (request) => {
      const pipelines = await git.listChangeRequestPipelines({ token, id: projectId, number: request.number }).catch(() => []);
      return { ...request, version: versionOfTitle(request.title), kind: kindOfTitle(request.title), pipeline: pipelineSummary(pipelineOf(request, pipelines)), awaitingDecision: awaitsDecision(product, request) };
    });
  };

  latestChecksPipeline = async ({ git, token, projectId }) => {
    const { baseBranch, defaultBranch } = properties.git;
    const all = await git.listChangeRequests({ token, id: projectId, state: 'all', targetBranch: defaultBranch });
    const [request] = all.filter((candidate) => candidate.sourceBranch === baseBranch)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (!request) return null;
    const pipeline = pipelineOf(request, await git.listChangeRequestPipelines({ token, id: projectId, number: request.number }));
    if (!pipeline) return null;
    return request.state === 'opened' ? { ...pipeline, ofOpenRequest: true } : pipeline;
  };

  /** What a job printed (the end of it, up to `lines` lines) and how it stands: the output a person reads while a pipeline runs. */
  getJobTrace = async ({ id, userId, jobId, lines = 200 }) => {
    const { git, token, projectId } = await this.#access({ id, userId });
    const wanted = Math.min(MAX_TRACE_LINES, Math.max(1, Number(lines) || 200));
    const trace = await git.getJobTrace({ token, id: projectId, jobId, lines: wanted }).catch(() => '');
    return { trace };
  };

  /** The merge request of the latest generation (an open one first, else the newest) with its checks: what a generation in progress shows. */
  getLatestMergeRequest = async ({ id, userId }) => {
    const requests = await this.listMergeRequests({ id, userId });
    const latest = requests.find((request) => request.state === 'opened') ?? requests[0];
    return latest ? this.getMergeRequest({ id, userId, number: latest.number }) : null;
  };

  /** One merge request with every pipeline that ran for it, and the jobs of the latest. */
  getMergeRequest = async ({ id, userId, number }) => {
    const { product, git, token, projectId } = await this.#access({ id, userId });
    const all = await git.listChangeRequests({ token, id: projectId, state: 'all', targetBranch: properties.git.defaultBranch });
    const request = all.find((candidate) => candidate.number === Number(number));
    if (!request) return null;
    const pipelines = await git.listChangeRequestPipelines({ token, id: projectId, number: request.number }).catch(() => []);
    const latest = pipelineOf(request, pipelines);
    const jobs = latest?.id === undefined ? [] : await git.getPipelineJobs({ token, id: projectId, pipelineId: latest.id }).catch(() => []);
    const failedJob = jobs.find((job) => job.status === 'failed');
    const trace = failedJob ? await git.getJobTrace({ token, id: projectId, jobId: failedJob.id }).catch(() => '') : '';
    return {
      ...request,
      version: versionOfTitle(request.title),
      kind: kindOfTitle(request.title),
      awaitingDecision: awaitsDecision(product, request),
      pipeline: pipelineSummary(latest),
      pipelines: pipelines.map(pipelineSummary),
      jobs,
      failed: failedJob ? { id: failedJob.id, name: failedJob.name, trace } : null,
    };
  };
}

Container.set(ProductCiService, new ProductCiService());

/**
 * Waits for the checks of a merge request: the pipeline of its tip commit. Without a pipeline for that commit after `graceMs` there
 * is nothing to wait for (the product has no CI). Never throws and never decides about the merge: it answers what it saw.
 * Answers `{ status, waitedMs }` where `status` is the final status of the pipeline, `none` when there was no pipeline and
 * `timeout` when it was still not over after `maxMs`; `token` is the one to use from here on (it was renewed if the first one expired).
 * `failedJob` names the job that failed; with `stopOnFailure` the pipeline is canceled as soon as one does.
 */
export const waitForChecks = async ({
  git, token: given, projectId, number, maxMs, graceMs = 60_000, pollMs = 10_000, onStatus = async () => {}, renewToken = null, stopOnFailure = false,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => {
  // the token the person signed in with does not last as long as a pipeline can: when the host says it is no good, ask for a new one
  let token = given;
  const started = Date.now();
  let last = null;
  let seen = null;
  const firstFailed = async (pipeline) => {
    if (pipeline.id === undefined) return null;
    try {
      const jobs = await git.getPipelineJobs({ token, id: projectId, pipelineId: pipeline.id });
      return jobs.find((job) => job.status === 'failed') ?? null;
    } catch (error) {
      console.error('[ci] waiting for the checks, could not read the jobs:', error?.message ?? error);
      return null;
    }
  };
  while (Date.now() - started < maxMs) {
    let pipeline = null;
    let unread = false;
    try {
      const [request] = (await git.listChangeRequests({ token, id: projectId, state: 'opened', targetBranch: properties.git.defaultBranch }))
        .filter((candidate) => candidate.number === number);
      const pipelines = await git.listChangeRequestPipelines({ token, id: projectId, number });
      // the checks of what the request holds now, not of a commit it had before
      pipeline = request?.headSha ? pipelines.find((candidate) => candidate.sha === request.headSha) : pipelines[0];
    } catch (error) {
      console.error('[ci] waiting for the checks, could not read them:', error?.message ?? error);
      unread = true;
      if (renewToken && git.isAuthError?.(error)) token = await renewToken().catch(() => token);
    }
    if (pipeline) {
      seen = pipeline;
      if (pipeline.status !== last) { last = pipeline.status; await onStatus(pipeline); }
      if (isFinished(pipeline.status)) {
        const failed = pipeline.status === 'failed' ? await firstFailed(pipeline) : null;
        return { status: pipeline.status, pipeline, failedJob: failed?.name ?? null, waitedMs: Date.now() - started, token };
      }
      const failed = stopOnFailure ? await firstFailed(pipeline) : null;
      if (failed) {
        await git.cancelPipeline({ token, id: projectId, pipelineId: pipeline.id }).catch((error) => {
          console.error('[ci] a check failed, but the pipeline could not be stopped:', error?.message ?? error);
        });
        return { status: 'failed', pipeline, failedJob: failed.name, waitedMs: Date.now() - started, token };
      }
    } else if (!unread && Date.now() - started >= graceMs) {
      // only a host that answered and has no pipeline means there is no CI: one that could not be read says nothing
      return { status: 'none', pipeline: null, waitedMs: Date.now() - started, token };
    }
    await sleep(pollMs);
  }
  return { status: 'timeout', pipeline: seen, waitedMs: Date.now() - started, token };
};
