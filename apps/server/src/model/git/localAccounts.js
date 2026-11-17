import { createHash } from 'node:crypto';
import { accountOfToken, tokenIsOf } from './localToken.js';
import bcrypt from 'bcrypt';
import User from '../entities/user.js';
import { instance } from '../../config/instanceSettings.js';

/**
 * Who the people of the `local` git host are: LINEA's own accounts (a user whose own host is `local`). Their token on that host is
 * the `accessToken` of the account, which is also what git asks for as a password; their password opens the web app.
 */

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt reads 72 bytes and ignores the rest: a longer password would be a shorter one that looks long
export const MAX_PASSWORD_BYTES = 72;

/** What is wrong with a password for a local account, or null. */
export const passwordProblem = (password) => {
  const text = String(password ?? '');
  const least = Math.max(MIN_PASSWORD_LENGTH, instance('minPasswordLength'));
  if (text.length < least) return `A password has at least ${least} characters.`;
  if (Buffer.byteLength(text) > MAX_PASSWORD_BYTES) return `A password has at most ${MAX_PASSWORD_BYTES} bytes.`;
  return null;
};

// the names that are the group of something else in the host: the registry's is `registry`
const RESERVED_USERNAMES = ['registry'];

/** Whether a name can be a local account: letters, digits, dots, dashes and underscores; it starts with a letter or digit and is not reserved. */
export const isValidUsername = (name) => typeof name === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(name)
  && !name.includes('..')
  && !/\.git$/i.test(name)
  && !RESERVED_USERNAMES.includes(name.toLowerCase());

const ofLocalHost = { gitHost: 'local' };

// Whose token it is is asked for on every call of the host (a page of lines asks dozens of times): the answer is kept a few seconds.
// What changes an account (a new password or token, switching it off, removing it) forgets it at once (`forgetLocalUsers`).
const KNOWN_FOR_MS = 5_000;
const KNOWN_MAX = 500;
const known = new Map(); // sha256(token) -> { user, until }
export const forgetLocalUsers = () => known.clear();

/** The account a local token belongs to, as the local provider wants it (`null` when none). */
export const resolveLocalUser = async (token) => {
  const id = accountOfToken(token);
  if (!id) return null;
  const key = createHash('sha256').update(`${process.env.JWT_SIGN_KEY}|${token}`).digest('hex'); // (a token is of the secret it was made with)
  const seen = known.get(key);
  if (seen && seen.until > Date.now()) return seen.user;
  const user = await User.findOne({ ...ofLocalHost, _id: id, disabled: { $ne: true } }).lean();
  const answer = user && tokenIsOf(user, token) ? { username: user.username, avatarUrl: user.avatarUrl, admin: Boolean(user.admin) } : null;
  // (only what is known to be an account: a wrong token is not kept, so guessing cannot fill the memory)
  if (answer) {
    if (known.size >= KNOWN_MAX) known.clear();
    known.set(key, { user: answer, until: Date.now() + KNOWN_FOR_MS });
  }
  return answer;
};

export const hashPassword = (password) => bcrypt.hash(password, 10);

// compared against something even when there is no account, so that the time taken does not say whether there is one
const NO_ACCOUNT = bcrypt.hashSync('no account', 10);

/** The account if `secret` is its password or its git token; `null` otherwise. */
export const authenticateLocal = async (username, secret) => {
  const user = await User.findOne({ ...ofLocalHost, username }).lean();
  // a git token is 64 hex digits: when that is what came, it is compared as it is (the slow hash of a password is not for every
  // request of a clone), and in constant time
  if (user && !user.disabled && accountOfToken(secret) === String(user._id) && tokenIsOf(user, secret)) {
    return { username: user.username, avatarUrl: user.avatarUrl, admin: Boolean(user.admin) };
  }
  const passwordOk = await bcrypt.compare(secret ?? '', user?.passwordHash ?? NO_ACCOUNT);
  if (!user || user.disabled || !passwordOk) return null;
  return { username: user.username, avatarUrl: user.avatarUrl, admin: Boolean(user.admin) };
};
