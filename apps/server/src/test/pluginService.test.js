import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { test, expect, beforeEach, afterEach } from 'vitest';
import { PluginHost } from '../plugins/PluginHost.js';
import { ServiceRunner } from '../plugins/ServiceRunner.js';
import { validateManifest } from '../plugins/manifest.js';

const memoryStore = () => {
  const rows = new Map();
  return { all: async () => [...rows.values()], save: async (id, patch) => { rows.set(id, { ...(rows.get(id) ?? { id }), ...patch }); return rows.get(id); } };
};

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-service-'));
  fs.mkdirSync(path.join(dir, 'a-plugin/service'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-plugin/plugin.json'), JSON.stringify({
    id: 'a-plugin', name: 'a', version: '1.0.0',
    service: { compose: 'service/compose.yml', env: { LINEA_API_URL: '${LINEA_INTERNAL_URL}', KEY: '${A_KEY}' } },
    settings: { key: { type: 'secret', env: 'A_KEY' } },
  }));
  fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ plugins: [{ id: 'a-plugin', path: 'a-plugin' }] }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// a Docker that only remembers what it was asked
const fakeDocker = ({ fail } = {}) => {
  const calls = [];
  let up = false;
  const exec = async (args, { env, cwd }) => {
    calls.push({ args, env, cwd });
    const verb = args.find((arg) => ['up', 'stop', 'ps'].includes(arg));
    if (fail && verb !== 'ps') throw new Error('no such image');
    if (verb === 'up') up = true;
    if (verb === 'stop') up = false;
    if (args.includes('logs')) return '2026-11-23T10:00:00Z flamapy  | listening, key k1 \u001b[32m200\u001b[0m [0m\n';
    return verb === 'ps' ? (up ? '{"State":"running"}\n' : '') : '';
  };
  return { calls, runner: new ServiceRunner({ exec }) };
};

const hostOf = (runner, env = {}) => new PluginHost({ pluginsDir: dir, lineaVersion: '1.2.0', store: memoryStore(), events: new EventEmitter(), runner, env: { port: '3100', A_KEY: 'k1', ...env } });

test('enabling a plugin starts its compose file, disabling stops it', async () => {
  const { calls, runner } = fakeDocker();
  const host = hostOf(runner);
  await host.start();
  await host.install('a-plugin');
  expect((await host.list())[0].serviceState).toMatchObject({ state: 'stopped' });

  await host.setEnabled('a-plugin', true);
  const up = calls.find((call) => call.args.includes('up'));
  expect(up.args).toEqual(['compose', '-p', 'linea-a-plugin', '-f', path.join(dir, 'a-plugin/service/compose.yml'), 'up', '-d', '--build']);
  // the plugin's setting reaches the compose file under its env name, and LINEA's address as a container sees it
  expect(up.env).toMatchObject({ KEY: 'k1', LINEA_API_URL: 'http://host.docker.internal:3100' });
  expect((await host.list())[0].serviceState).toMatchObject({ state: 'running' });

  await host.setEnabled('a-plugin', false);
  expect(calls.some((call) => call.args.includes('stop'))).toBe(true);
  expect((await host.list())[0]).toMatchObject({ enabled: false, serviceState: { state: 'stopped' } });
});

test('the logs of the service come with its containers, and the secrets are hidden', async () => {
  const { runner, calls } = fakeDocker();
  const host = hostOf(runner);
  await host.start();
  await host.install('a-plugin');
  await host.setEnabled('a-plugin', true);
  const result = await host.serviceLogs('a-plugin', { tail: 5 });
  expect(result.logs).toContain('listening, key ••••');
  expect(result.logs).not.toContain('k1');
  expect(result.logs).not.toMatch(/\[\d+m/); // no colour codes
  expect(calls.find((call) => call.args.includes('logs')).args.slice(-2)).toEqual(['--tail', '10']); // never fewer than 10
});

test('a service that does not start leaves the plugin enabled and says why', async () => {
  const { runner } = fakeDocker({ fail: true });
  const host = hostOf(runner);
  await host.start();
  await host.install('a-plugin');
  await host.setEnabled('a-plugin', true);
  const [plugin] = await host.list();
  expect(plugin.enabled).toBe(true);
  expect(plugin.serviceState.error).toMatch('no such image');
  await expect(host.startService('a-plugin')).rejects.toThrow('did not start');
});

test('a one-shot container that exited well does not make the service stopped', async () => {
  const lines = ['{"State":"running"}', '{"State":"exited","ExitCode":0}'].join('\n');
  const runner = new ServiceRunner({ exec: async () => lines });
  expect(await runner.status({ id: 'x', dir, service: { compose: 'c.yml' } }, {})).toMatchObject({ state: 'running' });
  const crashed = new ServiceRunner({ exec: async () => ['{"State":"running"}', '{"State":"exited","ExitCode":1}'].join('\n') });
  expect(await crashed.status({ id: 'x', dir, service: { compose: 'c.yml' } }, {})).toMatchObject({ state: 'degraded' });
});

test('the state tells starting, degraded and failed apart', async () => {
  const stateOf = async (rows) => (await new ServiceRunner({ exec: async () => rows.map((row) => JSON.stringify(row)).join('\n') }).status({ id: 'x', dir, service: { compose: 'c.yml' } }, {})).state;
  const up = { State: 'running', Health: 'healthy' };
  expect(await stateOf([up, up])).toBe('running');
  expect(await stateOf([up, { State: 'running', Health: 'starting' }])).toBe('starting');
  expect(await stateOf([up, { State: 'created' }])).toBe('starting');
  expect(await stateOf([up, { State: 'exited', ExitCode: 1 }])).toBe('degraded');
  expect(await stateOf([up, { State: 'exited', ExitCode: 137 }])).toBe('degraded'); // one killed while the others run
  expect(await stateOf([{ State: 'exited', ExitCode: 137 }, { State: 'exited', ExitCode: 0 }])).toBe('stopped'); // what `docker stop` leaves
  expect(await stateOf([{ State: 'exited', ExitCode: 1 }])).toBe('failed');
  expect(await stateOf([{ State: 'exited', ExitCode: 0 }])).toBe('stopped');
});

test('without Docker the state is unavailable', async () => {
  const runner = new ServiceRunner({ exec: async () => { throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }); } });
  expect(await runner.status({ id: 'x', dir, service: { compose: 'c.yml' } }, {})).toMatchObject({ state: 'unavailable', error: 'the Docker CLI is not installed here' });
});

test('the manifest keeps the compose file inside the plugin', () => {
  expect(validateManifest({ name: 'a', version: '1.0.0', service: { compose: '../x.yml' } }).errors).toHaveLength(1);
  expect(validateManifest({ name: 'a', version: '1.0.0', service: { compose: 'service/compose.yml' } }).errors).toEqual([]);
});
