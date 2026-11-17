import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// `/login` (via oauth/loopback.ts) calls `open()` to launch the browser;
// mocked so the test suite never spawns a real one. Hoisted by Bun's test
// transform ahead of the imports below (same reasoning as test/oauth.test.ts).
mock.module('open', () => ({ default: async () => {} }));

import { configureClient, handleApiError, SplalmError } from '../src/core/client.js';
import { loadState } from '../src/core/credentials.js';
import { getCommand } from '../src/commands/registry.js';
import { config } from '../src/core/config.js';
import type { CommandContext, Session } from '../src/commands/types.js';
import type { LoginResponse } from '../src/core/types.js';

// /login (commands/auth.ts) is one command, no args: GET /api/users/config
// for { clientId, url }, run the loopback authorization-code flow
// (oauth/loopback.ts — real local HTTP server, real browser-less `open()`),
// and POST { code, redirect_uri } to /api/users/loginFromGitLabNative. The
// tests below drive the real loopback server with a real HTTP request (the
// same shape GitLab's redirect would produce) rather than mocking
// oauth/loopback.ts, so the exact redirect_uri sent to the backend — the
// thing the whole native-login endpoint is strict about — is verified
// end-to-end, not asserted against a stub.

const BASE = 'http://fake-splalm.invalid';

type Route = (url: URL, init: RequestInit) => { status?: number; body?: unknown };

function fakeFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body: parsedBody });
    const route = routes[key];
    if (!route) throw new Error(`fakeFetch: no route for ${key}`);
    const { status = 200, body } = route(url, init ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return { baseUrl: BASE, authed: false, mode: 'cloud', ...overrides };
}
function makeCtx(session: Session, args: string[] = []): CommandContext & { printed: string[] } {
  const printed: string[] = [];
  return {
    args,
    rest: args.join(' '),
    session,
    updateSession: (patch) => Object.assign(session, patch),
    setStatus: () => {},
    print: (text) => printed.push(text),
    clear: () => {},
    exit: () => {},
    printed,
  };
}

/** Poll until `predicate()` is true or `timeoutMs` elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let home: string;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-'));
  process.env['LINEA_HOME'] = home;
  configureClient({ baseUrl: BASE, token: '' });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env['LINEA_HOME'];
  fs.rmSync(home, { recursive: true, force: true });
});

describe('/login — GET /api/users/config guard', () => {
  // The guard is a single `if (!cfg.clientId || !cfg.url)` check, so it
  // cannot tell which field is missing — both branches below throw the exact
  // same message on purpose. Asserting the full message (rather than a
  // field-specific regex that would pass regardless of which field is
  // missing) documents that indistinguishability instead of hiding it.
  const expectedMessage =
    "The backend's /api/users/config didn't return a GitLab clientId/url (internal_error).";

  it('fails when clientId is missing', async () => {
    const { fn } = fakeFetch({
      'GET /api/users/config': () => ({ body: { url: 'https://gitlab.example.com' } }),
    });
    globalThis.fetch = fn;
    await expect(getCommand('login')!.run(makeCtx(makeSession()))).rejects.toThrow(
      expectedMessage,
    );
  });

  it('fails when url is missing', async () => {
    const { fn } = fakeFetch({
      'GET /api/users/config': () => ({ body: { clientId: 'abc123' } }),
    });
    globalThis.fetch = fn;
    await expect(getCommand('login')!.run(makeCtx(makeSession()))).rejects.toThrow(
      expectedMessage,
    );
  });
});

describe('/login — full loopback round trip', () => {
  it('opens the loopback callback, exchanges via loginFromGitLabNative, and signs in', async () => {
    const { fn, calls } = fakeFetch({
      'GET /api/users/config': () => ({
        body: {
          clientId: 'abc123',
          redirectUri: 'https://cli.example.com/login', // the WEB redirect — must be ignored
          url: 'https://gitlab.example.com',
        },
      }),
      'POST /api/users/loginFromGitLabNative': () => ({
        body: { token: 'jwt-token', user: { userId: 'u1', username: 'alice' } } satisfies LoginResponse,
      }),
    });
    globalThis.fetch = fn;

    const session = makeSession();
    const ctx = makeCtx(session);
    const runPromise = getCommand('login')!.run(ctx);

    await waitFor(() => ctx.printed.length > 0);
    const authorizeUrl = ctx.printed[0]!.match(/https:\/\/\S+/)?.[0];
    expect(authorizeUrl).toBeTruthy();
    const state = new URL(authorizeUrl!).searchParams.get('state');
    expect(state).toBeTruthy();

    // Simulate GitLab's redirect back to the loopback server — a real HTTP
    // request against the real server `runLoopbackOAuth` started, using the
    // real (non-mocked) fetch, since globalThis.fetch above is stubbed for
    // the SPLALM API only.
    const callback = await originalFetch(
      `http://127.0.0.1:${config.LOOPBACK_PORT}/callback?code=the-oauth-code&state=${state}`,
    );
    expect(callback.status).toBe(200);

    const out = await runPromise;
    expect(out).toBe('✓ Signed in as alice.');
    expect(session.authed).toBe(true);
    expect(session.user?.username).toBe('alice');

    const exchange = calls.find((c) => c.path === '/api/users/loginFromGitLabNative');
    expect(exchange).toBeDefined();
    expect(exchange!.body).toEqual({
      code: 'the-oauth-code',
      redirect_uri: `http://127.0.0.1:${config.LOOPBACK_PORT}/callback`,
    });

    // Persisted for subsequent sessions.
    expect(loadState().token).toBe('jwt-token');
    expect(loadState().user?.username).toBe('alice');
  });

  it('propagates the raw SplalmError on an exchange failure; app.tsx maps it via handleApiError', async () => {
    const { fn } = fakeFetch({
      'GET /api/users/config': () => ({
        body: { clientId: 'abc123', url: 'https://gitlab.example.com' },
      }),
      'POST /api/users/loginFromGitLabNative': () => ({
        status: 422,
        body: { error: 'error_messages.redirect_uri_validation', message: 'bad redirect_uri' },
      }),
    });
    globalThis.fetch = fn;

    const session = makeSession();
    const ctx = makeCtx(session);
    const runPromise = getCommand('login')!.run(ctx);
    // Attach before triggering the rejection below, so Bun never observes
    // `runPromise` as unhandled in between.
    const rejection = runPromise.catch((err: unknown) => err);

    await waitFor(() => ctx.printed.length > 0);
    const authorizeUrl = ctx.printed[0]!.match(/https:\/\/\S+/)?.[0];
    const state = new URL(authorizeUrl!).searchParams.get('state');
    await originalFetch(
      `http://127.0.0.1:${config.LOOPBACK_PORT}/callback?code=x&state=${state}`,
    );

    // The command itself throws the raw SplalmError; the readable mapping
    // (core/client.ts#handleApiError / CODE_MESSAGES) is applied by app.tsx
    // when it catches the rejection, not by the command.
    const err = await rejection;
    expect(err).toBeInstanceOf(SplalmError);
    expect((err as SplalmError).code).toBe('error_messages.redirect_uri_validation');
  });
});

describe('handleApiError — loginFromGitLabNative i18n keys', () => {
  it('maps error_messages.code_validation to readable text', () => {
    const err = new SplalmError(422, { error: 'error_messages.code_validation' });
    expect(handleApiError(err)).toBe(
      'GitLab did not send a valid authorization code — try /login again.',
    );
  });

  it('maps error_messages.redirect_uri_validation to readable text', () => {
    const err = new SplalmError(422, { error: 'error_messages.redirect_uri_validation' });
    expect(handleApiError(err)).toContain('loopback redirect_uri was rejected');
  });

  it('falls back to showing the raw key (not "undefined") for an unmapped error code', () => {
    const err = new SplalmError(400, { error: 'error_messages.some_future_key' });
    expect(handleApiError(err)).toContain('error_messages.some_future_key');
    expect(handleApiError(err)).not.toContain('undefined');
  });
});
