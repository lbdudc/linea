import User from '../entities/user.js';
import UserRepository from '../repositories/UserRepository.js';
import bcrypt from 'bcrypt';
import { AlreadyExistentUserError, IncorrectCredentialsError, UserNotFoundError } from '../errors/errors.js';
import { enabledHosts, getGitProvider, getLocalProvider, gitConfig, hostDescriptor, hostSettings, hostTerms, primaryHost } from '../git/index.js';
import { GitHostNotLinkedError, activeHostOf, hostOf, hostsOf, onHost, setIdentity, tokenFor, usernameOn } from '../git/hosts.js';
import { hashPassword, isValidUsername, passwordProblem } from '../git/localAccounts.js';
import { localTokenOf } from '../git/localToken.js';
import { clearGitTokenCache } from '../../rest/common/auth.js';
import Line from '../entities/line.js';
import { Container } from 'typedi';
import DataSource from '../connectors/DataSource.js';
import { getAdminUsernames } from '../connectors/properties.js';

/**
 * Logging in only proves the identity on the git host: the OAuth exchange plus a
 * `getUser` call against it. It deliberately does NOT gate on membership
 * of any particular group or project — what a user may see or do is decided per
 * resource by PermissionChecker, and the lines they get are the `spl`-topic
 * projects their own token can reach (LineService.findEnrolledLines).
 */
export default class UserService {
  dataSource = Container.get(DataSource);
  userRepository = Container.get(UserRepository);

  // The git host rotates the refresh token each time it is used: two logins of the same user at once (two tabs, a reload while the session
  // is being renewed) made all but the first fail with "incorrect credentials", which logged that tab out. They share one refresh, and a
  // refresh that has just been made is reused for a few seconds (a page asks for the session more than once as it opens).
  #logins = new Map();

  loginUserFromId = ({ userId }) => {
    const key = String(userId);
    const known = this.#logins.get(key);
    if (known && (known.running || Date.now() - known.at < 5_000)) return known.promise;
    const entry = { running: true, at: Date.now(), promise: null };
    entry.promise = this.#refreshLogin({ userId }).then(
      (user) => { entry.running = false; entry.at = Date.now(); return user; },
      (error) => { this.#logins.delete(key); throw error; },
    );
    this.#logins.set(key, entry);
    return entry.promise;
  };

  // what the person changes about themselves (an account added, the profile) must show in the session they ask for next, not the one just renewed
  #forgetLogin = (userId) => this.#logins.delete(String(userId));

  #refreshLogin = async ({ userId }) => {
    const session = await this.dataSource.startTransaction();
    let git;
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) throw new UserNotFoundError();
      if (user.disabled) throw new IncorrectCredentialsError();

      // their own host first (a failure there is a failed login), then the other hosts they signed in to (best effort: one that is
      // down or revoked must not log them out of LINEA)
      // (their own host being switched off is not a failed login while another host of theirs is on: they work there)
      const on = enabledHosts();
      if (on.includes(hostOf(user)) || !hostsOf(user).some((host) => on.includes(host))) {
        git = getGitProvider({ host: hostOf(user) });
        if (user.gitHost === 'local') {
          // an account of this server: its token is made, there is nothing to renew
          user.avatarUrl = (await git.getUser({ token: localTokenOf(user) })).avatarUrl ?? user.avatarUrl;
        } else {
          const tokens = await git.refreshToken({ refreshToken: user.refreshToken, accessToken: user.accessToken });
          user.accessToken = tokens.accessToken;
          // a host whose tokens do not expire gives no new refresh token: the old one stays
          user.refreshToken = tokens.refreshToken ?? user.refreshToken;
          user.avatarUrl = (await git.getUser({ token: user.accessToken })).avatarUrl;
        }
      }

      for (const identity of user.identities ?? []) await this.#refreshIdentity(identity);

      await this.userRepository.save(user, { session });
      await this.dataSource.commitTransaction(session);
      return user;
    } catch (error) {
      await this.dataSource.abortTransaction(session);
      await git?.rollback();
      throw error;
    }
  }

  async #refreshIdentity(identity) {
    try {
      const other = getGitProvider({ host: identity.host });
      const tokens = await other.refreshToken({ refreshToken: identity.refreshToken, accessToken: identity.accessToken });
      identity.accessToken = tokens.accessToken;
      identity.refreshToken = tokens.refreshToken ?? identity.refreshToken;
    } catch (error) {
      console.warn(`[login] the ${identity.host} token of ${identity.username} could not be renewed:`, error.message);
    }
  }

  // ── the accounts of the `local` host: LINEA's own, with a password ───────────────────────────────────────────────────

  /** Signs in with the username and password of a local account. */
  loginLocal = async ({ username, password }) => {
    const user = await this.userRepository.findByUsername(username);
    const ok = await bcrypt.compare(password ?? '', user?.passwordHash ?? NO_ACCOUNT);
    if (!user || user.gitHost !== 'local' || !ok || user.disabled) throw new IncorrectCredentialsError();
    return user;
  }

  /** A new account on the local host. `admin` ones can make others and change the settings. */
  createLocalUser = async ({ username, password, admin = false }) => {
    if (!enabledHosts().includes('local')) throw new LocalHostOffError();
    if (!isValidUsername(username)) throw new InvalidUsernameError(username);
    const problem = passwordProblem(password);
    if (problem) throw new WeakPasswordError(problem);
    if (await this.userRepository.findByUsername(username)) throw new AlreadyExistentUserError();
    const user = new User({ username, gitHost: 'local', passwordHash: await hashPassword(password), admin: Boolean(admin) });
    await this.userRepository.save(user);
    return user;
  }

  /** A new password for a local account. Its git token changes too: what was open with the old one is closed. */
  setLocalPassword = async ({ userId, password }) => {
    const problem = passwordProblem(password);
    if (problem) throw new WeakPasswordError(problem);
    const user = await this.userRepository.findById(userId);
    if (!user || user.gitHost !== 'local') throw new UserNotFoundError();
    user.passwordHash = await hashPassword(password);
    user.gitTokenVersion = (user.gitTokenVersion ?? 0) + 1;
    user.activeSessions = [];
    await this.userRepository.save(user);
    // what was open with the old token is closed on the API too, not after the minutes the cache keeps it
    clearGitTokenCache();
    this.#forgetLogin(userId);
    return user;
  }

  /** A person changes their own password: they have to know the one they have. Their git token changes, the session they asked from goes on and their other sessions end. */
  changeOwnPassword = async ({ userId, currentPassword, newPassword, token }) => {
    const user = await this.userRepository.findById(userId);
    if (!user || user.gitHost !== 'local') throw new UserNotFoundError();
    if (!(await bcrypt.compare(currentPassword ?? '', user.passwordHash ?? NO_ACCOUNT))) throw new IncorrectCredentialsError();
    const problem = passwordProblem(newPassword);
    if (problem) throw new WeakPasswordError(problem);
    user.passwordHash = await hashPassword(newPassword);
    user.gitTokenVersion = (user.gitTokenVersion ?? 0) + 1;
    await this.userRepository.save(user);
    clearGitTokenCache();
    this.#forgetLogin(userId);
    if (token) await this.revokeSessions({ userId, others: true, token });
    return user;
  }

  /** A new git token for a local account (the old one stops working at once): for the person whose token leaked. Shown once, here. */
  regenerateGitToken = async ({ userId }) => {
    const user = await this.userRepository.findById(userId);
    if (!user || user.gitHost !== 'local') throw new UserNotFoundError();
    user.gitTokenVersion = (user.gitTokenVersion ?? 0) + 1;
    await this.userRepository.save(user);
    clearGitTokenCache();
    this.#forgetLogin(userId);
    return localTokenOf(user);
  }

  /** The people who can sign in here, for an administrator. */
  listUsers = async () => {
    const on = enabledHosts();
    return (await User.find().sort({ username: 1 }).lean()).map(({ _id, username, admin, gitHost, avatarUrl, createdAt, disabled }) => {
      const host = gitHost ?? primaryHost();
      // `hostOff`: nobody can sign in with this account until its host is on again
      return { id: _id, username, admin: Boolean(admin), host, hostOff: !on.includes(host), disabled: Boolean(disabled), avatarUrl, createdAt };
    });
  };

  /** Makes the accounts of `ADMIN_USERS` on the local host (with `LINEA_ADMIN_PASSWORD`) when there are none yet: someone has to be able to sign in. */
  ensureLocalAdmins = async ({ env = process.env } = {}) => {
    if (!enabledHosts().includes('local')) return [];
    const made = [];
    for (const username of getAdminUsernames()) {
      const existing = await this.userRepository.findByUsername(username);
      if (existing) {
        // a person of another host with that name is not the local administrator: say so, because nobody will be able to sign in as one
        if (existing.gitHost && existing.gitHost !== 'local') console.warn(`[accounts] ${username} is in ADMIN_USERS, but the name is taken by a ${existing.gitHost} account: no local administrator was made.`);
        continue;
      }
      if (!env.LINEA_ADMIN_PASSWORD) {
        console.warn(`[accounts] ${username} is an administrator (ADMIN_USERS) but has no account on the local host: set LINEA_ADMIN_PASSWORD to make it.`);
        continue;
      }
      try {
        await this.createLocalUser({ username, password: env.LINEA_ADMIN_PASSWORD, admin: true });
      } catch (error) {
        // a password that is too short, say: the server still starts, and the log says what to fix
        console.error(`[accounts] could not make the local administrator ${username}: ${error.message}`);
        continue;
      }
      made.push(username);
      console.info(`[accounts] made the local administrator ${username}`);
    }
    return made;
  }

  /** Signs in with the code a host's OAuth page gave back. `host` is the primary one when not said. */
  loginUserFromGitLab = async ({ code, host = primaryHost() }) => {
    const goodURL = getGitProvider({ host }).authConfig().redirectUri.replace(/\s/g, '');
    return this.#exchangeCodeAndUpsertUser({ host, code, redirectUri: goodURL, logLabel: `[loginFromGitLab ${host}]` });
  }

  loginUserFromGitLabNative = async ({ code, redirect_uri: redirectUri, host = primaryHost() }) => {
    return this.#exchangeCodeAndUpsertUser({ host, code, redirectUri, logLabel: `[loginFromGitLabNative ${host}]` });
  }

  /** Adds an account on another host to the user who is signed in (the same person on GitLab and on GitHub). */
  linkIdentity = async ({ userId, host, code }) => {
    const redirectUri = getGitProvider({ host }).authConfig().redirectUri.replace(/\s/g, '');
    const user = await this.#exchangeCodeAndUpsertUser({ host, code, redirectUri, linkUserId: userId, logLabel: `[linkIdentity ${host}]` });
    this.#forgetLogin(userId);
    return user;
  }

  // changes that could leave nobody to administer happen one at a time: two demotions at once must not both find "another admin"
  #adminChanges = Promise.resolve();
  #exclusively = (fn) => {
    const run = this.#adminChanges.then(fn, fn);
    this.#adminChanges = run.catch(() => undefined);
    return run;
  };

  // administrators other than `userId` who can sign in now: not disabled, and on a host that is on
  #otherAdmins = (userId) => User.countDocuments({ admin: true, disabled: { $ne: true }, _id: { $ne: userId }, $or: enabledHosts().map((host) => onHost(host)) });

  /** Makes a person an administrator, or takes it away; someone has to be left who can change the settings. */
  setAdmin = ({ userId, admin }) => this.#exclusively(async () => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    if (!admin && user.admin && (await this.#otherAdmins(user._id)) < 1) throw new LastAdminError();
    user.admin = Boolean(admin);
    await this.userRepository.save(user);
    return user;
  });

  /** Switches an account off (it signs in nowhere, its sessions and tokens stop) or on again. */
  setDisabled = ({ userId, disabled }) => this.#exclusively(async () => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    if (disabled && user.admin && (await this.#otherAdmins(user._id)) < 1) throw new LastAdminError();
    user.disabled = Boolean(disabled);
    if (disabled) user.activeSessions = [];
    await this.userRepository.save(user);
    clearGitTokenCache();
    this.#forgetLogin(userId);
    return user;
  });

  /**
   * Removes a person. What they own on the local host goes to `transferTo` (another account) or, with none, to a name nobody can sign in
   * with, so that a new account with the same name does not inherit it; their lines go to `transferTo` too.
   */
  deleteUser = ({ userId, transferTo }) => this.#exclusively(async () => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    if (user.admin && (await this.#otherAdmins(user._id)) < 1) throw new LastAdminError();
    const heir = transferTo ? await this.userRepository.findByUsername(transferTo) : null;
    if (transferTo && (!heir || String(heir._id) === String(user._id))) throw new UserNotFoundError();
    if (user.gitHost === 'local' && enabledHosts().includes('local')) {
      await getLocalProvider().transferOwnership({ from: user.username, to: heir ? heir.username : `deleted:${user.username}` });
    }
    if (heir) await Line.updateMany({ ownerId: user._id }, { $set: { ownerId: heir._id } });
    await User.deleteOne({ _id: user._id });
    clearGitTokenCache();
    this.#forgetLogin(userId);
  });

  /** The session a token belongs to (its sign-in), or null. */
  sessionOfToken = async ({ userId, token }) => {
    if (!token) return null;
    const user = await User.findOne({ _id: userId, 'activeSessions.token': token }, { 'activeSessions.$': 1 }).lean();
    return user?.activeSessions?.[0] ?? null;
  }

  /** The sign-ins of a person: one per `sessionId`, the newest token's data, without the tokens. `current` marks the one asking. */
  listSessions = async ({ userId, token }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const now = new Date();
    const mine = (user.activeSessions ?? []).find((session) => session.token === token);
    const bySession = new Map();
    for (const session of user.activeSessions ?? []) {
      if (session.expiresAt <= now) continue;
      const id = session.sessionId ?? String(session._id);
      const seen = bySession.get(id);
      if (!seen || (session.renewedAt ?? 0) > (seen.lastActive ?? 0)) {
        bySession.set(id, { id, signedInAt: session.signedInAt ?? session.renewedAt, lastActive: session.renewedAt, userAgent: session.userAgent ?? null, ip: session.ip ?? null, current: mine ? (mine.sessionId ?? String(mine._id)) === id : false });
      }
    }
    return [...bySession.values()].sort((a, b) => new Date(b.lastActive ?? 0) - new Date(a.lastActive ?? 0));
  }

  /** Ends one sign-in (`id`), all the others (`others`, with the `token` of the one that stays), or every one. */
  revokeSessions = async ({ userId, id, others = false, token }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const idOf = (session) => session.sessionId ?? String(session._id);
    const keep = others ? (user.activeSessions ?? []).find((session) => session.token === token) : null;
    const gone = (user.activeSessions ?? []).filter((session) => (id ? idOf(session) === id : !keep || idOf(session) !== idOf(keep))).map((session) => session.token);
    if (gone.length) await User.updateOne({ _id: userId }, { $pull: { activeSessions: { token: { $in: gone } } } });
  }

  /** Chooses the host LINEA shows (the profile): one the person is signed in to and that is on. */
  setActiveHost = async ({ userId, host }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    if (!hostsOf(user).includes(host) || !enabledHosts().includes(host)) throw new GitHostNotLinkedError(host);
    user.activeHost = host;
    await this.userRepository.save(user);
    this.#forgetLogin(userId);
    return user;
  }

  /** Forgets the account on a host; the one the user's own login is of cannot go (it is who they are here). */
  unlinkIdentity = async ({ userId, host }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    if (hostOf(user) === host) throw new GitHostIsOwnError(host);
    user.identities = user.identities.filter((identity) => identity.host !== host);
    if (user.activeHost === host) user.activeHost = undefined;
    await this.userRepository.save(user);
    this.#forgetLogin(userId);
    return user;
  }

  // a name no other person has: their name on the host, else with the host after it (two people may be "ana" on different hosts)
  async #freeUsername(base, host) {
    for (const candidate of [base, `${base}@${host}`]) {
      if (!(await this.userRepository.findByUsername(candidate))) return candidate;
    }
    for (let n = 2; ; n += 1) {
      if (!(await this.userRepository.findByUsername(`${base}@${host}${n}`))) return `${base}@${host}${n}`;
    }
  }

  #exchangeCodeAndUpsertUser = async ({ host, code, redirectUri, linkUserId, logLabel }) => {
    const session = await this.dataSource.startTransaction();
    const git = getGitProvider({ host });
    try {
      const { accessToken, refreshToken } = await git.exchangeCode({ code, redirectUri });
      const userData = await git.getUser({ token: accessToken });
      const account = { host, hostUsername: userData.username, primary: primaryHost() };

      let user;
      if (linkUserId) {
        user = await this.userRepository.findById(linkUserId);
        if (!user) throw new UserNotFoundError();
        const holder = await this.userRepository.findByHostAccount(account);
        if (holder && String(holder._id) !== String(user._id)) throw new GitHostAccountTakenError(host);
      } else {
        user = await this.userRepository.findByHostAccount(account);
        if (!user) user = new User({ username: await this.#freeUsername(userData.username, host), gitHost: host });
      }

      if (user.disabled) throw new IncorrectCredentialsError();

      setIdentity(user, host, { accessToken, refreshToken, username: userData.username, avatarUrl: userData.avatarUrl });
      if (hostOf(user) !== host) user.markModified('identities');
      if (user.avatarUrl === undefined) user.avatarUrl = userData.avatarUrl;
      const admins = getAdminUsernames();
      if (admins.includes(user.username) || admins.includes(`${host}:${userData.username}`)) user.admin = true;

      await this.userRepository.save(user, { session });

      await this.dataSource.commitTransaction(session);

      return user;
    } catch (error) {
      await this.dataSource.abortTransaction(session);
      await git.rollback();
      console.error(`${logLabel} error:`, error.constructor.name, error.message);
      throw error;
    }
  }

  /**
   * What a terminal needs to work on a git host as this user: the host, and the user's own token (renewed first, as signing in
   * again does). Only ever given to the user it belongs to: the CLI uses it for `git clone/push` and to open merge/pull requests.
   * `host` is the one they are working on (their profile) when not said.
   */
  getGitCredentials = async ({ userId, host }) => {
    const user = await this.loginUserFromId({ userId });
    const wanted = host ?? activeHostOf(user);
    const config = gitConfig(wanted);
    return {
      provider: config.provider,
      host: hostDescriptor(config.provider).endpoints(config),
      username: usernameOn(user, wanted),
      token: tokenFor(user, wanted),
    };
  }

  /**
   * What the login page needs: the hosts people can sign in with (each with its OAuth app and where to send the browser) and the
   * primary one.
   */
  getConfig = () => {
    const hosts = enabledHosts().flatMap((host) => {
      try {
        const { kind, clientId, redirectUri, url, authorizeUrl, scope } = getGitProvider({ host }).authConfig();
        // a host that gives a code but has no OAuth application has no way in: offering its button would only fail
        if (hostDescriptor(host).oauth && !clientId) return [];
        // `defaultNamespace`: where the form that makes an SPL starts on this host (the host plugin's setting)
        return [{ id: host, provider: kind, clientId, redirectUri, url, authorizeUrl, scope, defaultNamespace: hostSettings(host).defaultNamespace || null, terms: hostTerms(host) }];
      } catch {
        return []; // on, but not set up yet (no address): it has no button
      }
    });
    return { hosts, primary: hosts.find((entry) => entry.id === primaryHost())?.id ?? hosts[0]?.id ?? primaryHost() };
  }
}

// compared against something even when there is no account, so that the time taken does not say whether there is one
const NO_ACCOUNT = bcrypt.hashSync('no account', 10);

export class WeakPasswordError extends Error {
  constructor(message = 'A password has at least 8 characters.') {
    super(message);
    this.code = 'WEAK_PASSWORD';
  }
}

export class InvalidUsernameError extends Error {
  constructor(username) {
    super(`"${username}" cannot be an account name: letters, digits, dots, dashes and underscores, starting with a letter or digit (and not "registry").`);
    this.code = 'INVALID_USERNAME';
  }
}

export class LocalHostOffError extends Error {
  constructor() {
    super('The local git host is not on: there are no accounts to make.');
    this.code = 'GIT_HOST_UNAVAILABLE';
    this.host = 'local';
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('There must be at least one administrator.');
    this.code = 'LAST_ADMIN';
  }
}

export class GitHostIsOwnError extends Error {
  constructor(host) {
    super(`${host} is the host this person signs in to LINEA with: it cannot be removed.`);
    this.code = 'GIT_HOST_IS_OWN';
  }
}

export class GitHostAccountTakenError extends Error {
  constructor(host) {
    super(`That ${host} account already belongs to another person here.`);
    this.code = 'GIT_HOST_ACCOUNT_TAKEN';
  }
}

Container.set(UserService, new UserService());