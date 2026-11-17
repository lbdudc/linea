import { describe, it, expect, mock } from 'bun:test';

// `runLoopbackOAuth` calls `open()` to launch the browser; mocked so tests
// never spawn a real one. `mock.module` is hoisted by Bun's test transform
// (like jest.mock), so this takes effect even though `loopback.ts` is
// imported below, not after this call.
mock.module('open', () => ({ default: async () => {} }));

import { buildAuthorizeUrl, runLoopbackOAuth } from '../src/oauth/loopback.js';

describe('buildAuthorizeUrl', () => {
  it('builds a GitLab authorize URL with encoded params', () => {
    const url = buildAuthorizeUrl({
      authorizeBase: 'https://gitlab.example.com/',
      clientId: 'abc123',
      redirectUri: 'http://127.0.0.1:53682/callback',
      state: 'xyz',
    });
    expect(url).toContain('https://gitlab.example.com/oauth/authorize');
    expect(url).toContain('client_id=abc123');
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback');
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=api');
    expect(url).toContain('state=xyz');
    // trailing slash on the base must not double up
    expect(url).not.toContain('com//oauth');
  });
});

/** Poll until `predicate()` is true or `timeoutMs` elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Await a promise expected to reject, without ever going through
 * `expect(promise).rejects` — on this Bun version that matcher hangs
 * indefinitely for a promise that rejects asynchronously (reproduced in
 * isolation outside this suite; tracked as a Bun quirk, not a bug in the code
 * under test). Attaching `.catch` synchronously, right where the promise is
 * created, also sidesteps Bun's unhandled-rejection warning for the window
 * before the caller gets around to inspecting the result.
 */
function catchRejection<T>(promise: Promise<T>): { get(): unknown } {
  let caught: { error: unknown } | undefined;
  promise.then(
    (value) => {
      caught = { error: new Error(`expected rejection, but resolved with ${String(value)}`) };
    },
    (error: unknown) => {
      caught = { error };
    },
  );
  return {
    get: () => caught?.error,
  };
}

describe('runLoopbackOAuth', () => {
  it('resolves with the code and the exact canonical redirect_uri used at authorize time', async () => {
    let capturedUrl = '';
    const resultPromise = runLoopbackOAuth({
      authorizeBase: 'https://gitlab.example.com',
      clientId: 'abc123',
      port: 28231,
      onUrl: (url) => {
        capturedUrl = url;
      },
    });

    await waitFor(() => capturedUrl !== '');
    const state = new URL(capturedUrl).searchParams.get('state');
    expect(state).toBeTruthy();

    const res = await fetch(
      `http://127.0.0.1:28231/callback?code=the-code&state=${state}`,
    );
    expect(res.status).toBe(200);

    const result = await resultPromise;
    expect(result.code).toBe('the-code');
    // Canonical form the server's isAllowedNativeRedirectUri requires:
    // no trailing slash, no query/fragment, http + literal 127.0.0.1.
    expect(result.redirectUri).toBe('http://127.0.0.1:28231/callback');
    expect(new URL(result.redirectUri).href).toBe(result.redirectUri);
  });

  it('rejects on a state mismatch instead of trusting an unsolicited callback', async () => {
    let capturedUrl = '';
    const resultPromise = runLoopbackOAuth({
      authorizeBase: 'https://gitlab.example.com',
      clientId: 'abc123',
      port: 28232,
      onUrl: (url) => {
        capturedUrl = url;
      },
    });

    const rejection = catchRejection(resultPromise);
    await waitFor(() => capturedUrl !== '');
    const res = await fetch(`http://127.0.0.1:28232/callback?code=x&state=not-the-real-state`);
    expect(res.status).toBe(200); // still serves the "sign-in failed" HTML page

    await waitFor(() => rejection.get() !== undefined);
    expect((rejection.get() as Error).message).toMatch(/state mismatch/);
  });

  it('rejects with the GitLab error when the callback carries ?error=', async () => {
    let capturedUrl = '';
    const resultPromise = runLoopbackOAuth({
      authorizeBase: 'https://gitlab.example.com',
      clientId: 'abc123',
      port: 28233,
      onUrl: (url) => {
        capturedUrl = url;
      },
    });

    const rejection = catchRejection(resultPromise);
    await waitFor(() => capturedUrl !== '');
    await fetch(`http://127.0.0.1:28233/callback?error=access_denied`);

    await waitFor(() => rejection.get() !== undefined);
    expect((rejection.get() as Error).message).toMatch(/access_denied/);
  });
});
