import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startGitlabDouble } from '@lbdudc/linea-git/testing';
import { storeGitCredentials } from '../src/commands/auth.js';
import { configureClient } from '../src/core/client.js';
import { clearAuth, loadState, saveState, serverOf, storedGit, type StoredGit } from '../src/core/credentials.js';
import { gitSettings } from '../src/core/git.js';
import { spawnSync } from 'node:child_process';
import { traceHelper, whyNoAccess } from '../src/core/credentialHelper.js';
import { accessHint, credentialOptions, gitAsync, isAuthFailure } from '../src/core/gitops.js';
import { makeSession, run } from './helpers.js';

// The git access a LINEA server gives (or a personal access token the user gives) belongs to that server: what was kept for another
// one is not used, and a server that gives none does not leave someone with the wrong host's token.

setDefaultTimeout(60_000);

const ENV = ['LINEA_HOME', 'LINEA_BASE_URL', 'LINEA_TOKEN', 'GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN', 'LINEA_ENTRY', 'LINEA_DEBUG'];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let tmp: string;
let routes: Record<string, unknown>;

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-token-')));
  for (const k of ENV) delete process.env[k];
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  fs.mkdirSync(process.env['LINEA_HOME'], { recursive: true });
  saveState({ baseUrl: 'https://linea.example.com' });
  configureClient({ baseUrl: 'https://linea.example.com', token: 'session' });
  routes = {};
  // the LINEA server is stubbed; the git host (a real one, in memory) is reached for real
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://linea.example.com') return realFetch(input as RequestInfo, init);
    const body = routes[url.pathname];
    return body === undefined
      ? new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const git = (over: Partial<StoredGit> = {}): StoredGit => ({
  server: 'https://linea.example.com',
  source: 'server',
  provider: 'gitlab',
  host: { url: 'https://gitlab.example.com' },
  username: 'ana',
  token: 'glpat-x',
  ...over,
});

describe('git access belongs to the server it came from', () => {
  it('is used for that server, and not for another, nor when it was kept before servers were recorded', () => {
    saveState({ git: git() });
    expect(serverOf()).toBe('https://linea.example.com');
    expect(storedGit()?.token).toBe('glpat-x');
    expect(gitSettings().token).toBe('glpat-x');

    saveState({ baseUrl: 'https://another.example.com' });
    expect(storedGit()).toBeUndefined();
    expect(() => gitSettings()).toThrow(/GITLAB_HOSTNAME|No GitLab token/);

    // kept by an older CLI, with no server written: it cannot be trusted to be this one's
    saveState({ baseUrl: 'https://linea.example.com', git: { ...git(), server: undefined as unknown as string } });
    expect(storedGit()).toBeUndefined();
  });

  it('what a server says replaces what was kept from it; a server with nothing to say leaves nothing stale', async () => {
    saveState({ git: git({ token: 'old', host: { url: 'http://localhost:8082' } }) });
    routes['/api/users/git-credentials'] = { provider: 'gitlab', host: { url: 'https://gitlab.example.com' }, username: 'ana', token: 'fresh' };
    expect(await storeGitCredentials('https://linea.example.com')).toBe('GitLab');
    expect(loadState().git).toMatchObject({ token: 'fresh', server: 'https://linea.example.com', source: 'server' });

    delete routes['/api/users/git-credentials']; // an older server: 404
    expect(await storeGitCredentials('https://linea.example.com')).toBeUndefined();
    expect(loadState().git).toBeUndefined();
  });

  it('logging out takes it away with the session', () => {
    saveState({ token: 't', git: git() });
    clearAuth();
    expect(loadState().git).toBeUndefined();
  });
});

describe('login --token', () => {
  it('uses a personal access token (given as a file, never printed) for the git host the server says it is on', async () => {
    const host = await startGitlabDouble();
    try {
      // an SPL of yours is there, so git can be tried on it, as `get` will use it
      host.seedProject({ name: 'gis', groupName: 'team', topics: ['spl'] });
      routes['/api/users/config'] = { clientId: 'x', url: host.url, redirectUri: 'http://x/login', provider: 'gitlab' };
      process.env['LINEA_ENTRY'] = path.resolve(import.meta.dir, '../src/index.tsx'); // git runs this program as its credential helper
      process.env['LINEA_BASE_URL'] = 'https://linea.example.com'; // the helper is another process: it finds the server in the same place
      const file = path.join(tmp, 'token.txt');
      fs.writeFileSync(file, 'glpat-secret-value\n');
      const session = makeSession(tmp, { authed: true, user: { userId: '1', username: 'vlamas' }, baseUrl: 'https://linea.example.com' });

      const printed: string[] = [];
      const ctx = { args: ['--token', file], rest: '', session, updateSession: () => {}, setStatus: () => {}, print: (t: string) => printed.push(t), clear: () => {}, exit: () => {} };
      const { getCommand } = await import('../src/commands/registry.js');
      const out = String(await getCommand('login')!.run(ctx));

      expect(out).toContain('✓ Signed in as vlamas');
      expect(printed.join('\n')).toContain('for its API and for git, through the credential helper too');
      expect(printed.join('\n') + out).not.toContain('glpat-secret-value');
      expect(loadState().git).toMatchObject({ source: 'token', server: 'https://linea.example.com', provider: 'gitlab', host: { url: host.url }, token: 'glpat-secret-value' });
      expect(gitSettings().token).toBe('glpat-secret-value');

      // a server that gives its own does not take the user's away
      routes['/api/users/git-credentials'] = { provider: 'gitlab', host: { url: host.url }, username: 'x', token: 'from-the-server' };
      await storeGitCredentials('https://linea.example.com');
      expect(loadState().git?.token).toBe('glpat-secret-value');
    } finally {
      await host.close();
    }
  });

  it('says so when the host does not accept the token, and keeps nothing', async () => {
    routes['/api/users/config'] = { clientId: 'x', url: 'http://127.0.0.1:1', redirectUri: 'http://x/login', provider: 'gitlab' };
    const session = makeSession(tmp, { authed: true, baseUrl: 'https://linea.example.com' });
    await expect(run(session, 'login', '--token', 'glpat-bad')).rejects.toThrow(/did not accept that token.*`api`/);
    expect(loadState().git).toBeUndefined();
  });

  it('refuses something that is not a token', async () => {
    routes['/api/users/config'] = { clientId: 'x', url: 'http://127.0.0.1:1', redirectUri: 'http://x/login' };
    const session = makeSession(tmp, { authed: true });
    await expect(run(session, 'login', '--token', 'two words')).rejects.toThrow(/not a token/);
  });
});

describe('when git cannot get in', () => {
  it('says what to do, instead of leaving a question about a username', () => {
    for (const said of [
      "fatal: could not read Username for 'https://gitlab.example.com': terminal prompts disabled",
      "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.example.com/g/p.git/'",
      "fatal: unable to access 'https://x/g/p.git/': The requested URL returned error: 403",
    ]) {
      expect(accessHint(said)).toMatch(/git has no access to the host\. Sign in again \(login\), or give a personal access token: login --token <token or file>/);
    }
    // the words GitLab uses when the token reached it and was not enough
    const gitlab = 'remote: HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect or you are required to use a token instead of a password.';
    expect(isAuthFailure(gitlab)).toBe(true);
    expect(accessHint(gitlab)).toContain('read_repository');
    // other failures are left as git said them
    expect(accessHint("fatal: repository 'https://x/g/p.git/' not found")).toBe('');
    expect(accessHint('fatal: unable to access: Could not resolve host: nowhere.invalid')).toBe('');
  });
});

describe('git never asks a person', () => {
  /** A program like the one VS Code puts in GIT_ASKPASS: it writes down that it was asked. */
  function editorAskpass(): { script: string; marker: string } {
    const dir = tmp.replace(/\\/g, '/');
    const script = `${dir}/askpass.sh`;
    fs.writeFileSync(script, '#!/bin/sh\necho "asked: $1" >> "$MARKER"\nexit 1\n', { mode: 0o755 });
    return { script, marker: `${dir}/marker.txt` };
  }

  it('does not reach the askpass program of an editor, which shows as a login box once per repository', async () => {
    const { script, marker } = editorAskpass();
    const env = { GIT_ASKPASS: script, MARKER: marker };
    const input = 'protocol=https\nhost=example.test\n\n';
    const ask = ['-c', 'credential.helper=', 'credential', 'fill'];

    // what an editor's terminal does to a plain git: it reaches the askpass program, even with prompts off
    spawnSync('git', ask, { input, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' } });
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);

    // ours, in the same environment: it fails with a message instead
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const res = await gitAsync(undefined, ask, { input });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/could not read Username/);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
});

describe('why git had no access', () => {
  const settings = (over: { provider?: 'gitlab' | 'github'; url?: string; source?: 'environment' | 'server' | 'token' } = {}) => () => ({
    config: { provider: over.provider ?? 'gitlab', gitlab: { url: over.url ?? 'https://gitlab.example.com' } } as never,
    token: 't',
    source: over.source ?? 'token',
  });

  it('says when the access in use is for another host', () => {
    const why = whyNoAccess('https://gitlab.other.org/g/p.git', settings());
    expect(why).toMatch(/for gitlab\.example\.com, and this repository is on gitlab\.other\.org/);
    expect(why).toMatch(/the token you gave/);
  });

  it('says when the token was sent and the host refused it, with the scopes it needs', () => {
    const why = whyNoAccess('https://gitlab.example.com/g/p.git', settings({ source: 'server' }));
    expect(why).toMatch(/gitlab\.example\.com\) refused what git gave it: the token from LINEA's server/);
    expect(why).toMatch(/LINEA_DEBUG=1/);
    expect(why).toMatch(/read_repository/);
  });

  it('says when nothing is stored', () => {
    const none = () => {
      throw new Error('No GitLab token: export GITLAB_TOKEN=…');
    };
    expect(whyNoAccess('https://gitlab.example.com/g/p.git', none)).toMatch(/no git access is stored.*GITLAB_TOKEN/);
  });
});

describe('the credential helper route', () => {
  it('forgets every other helper for the whole command, and only for web addresses', () => {
    const opts = credentialOptions('https://gitlab.example.com/g/p.git');
    expect(opts.slice(0, 3)).toEqual(['-c', 'credential.helper=', '-c']);
    expect(opts[3]).toMatch(/^credential\.helper=!.*credential/);
    expect(credentialOptions('/tmp/some/bare.git')).toEqual([]);
  });

  it('writes its trace only with LINEA_DEBUG, and never the token', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-trace-'));
    const saved = { LINEA_HOME: process.env['LINEA_HOME'], LINEA_DEBUG: process.env['LINEA_DEBUG'] };
    process.env['LINEA_HOME'] = home;
    try {
      delete process.env['LINEA_DEBUG'];
      traceHelper('get', 'host=gitlab.example.com\n\n', 'username=oauth2\npassword=SECRET\n\n');
      expect(fs.existsSync(path.join(home, '.linea', 'credential.log'))).toBe(false);
      process.env['LINEA_DEBUG'] = '1';
      traceHelper('get', 'host=gitlab.example.com\n\n', 'username=oauth2\npassword=SECRET\n\n');
      const log = fs.readFileSync(path.join(home, '.linea', 'credential.log'), 'utf8');
      expect(log).toMatch(/get host=gitlab\.example\.com: answered as oauth2/);
      expect(log).not.toMatch(/SECRET/);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
