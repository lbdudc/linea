import { createHmac, timingSafeEqual } from 'node:crypto';

/** The version of the plugin interface (`requires.hostApi`) this SDK was written for. */
export const HOST_API_VERSION = '1.0.0';

/**
 * Checks the `X-Linea-Signature` header of an event LINEA sent to `remote.events`: `sha256=<hex>`, the HMAC-SHA256 of the *raw* body
 * keyed by `EVENT_WEBHOOK_SECRET`. Check the bytes you received, not a re-serialised JSON.
 */
export const verifyEventSignature = (secret, rawBody, header) => {
  if (!secret || !header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(String(header));
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Signs a body the way LINEA does (for tests of a receiver). */
export const signEvent = (secret, rawBody) => `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

/**
 * A client for LINEA's API from the service of a plugin: `Authorization: Service <key>` and `X-Act-As: <username>` (the person it acts for
 * must have logged in to LINEA once). `key` is the value of the plugin's `serviceKey` setting.
 */
export const serviceClient = ({ baseUrl, key, fetchFn = globalThis.fetch }) => {
  if (!baseUrl || !key) throw new Error('serviceClient needs baseUrl and key');
  const request = async (path, { actAs, method = 'GET', body, headers = {}, signal = AbortSignal.timeout(10_000) } = {}) => {
    if (!actAs) throw new Error('serviceClient: say who it acts as (actAs)');
    // (a path with a leading slash replaces any path in `baseUrl`: give LINEA's address without one, or a path without it)
    const response = await fetchFn(new URL(path, baseUrl), {
      method,
      headers: { ...headers, Authorization: `Service ${key}`, 'X-Act-As': actAs, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text */ }
    if (!response.ok) throw Object.assign(new Error(`LINEA answered ${response.status} to ${method} ${path}`), { status: response.status, data });
    return data;
  };
  return { request, get: (path, options) => request(path, options), post: (path, body, options) => request(path, { ...options, method: 'POST', body }) };
};

/**
 * The answer to LINEA's health check (`remote.health`): any 2xx means up. Use it as a `node:http` handler body, or in Express:
 * `app.get('/health', (req, res) => res.status(200).json(healthStatus({ version })))`.
 */
export const healthStatus = (extra = {}) => ({ status: 'ok', ...extra });

/** Reads the raw body of a `node:http` request (needed to check a signature). */
export const readBody = (request, limit = 1_000_000) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); request.destroy(); return; }
    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});
