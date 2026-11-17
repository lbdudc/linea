import { Container } from 'typedi';
import { ACCESS } from '@lbdudc/linea-git';
import LineRepository from '../repositories/LineRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import PermissionChecker from './PermissionChecker.js';
import mongoose from 'mongoose';
import { UserNotFoundError, NoDeployedSnapshotError, LineNotFoundError, ProductNotFoundError } from '../errors/errors.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor } from '../git/hosts.js';
import { isVersion, listVersionTags } from './versionTags.js';
import { findVersionRelease, keepVersionRelease, listVersionReleases, backfillVersionReleases } from './versionReleases.js';

/**
 * The releases of the versions of a line or a product: what was made, the changelog kept for each, why one failed, and the two ways to
 * make the missing ones (retry one, backfill all the tags that have none).
 */
export default class ReleaseService {
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  userRepository = Container.get(UserRepository);
  permissionChecker = Container.get(PermissionChecker);

  #context = async ({ kind, id, userId, accessLevel }) => {
    const NotFound = kind === 'line' ? LineNotFoundError : ProductNotFoundError;
    if (!mongoose.isValidObjectId(id)) throw new NotFound();
    const subject = kind === 'line' ? await this.lineRepository.findById(id) : await this.productRepository.findById(id);
    if (!subject) throw new NotFound();
    const host = hostOf(subject);
    const projectId = kind === 'line' ? subject.repoId : subject.repo.id;
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: projectId, accessLevel }, getGitProvider({ host }));
    if (!user) throw new UserNotFoundError();
    const name = kind === 'line' ? subject.name : subject.spec?.basicData?.name;
    return { kind, host, projectId, token: tokenFor(user, host), name };
  };

  /** The state of each version's release, without the changelogs. */
  list = async ({ kind, id, userId }) => {
    const { host, projectId } = await this.#context({ kind, id, userId, accessLevel: ACCESS.REPORTER });
    return (await listVersionReleases({ host, projectId })).map((r) => r.toObject());
  };

  /** The changelog kept for a version, or `null`; the record says whether the release failed. */
  get = async ({ kind, id, userId, version }) => {
    if (!isVersion(version)) throw new NoDeployedSnapshotError();
    const { host, projectId } = await this.#context({ kind, id, userId, accessLevel: ACCESS.REPORTER });
    return (await findVersionRelease({ host, projectId, version }))?.toObject() ?? null;
  };

  /** Tries the release of one version again. */
  retry = async ({ kind, id, userId, version }) => {
    if (!isVersion(version)) throw new NoDeployedSnapshotError();
    const { host, projectId, token, name } = await this.#context({ kind, id, userId, accessLevel: ACCESS.MAINTAINER });
    const result = await keepVersionRelease({ token, projectId, version, host, kind, name, force: true });
    return { version, ...result, changelog: undefined };
  };

  /** Creates the releases of the version tags that have none, each with the changes since the tag before it. */
  backfill = async ({ kind, id, userId }) => {
    const { host, projectId, token, name } = await this.#context({ kind, id, userId, accessLevel: ACCESS.MAINTAINER });
    const versions = await listVersionTags({ token, projectId, host });
    return backfillVersionReleases({ token, projectId, host, kind, name, versions });
  };
}

Container.set(ReleaseService, new ReleaseService());
