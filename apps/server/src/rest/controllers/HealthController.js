import { Container } from "typedi";
import fs from 'fs';
import mongoose from 'mongoose';
import { inspectLocalStore, version as lineaGitVersion } from '@lbdudc/linea-git';
import { enabledHosts, hostSettings } from '../../model/git/index.js';
import { pluginHost } from '../../plugins/index.js';
import { getJobs } from '../../utils/schedulerStatus.js';

const CHECK_TIMEOUT_MS = 3000;

const readPkg = (url) => {
  try {
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  } catch {
    return null;
  }
};

export const checkMongo = async () => {
  let timer;
  try {
    if (mongoose.connection.readyState !== 1) throw new Error('not connected');
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
};

// Reachability of one enabled git host, without any user token. Remote hosts: any HTTP response means up, only
// network errors/timeouts fail; redirects are not followed so a misbehaving host cannot bounce the probe elsewhere.
// The local host: its repositories folder must be writable.
export const checkHost = async (kind) => {
  try {
    if (kind === 'local') {
      // read-only look at the folder: writable, state.json, and the lock that guards it against a second process
      const { ok, ...local } = inspectLocalStore(hostSettings('local').dataDir);
      return { name: kind, ok, ...(ok ? {} : { error: local.lock.stale ? 'stale state lock' : 'repositories folder not usable' }), local };
    }
    const settings = hostSettings(kind);
    const url = kind === 'github' ? (settings.apiUrl ?? settings.url) : settings.url;
    if (!url) return { name: kind, ok: false, error: 'no address configured' };
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    return { name: kind, host: url, ok: true, status: res.status };
  } catch (e) {
    return { name: kind, ok: false, error: e.message };
  }
};

export const checkGitHosts = async () => {
  const hosts = await Promise.all(enabledHosts().map(checkHost));
  return { ok: hosts.every((h) => h.ok), hosts };
};

// A job is unhealthy if its last two runs failed, or if it has not completed a run
// for more than STALE_FACTOR intervals (stopped firing or hung).
const STALE_FACTOR = 3;
export const checkScheduler = () => {
  const now = Date.now();
  const jobs = getJobs().map((j) => {
    const since = j.lastRunAt ? Date.parse(j.lastRunAt) : j.registeredAt;
    const stale = Boolean(j.intervalMs) && now - since > STALE_FACTOR * j.intervalMs;
    const failing = j.lastOk === false && j.previousFailed;
    return { ...j, stale, ok: !stale && !failing };
  });
  return { ok: jobs.every((j) => j.ok), jobs };
};

const CACHE_TTL_MS = 5000;
let cache = null; // { at, value } | { promise }

export const resetReadinessCache = () => {
  cache = null;
};

const computeReadiness = async () => {
  const [mongo, gitHosts] = await Promise.all([checkMongo(), checkGitHosts()]);
  const scheduler = checkScheduler();
  const ok = mongo.ok && gitHosts.ok && scheduler.ok;
  for (const c of [mongo, ...gitHosts.hosts, ...scheduler.jobs.filter((j) => !j.ok)]) {
    if (!c.ok) console.warn('[health] check failed:', c.name ?? 'mongo', c.error ?? c.lastError ?? (c.stale ? 'stale' : ''));
  }
  return { ok, mongo, gitHosts, scheduler };
};

// Cached for a few seconds, with in-flight coalescing, so anonymous callers
// cannot amplify load onto Mongo/GitLab.
export const getReadiness = () => {
  const now = Date.now();
  if (cache?.value && now - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.value);
  if (cache?.promise) return cache.promise;
  const promise = computeReadiness()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .catch((e) => {
      cache = null;
      throw e;
    });
  cache = { promise };
  return promise;
};

export default class HealthController {
  live = (req, res) => res.json({ status: 'ok' });

  // Public: booleans only. Error text, host URL and job internals are admin-only (/details).
  ready = async (req, res) => {
    const r = await getReadiness();
    res.status(r.ok ? 200 : 503).json({
      status: r.ok ? 'ok' : 'unavailable',
      checks: { mongo: { ok: r.mongo.ok }, gitHosts: Object.fromEntries(r.gitHosts.hosts.map((h) => [h.name, { ok: h.ok }])), scheduler: { ok: r.scheduler.ok } },
    });
  };

  details = async (req, res) => {
    const r = await getReadiness();
    const server = readPkg(new URL('../../../package.json', import.meta.url));
    const plugins = (await pluginHost.list().catch(() => []))
      .filter((p) => p.enabled)
      .map((p) => ({ id: p.id, version: p.version ?? p.installedVersion ?? null, health: p.health ?? null, loadError: p.loadError ?? null }));
    const dep = (name) => readPkg(new URL(`../../../node_modules/${name}/package.json`, import.meta.url))?.version ?? null;
    res.json({
      version: server?.version ?? null,
      packages: { '@lbdudc/linea-core': dep('@lbdudc/linea-core'), '@lbdudc/linea-git': lineaGitVersion },
      plugins,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      readiness: {
        ok: r.ok,
        mongo: r.mongo,
        gitHosts: r.gitHosts.hosts,
        scheduler: r.scheduler,
      },
    });
  };
}

Container.set(HealthController, new HealthController());
