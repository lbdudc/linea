import UserService from '../../model/services/UserService.js';
import User from '../../model/entities/user.js';
import { generateToken } from '../common/auth.js';
import { getJwtExpirationSeconds } from '../../model/connectors/properties.js';
import { activeHostOf, hostsOf } from '../../model/git/hosts.js';
import { enabledHosts } from '../../model/git/index.js';
import { signInLimiter } from '../common/rateLimit.js';
import { IncorrectCredentialsError, TooManyAttemptsError } from '../../model/errors/errors.js';
import { asyncHandler } from '../common/asyncHandler.js';
import { Container } from 'typedi';
import { randomUUID } from 'node:crypto';
import { record } from '../../model/audit.js';
import LineService from '../../model/services/LineService.js';
import ProductService from '../../model/services/ProductService.js';

// the host a person works on, or null when none of theirs is on (the client says so instead of showing a remote that answers 503)
const bearerOf = (req) => req?.headers?.authorization?.split(' ')[1];

const usableActiveHost = (user) => {
  const host = activeHostOf(user);
  return enabledHosts().includes(host) ? host : null;
};

export default class UserController {
  userService = Container.get(UserService);

  // `renewal`: the page asks for a new token of the sign-in it already has (same session, not a new sign-in)
  #issueSession = async (userData, res, { req, renewal = false } = {}) => {
    const user = {userId: userData._id, username: userData.username, createdAt: userData.createdAt.getTime(), admin: userData.admin, avatarUrl: userData.avatarUrl, hosts: hostsOf(userData), activeHost: usableActiveHost(userData)};
    const token = generateToken(user);
    const expiresAt = new Date(Date.now() + getJwtExpirationSeconds() * 1000);
    const now = new Date();
    const previous = renewal ? await this.userService.sessionOfToken({ userId: userData._id, token: bearerOf(req) }) : null;
    const session = {
      token, expiresAt,
      sessionId: previous?.sessionId ?? randomUUID(),
      signedInAt: previous?.signedInAt ?? now,
      renewedAt: now,
      userAgent: String(req?.headers?.['user-agent'] ?? '').slice(0, 300) || undefined,
      ip: req?.ip,
    };
    // Atomic updates, not a rewrite of the array: two logins at once (two tabs, a page that renews while another opens) each rewrote
    // it from what they had read and the last one dropped the token of the other, which then got a 401 and sent that tab to the login.
    await User.updateOne({ _id: userData._id }, { $pull: { activeSessions: { expiresAt: { $lte: now } } } });
    await User.updateOne({ _id: userData._id }, { $push: { activeSessions: session } });
    // the sign-ins of administrators are the ones worth reading afterwards
    if (!previous && userData.admin) record({ userId: userData._id, action: 'auth.signin', ip: req?.ip });

    res.status(200).send({ token, user });
  };

  // The page asks for the lines and products of the user right after it logs in, and what GitLab answers to that is the slowest read
  // of every view: start it now, while the client is still loading its code, so that the answer is waiting in the cache.
  #warmUp = (userId) => {
    for (const read of [
      () => Container.get(LineService).findEnrolledLines({ userId }),
      () => Container.get(ProductService).findEnrolledProducts({ userId }),
    ]) {
      Promise.resolve().then(read).catch(() => {});
    }
  };

  loginUserFromId = asyncHandler(async (req, res) => {
    const userData = await this.userService.loginUserFromId(req);
    await this.#issueSession(userData, res, { req, renewal: true });
    this.#warmUp(userData._id);
  });

  loginLocal = asyncHandler(async (req, res) => {
    // a password is not guessed at the speed of the server: failures are counted per person and address
    const attempt = { ip: req.ip, key: String(req.body.username).toLowerCase() };
    const blocked = signInLimiter.blocked(attempt);
    if (blocked) throw new TooManyAttemptsError(blocked);
    let userData;
    try {
      userData = await this.userService.loginLocal(req.body);
    } catch (error) {
      if (error instanceof IncorrectCredentialsError) {
        signInLimiter.fail(attempt);
        // once, when the door closes, not for every attempt it then refuses
        if (signInLimiter.blocked(attempt)) record({ action: 'auth.lockout', target: attempt.key, ip: req.ip });
      }
      throw error;
    }
    signInLimiter.reset(attempt);
    await this.#issueSession(userData, res, { req });
    this.#warmUp(userData._id);
  });

  listUsers = asyncHandler(async (req, res) => {
    res.status(200).send(await this.userService.listUsers());
  });

  createLocalUser = asyncHandler(async (req, res) => {
    const user = await this.userService.createLocalUser(req.body);
    res.status(201).send({ id: user._id, username: user.username, admin: Boolean(user.admin), host: 'local' });
  });

  setAdmin = asyncHandler(async (req, res) => {
    const user = await this.userService.setAdmin({ userId: req.params.id, admin: req.body.admin });
    res.status(200).send({ id: user._id, username: user.username, admin: Boolean(user.admin) });
  });

  setDisabled = asyncHandler(async (req, res) => {
    const user = await this.userService.setDisabled({ userId: req.params.id, disabled: req.body.disabled });
    res.status(200).send({ id: user._id, username: user.username, disabled: Boolean(user.disabled) });
  });

  deleteUser = asyncHandler(async (req, res) => {
    await this.userService.deleteUser({ userId: req.params.id, transferTo: req.query.transferTo });
    res.status(204).send();
  });

  changeOwnPassword = asyncHandler(async (req, res) => {
    await this.userService.changeOwnPassword({ userId: req.userId, ...req.body, token: bearerOf(req) });
    res.status(204).send();
  });

  regenerateGitToken = asyncHandler(async (req, res) => {
    res.status(200).send({ token: await this.userService.regenerateGitToken({ userId: req.userId }) });
  });

  setLocalPassword = asyncHandler(async (req, res) => {
    await this.userService.setLocalPassword({ userId: req.params.id, password: req.body.password });
    res.status(204).send();
  });

  // a token of the host (a personal access token, or the git token of a LINEA account) as a way in, for people who have signed in before
  loginWithToken = asyncHandler(async (req, res) => {
    const attempt = { ip: req.ip, key: `token:${req.params.host}` };
    const blocked = signInLimiter.blocked(attempt);
    if (blocked) throw new TooManyAttemptsError(blocked);
    let userData;
    try {
      userData = await this.userService.loginWithToken({ host: req.params.host, token: req.body.token });
    } catch (error) {
      if (error instanceof IncorrectCredentialsError) signInLimiter.fail(attempt);
      throw error;
    }
    signInLimiter.reset(attempt);
    record({ userId: userData._id, action: 'auth.signin', detail: { method: 'token', host: req.params.host }, ip: req.ip });
    await this.#issueSession(userData, res, { req });
    this.#warmUp(userData._id);
  });

  startDevice = asyncHandler(async (req, res) => {
    const auth = await this.userService.startDeviceAuthorization({ host: req.params.host });
    res.status(200).send(auth);
  });

  // 202 while the person has not approved yet; then a session, like any other sign-in
  loginWithDevice = asyncHandler(async (req, res) => {
    const poll = await this.userService.pollDeviceAuthorization({ host: req.params.host, deviceCode: req.body.device_code, interval: req.body.interval });
    if (poll.status === 'pending') return res.status(202).send(poll);
    await this.#issueSession(poll.user, res, { req });
    this.#warmUp(poll.user._id);
  });

  linkIdentityNative = asyncHandler(async (req, res) => {
    const user = await this.userService.linkIdentity({ userId: req.userId, host: req.params.host, code: req.body.code, redirectUri: req.body.redirect_uri });
    res.status(200).send({ hosts: hostsOf(user), activeHost: usableActiveHost(user) });
  });

  linkIdentityDevice = asyncHandler(async (req, res) => {
    const poll = await this.userService.pollDeviceAuthorization({ host: req.params.host, deviceCode: req.body.device_code, interval: req.body.interval, linkUserId: req.userId });
    if (poll.status === 'pending') return res.status(202).send(poll);
    res.status(200).send({ hosts: hostsOf(poll.user), activeHost: usableActiveHost(poll.user) });
  });

  loginUserFromGitLab = asyncHandler(async (req, res) => {
    const userData = await this.userService.loginUserFromGitLab({ code: req.body.code, host: req.params.host });
    await this.#issueSession(userData, res, { req });
  });

  // the profile: the host LINEA shows the lines and products of. Answers like a session does, so the client takes the new `activeHost` from it.
  setProfile = asyncHandler(async (req, res) => {
    const user = await this.userService.setActiveHost({ userId: req.userId, host: req.body.host });
    res.status(200).send({ hosts: hostsOf(user), activeHost: usableActiveHost(user) });
  });

  linkIdentity = asyncHandler(async (req, res) => {
    const user = await this.userService.linkIdentity({ userId: req.userId, host: req.params.host, code: req.body.code });
    res.status(200).send({ hosts: hostsOf(user), activeHost: usableActiveHost(user) });
  });

  unlinkIdentity = asyncHandler(async (req, res) => {
    const user = await this.userService.unlinkIdentity({ userId: req.userId, host: req.params.host });
    res.status(200).send({ hosts: hostsOf(user), activeHost: usableActiveHost(user) });
  });

  loginUserFromGitLabNative = asyncHandler(async (req, res) => {
    const userData = await this.userService.loginUserFromGitLabNative({ ...req.body, host: req.params.host ?? req.body.host });
    await this.#issueSession(userData, res, { req });
  });

  // the sign-ins of the person (one per browser or device), without their tokens
  listSessions = asyncHandler(async (req, res) => {
    res.status(200).send(await this.userService.listSessions({ userId: req.userId, token: bearerOf(req) }));
  });

  // `?others=true`: all but the one asking
  revokeSessions = asyncHandler(async (req, res) => {
    await this.userService.revokeSessions({ userId: req.userId, id: req.params.id, others: req.query.others === 'true', token: bearerOf(req) });
    res.status(204).send();
  });

  // an administrator ends every sign-in of a person
  signOutEverywhere = asyncHandler(async (req, res) => {
    await this.userService.revokeSessions({ userId: req.params.id });
    res.status(204).send();
  });

  logout = asyncHandler(async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) await User.updateOne({ _id: req.userId }, { $pull: { activeSessions: { token } } });
    res.status(204).send();
  });

  getGitCredentials = asyncHandler(async (req, res) => {
    const credentials = await this.userService.getGitCredentials({ userId: req.userId, host: req.query.host });
    res.set('Cache-Control', 'no-store');
    res.status(200).send(credentials);
  });

  getConfig = asyncHandler(async (req, res) => {
    const config = this.userService.getConfig();
    res.status(200).send(config);
  });
}

Container.set(UserController, new UserController());
