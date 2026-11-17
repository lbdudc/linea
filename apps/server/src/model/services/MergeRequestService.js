import { Container } from 'typedi';
import PermissionChecker from './PermissionChecker.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor, usernameOn } from '../git/hosts.js';
import domainEvents, { DOMAIN_EVENTS } from '../events/domainEvents.js';
import { templatesOf } from './repositoryTemplates.js';
import { properties } from '../connectors/properties.js';
import { ownerOfRepository } from './repositoryOwner.js';
import { ACCESS } from '@lbdudc/linea-git';

const REFUSALS = new Set([400, 403, 404, 409, 422]);

/** What the host said no to keeps its status, rather than turning into a failure of the server. */
const refusal = (error) => (REFUSALS.has(error?.status) && !/auth/i.test(error?.constructor?.name ?? '')
  ? Object.assign(new Error(error.message), { code: 'ISSUE_REFUSED', status: error.status })
  : error);

// the most a filter by origin looks through: the host cannot narrow by how LINEA made a merge request, so the pages are read and narrowed here
const ORIGIN_SCAN = 300;

/**
 * Who opened it, as LINEA knows it: the generation of a product (from the base branch), a sync with the SPL (its own branches and
 * title) or a person. The two first are the business of the CI/CD tab: the pages show them and send the person there.
 */
export const originOf = (request) => {
  // a sync's request into the default branch comes from the base branch like a generation's does: its title tells them apart
  if (/^Sync with SPL\b/.test(request.title ?? '')) return 'sync';
  if (request.sourceBranch === properties.git.baseBranch) return 'generation';
  if (/^sync\//.test(request.sourceBranch)) return 'sync';
  return 'manual';
};

/**
 * The merge requests of the repository of a line or of a product, whatever host it is on: this finds the repository and the person's
 * token and asks the host's provider, which speaks the neutral shapes of `@lbdudc/linea-git`. What a person may do is what the host
 * lets them do with their own token.
 */
export default class MergeRequestService {
  permissionChecker = Container.get(PermissionChecker);

  #refuse = (error) => { throw refusal(error); };

  #access = async ({ kind, id, host: onHost, userId }) => {
    const { owner, projectId } = await ownerOfRepository({ kind, id, host: onHost });
    const host = hostOf(owner);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: projectId, accessLevel: ACCESS.REPORTER }, git);
    const target = { kind, id: String(id), name: kind === 'line' ? owner.name : owner.spec?.basicData?.name };
    return { git, host, token: tokenFor(user, host), projectId, target, actor: { userId, username: usernameOn(user, host) } };
  };

  #announce = (event, { host, target, actor }, request, extra = {}) => {
    domainEvents.emit(event, {
      host, target, actor, number: request.number, title: request.title, author: request.author, assignees: request.reviewers ?? [], state: request.state, ...extra,
    });
  };

  /** What the pages need to draw their forms and filters: the host, what it can do, the labels and the branches to choose from. */
  getMeta = async (target) => {
    const { git, host, token, projectId } = await this.#access(target);
    const capabilities = git.capabilities();
    const [labels, branches, repository, members, templates] = await Promise.all([
      capabilities.mergeRequests.labels ? git.listLabels({ token, id: projectId }).catch(() => []) : [],
      git.listBranches({ token, id: projectId }).catch(() => []),
      git.getRepository({ token, id: projectId }).catch(() => null),
      // the people of the repository: what the reviewers field proposes
      capabilities.mergeRequests.reviewers ? git.getMembers({ token, id: projectId }).catch(() => []) : [],
      templatesOf({ git, token, projectId, host, kind: 'mergeRequest' }),
    ]);
    return { host, capabilities, labels, branches, members: members.map((member) => member.username), defaultBranch: repository?.defaultBranch ?? properties.git.defaultBranch, baseBranch: properties.git.baseBranch, templates };
  };

  list = async ({ filter = {}, origin = 'all', ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    const tag = (page) => ({ ...page, items: page.items.map((request) => ({ ...request, origin: originOf(request) })) });
    if (origin === 'all') return tag(await git.listMergeRequests({ token, id: projectId, filter }).catch(this.#refuse));
    // narrowed by origin: read up to ORIGIN_SCAN of them and page what matches
    const perPage = Math.min(Math.max(filter.perPage ?? 20, 1), 100);
    const page = Math.max(filter.page ?? 1, 1);
    const all = [];
    for (let at = 1; all.length < ORIGIN_SCAN; at += 1) {
      const batch = await git.listMergeRequests({ token, id: projectId, filter: { ...filter, page: at, perPage: 100 } }).catch(this.#refuse);
      all.push(...batch.items);
      if (!batch.hasMore) break;
    }
    const matching = all.filter((request) => originOf(request) === origin);
    return tag({ items: matching.slice((page - 1) * perPage, page * perPage), page, perPage, hasMore: matching.length > page * perPage });
  };

  /** One merge request, with how it was opened and the checks that ran for it (a host that runs none has none). */
  get = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    const request = await git.getMergeRequest({ token, id: projectId, number }).catch(this.#refuse);
    const pipelines = await git.listChangeRequestPipelines({ token, id: projectId, number }).catch(() => []);
    const latest = pipelines[0];
    const jobs = latest?.id === undefined ? [] : await git.getPipelineJobs({ token, id: projectId, pipelineId: latest.id }).catch(() => []);
    return { ...request, origin: originOf(request), pipeline: latest ?? null, jobs };
  };

  create = async ({ fields, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const made = await git.createMergeRequest({ token, id: projectId, ...fields }).catch(this.#refuse);
    this.#announce(DOMAIN_EVENTS.MR_CREATED, access, made, { previousAssignees: [], text: made.description });
    return { ...made, origin: originOf(made) };
  };

  update = async ({ number, changes, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const before = await git.getMergeRequest({ token, id: projectId, number }).catch(() => null);
    const made = await git.updateMergeRequest({ token, id: projectId, number, changes }).catch(this.#refuse);
    this.#announce(DOMAIN_EVENTS.MR_UPDATED, access, made, {
      previousAssignees: before?.reviewers ?? made.reviewers ?? [],
      previousState: before?.state ?? made.state,
      text: changes.description !== undefined && changes.description !== before?.description ? made.description : '',
    });
    return { ...made, origin: originOf(made) };
  };

  diff = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.getMergeRequestDiff({ token, id: projectId, number }).catch(this.#refuse);
  };

  threads = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.listMergeRequestThreads({ token, id: projectId, number }).catch(this.#refuse);
  };

  comment = async ({ number, body, position, threadId, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const thread = await git.addMergeRequestComment({ token, id: projectId, number, body, position, threadId }).catch(this.#refuse);
    const [request, threads] = await Promise.all([
      git.getMergeRequest({ token, id: projectId, number }).catch(() => null),
      git.listMergeRequestThreads({ token, id: projectId, number }).catch(() => []),
    ]);
    if (request) this.#announce(DOMAIN_EVENTS.MR_COMMENTED, access, request, { text: body, commenters: threads.flatMap((entry) => entry.comments.map((comment) => comment.author)) });
    return thread;
  };

  saveTemplate = async ({ name, content, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.saveTemplate({ token, id: projectId, kind: 'mergeRequest', name, content }).catch(this.#refuse);
  };

  deleteTemplate = async ({ name, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    await git.deleteTemplate({ token, id: projectId, kind: 'mergeRequest', name }).catch(this.#refuse);
  };

  resolve = async ({ number, threadId, resolved, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.setThreadResolved({ token, id: projectId, number, threadId, resolved }).catch(this.#refuse);
  };

  /** `{ merged: true }`, or `{ merged: false, conflicts: true }` when it cannot be merged (conflicts, or it is not open). */
  merge = async ({ number, options, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const before = await git.getMergeRequest({ token, id: projectId, number }).catch(() => null);
    const conflicts = await git.mergeMergeRequest({ token, id: projectId, number, options }).catch(this.#refuse);
    if (conflicts) return { merged: false, conflicts: true };
    if (before) this.#announce(DOMAIN_EVENTS.MR_UPDATED, access, { ...before, state: 'merged' }, { previousAssignees: before.reviewers ?? [], previousState: before.state, text: '' });
    return { merged: true };
  };

  approve = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    await git.approveMergeRequest({ token, id: projectId, number }).catch(this.#refuse);
  };
}

Container.set(MergeRequestService, new MergeRequestService());
