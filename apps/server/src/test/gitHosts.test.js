import { expect, test } from 'vitest';
import { hostOf, hostsOf, identityOf, setIdentity, tokenFor, usernameOn } from '../model/git/hosts.js';

// a user as the entity gives them: their own host's token in the old fields, the others as identities
const ana = (extra = {}) => ({ username: 'ana', accessToken: 'gl-token', refreshToken: 'gl-refresh', identities: [{ host: 'github', username: 'ana-gh', accessToken: 'gh-token' }], ...extra });

test('the host of a line, a product or a provider is its own, else the primary one', () => {
  expect(hostOf({ gitHost: 'github' })).toBe('github');
  expect(hostOf({ kind: 'github', authConfig: () => ({}) })).toBe('github'); // a provider
  expect(hostOf({ kind: 'modular' })).toBe(hostOf({})); // a line's kind is not a host
  expect(hostOf('gitlab')).toBe('gitlab');
  expect(['local', 'gitlab', 'github']).toContain(hostOf({})); // the primary one
});

test('a user has the token and name of each host they signed in to', () => {
  const user = ana({ gitHost: 'gitlab' });
  expect(tokenFor(user, 'gitlab')).toBe('gl-token');
  expect(tokenFor(user, 'github')).toBe('gh-token');
  expect(usernameOn(user, 'github')).toBe('ana-gh');
  expect(usernameOn(user, 'gitlab')).toBe('ana');
  expect(hostsOf(user)).toEqual(['gitlab', 'github']);
  expect(() => tokenFor(ana({ gitHost: 'gitlab', identities: [] }), 'github')).toThrowError(expect.objectContaining({ code: 'GIT_HOST_NOT_LINKED', host: 'github' }));
});

test('tokens are put where they belong: the user\'s own fields or an identity', () => {
  const user = ana({ gitHost: 'gitlab' });
  setIdentity(user, 'gitlab', { accessToken: 'gl-2' });
  setIdentity(user, 'github', { accessToken: 'gh-2' });
  setIdentity(user, 'bitbucket', { accessToken: 'bb', username: 'ana-bb' });
  expect(user.accessToken).toBe('gl-2');
  expect(identityOf(user, 'github').accessToken).toBe('gh-2');
  expect(identityOf(user, 'bitbucket')).toMatchObject({ username: 'ana-bb', accessToken: 'bb' });
});

test('a user without a gitHost is a user of the primary host (everyone before there could be more than one)', () => {
  const user = { username: 'old', accessToken: 't', identities: [] };
  expect(identityOf(user, hostOf(user))).toMatchObject({ username: 'old', accessToken: 't' });
});
