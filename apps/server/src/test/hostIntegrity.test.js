import { afterEach, beforeEach, expect, test } from 'vitest';
import { resolveGitHosts, isUsable } from '../config/gitHosts.js';
import { loadDeployConfig } from '../config/deployConfig.js';
import { validateSettings } from '../config/settings.js';
import { HOST_SCHEMAS } from '../config/gitHostSchemas.js';
import { configureGitHosts, enabledHosts, primaryHost, saveGitHost, setPrimaryHost } from '../model/git/index.js';
import { checkGitVersion, configProblems } from '../model/git/startupChecks.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['GIT_PROVIDER', 'REDIRECT_URI', 'GITLAB_HOSTNAME', 'GITLAB_CLIENT_ID', 'GITLAB_SECRET_ID', 'GITHUB_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'LINEA_REPOS_DIR', 'LINEA_REGISTRY'];
const saved = {};
const memoryStore = (records = {}) => ({ records, all: async () => ({ ...records }), save: async (host, patch) => { records[host] = patch; } });
const github = { clientId: 'id', clientSecret: 'secret' };
const usageOf = (table) => async (host) => ({ lines: 0, products: 0, users: 0, admins: 0, ...table[host], total: Object.values(table[host] ?? {}).reduce((a, b) => a + b, 0) });

beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.REDIRECT_URI = 'http://x';
});
afterEach(async () => {
  for (const key of KEYS) saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
  await configureGitHosts({});
});

// ── the primary host never moves by itself ──────────────────────────────────────────────────────────────────────────────

test('switching local on next to GitLab does not make local the primary host', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  const store = memoryStore();
  await configureGitHosts({ hostStore: store });
  expect(primaryHost()).toBe('gitlab');
  await saveGitHost('local', { enabled: true });
  expect(enabledHosts()).toEqual(['local', 'gitlab']);
  // local comes first in the list, but gitlab was the primary host and stays so
  expect(primaryHost()).toBe('gitlab');
  expect(store.records._primary.settings.host).toBe('gitlab');
});

test('the primary host that is switched off gives way, and an administrator can choose another', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({ hostStore: memoryStore() });
  await saveGitHost('github', { enabled: true, settings: github });
  await setPrimaryHost('github');
  expect(primaryHost()).toBe('github');
  await expect(setPrimaryHost('local')).rejects.toThrow(/not on/);
});

test('the primary host of the file cannot be changed or switched off from the UI', async () => {
  await configureGitHosts({ file: { primary: 'gitlab', gitlab: { url: 'http://gl', clientId: 'a', clientSecret: 'b' } }, hostStore: memoryStore() });
  await expect(setPrimaryHost('gitlab')).rejects.toThrow(/linea\.config\.yml/);
});

// ── local does not switch itself off while it holds something ───────────────────────────────────────────────────────────

test('switching GitLab on keeps local on when people or lines live on it', async () => {
  const store = memoryStore();
  await configureGitHosts({ hostStore: store, usageOf: usageOf({ local: { users: 2, lines: 1 } }) });
  expect(enabledHosts()).toEqual(['local']);
  await saveGitHost('gitlab', { enabled: true, settings: { url: 'http://gl', clientId: 'a', clientSecret: 'b' } });
  expect(enabledHosts()).toEqual(['local', 'gitlab']);
  expect(primaryHost()).toBe('local');
});

test('switching GitLab on lets an empty local go', async () => {
  await configureGitHosts({ hostStore: memoryStore(), usageOf: usageOf({}) });
  await saveGitHost('gitlab', { enabled: true, settings: { url: 'http://gl', clientId: 'a', clientSecret: 'b' } });
  expect(enabledHosts()).toEqual(['gitlab']);
});

test('GIT_PROVIDER with nothing to sign in to does not switch local off', () => {
  const { hosts } = resolveGitHosts({ env: { GIT_PROVIDER: 'gitlab' } });
  expect(hosts.gitlab.enabled).toBe(true);
  expect(hosts.local.enabled).toBe(true);
  expect(isUsable('gitlab', hosts.gitlab.values)).toBe(false);
});

// ── switching a host off ────────────────────────────────────────────────────────────────────────────────────────────────

test('a host with people on it is switched off only with force, and the refusal says how many', async () => {
  const store = memoryStore();
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({ hostStore: store, usageOf: usageOf({ gitlab: { lines: 3, products: 5, users: 2 } }) });
  await saveGitHost('local', { enabled: true });
  const error = await saveGitHost('gitlab', { enabled: false }).catch((e) => e);
  expect(error.status).toBe(409);
  expect(error.preview).toMatchObject({ lines: 3, products: 5, users: 2 });
  expect(enabledHosts()).toContain('gitlab');
  await saveGitHost('gitlab', { enabled: false, force: true });
  expect(enabledHosts()).toEqual(['local']);
});

test('the host of the registry cannot be switched off', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  process.env.LINEA_REGISTRY = 'gitlab:linea/registry';
  await configureGitHosts({ hostStore: memoryStore() });
  await saveGitHost('local', { enabled: true });
  await expect(saveGitHost('gitlab', { enabled: false, force: true })).rejects.toThrow(/registry/);
});

test('a secret can be cleared, and kept when sent back as shown', async () => {
  const store = memoryStore();
  await configureGitHosts({ hostStore: store });
  await saveGitHost('github', { enabled: true, settings: github });
  await saveGitHost('github', { settings: { clientSecret: { isSet: true }, defaultNamespace: 'acme' } });
  expect(store.records.github.settings.clientSecret).toBe('secret');
  // without its secret GitHub is not complete any more
  await expect(saveGitHost('github', { settings: { clientSecret: { clear: true } } })).rejects.toThrow(/needs these settings/);
});

// ── the file ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const configFile = (text, env = {}) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-config-')), 'linea.config.yml');
  fs.writeFileSync(file, text);
  return loadDeployConfig({ file, env });
};

/* eslint-disable no-template-curly-in-string */
test('enabled: ${VAR:-false} is false, not the text "false"', () => {
  const { gitHosts, declared } = configFile('gitHosts:\n  gitlab:\n    enabled: ${ON:-false}\n    url: http://gl\nplugins:\n  analytics-plugin:\n    enabled: ${ON:-false}\n');
  expect(gitHosts.gitlab.enabled).toBe(false);
  expect(declared['analytics-plugin'].enabled).toBe(false);
  expect(resolveGitHosts({ declared: gitHosts, env: {} }).hosts.gitlab.enabled).toBe(false);
});
/* eslint-enable no-template-curly-in-string */

test('a host written as false, empty or nonsense does not switch on', () => {
  const { gitHosts, warnings } = configFile('gitHosts:\n  gitlab: false\n  github:\n  local:\n    enabled: yes please\n  primary: GitLab\n');
  expect(gitHosts.gitlab).toEqual({ enabled: false });
  expect(gitHosts.github).toBeUndefined();
  expect(gitHosts.local.enabled).toBe(false);
  expect(gitHosts.primary).toBe('gitlab');
  expect(warnings.join('\n')).toMatch(/gitHosts\.github: empty/);
});

test('gitHosts that is not a mapping stops the start, and bad settings are warned', () => {
  expect(() => configFile('gitHosts: gitlab\n')).toThrow(/mapping/);
  const { warnings } = configFile('gitHosts:\n  gitlab:\n    url: file:///etc/passwd\n    colour: red\n');
  expect(warnings.join('\n')).toMatch(/url: not an http\(s\) URL/);
  expect(warnings.join('\n')).toMatch(/colour: not a setting/);
});

test('settings are strict: real booleans, text and http(s) addresses only', () => {
  expect(validateSettings({ on: { type: 'boolean' } }, { on: 'yes' })).toHaveLength(1);
  expect(validateSettings({ on: { type: 'boolean' } }, { on: 'false' })).toHaveLength(0);
  expect(validateSettings({ name: { type: 'string' } }, { name: { a: 1 } })).toHaveLength(1);
  expect(validateSettings(HOST_SCHEMAS.gitlab, { url: 'javascript:alert(1)' })).toHaveLength(1);
  expect(validateSettings(HOST_SCHEMAS.gitlab, { url: 'https://gl.example.com' })).toHaveLength(0);
});

// ── start ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('git older than 2.38 stops a local host, and a missing git says so', async () => {
  await configureGitHosts({});
  expect(checkGitVersion({ run: () => 'git version 2.39.5' })).toBe('2.39');
  expect(() => checkGitVersion({ run: () => 'git version 2.34.1' })).toThrow(/2\.38/);
  expect(() => checkGitVersion({ run: () => { throw new Error('ENOENT'); } })).toThrow(/needs git on the PATH/);
});

test('git is not asked for when the local host is off', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({});
  expect(checkGitVersion({ run: () => { throw new Error('no'); } })).toBeNull();
});

test('the registry has to name a host that is on', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({});
  expect(configProblems({ env: { LINEA_REGISTRY: 'linea/registry' } })[0]).toMatch(/names no host/);
  expect(configProblems({ env: { LINEA_REGISTRY: 'github:a/b' } })[0]).toMatch(/github, which is not on/);
  expect(configProblems({ env: { LINEA_REGISTRY: 'gitlab:a/b' } })).toEqual([]);
});

// ── what the form may change ────────────────────────────────────────────────────────────────────────────────────────────

test('a setting saved from the form can be forgotten (back to the environment\'s), and the folder of the repositories is not for a form', async () => {
  process.env.GITHUB_URL = 'http://env-gh';
  const store = memoryStore();
  await configureGitHosts({ hostStore: store });
  await saveGitHost('github', { enabled: true, settings: { ...github, url: 'http://ui-gh' } });
  expect(store.records.github.settings.url).toBe('http://ui-gh');
  await saveGitHost('github', { settings: { url: null } });
  expect(store.records.github.settings.url).toBeUndefined();
  await expect(saveGitHost('local', { settings: { dataDir: '/somewhere/else' } })).rejects.toMatchObject({ status: 409 });
});

test('the address of a host with people on it is not changed without a yes', async () => {
  const store = memoryStore();
  Object.assign(process.env, { GITLAB_HOSTNAME: 'http://gl', GITLAB_CLIENT_ID: 'a', GITLAB_SECRET_ID: 'b' });
  await configureGitHosts({ hostStore: store, usageOf: usageOf({ gitlab: { users: 3 } }) });
  await saveGitHost('local', { enabled: true });
  const refused = await saveGitHost('gitlab', { settings: { url: 'http://other-gl' } }).catch((e) => e);
  expect(refused.status).toBe(409);
  expect(refused.preview.users).toBe(3);
  expect(store.records.gitlab).toBeUndefined();
  await saveGitHost('gitlab', { settings: { url: 'http://other-gl' }, force: true });
  expect(store.records.gitlab.settings.url).toBe('http://other-gl');
});

test('the primary host is not changed while records name no host', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({ hostStore: memoryStore(), unpinnedCount: async () => 4 });
  await saveGitHost('local', { enabled: true });
  await expect(setPrimaryHost('local')).rejects.toThrow(/name no host/);
  await configureGitHosts({ hostStore: memoryStore(), unpinnedCount: async () => 0 });
  await saveGitHost('local', { enabled: true });
  await setPrimaryHost('local');
  expect(primaryHost()).toBe('local');
});

test('a registry on the server itself has the feature metamodel in its own group, unless it is said otherwise', async () => {
  const { featureMetamodelLocation } = await import('../model/services/modules/hosts.js');
  const saved = { registry: process.env.LINEA_REGISTRY, metamodel: process.env.LINEA_FEATURE_METAMODEL };
  try {
    delete process.env.LINEA_FEATURE_METAMODEL;
    process.env.LINEA_REGISTRY = 'local:registry/index';
    expect(featureMetamodelLocation()).toBe('local:registry/metamodels/featuremodel');
    process.env.LINEA_FEATURE_METAMODEL = 'local:elsewhere/featuremodel';
    expect(featureMetamodelLocation()).toBe('local:elsewhere/featuremodel');
    delete process.env.LINEA_FEATURE_METAMODEL;
    process.env.LINEA_REGISTRY = 'gitlab:registry/index';
    expect(featureMetamodelLocation()).toMatch(/^gitlab:/);
  } finally {
    for (const [key, name] of [['registry', 'LINEA_REGISTRY'], ['metamodel', 'LINEA_FEATURE_METAMODEL']]) saved[key] === undefined ? delete process.env[name] : (process.env[name] = saved[key]);
  }
});
