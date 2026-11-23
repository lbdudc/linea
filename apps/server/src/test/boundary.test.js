import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';

// The line between the core and the plugins (see docs/linea/architecture.md): the core never names a plugin, and a plugin reaches only
// what the host gives it, never another plugin.
const here = path.dirname(fileURLToPath(import.meta.url));
const linea = path.resolve(here, '../../../..');
// (the plugins folder the server itself uses: PLUGINS_DIR when a deployment points elsewhere, else the one next to the checkout)
const plugins = process.env.PLUGINS_DIR ? path.resolve(process.env.PLUGINS_DIR) : path.resolve(linea, '..', 'linea-plugins');
const withPlugins = fs.existsSync(path.join(plugins, 'marketplace.json'));

const filesUnder = (dir, test_ = (file) => /\.(js|mjs|vue|ts)$/.test(file)) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.dev-data', 'coverage', 'service', 'uvl-language-server'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, test_));
    else if (test_(full)) out.push(full);
  }
  return out;
};

const isTest = (file) => /[\\/]test[\\/]/.test(file);
// (a plugin is a folder with a manifest: its id need not end in `-plugin`)
const pluginIds = () => !withPlugins ? [] : fs.readdirSync(plugins, { withFileTypes: true })
  .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== 'node_modules' && fs.existsSync(path.join(plugins, entry.name, 'plugin.json')))
  .map((entry) => entry.name);

test('the core never names a plugin', () => {
  const offenders = [];
  const sources = [...filesUnder(path.join(linea, 'apps/server/src')), ...filesUnder(path.join(linea, 'apps/client/src')), path.join(linea, 'apps/server/index.js')]
    .filter((file) => !isTest(file));
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const id of pluginIds()) if (text.includes(id)) offenders.push(`${path.relative(linea, file)} names ${id}`);
    if (/['"`][a-z]+-plugin['"`]/.test(text)) offenders.push(`${path.relative(linea, file)} names a plugin`);
  }
  // the plugin host and its catalog loader speak of plugins by nature; a migration names the plugins that used to be (to clean up after them)
  // (either separator: the paths are Windows' on Windows)
  expect(offenders.filter((line) => !/PluginHost|PluginRegistry|plugins[\\/]host|plugins[\\/]index|model[\\/]migrations[\\/]/.test(line))).toEqual([]);
});

// (needs the plugins repository: linea-plugins next to this checkout, or PLUGINS_DIR)
test.skipIf(!withPlugins)('a plugin imports no other plugin, and nothing of the core outside its aliases', () => {
  const offenders = [];
  for (const id of pluginIds()) {
    for (const file of filesUnder(path.join(plugins, id))) {
      if (isTest(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(path.join(plugins, id))) offenders.push(`${path.relative(plugins, file)} imports ${spec}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

// (needs the plugins repository: linea-plugins next to this checkout, or PLUGINS_DIR)
test.skipIf(!withPlugins)('every plugin of the catalog is a folder with a manifest, and nothing else is in the catalog', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(plugins, 'marketplace.json'), 'utf8')).plugins.map((entry) => entry.id).sort();
  expect(catalog).toEqual(pluginIds().sort());
  for (const id of catalog) expect(fs.existsSync(path.join(plugins, id, 'plugin.json')), id).toBe(true);
});

// A plugin reaches git through LINEA's repository API (`/api/lines/:id/repo`), whatever the host: it names no host and holds no token.
// (needs the plugins repository: linea-plugins next to this checkout, or PLUGINS_DIR)
test.skipIf(!withPlugins)('a plugin names no concrete git host library', () => {
  const offenders = [];
  for (const id of pluginIds()) {
    for (const file of filesUnder(path.join(plugins, id))) {
      if (isTest(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        if (/gitlab|github|octokit|linea-git/i.test(spec)) offenders.push(`${path.relative(plugins, file)} imports ${spec}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

// What a plugin says with the app's words is an agreement too: if the core renames or drops a key, the plugin's text breaks without a
// compile error. So every key a plugin takes from the core's messages is listed here, and a new one is a decision, not an accident
// (a plugin's own words go in its own messages: `ui.addI18n`).
const SHARED_WORDS = {
  'analytics-plugin': ['labels.feature', 'error_messages.load_model'],
  'agents-plugin': ['labels.ws_connected', 'labels.ws_disconnected'],
};

const flat = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (value && typeof value === 'object' ? flat(value, `${prefix}${key}.`) : [`${prefix}${key}`]));

// (needs the plugins repository: linea-plugins next to this checkout, or PLUGINS_DIR)
test.skipIf(!withPlugins)('the words a plugin takes from the app are the ones listed as shared, and they are still there in every language', async () => {
  const locales = {};
  for (const locale of ['en', 'es', 'gl']) locales[locale] = new Set(flat((await import(path.join(linea, `apps/client/src/i18n/${locale}/index.js`))).default));
  const offenders = [];
  for (const id of pluginIds()) {
    const used = new Set();
    const clientDir = path.join(plugins, id, 'client');
    // (a remote plugin has no web side)
    for (const file of fs.existsSync(clientDir) ? filesUnder(clientDir, (name) => /\.(vue|js)$/.test(name)) : []) {
      for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/\$?\bt\(\s*['"]([a-z_]+\.[a-zA-Z_0-9.]+)['"]/g)) used.add(key);
    }
    const fromCore = [...used].filter((key) => locales.en.has(key));
    for (const key of fromCore) if (!(SHARED_WORDS[id] ?? []).includes(key)) offenders.push(`${id} uses "${key}" from the app's words: bring its own, or list it as shared`);
    for (const key of SHARED_WORDS[id] ?? []) {
      for (const [locale, keys] of Object.entries(locales)) if (!keys.has(key)) offenders.push(`${id} is promised "${key}" and ${locale} does not have it`);
    }
  }
  expect(offenders).toEqual([]);
});

// (needs the plugins repository: linea-plugins next to this checkout, or PLUGINS_DIR)
test.skipIf(!withPlugins)('a plugin\'s service key setting, if it names one, exists and is a secret', () => {
  for (const id of pluginIds()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(plugins, id, 'plugin.json'), 'utf8'));
    if (manifest.serviceKey) expect(manifest.settings?.[manifest.serviceKey]?.type, id).toBe('secret');
  }
});
