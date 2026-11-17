import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostToSignIn } from '../src/commands/auth.js';
import { answer, hostOf } from '../src/core/credentialHelper.js';
import { LOCAL_HOST_LIMIT, gitConfigOf, gitProviderOf, gitSettings, hostLabel, packageSourceOf } from '../src/core/git.js';
import { clearAuth, saveState, storedGit, type StoredGit } from '../src/core/credentials.js';
import { configureClient } from '../src/core/client.js';
import { getCommand } from '../src/commands/registry.js';
import type { PublicConfig } from '../src/core/types.js';

// A LINEA that keeps its repositories itself: the CLI signs in with an account, and git works over HTTP with the account's token.

const local: StoredGit = { server: 'https://linea.example.com', source: 'server', provider: 'local', host: { url: 'https://linea.example.com/git' }, username: 'ana', token: 'a'.repeat(64) };
let tmp: string;
const saved = { ...process.env };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-localhost-'));
  for (const key of ['GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN', 'LINEA_BASE_URL', 'LINEA_PASSWORD']) delete process.env[key];
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  fs.mkdirSync(process.env['LINEA_HOME'], { recursive: true });
  saveState({ baseUrl: 'https://linea.example.com' });
  configureClient({ baseUrl: 'https://linea.example.com', token: 'session' });
});
afterEach(() => {
  clearAuth();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe('which host a sign-in is for', () => {
  const several = { clientId: 'g', redirectUri: '', url: 'http://gl', provider: 'gitlab', primary: 'gitlab', hosts: [{ id: 'gitlab' }, { id: 'local' }] } as unknown as PublicConfig;

  it('is the primary one, or the one asked for, and has to be one the server has on', () => {
    expect(hostToSignIn(several, undefined)).toBe('gitlab');
    expect(hostToSignIn(several, 'local')).toBe('local');
    expect(() => hostToSignIn(several, 'github')).toThrow(/does not have github on/);
  });

  it('is the only one a server from before there were several says', () => {
    expect(hostToSignIn({ clientId: 'g', redirectUri: '', url: 'http://gl' } as PublicConfig, undefined)).toBe('gitlab');
    expect(hostToSignIn({ clientId: '', redirectUri: '', url: '', provider: 'local' } as PublicConfig, undefined)).toBe('local');
  });
});

describe('git access to the repositories of LINEA itself', () => {
  it('is the account\'s name with the token as its password, to the address of /git', () => {
    saveState({ git: local });
    const settings = gitSettings({}, storedGit());
    expect(settings.config.provider).toBe('local');
    expect(settings.username).toBe('ana');
    expect(hostOf(settings)?.href).toBe('https://linea.example.com/git');
    const reply = answer('protocol=https\nhost=linea.example.com\npath=git/ana/app.git\n\n', settings);
    expect(reply).toContain('username=ana');
    expect(reply).toContain(`password=${'a'.repeat(64)}`);
  });

  it('is not given to another host', () => {
    const settings = gitSettings({}, local);
    expect(answer('protocol=https\nhost=gitlab.example.com\n\n', settings)).toBe('');
  });

  it('says what the CLI cannot do there, instead of failing inside the library, and reads only the workspace for packages', () => {
    const settings = gitSettings({}, local);
    expect(() => gitProviderOf(settings)).toThrow(LOCAL_HOST_LIMIT);
    const files = { read: async () => null, list: async () => [] } as never;
    expect(packageSourceOf(files, {}, local)).toBe(files);
  });

  it('is built from the address the server gave', () => {
    expect(gitConfigOf(local, {}).local?.baseUrl).toBe('https://linea.example.com/git');
    expect(hostLabel('local')).toBe('LINEA');
    expect(hostLabel('github')).toBe('GitHub');
    expect(hostLabel('gitlab')).toBe('GitLab');
  });
});

describe('login with an account', () => {
  const session = (): never => ({ baseUrl: 'https://linea.example.com', authed: false } as never);
  const ctx = (args: string[]) => ({ args, session: session(), setStatus: () => {}, print: () => {}, updateSession: () => {} }) as never;

  it('asks for the name and the password when they are missing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).endsWith('/api/users/config') ? { provider: 'local', primary: 'local', hosts: [{ id: 'local' }] } : {}), { status: 200 })) as never;
    try {
      await expect(getCommand('login')!.run(ctx([]))).rejects.toThrow(/login --host local --username/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('signs in with the password, keeps the session, and a personal token is refused there', async () => {
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path_ = new URL(String(url)).pathname;
      asked.push(`${init?.method ?? 'GET'} ${path_} ${init?.body ?? ''}`);
      if (path_ === '/api/users/config') return new Response(JSON.stringify({ provider: 'local', primary: 'local', hosts: [{ id: 'local' }] }), { status: 200 });
      if (path_ === '/api/users/login/local') return new Response(JSON.stringify({ token: 'jwt', user: { userId: 'u1', username: 'ana' } }), { status: 200 });
      if (path_ === '/api/users/git-credentials') return new Response(JSON.stringify({ provider: 'local', host: { url: 'https://linea.example.com/git' }, username: 'ana', token: 'b'.repeat(64) }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as never;
    try {
      const login = getCommand('login')!;
      expect(await login.run(ctx(['--host', 'local', '--username', 'ana', '--password', 'long-enough']))).toContain('Signed in as ana');
      expect(asked.some((line) => line.includes('/api/users/login/local') && line.includes('"password":"long-enough"'))).toBe(true);
      expect(storedGit()?.provider).toBe('local');
      await expect(login.run(ctx(['--host', 'local', '--token', 'abc']))).rejects.toThrow(/personal token is for GitLab or GitHub/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
