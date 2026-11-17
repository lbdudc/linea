import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { test, expect } from 'vitest';
import { PluginHost } from '../plugins/PluginHost.js';
import { validateManifest } from '../plugins/manifest.js';
import { readCatalog } from '../plugins/PluginRegistry.js';
import { onError } from '../rest/common/onError.js';
import { signEvent, verifyEventSignature } from '../../../../packages/sdk/index.js';
import { createServer } from '../../../../docs/linea/plugin-examples/echo-plugin/service/server.js';

// The example plugins (docs/linea/plugin-examples) are what docs/linea/plugins.md describes: if the host drifts from the docs, these break.
const examples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/linea/plugin-examples');
const memoryStore = () => {
  const rows = new Map();
  return { all: async () => [...rows.values()], save: async (id, patch) => { rows.set(id, { ...(rows.get(id) ?? { id }), ...patch }); return rows.get(id); } };
};
// (like the real requireAuth: it sets `req.userId` and nothing else)
const pass = (req, res, next) => { req.userId = 'u1'; next(); };
const services = { userRepository: { findById: async (id) => (id === 'u1' ? { username: 'ada' } : null) }, requireAuth: pass, requireAdmin: pass, asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next) };

test('the manifests of the examples are valid, with no unknown keys', async () => {
  for (const id of ['hello-plugin', 'echo-plugin']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(examples, id, 'plugin.json'), 'utf8'));
    expect(validateManifest(manifest), id).toEqual({ errors: [], warnings: [] });
  }
  const catalog = await readCatalog({ pluginsDir: examples, lineaVersion: '1.0.0', env: {} });
  expect(catalog.map((entry) => [entry.id, entry.compatible, entry.error])).toEqual([['hello-plugin', true, undefined], ['echo-plugin', true, undefined]]);
});

test('hello-plugin: serves its route while enabled, and uses its settings', async () => {
  const events = new EventEmitter();
  const host = new PluginHost({ pluginsDir: examples, lineaVersion: '1.0.0', store: memoryStore(), events, services });
  await host.start();
  await host.install('hello-plugin');
  const app = express();
  app.use('/api/plugins/:id', host.dispatch);
  app.use(onError);

  expect((await request(app).get('/api/plugins/hello-plugin/greeting')).body).toMatchObject({ error: 'error_messages.plugin_disabled' });
  await host.setEnabled('hello-plugin', true);
  events.emit('product:generated', {});
  expect((await request(app).get('/api/plugins/hello-plugin/greeting')).body).toEqual({ greeting: 'Hello', user: 'ada', generated: 1 });
  await host.saveSettings('hello-plugin', { greeting: 'Hi', shout: true });
  expect((await request(app).get('/api/plugins/hello-plugin/greeting')).body.greeting).toBe('HI');
  expect(host.enabled()[0]).toMatchObject({ id: 'hello-plugin', client: true, settings: { greeting: 'Hi' } });
});

test('echo-plugin: needs its key, is reported up, checks signatures', async () => {
  const secret = 'webhook-secret';
  const server = createServer({ secret });
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const host = new PluginHost({ pluginsDir: examples, lineaVersion: '1.0.0', store: memoryStore(), events: new EventEmitter(), services, env: { ECHO_URL: url } });
    await host.start();
    await host.install('echo-plugin');
    await expect(host.setEnabled('echo-plugin', true)).rejects.toThrow(/serviceKey/);
    await host.saveSettings('echo-plugin', { serviceKey: 's3cret' });
    await host.setEnabled('echo-plugin', true);

    expect(await host.health('echo-plugin')).toMatchObject({ id: 'echo-plugin', inProcess: false, enabled: true, status: 'up', httpStatus: 200, error: null });
    expect(host.serviceKeys()).toEqual([{ id: 'echo-plugin', secret: 's3cret', scopes: [] }]);
    expect(host.eventUrls()).toEqual([`${url}/events`]);

    const body = JSON.stringify({ event: 'product:generated', payload: { actor: { username: 'ada' } } });
    expect(verifyEventSignature(secret, body, signEvent(secret, body))).toBe(true);
    const post = (signature) => fetch(`${url}/events`, { method: 'POST', headers: { 'X-Linea-Signature': signature }, body });
    expect((await post(signEvent(secret, body))).status).toBe(204);
    expect((await post('sha256=bad')).status).toBe(401);
  } finally {
    server.close();
  }
});

test('health tells why a service is down', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'));
  fs.mkdirSync(path.join(dir, 'r-plugin'));
  fs.writeFileSync(path.join(dir, 'r-plugin/plugin.json'), JSON.stringify({ id: 'r-plugin', name: 'R', version: '1.0.0', remote: { baseUrl: 'http://svc:1', health: '/health' } }));
  fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ plugins: [{ id: 'r-plugin' }] }));
  fs.mkdirSync(path.join(dir, 'p-plugin'));
  fs.writeFileSync(path.join(dir, 'p-plugin/plugin.json'), JSON.stringify({ id: 'p-plugin', name: 'P', version: '1.0.0' }));
  fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ plugins: [{ id: 'r-plugin' }, { id: 'p-plugin' }] }));
  try {
    let answer = { ok: false, status: 503 };
    const host = new PluginHost({ pluginsDir: dir, lineaVersion: '1.0.0', store: memoryStore(), fetchFn: async () => { if (answer instanceof Error) throw answer; return answer; } });
    await host.start();
    expect(await host.health('r-plugin')).toMatchObject({ status: 'down', httpStatus: 503, error: 'HTTP 503' });
    answer = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(await host.health('r-plugin')).toMatchObject({ status: 'down', httpStatus: null, error: expect.stringContaining('no answer') });
    answer = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    expect(await host.health('r-plugin')).toMatchObject({ status: 'down', error: 'ECONNREFUSED' });
    // (Node reports a refused connection to several addresses as an AggregateError inside `cause`)
    answer = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('all'), { errors: [{ code: 'ECONNREFUSED' }] }) });
    expect(await host.health('r-plugin')).toMatchObject({ error: 'ECONNREFUSED' });
    expect(await host.health('p-plugin')).toMatchObject({ status: 'n/a' });
    const listed = await host.list();
    expect(listed.find((p) => p.id === 'r-plugin')).toMatchObject({ health: 'down', healthDetail: { status: 'down' } });
    expect(listed.find((p) => p.id === 'p-plugin').health).toBeNull();
    await expect(host.health('nope')).rejects.toThrow();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('validateManifest names what is wrong', () => {
  const { errors, warnings } = validateManifest({ id: 'x', name: 'X', version: 'one', server: '../out.js', serviceKey: 'k', settings: { k: { type: 'string' }, e: { type: 'enum' }, w: { type: 'nope' } }, typo: 1 });
  expect(errors).toEqual(expect.arrayContaining([expect.stringContaining('"version"'), expect.stringContaining('"server" must stay'), expect.stringContaining('serviceKey'), expect.stringContaining('enum needs'), expect.stringContaining('settings.w.type')]));
  expect(warnings).toEqual(['unknown key "typo"']);
});
