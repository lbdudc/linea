import { LocalProvider, createGitProvider, gitConfigFromEnv, hostDescriptor } from '@lbdudc/linea-git';
import { HOST_KINDS, HOST_SCHEMAS, HOST_TERMS } from '../../config/gitHostSchemas.js';
import { IDENTITY, PRIMARY_KEY, isUsable, resolveGitHosts } from '../../config/gitHosts.js';
import { maskSecrets, validateSettings } from '../../config/settings.js';
import { resolveLocalUser } from './localAccounts.js';

/**
 * The git hosts of this deployment, through the `@lbdudc/linea-git` library: `local` (the repositories on this server), GitLab and
 * GitHub, any of them, together. Which are on and how each is set is configuration (see config/gitHosts.js: linea.config.yml, the
 * environment, the Settings page). More than one can be on at once; `primaryHost()` is the one of the users and lines that name no
 * host (everything that existed when there was only one).
 */

let declared = {}; // the `gitHosts:` block of linea.config.yml
let stored = {}; // host -> { enabled, settings }, what an administrator saved
let store = null;
let usage = null;
let unpinned = null;

/**
 * Sets what the file says and loads what was saved (`store`: `all()` and `save(host, patch)`, the same shape in memory for tests).
 * `usageOf(host)` says what lives on a host (`{ lines, products, users, admins }`), to warn before switching one off.
 */
export const configureGitHosts = async ({ file = {}, hostStore = null, usageOf = null, unpinnedCount = null } = {}) => {
  unpinned = unpinnedCount;
  declared = file ?? {};
  store = hostStore;
  usage = usageOf;
  stored = hostStore ? await hostStore.all() : {};
};

const resolved = () => resolveGitHosts({ declared, stored });

/** The hosts people can use now, in the order they are offered. */
export const enabledHosts = () => {
  const { hosts } = resolved();
  return HOST_KINDS.filter((kind) => hosts[kind].enabled);
};

/** The host of whoever and whatever names none: `gitHosts.primary` of the file, else `GIT_PROVIDER`, as long as it is on; else the first that is. */
export const primaryHost = () => resolved().primary;

// the settings laid over what the environment says (an unset setting leaves the environment's value)
const withSettings = (config, kind, settings) => {
  if (kind !== 'local') return hostDescriptor(kind).withSettings(config, settings);
  // the repositories are served by this server, under /git of the address people reach it by (the client's)
  const baseUrl = process.env.LINEA_GIT_URL || (process.env.REDIRECT_URI ? `${process.env.REDIRECT_URI.replace(/\/+$/, '')}/git` : undefined);
  // the registry is read by everybody and written by its owner (the server) and the administrators: it is what every line is made of
  const registry = registriesOf().find((location) => location.startsWith('local:'))?.slice('local:'.length).split('/')[0] ?? null;
  return hostDescriptor('local').withSettings(config, settings, { ...(baseUrl ? { baseUrl } : {}), resolveUser: resolveLocalUser, readOnlyGroups: registry ? [registry] : [] });
};

/** The configuration of a host (the primary one by default): the environment's, with the host's settings over it. */
export const gitConfig = (host = primaryHost()) => {
  const config = gitConfigFromEnv({ ...process.env, GIT_PROVIDER: host });
  return withSettings(config, host, resolved().hosts[host]?.values ?? {});
};

/** What a host has as settings (`{}` when it has none): the default namespace, say. */
export const hostSettings = (host) => resolved().hosts[host]?.values ?? {};

/** What the interface calls things on a host (`HOST_TERMS`, and what the host is: its name, whether it runs pipelines). */
export const hostTerms = (host) => ({ ...(HOST_TERMS[host] ?? HOST_TERMS.local), name: hostDescriptor(host).label, pipelines: hostDescriptor(host).pipelines });

/** The kind of CI file the products of a host get: none where the host runs no pipelines. */
export const ciKindOf = (host) => (hostDescriptor(host).pipelines ? host : 'none');

/** The configuration with every host's settings in it (a package source reads more than one host): the primary one's `provider`. */
export const gitConfigAll = () => {
  let config = gitConfig();
  for (const [kind, host] of Object.entries(resolved().hosts)) {
    if (host.enabled) config = withSettings(config, kind, host.values);
  }
  return config;
};

/** The local host itself, not wrapped: what serves its repositories over HTTP needs its store. */
export const getLocalProvider = () => {
  const { dataDir, ...rest } = gitConfig('local').local;
  return new LocalProvider({ ...rest, dataDir, redirectUri: gitConfig('local').gitlab?.redirectUri });
};

export class GitHostUnavailableError extends Error {
  constructor(kind) {
    super(`The git host "${kind}" is not on in this LINEA: switch it on in linea.config.yml (gitHosts.${kind}) or in Settings, by an administrator.`);
    this.code = 'GIT_HOST_UNAVAILABLE';
    this.host = kind;
  }
}

/**
 * A provider of a host (`{ host }`; the primary one by default). Each call returns a new one, because a provider remembers what it did
 * so that `rollback()` can undo it: take one per operation.
 */
export const getGitProvider = ({ host } = {}) => {
  const kind = host ?? primaryHost();
  if (!enabledHosts().includes(kind)) throw new GitHostUnavailableError(kind);
  return createGitProvider(gitConfig(kind));
};

/** The hosts with their settings, resolved (secrets masked) and where each value came from: what the Settings page shows. */
export const describeGitHosts = () => {
  const { hosts, primary } = resolved();
  return {
    primary,
    primaryLocked: Boolean(declared.primary),
    hosts: HOST_KINDS.map((kind) => ({
      id: kind,
      enabled: hosts[kind].enabled,
      locked: hosts[kind].locked,
      terms: hostTerms(kind),
      schema: HOST_SCHEMAS[kind],
      values: maskSecrets(HOST_SCHEMAS[kind], hosts[kind].values),
      meta: hosts[kind].meta,
    })),
  };
};

/** The hosts as a `gitHosts:` block to keep (secrets as `${HOST_KEY}` placeholders): what the config download writes. */
export const exportGitHosts = () => {
  const { hosts, primary } = resolved();
  return {
    primary,
    hosts: HOST_KINDS.filter((kind) => hosts[kind].enabled).map((kind) => ({
      id: kind,
      enabled: true,
      // what was set (file or Settings), not what the environment or the defaults gave: those stay where they are; a secret is a placeholder
      // named after the variable the setting reads, so that the same environment fills it in
      settings: Object.fromEntries(Object.entries(hosts[kind].values)
        .filter(([key]) => ['file', 'stored'].includes(hosts[kind].meta[key]?.source))
        .map(([key, value]) => [
          key,
          HOST_SCHEMAS[kind][key].type === 'secret' ? `\${${HOST_SCHEMAS[kind][key].env ?? `${kind}_${key}`.toUpperCase()}}` : value,
        ])),
    })),
  };
};

export class GitHostSettingsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.code = 'GIT_HOST_SETTINGS';
    this.status = status;
  }
}

const listeners = [];

/** `fn()` runs after an administrator changes the hosts: what was made for the old ones (registry, first accounts, caches) is made again. */
export const onGitHostsChange = (fn) => { listeners.push(fn); };
const changed = async () => {
  for (const fn of listeners) {
    try { await fn(); } catch (error) { console.error('[git hosts] after the change:', error.message); }
  }
};

/** The host a registry location names (`gitlab:linea/registry` -> `gitlab`), or null when it names none. */
export const registryHostOf = (location = registriesOf()[0]) => (location?.includes(':') ? location.slice(0, location.indexOf(':')) : null);

/** The registries this LINEA has, one per git host (`LINEA_REGISTRY`: one location, or several separated by commas). */
export function registriesOf(value = process.env.LINEA_REGISTRY) {
  return String(value ?? '').split(',').map((location) => location.trim()).filter(Boolean);
}

/** The registry of a host: the one on that host, else the first there is (a registry on one host serves the people on the others). `null` when there is none. */
export const registryFor = (host, value = process.env.LINEA_REGISTRY) => {
  const all = registriesOf(value);
  return all.find((location) => registryHostOf(location) === host) ?? all[0] ?? null;
};

// what an administrator pinned as the primary host, so that switching hosts on or off never moves the data that names none
const pinPrimary = async () => {
  if (!store || declared.primary || stored[PRIMARY_KEY]?.settings?.host) return;
  const entry = { settings: { host: primaryHost() } };
  await store.save(PRIMARY_KEY, entry);
  stored = { ...stored, [PRIMARY_KEY]: entry };
};

/** Makes a host the primary one: it has to be on, and the file may not declare another. */
export const setPrimaryHost = async (kind) => {
  if (!enabledHosts().includes(kind)) throw new GitHostSettingsError(`${kind} is not on.`, 409);
  // what names no host belongs to whichever is the primary one: while there is any, changing it would hand it over
  const unnamed = unpinned ? await unpinned() : 0;
  if (unnamed > 0 && kind !== primaryHost()) throw new GitHostSettingsError(`${unnamed} user(s), line(s) or product(s) name no host: they belong to the primary one and would change hands.`, 409);
  if (declared.primary) throw new GitHostSettingsError('The primary host is set in linea.config.yml.', 409);
  if (!store) throw new GitHostSettingsError('There is nowhere to keep the settings.', 500);
  if (kind === primaryHost()) return describeGitHosts();
  const entry = { settings: { host: kind } };
  await store.save(PRIMARY_KEY, entry);
  stored = { ...stored, [PRIMARY_KEY]: entry };
  await changed();
  return describeGitHosts();
};

/**
 * Saves what an administrator changed about a host (`{ enabled?, settings? }`); what the file declares cannot be changed.
 * Switching a host off needs `force` while people or lines are on it; `local` stays on by itself when it holds anything and another host is switched on.
 */
export const saveGitHost = async (kind, { enabled, settings = {}, force = false } = {}) => {
  if (!HOST_KINDS.includes(kind)) throw new GitHostSettingsError(`${kind} is not a git host.`, 404);
  if (!store) throw new GitHostSettingsError('There is nowhere to keep the settings.', 500);
  if (kind in declared) throw new GitHostSettingsError(`${kind} is set in linea.config.yml.`, 409);
  const schema = HOST_SCHEMAS[kind];
  // where the repositories of the local host are is not for a form: moving it would orphan every one of them (LINEA_REPOS_DIR, or the file)
  if (kind === 'local' && 'dataDir' in settings) throw new GitHostSettingsError('The folder of the repositories is set with LINEA_REPOS_DIR or gitHosts.local.dataDir, not here.', 409);
  // a secret left empty, or sent back as it was shown, keeps the one saved; `{ clear: true }` forgets it; `null` on any other setting
  // forgets what was saved (back to the environment's value, or the default)
  const cleared = Object.entries(settings).filter(([key, value]) => (schema[key]?.type === 'secret' && value?.clear === true) || (schema[key]?.type !== 'secret' && value === null)).map(([key]) => key);
  const clean = Object.fromEntries(Object.entries(settings).filter(([key, value]) => (schema[key]?.type === 'secret' ? !(value === '' || value === null || value?.isSet !== undefined || value?.clear !== undefined) : value !== null)));
  const problems = validateSettings(schema, clean);
  if (problems.length) throw new GitHostSettingsError(problems.join('; '));
  const kept = { ...(stored[kind]?.settings ?? {}), ...clean };
  for (const key of cleared) delete kept[key];
  const next = { enabled: enabled === undefined ? stored[kind]?.enabled : Boolean(enabled), settings: kept };
  const before = enabledHosts();
  const trial = resolveGitHosts({ declared, stored: { ...stored, [kind]: next } });
  const after = HOST_KINDS.filter((other) => trial.hosts[other].enabled);

  // `local` is on only because nothing else was: keep it on, with what is there, when another host comes
  const keepLocal = kind !== 'local' && next.enabled === true && before.includes('local') && !after.includes('local')
    && stored.local?.enabled === undefined && !('local' in declared);
  if (keepLocal && usage && (await usage('local')).total > 0) {
    stored = { ...stored, local: { enabled: true, settings: stored.local?.settings ?? {} } };
    await store.save('local', stored.local);
    after.push('local');
  }

  // the address of a host that people and lines are on is not changed by a form without a yes: they would point at another server
  const identity = IDENTITY[kind];
  if (identity && identity in clean && clean[identity] !== resolved().hosts[kind].values[identity] && usage && trial.hosts[kind].enabled && before.includes(kind) && !force) {
    const preview = await usage(kind);
    if (preview.total > 0) {
      const error = new GitHostSettingsError(`${kind} has ${preview.lines} line(s), ${preview.products} product(s) and ${preview.users} person(s) on it: changing ${identity} points them at another server. Change it with force to confirm.`, 409);
      error.preview = preview;
      throw error;
    }
  }

  const missing = Object.entries(schema).filter(([key, spec]) => spec.required && trial.hosts[kind].enabled && trial.hosts[kind].values[key] === undefined).map(([key]) => key);
  if (missing.length) throw new GitHostSettingsError(`${kind} needs these settings first: ${missing.join(', ')}.`);

  if (before.includes(kind) && !after.includes(kind)) {
    // switching it off: someone has to be able to sign in, and what lives on it must not be lost by accident
    if (!after.some((other) => isUsable(other, trial.hosts[other].values))) {
      throw new GitHostSettingsError('At least one git host has to stay on: with none, nobody could sign in.', 409);
    }
    if (declared.primary === kind) throw new GitHostSettingsError(`${kind} is the primary host of linea.config.yml.`, 409);
    if (registriesOf().some((location) => registryHostOf(location) === kind)) throw new GitHostSettingsError(`${kind} holds the registry (LINEA_REGISTRY): the modules would be gone.`, 409);
    const preview = usage ? await usage(kind) : null;
    if (preview?.total > 0 && !force) {
      const error = new GitHostSettingsError(`${kind} has ${preview.lines} line(s), ${preview.products} product(s) and ${preview.users} person(s) on it: switch it off with force to confirm.`, 409);
      error.preview = preview;
      throw error;
    }
  }
  await pinPrimary();
  await store.save(kind, next);
  stored = { ...stored, [kind]: next };
  await changed();
  return describeGitHosts().hosts.find((host) => host.id === kind);
};

export { GIT_PROVIDER_METHODS, GitAuthError, GitError, hostDescriptor } from '@lbdudc/linea-git';
