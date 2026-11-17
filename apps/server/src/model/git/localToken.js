import crypto from 'node:crypto';
import { getJwtSignKey } from '../connectors/properties.js';

/**
 * The git token of a local account. It is not kept: it is made from the account and a version number with the server's secret
 * (`<24 hex: the account><40 hex: HMAC>`, 64 hex like any token), so a copy of the database holds nothing that opens a repository.
 * Renewing it is raising the version; changing JWT_SIGN_KEY renews every one.
 */
const mac = (id, version) => crypto.createHmac('sha256', getJwtSignKey() ?? '').update(`linea-git-token|${id}|${version}`).digest('hex').slice(0, 40);

export const localTokenOf = (user) => `${String(user._id)}${mac(user._id, user.gitTokenVersion ?? 0)}`;

/** Whose token it could be (the account id it starts with), or null when it is not shaped like one. */
export const accountOfToken = (token) => (/^[0-9a-f]{64}$/.test(token ?? '') ? token.slice(0, 24) : null);

export const tokenIsOf = (user, token) => {
  const [given, known] = [Buffer.from(String(token ?? '')), Buffer.from(localTokenOf(user))];
  return given.length === known.length && crypto.timingSafeEqual(given, known);
};
