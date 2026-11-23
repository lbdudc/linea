import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { ServiceRunner, ServiceBusyError, ServiceInputError } from '../../apps/server/src/plugins/ServiceRunner.js';

/**
 * The plugin runner: the one container of a deployment that holds the Docker socket. LINEA's server asks it, with a shared key, to
 * start, stop, restart, rebuild or take down the service a plugin declares (`service` in its plugin.json), to say how it is and to
 * show its logs. It does nothing else: it is given a plugin's id (never a path or a command), finds that plugin in `pluginsDir`
 * itself, and runs only `docker compose` with the plugin's own compose file.
 */
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// what the runner's own Docker needs is the runner's: LINEA's server cannot point compose at another daemon, file or program
const RESERVED = /^(PATH|HOME|USER|SHELL|LD_.*|DYLD_.*|DOCKER_.*|COMPOSE_.*|BUILDKIT_.*|NODE_.*)$/;
const MAX_BODY = 1024 * 1024;
const KINDS = ['start', 'stop', 'restart', 'rebuild', 'down'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The plugins of the folder that run a service: `{ id, dir, service }`, as their plugin.json say (read at each request: a pull is seen). */
export const findPlugin = (pluginsDir, id) => {
  if (!ID.test(id)) throw new HttpError(400, `"${id}" is not a plugin id.`);
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsDir, entry.name);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')); } catch { continue; }
    if (manifest.id !== id) continue;
    const compose = manifest.service?.compose;
    if (typeof compose !== 'string' || !compose) throw new HttpError(404, `The plugin "${id}" declares no service.`);
    const file = path.resolve(dir, compose);
    if (!file.startsWith(`${dir}${path.sep}`) || !fs.existsSync(file)) throw new HttpError(404, `The compose file of "${id}" is not in its folder.`);
    return { id, dir, service: { compose, project: typeof manifest.service.project === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(manifest.service.project) ? manifest.service.project : undefined } };
  }
  throw new HttpError(404, `There is no plugin "${id}" here.`);
};

/** What the compose file is run with: the variables LINEA's server sent (valid names, none that are the runner's own) over the runner's PATH and HOME. */
const environment = (given, base) => {
  const env = { PATH: base.PATH, HOME: base.HOME, DOCKER_HOST: base.DOCKER_HOST };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  if (given === undefined) return env;
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new HttpError(400, '`env` is an object.');
  for (const [name, value] of Object.entries(given)) {
    if (!VARIABLE.test(name) || RESERVED.test(name) || typeof value !== 'string') throw new HttpError(400, `The variable "${name}" is not accepted.`);
    env[name] = value;
  }
  return env;
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) { reject(new HttpError(413, 'The body is too large.')); req.destroy(); } else chunks.push(chunk);
  });
  req.on('end', () => {
    if (!size) return resolve({});
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'The body is not JSON.')); }
  });
  req.on('error', reject);
});

const digest = (text) => crypto.createHash('sha256').update(String(text)).digest();

/** An `http.Server` for the runner. `key` is the bearer token LINEA's server must present. */
export const createRunner = ({ pluginsDir, key, runner = new ServiceRunner(), baseEnv = process.env }) => {
  if (!key) throw new Error('The plugin runner needs a key (PLUGIN_RUNNER_KEY).');
  const expected = digest(key);

  const handle = async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!crypto.timingSafeEqual(digest(given), expected)) throw new HttpError(401, 'A key is needed.');
      const url = new URL(req.url, 'http://runner');
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });
      const match = url.pathname.match(/^\/plugins\/([^/]+)\/(status|logs|logs\/stream|(?:services\/([^/]+)\/)?(start|stop|restart|rebuild|down))$/);
      if (req.method !== 'POST' || !match) throw new HttpError(404, 'There is nothing here.');
      const [, id, action, container, kind] = match;
      const body = await readBody(req);
      const plugin = findPlugin(pluginsDir, decodeURIComponent(id));
      const env = environment(body.env, baseEnv);

      if (action === 'status') return json(200, await runner.status(plugin, env));
      const tail = Math.min(2000, Math.max(10, Number.parseInt(body.tail, 10) || 200));
      const service = body.service === undefined || body.service === null || body.service === '' ? null : String(body.service);
      if (service !== null && !SERVICE.test(service)) throw new HttpError(400, `"${service}" is not a service name.`);
      if (action === 'logs') {
        const text = await runner.logs(plugin, env, { tail, service });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(text);
      }
      if (action === 'logs/stream') {
        let stop = () => {};
        let closed = false;
        res.on('close', () => { closed = true; stop(); });
        const started = await runner.followLogs(plugin, env, {
          tail,
          service,
          onData: (text) => res.write(`data: ${JSON.stringify(text)}\n\n`),
          onEnd: () => res.end(),
        });
        stop = started;
        if (closed) return started();
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform' });
        return res.flushHeaders();
      }
      if (!KINDS.includes(kind)) throw new HttpError(404, 'There is nothing here.');
      await runner.begin(plugin, env, kind, container ? decodeURIComponent(container) : null);
      return json(202, { accepted: kind });
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error instanceof HttpError ? error.status : error instanceof ServiceBusyError ? 409 : error instanceof ServiceInputError ? 400 : 500;
      return json(status, { error: status === 500 ? 'The runner failed.' : error.message });
    }
  };

  return http.createServer((req, res) => { handle(req, res).catch(() => res.end()); });
};
