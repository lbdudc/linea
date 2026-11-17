import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_DIR = path.join(ROOT, 'apps/server');
const CLIENT_DIR = path.join(ROOT, 'apps/client');

// Node 22 (what LINEA runs on), first on the PATH of what is started
const NODE_PATH = `${process.env.HOME}/.nvm/versions/node/v22.23.3/bin:${process.env.PATH}`;

// the ports of a stack: away from the usual ones, so a stack that is already running (3000, 9000, 27017, 8081...) is left alone
const BASE_PORTS = { mongo: 27030, server: 3300, client: 9300, gitlab: 8091, github: 8092 };
// each stack has ports of its own (`slot`): the one before it may still be letting go of its
const portsFor = (slot) => Object.fromEntries(Object.entries(BASE_PORTS).map(([name, port]) => [name, port + slot * 10]));

const waitFor = async (url, { timeout = 120_000, what = url } = {}) => {
  const until = Date.now() + timeout;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error(`${what} did not come up in ${timeout / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const group = (child, signal = 'SIGTERM') => () => {
  try { process.kill(-child.pid, signal); } catch { /* already gone */ }
};

const listening = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

// the next stack binds the same ports: wait for these to be let go (Mongo takes a while to shut down)
const waitUntilFree = async (ports, { timeout = 30_000 } = {}) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (!(await Promise.all(ports.map(listening))).some(Boolean)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

/**
 * LINEA with the git hosts and plugins of a configuration: its own MongoDB, dev GitLab/GitHub as asked, the server, and the client
 * (vite) in front of it. `hosts` is up.sh's GIT_HOSTS (the first is the primary), `plugins` is LINEA_PLUGINS, `config` a linea.config.yml.
 * Returns `{ base, api, stop }`.
 */
export const startStack = async ({ name, slot = 0, hosts = ['local'], plugins = [], config = null, env = {} }) => {
  const PORTS = portsFor(slot);
  if ((await Promise.all(Object.values(PORTS).map(listening))).some(Boolean)) throw new Error(`a port of ${JSON.stringify(PORTS)} is already in use: stop what holds it`);
  const data = mkdtempSync(path.join(tmpdir(), `linea-e2e-${name}-`));
  const children = [];
  // the output is drained (a full pipe would stall the process) and kept for the report of a failure
  const output = [];
  const keep = (child, label) => { for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output.push(`[${label}] ${chunk}`); if (output.length > 400) output.shift(); }); };

  let configFile = null;
  if (config) {
    configFile = path.join(data, 'linea.config.yml');
    writeFileSync(configFile, typeof config === 'function' ? config({ data }) : config);
  }

  const up = spawn('bash', ['dev/up.sh'], {
    cwd: SERVER_DIR,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: NODE_PATH,
      DEV_DATA: data,
      // the metamodels and modules the registry is published from sit next to the repository, in the workspace
      REGISTRY_DIR: process.env.REGISTRY_DIR ?? path.resolve(ROOT, '..', 'linea-metamodels'),
      GIT_HOSTS: hosts.join(','),
      LINEA_PLUGINS: plugins.join(','),
      MONGO_PORT: String(PORTS.mongo),
      SERVER_PORT: String(PORTS.server),
      CLIENT_PORT: String(PORTS.client),
      GITLAB_PORT: String(PORTS.gitlab),
      GITHUB_PORT: String(PORTS.github),
      ...(configFile ? { LINEA_CONFIG: configFile } : {}),
      ...env,
    },
  });
  keep(up, 'up');
  children.push(up);

  const stop = async () => {
    for (const child of children) group(child)();
    if (!(await waitUntilFree(Object.values(PORTS), { timeout: 15_000 }))) {
      for (const child of children) group(child, 'SIGKILL')();
      await waitUntilFree(Object.values(PORTS));
    }
    if (!process.env.KEEP) rmSync(data, { recursive: true, force: true });
  };

  // the logs the stack keeps in its folder (the server's, the dev hosts'), for the report of a failure
  const logs = () => readdirSync(data).filter((file) => file.endsWith('.log')).map((file) => `--- ${file} ---\n${readFileSync(path.join(data, file), 'utf8').split('\n').slice(-25).join('\n')}`).join('\n');

  try {
    await waitFor(`http://127.0.0.1:${PORTS.server}/api/users/config`, { what: 'the server', timeout: 180_000 });
    const vite = spawn('npx', ['vite', '--port', String(PORTS.client), '--strictPort', '--host', 'localhost'], {
      cwd: CLIENT_DIR,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: NODE_PATH, API_URL: '', LINEA_SERVER: `http://127.0.0.1:${PORTS.server}` },
    });
    keep(vite, 'vite');
    children.push(vite);
    await waitFor(`http://localhost:${PORTS.client}/`, { what: 'the client', timeout: 120_000 });
  } catch (error) {
    error.message += `\n--- what the stack said ---\n${output.slice(-60).join('')}\n${logs()}`;
    await stop();
    throw error;
  }

  return {
    name,
    base: `http://localhost:${PORTS.client}`,
    api: `http://127.0.0.1:${PORTS.server}/api`,
    data,
    stop,
    output: () => output.join(''),
  };
};
