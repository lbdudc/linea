import { Container } from 'typedi';
import LineRepository from '../repositories/LineRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import PermissionChecker from './PermissionChecker.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor, usernameOn } from '../git/hosts.js';
import domainEvents, { DOMAIN_EVENTS } from '../events/domainEvents.js';
import { templatesOf } from './repositoryTemplates.js';
import { LineNotFoundError, ProductNotFoundError } from '../errors/errors.js';
import { ACCESS } from '@lbdudc/linea-git';

const REFUSALS = new Set([400, 403, 404, 409, 422]);

/** What the host said no to (there is no such issue, a field it does not take) keeps its status, rather than turning into a failure of the server. */
const refusal = (error) => (REFUSALS.has(error?.status) && !/auth/i.test(error?.constructor?.name ?? '')
  ? Object.assign(new Error(error.message), { code: 'ISSUE_REFUSED', status: error.status })
  : error);

/**
 * The issues of the repository of a line or of a product, whatever host it is on: this only finds the repository and the person's
 * token and asks the host's provider, which speaks the neutral shapes of `@lbdudc/linea-git`. What a person may do is what the host
 * lets them do with their own token (a reader of the repository is let in; the host refuses the rest).
 */
export default class IssueService {
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  permissionChecker = Container.get(PermissionChecker);

  #refuse = (error) => { throw refusal(error); };

  #access = async ({ kind, id, userId }) => {
    let owner;
    let projectId;
    if (kind === 'line') {
      owner = await this.lineRepository.findById(id);
      if (!owner) throw new LineNotFoundError();
      projectId = owner.repoId;
    } else {
      owner = await this.productRepository.findById(id);
      if (!owner) throw new ProductNotFoundError();
      projectId = owner.repo.id;
    }
    const host = hostOf(owner);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: projectId, accessLevel: ACCESS.REPORTER }, git);
    const target = { kind, id: String(id), name: kind === 'line' ? owner.name : owner.spec?.basicData?.name };
    return { git, host, token: tokenFor(user, host), projectId, target, actor: { userId, username: usernameOn(user, host) } };
  };

  #announce = (event, { host, target, actor }, issue, extra = {}) => {
    domainEvents.emit(event, {
      host, target, actor, number: issue.number, title: issue.title, author: issue.author, assignees: issue.assignees, state: issue.state, ...extra,
    });
  };

  /** What the UI needs to draw the forms and the filters: the host, what it can do, and the labels and milestones to choose from. */
  getMeta = async (target) => {
    const { git, host, token, projectId } = await this.#access(target);
    const capabilities = git.capabilities();
    const [labels, milestones, members, templates] = await Promise.all([
      capabilities.issues.labels ? git.listLabels({ token, id: projectId }).catch(() => []) : [],
      capabilities.issues.milestones ? git.listMilestones({ token, id: projectId }).catch(() => []) : [],
      // the people of the repository: what the assignees field proposes
      capabilities.issues.assignees ? git.getMembers({ token, id: projectId }).catch(() => []) : [],
      templatesOf({ git, token, projectId, host, kind: 'issue' }),
    ]);
    return { host, capabilities, labels, milestones, members: members.map((member) => member.username), templates };
  };

  list = async ({ filter, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.listIssues({ token, id: projectId, filter }).catch(this.#refuse);
  };

  get = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.getIssue({ token, id: projectId, number }).catch(this.#refuse);
  };

  create = async ({ fields, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const made = await git.createIssue({ token, id: projectId, ...fields }).catch(this.#refuse);
    this.#announce(DOMAIN_EVENTS.ISSUE_CREATED, access, made, { previousAssignees: [], text: made.description });
    return made;
  };

  update = async ({ number, changes, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const before = await git.getIssue({ token, id: projectId, number }).catch(() => null);
    const made = await git.updateIssue({ token, id: projectId, number, changes }).catch(this.#refuse);
    this.#announce(DOMAIN_EVENTS.ISSUE_UPDATED, access, made, {
      previousAssignees: before?.assignees ?? made.assignees,
      previousState: before?.state ?? made.state,
      text: changes.description !== undefined && changes.description !== before?.description ? made.description : '',
    });
    return made;
  };

  listComments = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.listIssueComments({ token, id: projectId, number }).catch(this.#refuse);
  };

  /** The labels put on the issue and taken off it, oldest first: who and when (what the host keeps of it). */
  listLabelEvents = async ({ number, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.listIssueLabelEvents({ token, id: projectId, number }).catch(this.#refuse);
  };

  addComment = async ({ number, body, ...target }) => {
    const access = await this.#access(target);
    const { git, token, projectId } = access;
    const made = await git.addIssueComment({ token, id: projectId, number, body }).catch(this.#refuse);
    const [issue, comments] = await Promise.all([
      git.getIssue({ token, id: projectId, number }).catch(() => null),
      git.listIssueComments({ token, id: projectId, number }).catch(() => []),
    ]);
    if (issue) this.#announce(DOMAIN_EVENTS.ISSUE_COMMENTED, access, issue, { text: body, commenters: comments.map((comment) => comment.author) });
    return made;
  };

  saveTemplate = async ({ name, content, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    return git.saveTemplate({ token, id: projectId, kind: 'issue', name, content }).catch(this.#refuse);
  };

  deleteTemplate = async ({ name, ...target }) => {
    const { git, token, projectId } = await this.#access(target);
    await git.deleteTemplate({ token, id: projectId, kind: 'issue', name }).catch(this.#refuse);
  };
}

Container.set(IssueService, new IssueService());
