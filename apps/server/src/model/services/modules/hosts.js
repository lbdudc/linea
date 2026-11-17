import { createGitCatalog, createPackageSource as createSource, repositoryFiles as filesOf, upsertFiles as upsert } from '@lbdudc/linea-git';
import { FEATURE_METAMODEL } from '@lbdudc/linea-core';
import { getGitProvider, gitConfigAll, registriesOf, registryFor, registryHostOf } from '../../git/index.js';
import { cachedPackageSource } from './packageCache.js';

/**
 * The source linea-core reads packages through: one per host, chosen by the scheme of a location. `overrides` reads a package from a
 * branch as one version, to check a working copy that is not published.
 */
export const createPackageSource = ({ token, tokens, userId, overrides, signal }) => createSource(gitConfigAll(), { token, tokens, userId, overrides, signal });

/** The same source, with every package it opens kept on disk by `name@version`: what a generation reads again is not downloaded again. */
export const createCachedPackageSource = (options) => cachedPackageSource({ source: createPackageSource(options) });

/** The files of the repository of an SPL at `ref`, as linea-core's `PackageFiles`. */
export const repositoryFiles = ({ token, id, ref, host }) => filesOf({ provider: getGitProvider({ host }), token, id, ref });

/** Writes several files to a branch of a repository in one commit (a string creates or updates, `null` deletes); `null` when nothing changed. */
export const upsertFiles = ({ token, id, branch, message, files, host }) => upsert({ provider: getGitProvider({ host }), token, id, branch, message, files });

/** The catalog of registered packages of a host (`LINEA_REGISTRY`, a repository on a git host), or `null` when this deployment has none. */
export const registryCatalog = ({ token, tokens, host: on }) => {
  const registry = registryFor(on);
  if (!registry) return null;
  // the registry is a repository on the host its location names (`gitlab:linea/registry`): that host's provider and the user's token there
  const host = registryHostOf(registry);
  return createGitCatalog({ provider: getGitProvider({ host: host ?? undefined }), token: tokens?.[host] ?? token, location: registry });
};

/**
 * The files of an SPL with some of them replaced by text (path -> text): what the SPL would be if they were saved. It is how a model is
 * checked before it is committed.
 */
export const overlayFiles = (files, overrides) => ({
  read: async ({ path }) => {
    if (!(path in overrides)) return files.read({ path });
    return overrides[path] === null ? undefined : new TextEncoder().encode(overrides[path]);
  },
  list: async ({ dir }) => {
    const base = (await files.list({ dir })).filter((path) => overrides[path] !== null);
    const added = Object.keys(overrides).filter((path) => overrides[path] !== null && (dir === '' || path.startsWith(`${dir}/`)) && !base.includes(path));
    return [...base, ...added];
  },
  ...(files.prefetch ? { prefetch: (paths) => files.prefetch(paths) } : {}),
});

/**
 * Where the feature metamodel is in the registry of a host (every SPL has it). `LINEA_FEATURE_METAMODEL` when it is not at the usual place
 * (one location per host when there are several registries).
 */
export const featureMetamodelLocation = (host) => {
  const given = String(process.env.LINEA_FEATURE_METAMODEL ?? '').split(',').map((location) => location.trim()).filter(Boolean);
  const mine = given.find((location) => registryHostOf(location) === host) ?? (given.length === 1 ? given[0] : undefined);
  if (mine) return mine;
  // a registry on the server itself has it in its own group (`local:registry/metamodels/featuremodel`): nothing more to configure
  const registry = registryFor(host);
  if (registry?.startsWith('local:')) return `local:${registry.slice('local:'.length).split('/')[0]}/metamodels/featuremodel`;
  return FEATURE_METAMODEL.location;
};
