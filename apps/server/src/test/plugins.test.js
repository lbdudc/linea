import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { test, expect, beforeEach, afterEach } from 'vitest';
import { PluginHost } from '../plugins/PluginHost.js';
import { onError } from '../rest/common/onError.js';

const memoryStore = () => {
  const rows = new Map();
  return {
    all: async () => [...rows.values()],
    save: async (id, patch) => {
      rows.set(id, { ...(rows.get(id) ?? { id }), ...patch });
      return rows.get(id);
    },
  };
};

let dir;
const writePlugin = (id, { manifest = {}, server } = {}) => {
  fs.mkdirSync(path.join(dir, id, 'server'), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'plugin.json'), JSON.stringify({ id, name: id, version: '1.0.0', server: 'server/index.js', ...manifest }));
  fs.writeFileSync(path.join(dir, id, 'server/index.js'), server ?? `export default { register(ctx) { ctx.router().get('/ping', (req, res) => res.json({ pong: ctx.id })); } };`);
};
const catalog = (...ids) => fs.writeFileSync(path.join(dir, 'marketplace.json'), JSON.stringify({ plugins: ids.map((id) => ({ id, path: id })) }));

const appOf = (host) => {
  const app = express();
  app.use('/api/plugins/:id', host.dispatch);
  app.use(onError);
  return app;
};
const hostOf = (extra = {}) => new PluginHost({ pluginsDir: dir, lineaVersion: '1.2.0', store: memoryStore(), events: new EventEmitter(), ...extra });

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('lists the catalog, with the plugins not installed', async () => {
  writePlugin('a-plugin');
  catalog('a-plugin');
  const host = hostOf();
  await host.start();
  const [a] = await host.list();
  expect(a).toMatchObject({ id: 'a-plugin', installed: false, enabled: false, compatible: true, inProcess: true });
  expect(host.enabled()).toEqual([]);
});

test('a plugin route answers only while it is enabled, with no restart', async () => {
  writePlugin('a-plugin');
  catalog('a-plugin');
  const host = hostOf();
  await host.start();
  const app = appOf(host);

  expect((await request(app).get('/api/plugins/a-plugin/ping')).status).toBe(404); // not installed: nothing mounted
  await host.install('a-plugin');
  expect((await request(app).get('/api/plugins/a-plugin/ping')).body).toMatchObject({ error: 'error_messages.plugin_disabled' });
  await host.setEnabled('a-plugin', true);
  expect((await request(app).get('/api/plugins/a-plugin/ping')).body).toEqual({ pong: 'a-plugin' });
  expect(host.enabled()).toMatchObject([{ id: 'a-plugin' }]);
  await host.setEnabled('a-plugin', false);
  expect((await request(app).get('/api/plugins/a-plugin/ping')).status).toBe(404);
});

test('installed plugins are loaded at start; uninstalling switches them off', async () => {
  writePlugin('a-plugin');
  catalog('a-plugin');
  const store = memoryStore();
  const first = hostOf({ store });
  await first.start();
  await first.install('a-plugin');
  await first.setEnabled('a-plugin', true);

  const second = hostOf({ store });
  await second.start();
  expect((await request(appOf(second)).get('/api/plugins/a-plugin/ping')).body).toEqual({ pong: 'a-plugin' });
  await second.uninstall('a-plugin');
  expect(second.isEnabled('a-plugin')).toBe(false);
});

test('refuses a plugin that needs another LINEA, and one that is not in the catalog', async () => {
  writePlugin('old-plugin', { manifest: { requires: { linea: '^9.0.0' } } });
  catalog('old-plugin');
  const host = hostOf();
  await host.start();
  expect((await host.list())[0].compatible).toBe(false);
  await expect(host.install('old-plugin')).rejects.toMatchObject({ code: 'PLUGIN_INCOMPATIBLE' });
  await expect(host.install('nope')).rejects.toMatchObject({ code: 'PLUGIN_NOT_FOUND' });
  await expect(host.setEnabled('old-plugin', true)).rejects.toMatchObject({ code: 'PLUGIN_STATE' });
});

test('a plugin that fails to load does not stop the others, and cannot be enabled', async () => {
  writePlugin('bad-plugin', { server: 'throw new Error("boom");' });
  writePlugin('a-plugin');
  catalog('bad-plugin', 'a-plugin');
  const host = hostOf();
  await host.start();
  await host.install('bad-plugin');
  await host.install('a-plugin');
  expect((await host.list()).find((p) => p.id === 'bad-plugin').loadError).toBe('boom');
  await expect(host.setEnabled('bad-plugin', true)).rejects.toMatchObject({ code: 'PLUGIN_STATE' });
  await host.setEnabled('a-plugin', true);
  expect((await request(appOf(host)).get('/api/plugins/a-plugin/ping')).status).toBe(200);
});

test('events reach a plugin only while it is enabled', async () => {
  const events = new EventEmitter();
  writePlugin('a-plugin', { server: `export default { register(ctx) { ctx.events.on('x', () => globalThis.__seen.push(1)); } };` });
  catalog('a-plugin');
  globalThis.__seen = [];
  const host = hostOf({ events });
  await host.start();
  await host.install('a-plugin');
  events.emit('x');
  await host.setEnabled('a-plugin', true);
  events.emit('x');
  await host.setEnabled('a-plugin', false);
  events.emit('x');
  expect(globalThis.__seen).toEqual([1]);
});

test('reports whether the service of a remote plugin is up', async () => {
  writePlugin('r-plugin', { manifest: { server: undefined, remote: { baseUrl: 'http://svc:8000', health: '/health' } } });
  catalog('r-plugin');
  let up = true;
  const host = hostOf({ fetchFn: async () => { if (!up) throw new Error('down'); return { ok: true }; } });
  await host.start();
  expect((await host.list())[0]).toMatchObject({ inProcess: false, health: 'up' });
  up = false;
  expect((await host.list())[0].health).toBe('down');
});

test('a plugin can keep answering at the path of what moved into it, only while it is enabled', async () => {
  writePlugin('a-plugin', { server: `export default { register(ctx) { ctx.router().post('/analyze', (req, res) => res.json({ got: req.body ?? null, url: req.originalUrl })); ctx.alias('/api/lines/analyze', '/analyze'); } };` });
  catalog('a-plugin');
  const host = hostOf();
  await host.start();
  await host.install('a-plugin');
  const app = express();
  app.use(express.json());
  app.use(host.aliases);
  app.post('/api/lines/other', (req, res) => res.json({ base: true }));
  app.use(onError);

  await request(app).post('/api/lines/analyze').send({ uvl: 'x' }).expect(404); // installed, not enabled
  await host.setEnabled('a-plugin', true);
  expect((await request(app).post('/api/lines/analyze').send({ uvl: 'x' })).body.got).toEqual({ uvl: 'x' });
  expect((await request(app).post('/api/lines/other')).body).toEqual({ base: true }); // the rest of the base is untouched
});

test('the address of a remote plugin can come from the environment', async () => {
  writePlugin('r-plugin', { manifest: { server: undefined, remote: { baseUrl: '$' + '{R_URL:-http://fallback:1}', health: '/health' } } });
  catalog('r-plugin');
  const asked = [];
  const host = hostOf({ fetchFn: async (url) => { asked.push(String(url)); return { ok: true }; } });
  await host.start();
  await host.list();
  expect(asked).toEqual(['http://fallback:1/health']);
});

test('plugins a deployment asks for are installed and enabled at start, once: what a person decided afterwards stays', async () => {
  writePlugin('a-plugin');
  writePlugin('b-plugin');
  catalog('a-plugin', 'b-plugin');
  const store = memoryStore();

  const first = hostOf({ store });
  await first.start({ provision: ['a-plugin', 'nobody-plugin'] });
  expect(first.isEnabled('a-plugin')).toBe(true);
  expect(first.isEnabled('b-plugin')).toBe(false);
  expect((await request(appOf(first)).get('/api/plugins/a-plugin/ping')).body).toEqual({ pong: 'a-plugin' });

  await first.setEnabled('a-plugin', false); // an administrator switches it off

  const second = hostOf({ store });
  await second.start({ provision: ['a-plugin'] });
  expect(second.isEnabled('a-plugin')).toBe(false);
});

test('an alias can be a pattern with parameters, rewritten for the router', async () => {
  writePlugin('a-plugin', { server: `export default { register(ctx) { ctx.router().post('/lines/:id/conv', (req, res) => res.json({ id: req.params.id, query: req.query })); ctx.alias(/^\\/api\\/lines\\/([^/]+)\\/conv$/, ([, id]) => '/lines/' + id + '/conv'); } };` });
  catalog('a-plugin');
  const host = hostOf();
  await host.start();
  await host.install('a-plugin');
  await host.setEnabled('a-plugin', true);
  const app = express();
  app.use(host.aliases);
  app.use(onError);

  expect((await request(app).post('/api/lines/L1/conv?x=1')).body).toEqual({ id: 'L1', query: { x: '1' } });
  expect((await request(app).post('/api/lines/L1/other')).status).toBe(404); // not the plugin's
});

const settingsManifest = { settings: { url: { type: 'url', default: 'http://svc:1', env: 'SVC_URL' }, key: { type: 'secret', required: true }, mode: { type: 'enum', options: ['a', 'b'], default: 'a', public: true } } };

test('a plugin reads its settings (default < env < UI < file) and hears when they change', async () => {
  writePlugin('s-plugin', {
    manifest: settingsManifest,
    server: `export default { register(ctx) { ctx.onSettingsChange((v) => { globalThis.__seen = v; }); ctx.router().get('/s', (req, res) => res.json(ctx.settings())); } };`,
  });
  catalog('s-plugin');
  const host = hostOf({ env: { SVC_URL: 'http://env:2' }, declared: { 's-plugin': { enabled: true, settings: { key: 'from-file' } } } });
  await host.start();
  const app = appOf(host);
  expect((await request(app).get('/api/plugins/s-plugin/s')).body).toMatchObject({ url: 'http://env:2', mode: 'a', key: 'from-file' });

  await host.saveSettings('s-plugin', { mode: 'b', url: 'http://ui:3' });
  expect(globalThis.__seen).toMatchObject({ mode: 'b', url: 'http://ui:3' });
  expect(host.enabled()[0].settings).toEqual({ mode: 'b' }); // only the public ones reach the browser
  const shown = await host.getSettings('s-plugin');
  expect(shown.values.key).toEqual({ isSet: true });
  await expect(host.saveSettings('s-plugin', { key: 'other' })).rejects.toThrow(/linea.config.yml/);
});

test('a plugin with a required setting nobody gave cannot be enabled', async () => {
  writePlugin('s-plugin', { manifest: settingsManifest });
  catalog('s-plugin');
  const host = hostOf({ env: {} });
  await host.start();
  await host.install('s-plugin');
  await expect(host.setEnabled('s-plugin', true)).rejects.toThrow(/key/);
  expect((await host.list())[0].settingsMissing).toEqual(['key']);
  await host.saveSettings('s-plugin', { key: 'x' });
  await host.setEnabled('s-plugin', true);
  expect(host.isEnabled('s-plugin')).toBe(true);
});

test('a plugin the config file declares is put in that state at every start, even on a wiped store, and the view cannot change it', async () => {
  writePlugin('a-plugin');
  writePlugin('b-plugin');
  catalog('a-plugin', 'b-plugin');
  const declared = { 'a-plugin': { enabled: true, settings: {} }, 'b-plugin': { enabled: false, settings: {} }, 'ghost-plugin': { enabled: true, settings: {} } };

  for (let run = 0; run < 2; run += 1) { // the second run is a store that was wiped
    const host = hostOf({ declared });
    await host.start();
    expect(host.isEnabled('a-plugin')).toBe(true);
    expect(host.isEnabled('b-plugin')).toBe(false);
    const listed = await host.list();
    expect(listed.find((p) => p.id === 'a-plugin')).toMatchObject({ installed: true, declared: true });
    expect(listed.find((p) => p.id === 'b-plugin')).toMatchObject({ installed: true, enabled: false, declared: true });
    await expect(host.setEnabled('a-plugin', false)).rejects.toThrow(/linea.config.yml/);
    await expect(host.uninstall('a-plugin')).rejects.toThrow(/linea.config.yml/);
  }
});

test('a declared plugin that lacks a required setting stays disabled, and the config can be exported again', async () => {
  writePlugin('s-plugin', { manifest: settingsManifest });
  catalog('s-plugin');
  const store = memoryStore();
  const first = hostOf({ store, env: {}, declared: { 's-plugin': { enabled: true, settings: {} } } });
  await first.start();
  expect(first.isEnabled('s-plugin')).toBe(false);

  const free = hostOf({ store: memoryStore(), env: {} });
  await free.start();
  await free.install('s-plugin');
  await free.saveSettings('s-plugin', { key: 'shh', mode: 'b' });
  await free.setEnabled('s-plugin', true);
  const yaml = await free.exportConfig();
  expect(yaml).toContain('s-plugin:');
  expect(yaml).toContain('enabled: true');
  expect(yaml).toContain('mode: "b"');
  expect(yaml).toContain(`key: "$\{S_KEY}"`); // a secret never goes into the file
  expect(yaml).not.toContain('shh');
});


// ── a plugin that does not load well, does not fit, or does not belong ───────────────────────────────────────────────────

test('a plugin installed before an upgrade, which no longer fits, is not run, and says why', async () => {
  writePlugin('old-plugin', { manifest: { requires: { linea: '^9.0.0' } } });
  catalog('old-plugin');
  const store = memoryStore();
  await store.save('old-plugin', { installed: true, enabled: true, version: '1.0.0' });
  const host = hostOf({ store });
  await host.start();
  expect((await request(appOf(host)).get('/api/plugins/old-plugin/ping')).status).toBe(404);
  const [listed] = await host.list();
  expect(listed.loadError).toMatch(/needs LINEA \^9/);
});

test('the version of the plugin interface is checked too', async () => {
  writePlugin('api-plugin', { manifest: { requires: { hostApi: '^2.0.0' } } });
  catalog('api-plugin');
  const host = hostOf();
  await host.start();
  await expect(host.install('api-plugin')).rejects.toMatchObject({ code: 'PLUGIN_INCOMPATIBLE' });
});

test('a register() that never ends does not stop the start, and the plugin is listed with the error', async () => {
  writePlugin('hung-plugin', { server: 'export default { register() { return new Promise(() => {}); } };' });
  writePlugin('fine-plugin');
  catalog('hung-plugin', 'fine-plugin');
  const host = hostOf({ registerTimeoutMs: 50 });
  await host.start();
  await host.install('hung-plugin');
  await host.install('fine-plugin');
  const listed = Object.fromEntries((await host.list()).map((plugin) => [plugin.id, plugin]));
  expect(listed['hung-plugin'].loadError).toMatch(/did not finish/);
  expect(listed['fine-plugin'].loadError).toBeNull();
});

test('what a plugin subscribed before it failed is not left listening', async () => {
  globalThis.__heard = 0;
  writePlugin('half-plugin', { server: `export default { register(ctx) { ctx.events.on('thing', () => { globalThis.__heard += 1; }); ctx.onSettingsChange(() => { globalThis.__heard += 100; }); throw new Error('half way'); } };` });
  catalog('half-plugin');
  const events = new EventEmitter();
  const host = hostOf({ events });
  await host.start();
  await host.install('half-plugin');
  await host.setEnabled('half-plugin', true).catch(() => undefined);
  events.emit('thing');
  expect(globalThis.__heard).toBe(0);
  expect((await host.list())[0].loadError).toBe('half way');
});

test('a plugin that failed to load gets another try when it is enabled, with the code as it is then', async () => {
  writePlugin('retry-plugin', { server: "export default { register() { throw new Error('not yet'); } };" });
  catalog('retry-plugin');
  const host = hostOf();
  await host.start();
  await host.install('retry-plugin');
  await expect(host.setEnabled('retry-plugin', true)).rejects.toThrow(/failed to load: not yet/);
  fs.writeFileSync(path.join(dir, 'retry-plugin/server/index.js'), `export default { register(ctx) { ctx.router().get('/ping', (req, res) => res.json({ fixed: true })); } };`);
  await host.setEnabled('retry-plugin', true);
  expect((await request(appOf(host)).get('/api/plugins/retry-plugin/ping')).body).toEqual({ fixed: true });
});

test('a plugin that is enabled but fails to load at start is not offered to the web client, and its error keeps the folders of the server out', async () => {
  writePlugin('broken-plugin', { server: "export default { register() { throw new Error(\"Cannot find package 'express-validator' imported from /home/someone/projects/linea/plugins/broken-plugin/server/index.js\"); } };" });
  writePlugin('fine-plugin');
  catalog('broken-plugin', 'fine-plugin');
  const store = memoryStore();
  await store.save('broken-plugin', { installed: true, enabled: true, version: '1.0.0' });
  await store.save('fine-plugin', { installed: true, enabled: true, version: '1.0.0' });
  const host = hostOf({ store });
  await host.start();
  const listed = Object.fromEntries((await host.list()).map((p) => [p.id, p]));
  expect(listed['broken-plugin'].loadError).toMatch(/express-validator/);
  expect(listed['broken-plugin'].loadError).not.toContain('/home/someone');
  expect(listed['broken-plugin'].loadError).toContain('…/broken-plugin/server/index.js');
  expect(host.enabled().map((p) => p.id)).toEqual(['fine-plugin']);
});

test('uninstalling takes everything away, and installing again reads the code that is on disk then', async () => {
  const events = new EventEmitter();
  globalThis.__heard = 0;
  writePlugin('v-plugin', { server: `export default { register(ctx) { ctx.events.on('thing', () => { globalThis.__heard += 1; }); ctx.router().get('/ping', (req, res) => res.json({ v: 1 })); } };` });
  catalog('v-plugin');
  const host = hostOf({ events });
  await host.start();
  await host.install('v-plugin');
  await host.setEnabled('v-plugin', true);
  events.emit('thing');
  expect(globalThis.__heard).toBe(1);

  await host.uninstall('v-plugin');
  events.emit('thing');
  expect(globalThis.__heard).toBe(1); // nobody listens
  expect((await request(appOf(host)).get('/api/plugins/v-plugin/ping')).status).toBe(404);

  fs.writeFileSync(path.join(dir, 'v-plugin/server/index.js'), `export default { register(ctx) { ctx.router().get('/ping', (req, res) => res.json({ v: 2 })); } };`);
  await host.install('v-plugin');
  await host.setEnabled('v-plugin', true);
  expect((await request(appOf(host)).get('/api/plugins/v-plugin/ping')).body).toEqual({ v: 2 });
});

test('it says when the version on disk is not the one running', async () => {
  writePlugin('up-plugin');
  catalog('up-plugin');
  const host = hostOf();
  await host.start();
  await host.install('up-plugin');
  expect((await host.list())[0].restartRequired).toBe(false);
  fs.writeFileSync(path.join(dir, 'up-plugin/plugin.json'), JSON.stringify({ id: 'up-plugin', name: 'up', version: '2.0.0', server: 'server/index.js' }));
  expect((await host.list())[0].restartRequired).toBe(true);
});

test('an alias cannot take a path the server answers, and ids and paths of the host are not for plugins', async () => {
  writePlugin('greedy-plugin', { server: "export default { register(ctx) { ctx.alias('/api/users'); } };" });
  writePlugin('enabled', {});
  writePlugin('Bad_ID', {});
  catalog('greedy-plugin', 'enabled', 'Bad_ID');
  const host = hostOf();
  await host.start();
  await host.install('greedy-plugin');
  const listed = Object.fromEntries((await host.list()).map((plugin) => [plugin.id, plugin]));
  expect(listed['greedy-plugin'].loadError).toMatch(/whole part of the server itself/);
  expect(listed.enabled.error).toMatch(/cannot be the id/);
  expect(listed.Bad_ID.error).toMatch(/cannot be the id/);
});

test('a settings listener that fails does not make the save fail', async () => {
  writePlugin('s2-plugin', { manifest: settingsManifest, server: `export default { register(ctx) { ctx.onSettingsChange(() => { throw new Error('boom'); }); } };` });
  catalog('s2-plugin');
  const host = hostOf({ declared: {} });
  await host.start();
  await host.install('s2-plugin');
  await host.saveSettings('s2-plugin', { mode: 'b', key: 'k' });
  await host.setEnabled('s2-plugin', true);
  const shown = await host.saveSettings('s2-plugin', { mode: 'a' });
  expect(shown.values.mode).toBe('a');
});

test('a secret can be cleared, and values the form got from the environment are not frozen when only another one changed', async () => {
  writePlugin('s3-plugin', { manifest: settingsManifest });
  catalog('s3-plugin');
  const store = memoryStore();
  const host = hostOf({ store, env: { SVC_URL: 'http://env:2' } });
  await host.start();
  await host.install('s3-plugin');
  await host.saveSettings('s3-plugin', { key: 'secret-1' });
  await host.saveSettings('s3-plugin', { mode: 'b' });
  expect((await store.all()).find((row) => row.id === 's3-plugin').settings).toEqual({ key: 'secret-1', mode: 'b' }); // no url: it is the environment's
  await host.saveSettings('s3-plugin', { key: { clear: true } });
  const after = await host.getSettings('s3-plugin');
  expect(after.values.key).toBeUndefined();
  expect(after.meta.key.source).toBeNull();
});

test('a plugin that needs a git host is off while none of them is on, and comes back with one', async () => {
  writePlugin('git-plugin', { manifest: { requires: { gitHosts: ['gitlab'] } } });
  catalog('git-plugin');
  let on = ['local'];
  const store = memoryStore();
  await store.save('git-plugin', { installed: true, enabled: true });
  const host = hostOf({ store, enabledHosts: () => on });
  await host.start();
  const app = appOf(host);
  expect(host.isEnabled('git-plugin')).toBe(false);
  expect(host.enabled()).toEqual([]);
  expect((await host.list())[0].unavailable).toMatch(/needs one of these git hosts to be on: gitlab/);
  expect((await request(app).get('/api/plugins/git-plugin/ping')).body).toMatchObject({ error: 'error_messages.plugin_disabled' });
  await expect(host.setEnabled('git-plugin', true)).rejects.toThrow(/git hosts/);
  on = ['local', 'gitlab'];
  expect(host.isEnabled('git-plugin')).toBe(true);
  expect((await request(app).get('/api/plugins/git-plugin/ping')).body).toEqual({ pong: 'git-plugin' });
});

test('the service key a plugin has in its settings is a key of LINEA\'s too, while it is on', async () => {
  writePlugin('k-plugin', { manifest: { serviceKey: 'key', settings: { key: { type: 'secret' } } } });
  catalog('k-plugin');
  const store = memoryStore();
  await store.save('k-plugin', { installed: true, enabled: true, settings: { key: 'abc' } });
  const host = hostOf({ store });
  await host.start();
  expect(host.serviceKeys()).toEqual([{ id: 'k-plugin', secret: 'abc', scopes: [] }]);
  await host.setEnabled('k-plugin', false);
  expect(host.serviceKeys()).toEqual([]);
});

test('a plugin declared enabled that lacks a setting is listed as such, not only logged', async () => {
  writePlugin('d-plugin', { manifest: settingsManifest });
  catalog('d-plugin');
  const host = hostOf({ declared: { 'd-plugin': { enabled: true, settings: {} } } });
  await host.start();
  expect((await host.list())[0].declaredOff).toBe('declared but disabled: missing key');
});

test('what the host lends to plugins is there, and is not the whole container', async () => {
  const { services } = await import('../plugins/index.js');
  for (const name of ['requireAuth', 'requireAdmin', 'asyncHandler', 'rateLimit', 'handleValidationErrors', 'errors']) expect(services[name], name).toBeDefined();
  expect(typeof services.rateLimit).toBe('function');
  expect(services.Container).toBeUndefined();
});
