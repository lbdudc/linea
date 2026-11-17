import { HOST_KINDS, HOST_SCHEMAS } from './gitHostSchemas.js';
import { resolveSettings } from './settings.js';

// what tells that a host is configured at all (the same the environment is read for): an address, an OAuth app
export const IDENTITY = { gitlab: 'url', github: 'clientId' };

/** Whether a host has what it is nothing without (GitLab's address, GitHub's OAuth app): the local host always. */
export const isUsable = (kind, values) => !IDENTITY[kind] || truthy(values[IDENTITY[kind]]);

/** Where the store keeps which host is the primary one (it is not a host). */
export const PRIMARY_KEY = '_primary';

const truthy = (value) => value !== undefined && value !== null && value !== '';

/**
 * Which git hosts this deployment has and how each is set, from what it says (`declared`: the `gitHosts:` block of linea.config.yml),
 * what an administrator saved (`stored`: host -> `{ enabled?, settings }`) and the environment.
 *
 * A host is on when the file says so (`enabled`, true unless it says otherwise), else when an administrator switched it, else when
 * the environment configures it (GitLab: an address; GitHub: an OAuth app; `GIT_PROVIDER` names the primary host and so puts it on).
 * `local` is also on when nothing else is: LINEA works on its own.
 *
 * Returns `{ hosts: { <kind>: { enabled, values, meta } }, primary }`.
 */
export const resolveGitHosts = ({ declared = {}, stored = {}, env = process.env } = {}) => {
  const hosts = {};
  const named = (env.GIT_PROVIDER ?? '').toLowerCase();
  for (const kind of HOST_KINDS) {
    const { enabled: fileEnabled, ...fileSettings } = declared[kind] ?? {};
    const { values, meta } = resolveSettings(HOST_SCHEMAS[kind], { file: fileSettings, stored: stored[kind]?.settings ?? {}, env });
    let enabled;
    if (kind in declared && declared[kind] !== null) enabled = fileEnabled !== false;
    else if (stored[kind]?.enabled !== undefined) enabled = Boolean(stored[kind].enabled);
    else enabled = kind !== 'local' && isUsable(kind, values);
    if (kind === named && !(kind in declared) && stored[kind]?.enabled === undefined) enabled = true;
    hosts[kind] = { enabled, values, meta, locked: kind in declared };
  }
  // with no other host, the repositories stay on this server
  // (a host switched on without what it needs, say GIT_PROVIDER with no address, does not count: nobody could sign in to it)
  if (!HOST_KINDS.some((kind) => kind !== 'local' && hosts[kind].enabled && isUsable(kind, hosts[kind].values)) && !('local' in declared && declared.local?.enabled === false) && stored.local?.enabled === undefined) {
    hosts.local.enabled = true;
  }
  const on = HOST_KINDS.filter((kind) => hosts[kind].enabled);
  // the file decides, then the one an administrator pinned (`stored._primary`), then GIT_PROVIDER: it never moves by itself
  const pinned = stored[PRIMARY_KEY]?.settings?.host;
  const wanted = [declared.primary, pinned, env.GIT_PROVIDER].map((name) => (typeof name === 'string' ? name.toLowerCase() : null)).find((name) => on.includes(name));
  const primary = wanted ?? (on[0] ?? 'local');
  return { hosts, primary };
};

/** The hosts a file may name (`gitHosts.<kind>`), to warn about the rest. */
export const knownHostKeys = ['primary', ...HOST_KINDS];
