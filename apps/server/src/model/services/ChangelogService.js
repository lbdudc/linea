import { Container } from 'typedi';
import { ACCESS } from '@lbdudc/linea-git';
import mongoose from 'mongoose';
import LineRepository from '../repositories/LineRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import PermissionChecker from './PermissionChecker.js';
import ProductSpecService from './ProductSpecService.js';
import SyncRun from '../entities/syncRun.js';
import { UserNotFoundError, LineNotFoundError, ProductNotFoundError } from '../errors/errors.js';
import { getGitProvider } from '../git/index.js';
import { activeHostOf, hostOf, tokenFor } from '../git/hosts.js';
import { isVersion, listVersionTags, compareVersions } from './versionTags.js';
import { mapLimit } from './recent.js';
import { rangeChangelog, changedPackages, packagesOfVersion, dependenciesMarkdown, splChangesMarkdown, parseLocation, MAX_DEPENDENCY_RANGE } from './changelogs.js';

const MAX_DEPENDENCIES = 30;

const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });

const checkRange = ({ from, to }) => {
  for (const value of [from, to]) if (value != null && value !== '' && !isVersion(value)) throw invalid(`"${String(value).slice(0, 20)}" is not a version`);
  return { from: from || null, to: to || null };
};

/**
 * What a version (or a range of them) brings: the changelogs kept by the releases of #103, put together. For a line or a product, and for
 * a package; for something made of modules, also what changed in each dependency whose version differs between two resolutions.
 */
export default class ChangelogService {
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  userRepository = Container.get(UserRepository);
  permissionChecker = Container.get(PermissionChecker);
  productSpecService = Container.get(ProductSpecService);

  #subject = async ({ kind, id, userId }) => {
    const NotFound = kind === 'line' ? LineNotFoundError : ProductNotFoundError;
    if (!mongoose.isValidObjectId(id)) throw new NotFound();
    const subject = kind === 'line' ? await this.lineRepository.findById(id) : await this.productRepository.findById(id);
    if (!subject) throw new NotFound();
    const host = hostOf(subject);
    const projectId = kind === 'line' ? subject.repoId : subject.repo.id;
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: projectId, accessLevel: ACCESS.REPORTER }, getGitProvider({ host }));
    if (!user) throw new UserNotFoundError();
    return { subject, host, projectId, token: tokenFor(user, host), user };
  };

  /** The dependencies (modules and metamodels) whose version changes between two versions of a line, each with its own changelog. */
  #dependencies = async ({ token, host, line, user, from, to, tokenOf = (h) => tokenFor(user, h) }) => {
    if (!from || !to || !line) return [];
    const projectId = line.repoId;
    const [before, after] = await Promise.all([
      packagesOfVersion({ token, projectId, host, version: from }),
      packagesOfVersion({ token, projectId, host, version: to }),
    ]);
    if (!before || !after) return [];
    const changes = changedPackages(before, after).slice(0, MAX_DEPENDENCIES);
    return mapLimit(changes, 3, async (change) => {
      if (change.change !== 'upgraded') return change;
      try {
        const detail = await this.#packageChangelog({ location: change.location, from: change.from, to: change.to, tokenOf, fallbackHost: host });
        return { ...change, changelog: detail };
      } catch (error) {
        return { ...change, changelog: null, error: 'unavailable' };
      }
    });
  };

  // `gitlab:group/project` -> its repository on the host of that kind (the user's host when it is of that kind)
  #packageChangelog = async ({ location, from, to, tokenOf, fallbackHost }) => {
    const parsed = parseLocation(location);
    const git = getGitProvider({ host: fallbackHost });
    // a location of another kind of host than this one's is not looked up here
    if (!parsed || parsed.scheme !== git.kind) return null;
    const token = tokenOf(fallbackHost);
    const repo = await git.findRepository({ token, path: parsed.path });
    if (!repo) return null;
    return rangeChangelog({ token, projectId: repo.id, host: fallbackHost, from, to, maxVersions: MAX_DEPENDENCY_RANGE });
  };

  #lastSyncedLineVersion = async (productId) =>
    (await SyncRun.findOne({ productId, lineVersion: { $exists: true }, status: { $in: ['unchanged', 'merged'] } }).sort({ startedAt: -1 }))?.lineVersion ?? null;

  /**
   * The markdown for the description of the request of a sync: what each dependency of the line brings since the line version of the last
   * sync. Empty when there is nothing to say (no earlier sync, a line that is not modular, no dependency changed). Never throws.
   */
  syncDescription = async ({ product, line, token }) => {
    try {
      if (!line) return '';
      const from = await this.#lastSyncedLineVersion(product._id);
      if (!from || from === line.version) return '';
      const host = hostOf(line);
      // what the SPL's own commits say (every kind of line), and what its dependencies (modules, metamodels) changed
      const [own, dependencies] = await Promise.all([
        rangeChangelog({ token, projectId: line.repoId, host, from, to: line.version }).catch(() => null),
        this.#dependencies({ token, host, line, from, to: line.version, tokenOf: () => token }).catch(() => []),
      ]);
      return [splChangesMarkdown({ from, to: line.version, changelog: own }), dependenciesMarkdown({ from, to: line.version, dependencies })].filter(Boolean).join('\n\n');
    } catch {
      return '';
    }
  };

  /** A line's changelog; of a modular one also its dependencies between `from` and `to`. */
  line = async ({ id, userId, from, to }) => {
    const range = checkRange({ from, to });
    const { subject, host, projectId, token, user } = await this.#subject({ kind: 'line', id, userId });
    const changelog = await rangeChangelog({ token, projectId, host, ...range });
    // without a `from`, what the version changed in its dependencies is relative to the version before it
    let fromVersion = range.from;
    if (!fromVersion && changelog.to) {
      fromVersion = (await listVersionTags({ token, projectId, host })).find((v) => compareVersions(v, changelog.to) < 0) ?? null;
    }
    const dependencies = fromVersion ? await this.#dependencies({ token, host, line: subject, user, from: fromVersion, to: changelog.to }) : [];
    return { ...changelog, dependencies };
  };

  /**
   * A product's changelog (its own releases) and, when its line is modular, what changed in each dependency between `lineFrom` (by default
   * the line version of its last sync) and `lineTo` (by default the line's current one): what a sync would bring.
   */
  product = async ({ id, userId, from, to, lineFrom, lineTo }) => {
    const range = checkRange({ from, to });
    const lines = checkRange({ from: lineFrom, to: lineTo });
    const { subject, host, projectId, token, user } = await this.#subject({ kind: 'product', id, userId });
    const changelog = await rangeChangelog({ token, projectId, host, ...range });
    const line = await this.lineRepository.findById(subject.lineId);
    // the line version of the last sync, else the one the product was last generated from (its deployment record keeps it)
    const fromLine = lines.from ?? await this.#lastSyncedLineVersion(subject._id)
      ?? (await this.productSpecService.readDeployed({ token, host, productProjectId: projectId }).catch(() => null))?.line?.version ?? null;
    const toLine = lines.to ?? line?.version ?? null;
    const lineHost = line ? hostOf(line) : host;
    const lineToken = line ? tokenFor(user, lineHost) : token;
    const moves = Boolean(line && fromLine && toLine && fromLine !== toLine);
    // what a sync would bring, for every kind of line: the SPL's own commits since that version, and what its dependencies changed
    const lineChangelog = moves ? await rangeChangelog({ token: lineToken, projectId: line.repoId, host: lineHost, from: fromLine, to: toLine }).catch(() => null) : null;
    const dependencies = moves ? await this.#dependencies({ token: lineToken, host: lineHost, line, user, from: fromLine, to: toLine }).catch(() => []) : [];
    return { ...changelog, lineFrom: fromLine, lineTo: toLine, lineChangelog, dependencies };
  };

  /** A package's changelog by its location (`gitlab:group/name`), for what the registry lists and the line pins. */
  packageByLocation = async ({ location, userId, from, to }) => {
    const range = checkRange({ from, to });
    if (!parseLocation(location)) throw invalid('the location is not valid');
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const host = activeHostOf(user);
    return (await this.#packageChangelog({ location, ...range, tokenOf: (h) => tokenFor(user, h), fallbackHost: host })) ?? { to: null, versions: [], sections: [], breaking: false, markdown: '' };
  };

  /** A package's (module or metamodel) changelog, by the id of its repository. */
  package = async ({ id, userId, from, to }) => {
    const range = checkRange({ from, to });
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const host = activeHostOf(user);
    const token = tokenFor(user, host);
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: id, host, accessLevel: ACCESS.REPORTER });
    return rangeChangelog({ token, projectId: id, host, ...range });
  };
}

Container.set(ChangelogService, new ChangelogService());
