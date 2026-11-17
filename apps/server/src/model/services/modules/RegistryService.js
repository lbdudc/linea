import { registerLocation } from '@lbdudc/linea-core';
import { suggestPackages } from '@lbdudc/linea-git';
import { Container } from 'typedi';
import UserRepository from '../../repositories/UserRepository.js';
import { UserNotFoundError, RegistryNotConfiguredError } from '../../errors/errors.js';
import { getGitProvider, gitConfig, registryFor, registryHostOf } from '../../git/index.js';
import { activeHostOf, tokenFor, tokenOrElse, usernameOn } from '../../git/hosts.js';
import { createPackageSource, registryCatalog } from './hosts.js';
import { packageLists } from './packageLists.js';

/**
 * Which modules and metamodels this LINEA lists: the catalog of `LINEA_REGISTRY`, one repository with a `registry.json`. Registering is
 * a commit there, made with the user's own token, so the git host decides who may do it. A catalog only lists: what an SPL may
 * require is decided as before (`LINEA_TRUSTED_NAMESPACES`), not by being registered.
 */
export default class RegistryService {
  userRepository = Container.get(UserRepository);

  // packages and the registry are those of the git host the person works on: the person as they are there (their token and name on it)
  #user = async (userId) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const host = activeHostOf(user);
    const accessToken = tokenFor(user, host);
    // the registry is a repository on the host its location names, which need not be the primary one
    return { host, accessToken, username: usernameOn(user, host), registryToken: tokenOrElse(user, registryHostOf(registryFor(host)), accessToken) };
  };

  #catalog = ({ token, host }) => {
    const catalog = registryCatalog({ token, host });
    if (!catalog) throw new RegistryNotConfiguredError();
    return catalog;
  };

  /** Where the registry is, or `null` when this deployment lists packages by their topic instead. */
  status = async ({ userId } = {}) => {
    const host = userId ? (await this.#user(userId)).host : undefined;
    const location = registryFor(host);
    return { configured: Boolean(location), location };
  };

  /** The entries of the catalog as they are written there (see `PackageService.list` for the packages with their versions). */
  entries = async ({ userId, kind }) => {
    const { host, registryToken } = await this.#user(userId);
    return this.#catalog({ token: registryToken, host }).list({ kind });
  };

  /** Packages of the host with the topic of their kind that are not registered yet. */
  suggestions = async ({ userId, kind }) => {
    const { host, accessToken: token, registryToken } = await this.#user(userId);
    return suggestPackages({ provider: getGitProvider({ host }), token, kind, config: gitConfig(host), userId, catalog: this.#catalog({ token: registryToken, host }) });
  };

  /** Registers a location after reading it: a module or a metamodel (its manifest says which) with a published version. */
  register = async ({ userId, location }) => {
    const { host, accessToken: token, registryToken, username } = await this.#user(userId);
    const catalog = this.#catalog({ token: registryToken, host });
    try {
      return await registerLocation({ catalog, source: createPackageSource({ token, userId }), location, addedBy: username });
    } finally {
      packageLists.clear();
    }
  };

  unregister = async ({ userId, location }) => {
    const { host, registryToken } = await this.#user(userId);
    try {
      await this.#catalog({ token: registryToken, host }).remove({ location });
    } finally {
      packageLists.clear();
    }
  };
}

