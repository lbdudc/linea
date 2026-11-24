import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

mock.module('open', () => ({ default: async () => {} }));

import { configureClient } from '../src/core/client.js';
import { clearAuth, loadState, resolveMode, saveState } from '../src/core/credentials.js';
import { getCommand } from '../src/commands/registry.js';
import { execute, gate, splitGlobals } from '../src/commands/dispatch.js';
import { timing } from '../src/commands/auth.js';
import { contextLine } from '../src/core/mode.js';
import type { CommandContext, Session } from '../src/commands/types.js';

const BASE = 'http://linea.invalid';

type Route = (url: URL, init: RequestInit, body: any) => { status?: number; body?: unknown };
function fakeFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: any }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new Error(`no route for ${method} ${url.pathname}`);
    const { status = 200, body: answer } = route(url, init ?? {}, body);
    return { ok: status >= 200 && status < 300, status, json: async () => answer, text: async () => JSON.stringify(answer) } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

const session = (over: Partial<Session> = {}): Session => ({ baseUrl: BASE, authed: false, ...over });
function ctxOf(s: Session, args: string[] = []): CommandContext & { printed: string[] } {
  const printed: string[] = [];
  return { args, rest: args.join(' '), session: s, updateSession: (patch) => Object.assign(s, patch), setStatus: () => {}, print: (t) => printed.push(t), clear: () => {}, exit: () => {}, printed };
}
const hooks = () => ({ updateSession: () => {}, setStatus: () => {}, print: () => {}, clear: () => {}, exit: () => {} });

let home: string;
const realFetch = globalThis.fetch;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-remotes-'));
  process.env['LINEA_HOME'] = home;
  delete process.env['LINEA_MODE'];
  delete process.env['LINEA_TOKEN'];
  delete process.env['LINEA_BASE_URL'];
  configureClient({ baseUrl: BASE, token: '' });
  timing.sleep = async () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env['LINEA_HOME'];
});

const user = (hosts: string[], activeHost: string | null) => ({ userId: 'u1', username: 'ana', hosts, activeHost });
const CONFIG = { primary: 'gitlab', hosts: [{ id: 'local', url: 'http://git', password: true, token: true }, { id: 'gitlab', url: 'https://gitlab.example.org', clientId: 'c', device: true, token: true }, { id: 'github', url: 'https://github.com', clientId: 'g', device: false, token: true }] };

describe('the mode', () => {
  it('is offline in a file with no sign-in, server in one with a token, and LINEA_MODE wins', () => {
    expect(resolveMode({})).toBe('offline');
    expect(resolveMode({ token: 't' })).toBe('server');
    expect(resolveMode({ token: 't', mode: 'offline' })).toBe('offline');
    process.env['LINEA_MODE'] = 'server';
    expect(resolveMode({ mode: 'offline' })).toBe('server');
  });

  it('survives signing out, which drops the sign-in and what came with it', () => {
    saveState({ mode: 'server', baseUrl: BASE, token: 't', user: user(['gitlab'], 'gitlab') });
    clearAuth();
    expect(loadState()).toMatchObject({ mode: 'server', baseUrl: BASE });
    expect(loadState().token).toBeUndefined();
  });

  it('says where you are in one line', () => {
    expect(contextLine(session({ mode: 'offline' }))).toBe('○ offline · this machine only');
    expect(contextLine(session({ mode: 'offline', modeOverride: true }))).toContain('(this command)');
    expect(contextLine(session({ mode: 'server' }))).toBe('◐ server linea.invalid · not signed in (login)');
    expect(contextLine(session({ mode: 'server', authed: true, user: user(['gitlab'], 'gitlab') }))).toBe('● server linea.invalid · GitLab as ana');
    expect(contextLine(session({ mode: 'server', authed: true, user: user(['local'], 'local') }), { short: true })).toBe('● LINEA git · ana');
    expect(contextLine(session({ mode: 'server', authed: true, expired: true }))).toContain('session expired');
  });

  it('--offline (and the old --local) is for one command', () => {
    expect(splitGlobals(['spl', 'list', '--offline']).offline).toBe(true);
    expect(splitGlobals(['spl', 'list', '--local']).rest).toEqual(['spl', 'list']);
    expect(splitGlobals(['spl', 'list']).offline).toBe(false);
  });
});

describe('what runs where', () => {
  it('a command of the server does not run offline, and says how to switch', () => {
    expect(gate(getCommand('namespaces')!, session({ mode: 'offline' }))).toMatch(/needs the LINEA server, and linea is offline.*mode server/);
    expect(gate(getCommand('remote')!, session({ mode: 'offline' }))).toBeDefined();
  });

  it('server mode with no sign-in refuses what has both sides, instead of doing the local one quietly', () => {
    expect(gate(getCommand('spl new')!, session({ mode: 'server' }))).toMatch(/needs you signed in to linea.invalid: login/);
    expect(gate(getCommand('spl new')!, session({ mode: 'offline' }))).toBeUndefined();
    expect(gate(getCommand('spl new')!, session({ mode: 'server', authed: true }))).toBeUndefined();
    expect(gate(getCommand('fm show')!, session({ mode: 'server' }))).toBeUndefined(); // folders: always
  });

  it('prints where it worked for a command of the server', async () => {
    const outcome = await execute({ tokens: ['namespaces', '--offline'], session: session({ mode: 'server', authed: true }), hooks: hooks() });
    expect(outcome.code).toBe(1);
    expect(outcome.context).toBe('○ offline (this command) · this machine only');
  });
});

describe('mode and server', () => {
  it('mode is kept, and says how to go back', async () => {
    const s = session({ mode: 'server', authed: true });
    expect(await getCommand('mode')!.run(ctxOf(s, ['offline']))).toContain('Offline');
    expect(loadState().mode).toBe('offline');
    expect(s.mode).toBe('offline');
    expect(await getCommand('mode')!.run(ctxOf(s, ['server']))).toContain('Server mode');
    expect(loadState().mode).toBe('server');
  });

  it('server <url> signs you out, and asks for --yes first', async () => {
    saveState({ mode: 'server', baseUrl: BASE, token: 't', user: user(['gitlab'], 'gitlab') });
    const { fn, calls } = fakeFetch({ 'POST /api/users/logout': () => ({ body: {} }) });
    globalThis.fetch = fn;
    const s = session({ mode: 'server', authed: true });
    expect(await getCommand('server')!.run(ctxOf(s, ['https://other.example.org']))).toMatch(/--yes/);
    expect(calls).toHaveLength(0);
    expect(await getCommand('server')!.run(ctxOf(s, ['other.example.org', '--yes']))).toContain('https://other.example.org');
    expect(loadState()).toMatchObject({ baseUrl: 'https://other.example.org', mode: 'server' });
    expect(loadState().token).toBeUndefined();
    expect(s.authed).toBe(false);
  });
});

describe('remotes', () => {
  const signedIn = (hosts = ['gitlab', 'github'], active: string | null = 'gitlab') => {
    saveState({ mode: 'server', baseUrl: BASE, token: 't', user: user(hosts, active) });
    configureClient({ baseUrl: BASE, token: 't' });
    return session({ mode: 'server', authed: true, user: user(hosts, active) });
  };

  it('lists the remotes of the server, the one you are on and how to sign in with each', async () => {
    const s = signedIn();
    globalThis.fetch = fakeFetch({
      'GET /api/users/config': () => ({ body: CONFIG }),
      'POST /api/users/loginFromServiceToken': () => ({ body: { token: 't2', user: user(['gitlab', 'github'], 'gitlab') } }),
    }).fn;
    const out = await getCommand('remote')!.run(ctxOf(s));
    expect(out).toMatch(/● GitLab \(gitlab.example.org\)\s+your sign-in account\s+sign in with: browser, code, token/);
    expect(out).toMatch(/GitHub \(github.com\)\s+linked\s+sign in with: browser, token/);
    expect(out).toMatch(/LINEA git\s+no account/);
    expect(out).toMatch(/password, token/);
  });

  it('remote use switches on the server and asks for the git access of that remote', async () => {
    const s = signedIn();
    const { fn, calls } = fakeFetch({
      'PUT /api/users/profile': () => ({ body: { hosts: ['gitlab', 'github'], activeHost: 'github' } }),
      'GET /api/users/git-credentials': () => ({ body: { provider: 'github', host: { webUrl: 'https://github.com' }, username: 'ana', token: 'gho_x' } }),
    });
    globalThis.fetch = fn;
    const out = await getCommand('remote use')!.run(ctxOf(s, ['github']));
    expect(out).toContain('Working on GitHub');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/users/profile', 'GET /api/users/git-credentials?host=github']);
    expect(loadState().user?.activeHost).toBe('github');
    expect(loadState().git?.provider).toBe('github');
  });

  it('keeps a personal token per remote: switching back gives it again', async () => {
    const s = signedIn();
    const mine = { server: BASE, source: 'token' as const, provider: 'gitlab' as const, host: { url: 'https://gitlab.example.org' }, username: 'oauth2', token: 'glpat-mine' };
    saveState({ personal: { gitlab: mine }, git: mine });
    let n = 0;
    globalThis.fetch = fakeFetch({
      'PUT /api/users/profile': () => ({ body: { hosts: ['gitlab', 'github'], activeHost: n++ === 0 ? 'github' : 'gitlab' } }),
      'GET /api/users/git-credentials': () => ({ body: { provider: 'github', host: { webUrl: 'https://github.com' }, username: 'ana', token: 'gho_x' } }),
    }).fn;
    await getCommand('remote use')!.run(ctxOf(s, ['github']));
    expect(loadState().git?.token).toBe('gho_x');
    await getCommand('remote use')!.run(ctxOf(s, ['gitlab']));
    expect(loadState().git?.token).toBe('glpat-mine');
  });

  it('says what to do when the account is not linked', async () => {
    const s = signedIn(['gitlab']);
    globalThis.fetch = fakeFetch({ 'PUT /api/users/profile': () => ({ status: 403, body: { error: 'error_messages.git_host_not_linked' } }) }).fn;
    await expect(getCommand('remote use')!.run(ctxOf(s, ['github']))).rejects.toMatchObject({ code: 'error_messages.git_host_not_linked' });
  });

  it('links an account by code (--device) and refuses to link LINEA git', async () => {
    const s = signedIn(['gitlab']);
    let polls = 0;
    const { fn, calls } = fakeFetch({
      'GET /api/users/config': () => ({ body: CONFIG }),
      'POST /api/users/device/gitlab': () => ({ body: { deviceCode: 'dc', userCode: 'AB-12', verificationUri: 'https://gitlab.example.org/device', expiresIn: 600, interval: 1 } }),
      'POST /api/users/identities/gitlab/device': () => (polls++ < 2 ? { status: 202, body: { status: 'pending', interval: 1 } } : { body: { hosts: ['github', 'gitlab'], activeHost: 'github' } }),
    });
    globalThis.fetch = fn;
    const c = ctxOf(s, ['gitlab', '--device']);
    expect(await getCommand('remote link')!.run(c)).toContain('GitLab account linked');
    expect(c.printed.join('\n')).toContain('AB-12');
    expect(calls.filter((x) => x.path === '/api/users/identities/gitlab/device')).toHaveLength(3);
    expect(loadState().user?.hosts).toEqual(['github', 'gitlab']);
    expect(await getCommand('remote link')!.run(ctxOf(s, ['local']))).toMatch(/password/);
  });

  it('unlinks an account', async () => {
    const s = signedIn();
    globalThis.fetch = fakeFetch({ 'DELETE /api/users/identities/github': () => ({ body: { hosts: ['gitlab'], activeHost: 'gitlab' } }) }).fn;
    expect(await getCommand('remote unlink')!.run(ctxOf(s, ['github']))).toContain('unlinked');
    expect(loadState().user?.hosts).toEqual(['gitlab']);
  });
});

describe('login on each remote', () => {
  it('--device: shows the code, polls (also when told to wait), signs in and sets the mode', async () => {
    saveState({ mode: 'offline', baseUrl: BASE });
    let polls = 0;
    globalThis.fetch = fakeFetch({
      'GET /api/users/config': () => ({ body: CONFIG }),
      'POST /api/users/device/gitlab': () => ({ body: { deviceCode: 'dc', userCode: 'AB-12', verificationUri: 'https://gitlab.example.org/device', expiresIn: 600, interval: 1 } }),
      'POST /api/users/login/gitlab/device': () => (polls++ === 0 ? { status: 202, body: { status: 'pending', interval: 5 } } : { body: { token: 'jwt', user: user(['gitlab'], 'gitlab') } }),
      'GET /api/users/git-credentials': () => ({ body: { provider: 'gitlab', host: { url: 'https://gitlab.example.org' }, username: 'ana', token: 'glpat' } }),
    }).fn;
    const s = session({ mode: 'offline' });
    const c = ctxOf(s, ['gitlab', '--device']);
    const out = await getCommand('login')!.run(c);
    expect(out).toContain('Signed in as ana with GitLab');
    expect(out).toContain('Mode is now: server (it was offline)');
    expect(c.printed.join('\n')).toMatch(/enter the code:\s+AB-12/);
    expect(loadState()).toMatchObject({ mode: 'server', token: 'jwt' });
    expect(s.mode).toBe('server');
  });

  it('--device says so when the server has none for that remote', async () => {
    globalThis.fetch = fakeFetch({ 'GET /api/users/config': () => ({ body: CONFIG }) }).fn;
    await expect(getCommand('login')!.run(ctxOf(session(), ['github', '--device']))).rejects.toThrow(/no sign-in with a code for GitHub/);
  });

  it('--token goes to the server, for the remote given as a word', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/users/config': () => ({ body: CONFIG }),
      'POST /api/users/login/github/token': () => ({ body: { token: 'jwt', user: user(['github'], 'github') } }),
    });
    globalThis.fetch = fn;
    // the check of the token by the host is not under test (it fails here): what the server was sent is
    await getCommand('login')!.run(ctxOf(session(), ['github', '--token', 'ghp_abc'])).catch(() => {});
    expect(calls.find((c) => c.path === '/api/users/login/github/token')?.body).toEqual({ token: 'ghp_abc' });
  });

  it('a token of an account that never signed in here says what to do', async () => {
    globalThis.fetch = fakeFetch({
      'GET /api/users/config': () => ({ body: CONFIG }),
      'POST /api/users/login/gitlab/token': () => ({ status: 403, body: { error: 'error_messages.no_linea_account' } }),
    }).fn;
    await expect(getCommand('login')!.run(ctxOf(session(), ['gitlab', '--token', 'glpat-abc']))).rejects.toMatchObject({ code: 'error_messages.no_linea_account' });
  });

  it('whoami offline says the mode and does not ask the server', async () => {
    saveState({ mode: 'offline', baseUrl: BASE, token: 't', user: user(['gitlab'], 'gitlab') });
    globalThis.fetch = (async () => { throw new Error('no network offline'); }) as typeof fetch;
    const out = await getCommand('whoami')!.run(ctxOf(session({ mode: 'offline', authed: true, user: user(['gitlab'], 'gitlab') })));
    expect(out).toContain('○ offline');
    expect(out).toContain('not checked now');
    expect(out).toContain('remote:     GitLab');
  });
});
