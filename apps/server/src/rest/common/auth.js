import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { IncorrectCredentialsError, PermissionError } from '../../model/errors/errors.js';
import User from '../../model/entities/user.js';
import { getJwtSignKey, getJwtExpirationSeconds } from '../../model/connectors/properties.js';
import { Container } from 'typedi';
import UserRepository from '../../model/repositories/UserRepository.js';
import { enabledHosts, getGitProvider, primaryHost } from '../../model/git/index.js';
import { onError } from './onError.js';
import { instance } from '../../config/instanceSettings.js';
import { forgetLocalUsers } from '../../model/git/localAccounts.js';

export const generateToken = ({ userId }) => {
  // a token of its own each time (two signed in the same second would be the same string, and ending one would end both)
  return jwt.sign({ userId }, getJwtSignKey(), { expiresIn: getJwtExpirationSeconds(), jwtid: randomUUID() });
};

// jwt.verify's callback form swallows anything the callback throws, so verify
// through a promise that only ever settles, and do the DB work outside it —
// otherwise a rejection here leaves the request hanging forever.
const verifyToken = (token) => new Promise((resolve, reject) => {
  jwt.verify(token, getJwtSignKey(), (err, decoded) => {
    if (err) reject(new IncorrectCredentialsError());
    else resolve(decoded);
  });
});

// A service acting for a person (e.g. an external tool with its own login) can present that person's git host token instead of a
// LINEA session: `Authorization: GitToken <token>`. The host vouches for who it is; LINEA only maps it to a LINEA user and never
// stores the presented token (git operations keep using the one saved at login).
const GIT_TOKEN_SCHEME = 'GitToken';
const GIT_TOKEN_TTL_MS = 5 * 60 * 1000;
const GIT_TOKEN_CACHE_MAX = 1000;
const gitTokenCache = new Map(); // sha256(token) -> { userId, expiresAt }

export const clearGitTokenCache = () => {
  gitTokenCache.clear();
  forgetLocalUsers();
};

// The service of a plugin (the agents, say) acts for a person without that person's token: `Authorization: Service <key>` and
// `X-Act-As: <username>`. The keys are the deployment's (`LINEA_SERVICE_KEYS=id:secret,id#scope+scope:secret,...`) and those the
// plugins bring (`addServiceKeys`): whoever has one can act as anyone who has logged in to LINEA, so it stays on the server side, between
// the two. A key may appear more than once for an id (the old and the new one while it is rotated). It acts on what a person can do;
// the routes of an administrator (settings, plugins, accounts) need a key with the scope `admin`. Nothing is created or stored for it.
const SERVICE_SCHEME = 'Service';

let extraServiceKeys = () => [];

/** `fn()` gives more service keys, `[{ id, secret, scopes? }]`: the plugins' own (their `serviceKey` setting). */
export const addServiceKeys = (fn) => { extraServiceKeys = fn; };

const declaredServiceKeys = () => (process.env.LINEA_SERVICE_KEYS ?? '').split(',').flatMap((entry) => {
  const at = entry.indexOf(':');
  if (at <= 0) return [];
  const [id, scopes = ''] = entry.slice(0, at).trim().split('#');
  return [{ id, secret: entry.slice(at + 1), scopes: scopes.split('+').filter(Boolean) }];
});

/** `{ id, scopes }` of the service this key is of, or null. */
export const serviceOfKey = (key) => {
  const wanted = Buffer.from(String(key ?? ''));
  for (const { id, secret, scopes = [] } of [...declaredServiceKeys(), ...extraServiceKeys()]) {
    const known = Buffer.from(String(secret ?? ''));
    if (known.length > 0 && known.length === wanted.length && timingSafeEqual(known, wanted)) return { id, scopes };
  }
  return null;
};

const userFromService = async (req, key, { admin = false } = {}) => {
  const service = serviceOfKey(key);
  const username = req.headers['x-act-as'];
  if (!service || !username) throw new IncorrectCredentialsError();
  // the routes of an administrator are not for a service, whoever it acts as, unless its key says so
  if (admin && !service.scopes.includes('admin')) throw new PermissionError();
  const user = await User.findOne({ username: String(username) });
  if (!user) throw new PermissionError(); // a person that never logged in to LINEA is not created here
  req.serviceId = service.id;
  console.info(`[service] ${service.id} as ${user.username}: ${req.method} ${req.originalUrl}`);
  return user;
};

const parseAuthorization = (header) => {
  const [scheme, credential] = (header ?? '').split(' ');
  return { scheme, credential };
};

// `X-Git-Host: github` says which host vouches for the token; without it, the primary one
const hostFromHeader = (req) => {
  const host = req.headers['x-git-host'];
  if (host === undefined) return primaryHost();
  if (!enabledHosts().includes(String(host))) throw new IncorrectCredentialsError();
  return String(host);
};

const userIdFromGitToken = async (gitToken, host = primaryHost()) => {
  if (!gitToken) throw new IncorrectCredentialsError();
  const key = createHash('sha256').update(`${host}|${gitToken}`).digest('hex');
  const now = Date.now();

  const hit = gitTokenCache.get(key);
  if (hit && hit.expiresAt > now) return hit.userId;
  gitTokenCache.delete(key);

  let hostUser;
  try {
    hostUser = await getGitProvider({ host }).getUser({ token: gitToken });
  } catch {
    throw new IncorrectCredentialsError();
  }

  const user = hostUser?.username ? await Container.get(UserRepository).findByHostAccount({ host, hostUsername: hostUser.username, primary: primaryHost() }) : null;
  if (!user) throw new PermissionError(); // a valid host user that never logged in to LINEA is not created here

  if (gitTokenCache.size >= GIT_TOKEN_CACHE_MAX) gitTokenCache.delete(gitTokenCache.keys().next().value);
  const userId = String(user._id);
  gitTokenCache.set(key, { userId, expiresAt: now + GIT_TOKEN_TTL_MS });
  return userId;
};

// Who is asking: the session (the JWT LINEA gave at login, still among the person's open sessions), a git host token or a service.
// A person whose account was disabled is none of them.
const authenticate = async (req, { admin = false } = {}) => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) throw new IncorrectCredentialsError();

  const { scheme, credential } = parseAuthorization(authorizationHeader);
  let user;
  if (scheme === GIT_TOKEN_SCHEME) {
    user = await User.findById(await userIdFromGitToken(credential, hostFromHeader(req)));
  } else if (scheme === SERVICE_SCHEME) {
    user = await userFromService(req, credential, { admin });
  } else {
    const token = authorizationHeader.split(' ')[1];
    const decoded = await verifyToken(token);

    user = await User.findById(decoded.userId);
    const now = new Date();
    const valid = user?.activeSessions?.some(s => s.token === token && s.expiresAt > now);
    if (!valid) throw new IncorrectCredentialsError();

    // Drop expired sessions with a targeted atomic update. Reassigning the
    // array and calling save() on every request raced concurrent requests into
    // mongoose VersionErrors, and wrote on requests that changed nothing.
    if (user.activeSessions.some(s => s.expiresAt <= now)) {
      await User.updateOne({ _id: user._id }, { $pull: { activeSessions: { expiresAt: { $lte: now } } } });
    }
  }
  if (!user) throw new IncorrectCredentialsError();
  if (user.disabled) throw new PermissionError();
  if (admin && !user.admin) throw new PermissionError();
  return String(user._id);
};

export const requireAuth = async (req, res, next) => {
  try {
    req.userId = await authenticate(req);
    next();
  } catch (error) {
    onError(error, req, res);
  }
};

export const requireAdmin = async (req, res, next) => {
  try {
    req.userId = await authenticate(req, { admin: true });
    next();
  } catch (error) {
    onError(error, req, res);
  }
};

/** After `requireAuth`: where an administrator limited an action to administrators (`setting`: 'everyone' or 'admins'), the rest are refused. */
export const requireAdminIf = (setting) => async (req, res, next) => {
  try {
    if (instance(setting) === 'admins' && !(await User.exists({ _id: req.userId, admin: true }))) throw new PermissionError();
    next();
  } catch (error) {
    onError(error, req, res);
  }
};
