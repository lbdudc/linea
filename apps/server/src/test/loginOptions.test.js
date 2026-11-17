import { afterEach, beforeEach, expect, test } from 'vitest';
import { Container } from 'typedi';
import { configureGitHosts } from '../model/git/index.js';
import UserService from '../model/services/UserService.js';

const KEYS = ['GIT_PROVIDER', 'REDIRECT_URI', 'GITLAB_HOSTNAME', 'GITLAB_CLIENT_ID', 'GITLAB_SECRET_ID', 'GITHUB_URL', 'GITHUB_API_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'LINEA_REPOS_DIR'];
const saved = {};

beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.REDIRECT_URI = 'http://x';
});

afterEach(async () => {
  for (const key of KEYS) saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
  await configureGitHosts({});
});

const loginHosts = async (file) => {
  await configureGitHosts({ file });
  return Container.get(UserService).getConfig().hosts.map((host) => host.id);
};

test('people are offered the sign-in of the hosts LINEA has configured, and no other', async () => {
  expect(await loginHosts({ gitlab: { url: 'https://gl.example.org', clientId: 'a', clientSecret: 'b' } })).toEqual(['gitlab']);
  expect(await loginHosts({ github: { clientId: 'a', clientSecret: 'b' } })).toEqual(['github']);
  expect(await loginHosts({ local: {}, gitlab: { url: 'https://gl.example.org', clientId: 'a', clientSecret: 'b' }, github: { clientId: 'a', clientSecret: 'b' } })).toEqual(['local', 'gitlab', 'github']);
});

test('a host that is on without an OAuth application has no way in, so it is not offered', async () => {
  expect(await loginHosts({ local: {}, gitlab: { url: 'https://gl.example.org' } })).toEqual(['local']);
  expect(await loginHosts({ local: {}, github: { enabled: true } })).toEqual(['local']);
});
