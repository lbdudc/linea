import { afterEach, beforeEach, expect, test } from 'vitest';
import { resolveGitHosts } from '../config/gitHosts.js';
import { configureGitHosts, describeGitHosts, enabledHosts, exportGitHosts, getGitProvider, gitConfig, hostSettings, primaryHost, saveGitHost } from '../model/git/index.js';

const KEYS = ['GIT_PROVIDER', 'REDIRECT_URI', 'GITLAB_HOSTNAME', 'GITLAB_CLIENT_ID', 'GITLAB_SECRET_ID', 'GITHUB_URL', 'GITHUB_API_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'LINEA_REPOS_DIR'];
const saved = {};
const memoryStore = () => {
  const records = {};
  return { records, all: async () => ({ ...records }), save: async (host, patch) => { records[host] = patch; } };
};

beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.REDIRECT_URI = 'http://x';
});

afterEach(async () => {
  for (const key of KEYS) saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
  await configureGitHosts({});
});

test('with nothing configured the repositories stay on this server', () => {
  const { hosts, primary } = resolveGitHosts({ env: {} });
  expect(Object.entries(hosts).filter(([, host]) => host.enabled).map(([kind]) => kind)).toEqual(['local']);
  expect(primary).toBe('local');
});

test('the environment of a deployment that has only GitLab keeps it the only host, and the primary', () => {
  const { hosts, primary } = resolveGitHosts({ env: { GITLAB_HOSTNAME: 'http://gl', GITLAB_CLIENT_ID: 'a', GITLAB_SECRET_ID: 'b' } });
  expect(hosts.gitlab.enabled).toBe(true);
  expect(hosts.local.enabled).toBe(false);
  expect(hosts.gitlab.values).toMatchObject({ url: 'http://gl', clientId: 'a', clientSecret: 'b' });
  expect(primary).toBe('gitlab');
});

test('GIT_PROVIDER puts a host on and makes it the primary one', () => {
  const env = { GIT_PROVIDER: 'github', GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b', GITLAB_HOSTNAME: 'http://gl' };
  const { hosts, primary } = resolveGitHosts({ env });
  expect(Object.entries(hosts).filter(([, host]) => host.enabled).map(([kind]) => kind)).toEqual(['gitlab', 'github']);
  expect(primary).toBe('github');
});

test('the file decides: what it names is on (or off), is locked, and wins over the environment', () => {
  const declared = { primary: 'github', github: { clientId: 'from-file', clientSecret: 's' }, gitlab: { enabled: false } };
  const { hosts, primary } = resolveGitHosts({ declared, env: { GITLAB_HOSTNAME: 'http://gl', GITHUB_CLIENT_ID: 'from-env' } });
  expect(hosts.github).toMatchObject({ enabled: true, locked: true, values: { clientId: 'from-file' } });
  expect(hosts.gitlab.enabled).toBe(false);
  expect(primary).toBe('github');
});

test('a primary host that is off gives way to the first that is on', () => {
  const { primary } = resolveGitHosts({ declared: { primary: 'github' }, env: { GITLAB_HOSTNAME: 'http://gl' } });
  expect(primary).toBe('gitlab');
});

test('the host module reads the file and the environment, and settings lay over the environment\'s', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  process.env.GITLAB_CLIENT_ID = 'c';
  process.env.GITLAB_SECRET_ID = 'd';
  await configureGitHosts({ file: { github: { clientId: 'gh-id', clientSecret: 'gh-secret', url: 'http://gh' } } });
  expect(enabledHosts()).toEqual(['gitlab', 'github']);
  expect(primaryHost()).toBe('gitlab');
  expect(gitConfig('github').github).toMatchObject({ webUrl: 'http://gh', clientId: 'gh-id' });
  expect(gitConfig('gitlab').gitlab).toMatchObject({ url: 'http://gl', clientSecret: 'd' });
  expect(getGitProvider({ host: 'gitlab' }).kind).toBe('gitlab');
  expect(getGitProvider({ host: 'github' }).kind).toBe('github');
});

test('a host that is not on is refused by name', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  await configureGitHosts({});
  expect(() => getGitProvider({ host: 'github' })).toThrowError(expect.objectContaining({ code: 'GIT_HOST_UNAVAILABLE', host: 'github' }));
});

test('an administrator switches a host on and sets it, unless the file declares it', async () => {
  process.env.GITLAB_HOSTNAME = 'http://gl';
  const store = memoryStore();
  await configureGitHosts({ file: { gitlab: { url: 'http://gl' } }, hostStore: store });

  const github = await saveGitHost('github', { enabled: true, settings: { clientId: 'id', clientSecret: 'secret', defaultNamespace: 'acme' } });
  expect(github).toMatchObject({ id: 'github', enabled: true, locked: false });
  expect(github.values.clientSecret).toEqual({ isSet: true }); // a secret is never given back
  expect(enabledHosts()).toEqual(['gitlab', 'github']);
  expect(hostSettings('github').defaultNamespace).toBe('acme');
  expect(store.records.github.enabled).toBe(true);

  await expect(saveGitHost('gitlab', { settings: { url: 'http://other' } })).rejects.toThrow(/linea.config.yml/);
  await expect(saveGitHost('nothing', {})).rejects.toThrow(/not a git host/);
  // a secret sent back as it was shown keeps the one saved
  await saveGitHost('github', { settings: { clientSecret: { isSet: true }, defaultNamespace: 'other' } });
  expect(gitConfig('github').github.clientSecret).toBe('secret');
  expect(hostSettings('github').defaultNamespace).toBe('other');
});

test('the last host cannot be switched off when nothing else would be on, and one that lacks required settings cannot be switched on', async () => {
  process.env.GITHUB_CLIENT_ID = 'a';
  process.env.GITHUB_CLIENT_SECRET = 'b';
  const store = memoryStore();
  store.records.local = { enabled: false, settings: {} };
  await configureGitHosts({ hostStore: store });
  expect(enabledHosts()).toEqual(['github']);
  await expect(saveGitHost('github', { enabled: false })).rejects.toThrow(/at least one/i);
  await expect(saveGitHost('gitlab', { enabled: true })).rejects.toThrow(/needs these settings/);
});

test('switching off the only other host takes the deployment back to the local host', async () => {
  process.env.GITHUB_CLIENT_ID = 'a';
  process.env.GITHUB_CLIENT_SECRET = 'b';
  await configureGitHosts({ hostStore: memoryStore() });
  await saveGitHost('github', { enabled: false });
  expect(enabledHosts()).toEqual(['local']);
});

test('the hosts as a file to keep: what was set, with secrets as placeholders named after their variable', async () => {
  process.env.GITLAB_CLIENT_ID = 'from-env';
  await configureGitHosts({ file: {} , hostStore: { all: async () => ({ gitlab: { enabled: true, settings: { url: 'http://gl', clientSecret: 'b' } } }), save: async () => {} } });
  const exported = exportGitHosts();
  expect(exported.primary).toBe('gitlab');
  // clientId came from the environment: it stays there
  expect(exported.hosts).toEqual([{ id: 'gitlab', enabled: true, settings: { url: 'http://gl', clientSecret: `$\{GITLAB_SECRET_ID}` } }]);
  expect(describeGitHosts().hosts.find((host) => host.id === 'gitlab').terms.changeRequest).toBe('merge request');
});

test('where the OAuth round trip goes is what the administrator set: the address of the host and the return address', async () => {
  await configureGitHosts({ file: { gitlab: { url: 'https://gitlab.example.org', clientId: 'app', clientSecret: 's', redirectUri: 'http://localhost:9000/login' }, github: { clientId: 'gh', clientSecret: 's' } } });

  expect(getGitProvider({ host: 'gitlab' }).authConfig()).toMatchObject({ url: 'https://gitlab.example.org', authorizeUrl: 'https://gitlab.example.org/oauth/authorize', clientId: 'app', redirectUri: 'http://localhost:9000/login' });
  // nothing set: this LINEA's own address + /login, as it has always been
  expect(getGitProvider({ host: 'github' }).authConfig().redirectUri).toBe('http://x/login');
});
