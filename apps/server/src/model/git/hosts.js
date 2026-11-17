import { enabledHosts, hostDescriptor, primaryHost } from './index.js';
import { localTokenOf } from './localToken.js';

/**
 * Who is who on which git host. A user has one login on LINEA and may have signed in to more than one host: the host their own
 * `username` and `accessToken` are of (`gitHost`, else the primary host) and the others, in `identities`. A line, and the
 * products of it, live on one host (`gitHost`, else the primary host).
 */

/** The host of a line, a product, a user or a provider; a bare string is the host itself. */
export const hostOf = (subject) => {
  if (typeof subject === 'string') return subject;
  // a provider says its host as `kind` (a line's `kind` is plain/project/modular: not that)
  if (typeof subject?.authConfig === 'function') return subject.kind;
  return subject?.gitHost || primaryHost();
};

export class GitHostNotLinkedError extends Error {
  constructor(host) {
    super(`This person has not signed in to ${host}.`);
    this.code = 'GIT_HOST_NOT_LINKED';
    this.host = host;
  }
}

/** What a user is on a host: `{ host, username, accessToken, refreshToken, avatarUrl }`, or null when they never signed in to it. */
export const identityOf = (user, host) => {
  if (!user) return null;
  if (hostOf(user) === host) {
    // (a local account's token is made, not kept)
    return { host, username: user.hostUsername ?? user.username, accessToken: hostDescriptor(host).ownsAccounts && user.gitHost === host ? localTokenOf(user) : user.accessToken, refreshToken: user.refreshToken, avatarUrl: user.avatarUrl };
  }
  return user.identities?.find((identity) => identity.host === host) ?? null;
};

/** The hosts a user has signed in to. */
export const hostsOf = (user) => [hostOf(user), ...(user.identities ?? []).map((identity) => identity.host)];

/**
 * The host a person is working on now (their profile): LINEA shows one remote at a time. It is the one they chose (`activeHost`) while
 * they are still signed in to it and it is on, else their own host, else the first of theirs that is on.
 */
export const activeHostOf = (user, on = enabledHosts()) => {
  const mine = [...new Set(hostsOf(user))].filter((host) => on.includes(host));
  if (user.activeHost && mine.includes(user.activeHost)) return user.activeHost;
  return mine.includes(hostOf(user)) ? hostOf(user) : (mine[0] ?? hostOf(user));
};

/** The user's token for a host; `GitHostNotLinkedError` when they never signed in to it. */
export const tokenFor = (user, host) => {
  const identity = identityOf(user, host);
  if (!identity) throw new GitHostNotLinkedError(host);
  return identity.accessToken;
};

/** The user's name on a host (it can differ from `user.username` on the hosts that are not their own). */
export const usernameOn = (user, host) => identityOf(user, host)?.username ?? user.username;

/** Remembers tokens of a host on a user (`{ accessToken, refreshToken, username, avatarUrl }`): the user's own fields or an identity. */
export const setIdentity = (user, host, values) => {
  if (hostOf(user) === host) {
    if (values.username !== undefined && values.username !== user.username) user.hostUsername = values.username;
    if (values.accessToken !== undefined) user.accessToken = values.accessToken;
    if (values.refreshToken !== undefined) user.refreshToken = values.refreshToken;
    if (values.avatarUrl !== undefined) user.avatarUrl = values.avatarUrl;
    return;
  }
  const existing = user.identities.find((identity) => identity.host === host);
  if (existing) Object.assign(existing, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)));
  else user.identities.push({ host, ...values });
};

/** The user's token on each host they signed in to: `{ gitlab: '…', github: '…' }`, for what reads packages from more than one host. */
export const tokensOf = (user) => Object.fromEntries(hostsOf(user).map((host) => [host, identityOf(user, host)?.accessToken]).filter(([, token]) => token));

/** The query for what lives on a host: the primary host also has what never said which host it is on. */
export const onHost = (host, field = 'gitHost') => (host === primaryHost()
  ? { $or: [{ [field]: host }, { [field]: { $exists: false } }, { [field]: null }] }
  : { [field]: host });

/** The user's token for a host when they have one, else `fallback`: the registry may be on another host than the packages. */
export const tokenOrElse = (user, host, fallback) => {
  try {
    return host ? tokenFor(user, host) : fallback;
  } catch (error) {
    if (error instanceof GitHostNotLinkedError) return fallback;
    throw error;
  }
};
