import {
  createPackage, getPackage, listPackages, listRegisteredPackages, publishPackage, readManifest, readPackageFile, savePackageFile, savePackageFiles, packageRepository,
  KIND_DEFINITIONS, KINDS, locationOf, ACCESS,
} from '@lbdudc/linea-git';
import { LineaCoreError } from '@lbdudc/linea-core';
import { Container } from 'typedi';
import UserRepository from '../../repositories/UserRepository.js';
import PermissionChecker from '../PermissionChecker.js';
import { UserNotFoundError, PackageNotFoundError } from '../../errors/errors.js';
import { getGitProvider, gitConfig, registryFor, registryHostOf } from '../../git/index.js';
import { activeHostOf, tokenFor, tokenOrElse, usernameOn } from '../../git/hosts.js';
import { createPackageSource, registryCatalog } from './hosts.js';
import { checkWorkingCopy } from './packageCheck.js';
import { readStudio } from './studio.js';
import { checkModuleTrial, deriveModuleTrial, describeModuleTrial, sourceWithChanges } from './packageTrial.js';
import { packageLists } from './packageLists.js';

export { KINDS };

/**
 * The modules and metamodels of the registry, for the people of this server: what the registry does is in `@lbdudc/linea-git`; here
 * is who may do it (a user, with their token, and their access to the repository), and the check of a package, which needs the
 * metamodel engine.
 */
export default class PackageService {
  userRepository = Container.get(UserRepository);
  permissionChecker = Container.get(PermissionChecker);

  // packages and the registry are those of the git host the person works on: the person as they are there (their token and name on it)
  #user = async (userId) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const host = activeHostOf(user);
    const accessToken = tokenFor(user, host);
    // the registry is a repository on the host its location names, which need not be the primary one
    return { host, accessToken, username: usernameOn(user, host), registryToken: tokenOrElse(user, registryHostOf(registryFor(host)), accessToken) };
  };

  #access = async ({ userId, id, host, accessLevel }) =>
    this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: id, host, accessLevel });

  list = async ({ userId, kind }) => {
    // keyed by the host the person works on: switching profile must not bring back the list of the other host's registry
    const { host, accessToken: token, registryToken } = await this.#user(userId);
    return packageLists.get(`${process.env.LINEA_REGISTRY ?? 'topic'}|${host}|${userId}|${kind}`, async () => {
      // with a registry, the list is what is registered; without one, every package of the host that has the topic of its kind
      const catalog = registryCatalog({ token: registryToken, host });
      return catalog
        ? listRegisteredPackages({ provider: getGitProvider({ host }), token, kind, catalog, source: createPackageSource({ token, userId }) })
        : listPackages({ provider: getGitProvider({ host }), token, kind, config: gitConfig(host), userId });
    });
  };

  /** `register` also adds it to the registry (when this deployment has one). */
  create = async ({ userId, kind, name, description, namespaceId, register }) => {
    const { host, accessToken: token, registryToken } = await this.#user(userId);
    const catalog = register ? registryCatalog({ token: registryToken, host }) : null;
    try {
      return await createPackage({ provider: getGitProvider({ host }), token, kind, name, description, namespaceId, catalog: catalog ?? undefined });
    } finally {
      packageLists.clear();
    }
  };

  get = async ({ userId, kind, id }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.REPORTER });
    return getPackage({ provider: getGitProvider({ host }), token, kind, id });
  };

  readFile = async ({ userId, kind, id, path, ref }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.REPORTER });
    return readPackageFile({ provider: getGitProvider({ host }), token, kind, id, path, ref });
  };

  /** Writes (or, with `content: null`, deletes) one file of a package on `main`. A manifest is checked before it is saved. */
  saveFile = async ({ userId, kind, id, path, content, message }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.DEVELOPER });
    return savePackageFile({ provider: getGitProvider({ host }), token, kind, id, path, content, message });
  };

  /** Writes (or, with `null`, deletes) several files of a package on `main` in one commit. A manifest among them is checked first. */
  saveFiles = async ({ userId, kind, id, files, message }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.DEVELOPER });
    return savePackageFiles({ provider: getGitProvider({ host }), token, kind, id, files, message });
  };

  /**
   * What the metamodel studio edits: the grammar and scripts of a metamodel as they are on `main`, the metamodels it needs, and its
   * test cases (see `studio.js`). Only a metamodel has a studio.
   */
  studio = async ({ userId, kind, id }) => {
    if (kind !== 'metamodel') throw new PackageNotFoundError();
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.REPORTER });
    const provider = getGitProvider({ host });
    const repository = await packageRepository({ provider, token, kind, id });
    const location = locationOf({ kind: provider.kind, path: repository.path });
    const manifest = await readManifest({ provider, token, kind, id });
    return readStudio({ token, userId, location, manifest });
  };

  #trialSource = async ({ userId, kind, id, ref, changes, others = [], accessLevel }) => {
    if (kind !== 'module') throw new PackageNotFoundError();
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel });
    const provider = getGitProvider({ host });
    const repository = await packageRepository({ provider, token, kind, id });
    const location = locationOf({ kind: provider.kind, path: repository.path });
    const changedManifest = changes.find((change) => change.path === KIND_DEFINITIONS[kind].manifest && change.action !== 'delete');
    const manifest = changedManifest
      ? KIND_DEFINITIONS[kind].parse({ content: changedManifest.content ?? '' })
      : await readManifest({ provider, token, kind, id, ref });
    const base = createPackageSource({ token, userId, overrides: { [location]: { version: manifest.version, ref } } });
    return { source: sourceWithChanges({ source: base, location, changes, others }), location, version: manifest.version };
  };

  /** What it takes to try a module at `ref`, with `changes` (and `others`, changes to the modules it needs) not committed yet: its metamodels, its features and its code insertion points. */
  #registryModules = (userId) => this.list({ userId, kind: 'module' })
    .then((list) => list.filter((pkg) => pkg.latest && !pkg.unavailable).map((pkg) => ({ location: pkg.location, version: pkg.latest })))
    .catch(() => []);

  trial = async ({ userId, kind, id, ref = 'main', changes = [], others = [], alongside = [] }) => {
    try {
      const [trialSource, elsewhere] = await Promise.all([
        this.#trialSource({ userId, kind, id, ref, changes, others, accessLevel: ACCESS.REPORTER }),
        this.#registryModules(userId),
      ]);
      return await describeModuleTrial({ ...trialSource, elsewhere, alongside: elsewhere.filter((other) => alongside.includes(other.location)) });
    } catch (error) {
      if (error instanceof LineaCoreError) return { ok: false, error: error.message, diagnostics: [{ severity: 'error', package: String(id), message: error.message }], modules: [], metamodels: [], offered: [], features: [], selected: [], cips: { compositions: [] } };
      throw error;
    }
  };

  /** Derives a module at `ref`, with `changes` not committed yet, from some models and features. Nothing is made. Needs developer access. */
  deriveTrial = async ({ userId, kind, id, ref = 'main', changes = [], others = [], alongside = [], ...options }) => {
    try {
      const [trialSource, registry] = await Promise.all([
        this.#trialSource({ userId, kind, id, ref, changes, others, accessLevel: ACCESS.DEVELOPER }),
        alongside.length ? this.#registryModules(userId) : [],
      ]);
      return await deriveModuleTrial({ ...trialSource, alongside: registry.filter((other) => alongside.includes(other.location)), ...options });
    } catch (error) {
      if (error instanceof LineaCoreError) return { ok: false, error: error.message, diagnostics: [{ severity: 'error', package: String(id), message: error.message }] };
      throw error;
    }
  };

  /** Whether some models and features are right for a module at `ref`, with `changes` not committed yet. Nothing is made. */
  checkTrial = async ({ userId, kind, id, ref = 'main', changes = [], others = [], alongside = [], models, features }) => {
    try {
      const [trialSource, registry] = await Promise.all([
        this.#trialSource({ userId, kind, id, ref, changes, others, accessLevel: ACCESS.REPORTER }),
        alongside.length ? this.#registryModules(userId) : [],
      ]);
      return await checkModuleTrial({ ...trialSource, alongside: registry.filter((other) => alongside.includes(other.location)), models, features });
    } catch (error) {
      if (error instanceof LineaCoreError) return { ok: false, error: error.message, diagnostics: [{ severity: 'error', package: String(id), message: error.message }] };
      throw error;
    }
  };

  check = async ({ userId, kind, id }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.REPORTER });
    const provider = getGitProvider({ host });
    const repository = await packageRepository({ provider, token, kind, id });
    const location = locationOf({ kind: provider.kind, path: repository.path });
    let manifest;
    try {
      manifest = await readManifest({ provider, token, kind, id });
    } catch (error) {
      return { ok: false, diagnostics: [{ severity: 'error', package: location, file: KIND_DEFINITIONS[kind].manifest, message: error.message }], metamodels: [], featureModel: '', resolved: [] };
    }
    return checkWorkingCopy({ token, userId, kind, location, manifest });
  };

  /**
   * Publishes the version of `main`: checks it, and tags it `vX.Y.Z`. With `bump` (`patch`, `minor`, `major`) the version in the manifest
   * is raised first (a commit on `main`), so a package can be released without editing the manifest by hand.
   */
  publish = async ({ userId, kind, id, bump }) => {
    const { host, accessToken: token } = await this.#user(userId);
    await this.#access({ userId, id, host, accessLevel: ACCESS.DEVELOPER });
    try {
      return await publishPackage({
        provider: getGitProvider({ host }), token, kind, id, bump,
        check: ({ location, manifest }) => checkWorkingCopy({ token, userId, kind, location, manifest }),
      });
    } finally {
      packageLists.clear();
    }
  };
}

