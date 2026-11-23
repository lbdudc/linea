import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, beforeEach, afterEach } from 'vitest';
import { ServiceRunner, ServiceBusyError, ServiceInputError } from '../plugins/ServiceRunner.js';
import { RemoteServiceRunner } from '../plugins/RemoteServiceRunner.js';
import { createRunner } from '../../../../deploy/plugin-runner/app.js';

let dir;
const plugin = () => ({ id: 'a-plugin', dir: path.join(dir, 'a-plugin'), service: { compose: 'service/compose.yml' } });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-runner-'));
  fs.mkdirSync(path.join(dir, 'a-plugin/service'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-plugin/service/compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(dir, 'a-plugin/plugin.json'), JSON.stringify({ id: 'a-plugin', name: 'a', version: '1.0.0', service: { compose: 'service/compose.yml' } }));
  fs.mkdirSync(path.join(dir, 'plain-plugin'));
  fs.writeFileSync(path.join(dir, 'plain-plugin/plugin.json'), JSON.stringify({ id: 'plain-plugin', name: 'p', version: '1.0.0' }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const compose = (...rest) => ['compose', '-p', 'linea-a-plugin', '-f', path.join(dir, 'a-plugin/service/compose.yml'), ...rest];

// a Docker that remembers what it was asked; `hold` keeps a command running until released
const fakeDocker = ({ hold } = {}) => {
  const calls = [];
  const exec = async (args, { env }) => {
    calls.push({ args, env });
    const verb = args[args.indexOf('-f') + 2];
    if (verb === 'config') return 'web\ndb\n';
    if (verb === 'ps') return '{"Name":"x-web-1","Service":"web","State":"running"}\n';
    if (hold && verb === 'up') await hold;
    return `${verb} done\n`;
  };
  return { calls, runner: new ServiceRunner({ exec, follow: (args, { onData, onEnd }) => { calls.push({ args, follow: true }); onData('2026-11-23 web | hi\n'); setTimeout(() => onEnd(null), 5); return () => calls.push({ stopped: true }); } }) };
};

test('every action is one compose command, or two for a rebuild; down never removes the volumes', async () => {
  const { calls, runner } = fakeDocker();
  for (const kind of ['start', 'stop', 'restart', 'rebuild', 'down']) await runner.run(plugin(), {}, kind);
  const asked = calls.map((call) => call.args.slice(5).join(' '));
  expect(asked).toEqual([
    'up -d --build --remove-orphans', 'stop', 'restart',
    'pull --ignore-buildable --quiet', 'up -d --build --force-recreate --remove-orphans',
    'down --remove-orphans',
  ]);
  expect(asked.join(' ')).not.toMatch(/-v\b|--volumes/);
});

test('one container: start, stop and restart go to it, and only if it is a service of the compose file', async () => {
  const { calls, runner } = fakeDocker();
  await runner.run(plugin(), {}, 'restart', 'web');
  expect(calls.at(-1).args).toEqual(compose('restart', 'web'));
  await expect(runner.run(plugin(), {}, 'restart', 'evil; rm -rf')).rejects.toBeInstanceOf(ServiceInputError);
  await expect(runner.run(plugin(), {}, 'down', 'web')).rejects.toBeInstanceOf(ServiceInputError);
  await expect(runner.run(plugin(), {}, 'explode')).rejects.toBeInstanceOf(ServiceInputError);
});

test('a second operation while one runs is busy, and the operation is in the status', async () => {
  let release;
  const { runner } = fakeDocker({ hold: new Promise((resolve) => { release = resolve; }) });
  await runner.begin(plugin(), {}, 'start');
  await expect(runner.begin(plugin(), {}, 'restart')).rejects.toBeInstanceOf(ServiceBusyError);
  expect((await runner.status(plugin(), {})).operation).toMatchObject({ kind: 'start', finishedAt: null, error: null });
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await runner.status(plugin(), {})).operation).toMatchObject({ kind: 'start', error: null, output: expect.stringContaining('up done') });
  await runner.begin(plugin(), {}, 'restart'); // free again
});

test('a failed operation says why in the status', async () => {
  const runner = new ServiceRunner({ exec: async (args) => { if (args.includes('up')) throw new Error('no such image'); return args.includes('ps') ? '' : 'web\n'; } });
  await runner.begin(plugin(), {}, 'start');
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect((await runner.status(plugin(), {})).operation).toMatchObject({ kind: 'start', error: 'no such image' });
});

test('following the logs asks for -f, and a container that is not one is refused', async () => {
  const { calls, runner } = fakeDocker();
  const seen = [];
  const stop = await runner.followLogs(plugin(), {}, { tail: 20, service: 'web', onData: (text) => seen.push(text), onEnd: () => {} });
  expect(calls.at(-1).args).toEqual(compose('logs', '-f', '--no-color', '--timestamps', '--tail', '20', 'web'));
  expect(seen[0]).toContain('web | hi');
  stop();
  await expect(runner.followLogs(plugin(), {}, { service: 'nope', onData() {}, onEnd() {} })).rejects.toBeInstanceOf(ServiceInputError);
});

describe_runner();

function describe_runner() {
  let server;
  let url;
  let calls;
  const key = 'k-123';
  const boot = async ({ baseEnv = { PATH: '/usr/bin', HOME: '/root' } } = {}) => {
    const docker = fakeDocker();
    ({ calls } = docker);
    server = createRunner({ pluginsDir: dir, key, runner: docker.runner, baseEnv });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  };
  afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve())));
  const post = (path_, body, token = key) => fetch(`${url}${path_}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

  test('the runner refuses a wrong key, an unknown plugin, a path for an id and a plugin without a service', async () => {
    await boot();
    expect((await post('/plugins/a-plugin/status', {}, 'wrong')).status).toBe(401);
    expect((await fetch(`${url}/plugins/a-plugin/status`, { method: 'POST' })).status).toBe(401);
    expect((await post('/plugins/missing/status')).status).toBe(404);
    expect((await post('/plugins/plain-plugin/status')).status).toBe(404);
    expect((await post('/plugins/..%2Fetc/status')).status).toBe(400);
    expect((await post('/plugins/a-plugin/format-disk')).status).toBe(404);
    expect((await fetch(`${url}/plugins/a-plugin/status`, { method: 'GET', headers: { authorization: `Bearer ${key}` } })).status).toBe(404);
    expect(calls).toHaveLength(0); // nothing reached Docker
  });

  test('the environment the server sends is checked: its names, and nothing that is the runner’s own', async () => {
    await boot();
    expect((await post('/plugins/a-plugin/status', { env: { DOCKER_HOST: 'tcp://evil:2375' } })).status).toBe(400);
    expect((await post('/plugins/a-plugin/status', { env: { COMPOSE_FILE: '/etc/x' } })).status).toBe(400);
    expect((await post('/plugins/a-plugin/status', { env: { 'A B': 'x' } })).status).toBe(400);
    expect((await post('/plugins/a-plugin/status', { env: { PORT: 5 } })).status).toBe(400);
    expect((await post('/plugins/a-plugin/status', { env: { A_KEY: 'k1' } })).status).toBe(200);
    expect(calls.at(-1)).toBeTruthy();
    expect(calls.at(-1).env).toEqual({ PATH: '/usr/bin', HOME: '/root', A_KEY: 'k1' });
  });

  test('the server’s runner client drives the runner: status, actions, busy, one container, logs, a stream', async () => {
    await boot();
    const remote = new RemoteServiceRunner({ url, key });
    // the server's own PATH, HOME and DOCKER_* are not sent: the runner has its own, and refuses them
    expect(await remote.status(plugin(), { PATH: '/bin', HOME: '/h', DOCKER_HOST: 'x', A_KEY: 'k1' })).toMatchObject({ state: 'running', containers: 1 });
    expect(calls.at(-1).env).toEqual({ PATH: '/usr/bin', HOME: '/root', A_KEY: 'k1' });
    await remote.begin(plugin(), { A_KEY: 'k1' }, 'rebuild');
    expect(calls.some((call) => call.args?.includes('--force-recreate') && call.env.A_KEY === 'k1')).toBe(true);
    await remote.begin(plugin(), {}, 'restart', 'web');
    expect(calls.at(-1).args).toEqual(compose('restart', 'web'));
    await expect(remote.begin(plugin(), {}, 'restart', 'nope')).rejects.toBeInstanceOf(ServiceInputError);
    expect(await remote.logs(plugin(), {}, { tail: 5 })).toContain('logs done');

    const seen = [];
    let ended;
    const over = new Promise((resolve) => { ended = resolve; });
    await remote.followLogs(plugin(), {}, { tail: 10, onData: (text) => seen.push(text), onEnd: ended });
    expect(await over).toBeNull();
    expect(seen.join('')).toContain('web | hi');
  });

  test('the client says unavailable when the runner is not there', async () => {
    const remote = new RemoteServiceRunner({ url: 'http://127.0.0.1:1', key });
    expect(await remote.status(plugin(), {})).toMatchObject({ state: 'unavailable', error: expect.stringContaining('plugin runner') });
  });
}
