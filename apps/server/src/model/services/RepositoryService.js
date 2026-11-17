import { Container } from 'typedi';
import PermissionChecker from './PermissionChecker.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor } from '../git/hosts.js';
import { properties } from '../connectors/properties.js';
import { ownerOfRepository } from './repositoryOwner.js';
import { ACCESS } from '@lbdudc/linea-git';

const REFUSALS = new Set([400, 403, 404, 409, 422]);
const refuse = (error) => {
  throw REFUSALS.has(error?.status) ? Object.assign(new Error(error.message), { code: 'REPOSITORY_REFUSED', status: error.status }) : error;
};

/**
 * The code of the repository of a line or of a product, whatever host it is on: branches, files and commits. It finds the repository
 * and the person's token and asks the host's provider, so what a person may do is what the host lets them do. Reading asks for
 * reporter access, writing for developer. (The merge requests are `MergeRequestService`'s.)
 */
export default class RepositoryService {
  permissionChecker = Container.get(PermissionChecker);

  #access = async (target, accessLevel) => {
    const { owner, projectId } = await ownerOfRepository(target);
    const host = hostOf(owner);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId: target.userId, repoId: projectId, accessLevel }, git);
    return { git, host, owner, token: tokenFor(user, host), projectId };
  };

  #read = (target) => this.#access(target, ACCESS.REPORTER);
  #write = (target) => this.#access(target, ACCESS.DEVELOPER);

  info = async (target) => {
    const { git, token, projectId } = await this.#read(target);
    const repository = await git.getRepository({ token, id: projectId }).catch(refuse);
    return { id: repository.id, path: repository.path, webUrl: repository.webUrl, defaultBranch: repository.defaultBranch ?? properties.git.defaultBranch, baseBranch: properties.git.baseBranch };
  };

  listBranches = async (target) => {
    const { git, token, projectId } = await this.#read(target);
    return git.listBranches({ token, id: projectId }).catch(refuse);
  };

  getBranch = async ({ branch, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    return git.getBranch({ token, id: projectId, branch }).catch(refuse);
  };

  createBranch = async ({ branch, ref, ...target }) => {
    const { git, token, projectId } = await this.#write(target);
    await git.createBranch({ token, id: projectId, branch, ref }).catch(refuse);
    return { branch, ref };
  };

  listFiles = async ({ ref, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    return git.listFiles({ token, id: projectId, ref }).catch(refuse);
  };

  /** `{ path, content (base64), encoding, revision }`; `null` when there is no such file. */
  getFile = async ({ path, ref, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    const file = await git.getFileRevision({ token, id: projectId, path, ref }).catch((error) => (error?.status === 404 ? null : refuse(error)));
    return file && { path: file.path, content: file.content, encoding: file.encoding, revision: file.revision };
  };

  /** What `to` has that `from` has not: `{ commits, files }`. */
  compare = async ({ from, to, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    return git.compare({ token, id: projectId, from, to }).catch(refuse);
  };

  /** Asks the host to tell LINEA about the pushes to the repository (`{ status, hookId }`); nothing to do when LINEA has no public address. */
  ensurePushHook = async (target) => {
    const { git, host, projectId, token } = await this.#access(target, ACCESS.MAINTAINER);
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
    const secret = process.env.GIT_WEBHOOK_SECRET;
    if (!base || !secret) return { status: 'unavailable', reason: 'PUBLIC_URL and GIT_WEBHOOK_SECRET are both needed' };
    return git.ensureWebhook({ token, id: projectId, url: `${base}${git.webhookPath}`, secret, branch: undefined }).catch(refuse).then((result) => ({ host, ...result }));
  };

  /** A zip of the repository at `ref`, as a stream. */
  archive = async ({ ref, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    return git.downloadArchive({ token, id: projectId, ref }).catch(refuse);
  };

  listCommits = async ({ ref, perPage, ...target }) => {
    const { git, token, projectId } = await this.#read(target);
    return git.getCommits({ token, id: projectId, ref, perPage }).catch(refuse);
  };

  commit = async ({ branch, message, actions, ...target }) => {
    const { git, token, projectId } = await this.#write(target);
    return git.commit({ token, id: projectId, branch, message, actions }).catch(refuse);
  };
}

Container.set(RepositoryService, new RepositoryService());
