import { instance } from '../../config/instanceSettings.js';

const windows = new Map();

/**
 * Simple in-process per-user rate limiter.
 * Must be placed AFTER requireAuth so req.userId is available.
 */
export const rateLimit = (maxCalls, windowMs) => (req, res, next) => {
  const key = req.userId;
  if (!key) return next();

  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + windowMs };
  }
  entry.count++;
  windows.set(key, entry);

  if (entry.count > maxCalls) {
    return res.status(429).json({ message: 'Too many requests. Please wait before retrying.' });
  }
  next();
};

/**
 * Failed sign-ins, counted: after too many for one person from one address, or from one address altogether, the next ones are refused for a
 * while (a password cannot be guessed at the speed of the server). In memory: it starts over with the process, like the sessions do not.
 */
export const createFailureLimiter = ({ windowMs: windowOf = 15 * 60_000, perKey: perKeyOf = 10, perIp = 200, now = () => Date.now() } = {}) => {
  // the limits may be functions: an administrator changes them while the server runs
  const valueOf = (limit) => (typeof limit === 'function' ? limit() : limit);
  const buckets = { key: new Map(), ip: new Map() };

  const fresh = (map, name) => {
    const entry = map.get(name);
    if (entry && now() - entry.first < valueOf(windowOf)) return entry;
    map.delete(name);
    return null;
  };

  const sweep = () => {
    if (buckets.key.size + buckets.ip.size < 10_000) return;
    for (const map of Object.values(buckets)) for (const name of map.keys()) fresh(map, name);
  };

  return {
    /** Why the attempt is refused (seconds to wait included), or null. */
    blocked({ ip, key }) {
      const windowMs = valueOf(windowOf);
      const perKey = valueOf(perKeyOf);
      const byKey = fresh(buckets.key, `${ip}|${key}`);
      const byIp = fresh(buckets.ip, ip);
      const hit = (byKey?.count ?? 0) >= perKey ? byKey : (byIp?.count ?? 0) >= perIp ? byIp : null;
      if (!hit) return null;
      return `Too many failed attempts: try again in ${Math.max(1, Math.ceil((hit.first + windowMs - now()) / 1000))} seconds`;
    },
    fail({ ip, key }) {
      sweep();
      for (const [map, name] of [[buckets.key, `${ip}|${key}`], [buckets.ip, ip]]) {
        const entry = fresh(map, name) ?? { first: now(), count: 0 };
        entry.count += 1;
        map.set(name, entry);
      }
    },
    reset({ ip, key }) {
      buckets.key.delete(`${ip}|${key}`);
    },
    clear() {
      buckets.key.clear();
      buckets.ip.clear();
    },
  };
};

/** The one the sign-in with a password and git over HTTP share. */
export const signInLimiter = createFailureLimiter({ windowMs: () => instance('lockMinutes') * 60_000, perKey: () => instance('maxFailedSignIns') });
