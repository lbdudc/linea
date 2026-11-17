import { vi, test, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';

// two hosts at once, each a fake provider: what is under test is who UserService makes of whom
const hosts = {
  gitlab: { users: { 'code-gl': { username: 'ana', avatarUrl: 'gl.png' }, 'code-gl-bob': { username: 'bob', avatarUrl: 'bob.png' } } },
  github: { users: { 'code-gh': { username: 'ana-gh', avatarUrl: 'gh.png' }, 'code-gh-ana': { username: 'ana', avatarUrl: 'gh2.png' } } },
};
const known = new Map(); // token -> the host user it was given to
const providerOf = (host) => {
  return {
    kind: host,
    authConfig: () => ({ kind: host, clientId: `${host}-client`, redirectUri: `http://app/login`, url: `http://${host}`, authorizeUrl: `http://${host}/authorize`, scope: host === 'github' ? 'repo' : 'api' }),
    exchangeCode: async ({ code }) => {
      const current = hosts[host].users[code];
      if (!current) throw new Error('bad code');
      known.set(`${host}-token-${current.username}`, current);
      known.set(`${host}-token-${current.username}+`, current);
      return { accessToken: `${host}-token-${current.username}`, refreshToken: host === 'gitlab' ? `${host}-refresh` : null };
    },
    getUser: async ({ token }) => known.get(token),
    refreshToken: async ({ accessToken, refreshToken }) => {
      known.set(`${accessToken}+`, known.get(accessToken)); // the renewed token is of the same host user
      return { accessToken: `${accessToken}+`, refreshToken };
    },
    rollback: async () => {},
  };
};

vi.mock('../model/git/index.js', async () => ({
  hostDescriptor: (await import('@lbdudc/linea-git')).hostDescriptor,
  enabledHosts: () => ['gitlab', 'github'],
  primaryHost: () => 'gitlab',
  getGitProvider: ({ host } = {}) => providerOf(host ?? 'gitlab'),
  hostTerms: (host) => ({ name: host }),
  hostSettings: (host) => (host === 'github' ? { defaultNamespace: 'account:acme' } : {}),
  gitConfig: (host = 'gitlab') => ({ provider: host, gitlab: { url: 'http://gitlab' }, github: { webUrl: 'http://github', apiUrl: 'http://github/api' } }),
}));

const { default: UserService } = await import('../model/services/UserService.js');
const userService = Container.get(UserService);

test('the login page is told every host that is on, and which is the primary one', () => {
  const config = userService.getConfig();
  expect(config.hosts.map((host) => host.id)).toEqual(['gitlab', 'github']);
  expect(config.hosts[1]).toMatchObject({ clientId: 'github-client', authorizeUrl: 'http://github/authorize', scope: 'repo', defaultNamespace: 'account:acme' });
  expect(config.hosts[0].defaultNamespace).toBeNull(); // the scope the client was missing
  expect(config.primary).toBe('gitlab');
  expect(Object.keys(config).sort()).toEqual(['hosts', 'primary']); // nothing of the primary host is repeated at the top
});

test('signing in with another host makes a user of that host', async () => {
  const user = await userService.loginUserFromGitLab({ code: 'code-gh', host: 'github' });

  expect(user).toMatchObject({ username: 'ana-gh', gitHost: 'github', accessToken: 'github-token-ana-gh' });
  expect(user.identities).toHaveLength(0); // it is their own host: no identity
});

test('the same host username on two hosts is two people, unless one links the other', async () => {
  const onGitlab = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' }); // "ana", of the primary host
  const onGithub = await userService.loginUserFromGitLab({ code: 'code-gh-ana', host: 'github' }); // another "ana", of GitHub

  expect(onGitlab.username).toBe('ana');
  expect(onGithub.username).toBe('ana@github');
  expect(String(onGithub._id)).not.toBe(String(onGitlab._id));
});

test('a person whose name was taken keeps it on their host: signing in again finds the same account, and the host is asked with the host name', async () => {
  const { usernameOn } = await import('../model/git/hosts.js');
  const first = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  const renamed = await userService.loginUserFromGitLab({ code: 'code-gh-ana', host: 'github' });
  const again = await userService.loginUserFromGitLab({ code: 'code-gh-ana', host: 'github' });

  expect(renamed.username).toBe('ana@github');
  expect(String(again._id)).toBe(String(renamed._id)); // not a third "ana@github2"
  expect(usernameOn(again, 'github')).toBe('ana'); // what the host knows them as: its permission checks use it
  expect(usernameOn(first, 'gitlab')).toBe('ana');
});

test('linking adds an account on another host to the same person, and it is found by it afterwards', async () => {
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });

  const linked = await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });

  expect(String(linked._id)).toBe(String(ana._id));
  expect(linked.identities).toMatchObject([{ host: 'github', username: 'ana-gh', accessToken: 'github-token-ana-gh' }]);
  const again = await userService.loginUserFromGitLab({ code: 'code-gh', host: 'github' }); // signing in with the linked GitHub account
  expect(String(again._id)).toBe(String(ana._id));
  expect(await User.countDocuments()).toBe(1);
});

test('an account cannot be linked to two people', async () => {
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  const bob = await userService.loginUserFromGitLab({ code: 'code-gl-bob', host: 'gitlab' });
  await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });

  await expect(userService.linkIdentity({ userId: bob._id, host: 'github', code: 'code-gh' })).rejects.toMatchObject({ code: 'GIT_HOST_ACCOUNT_TAKEN' });
});

test('an identity can be removed, but not the host of the login itself', async () => {
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });

  expect((await userService.unlinkIdentity({ userId: ana._id, host: 'github' })).identities).toHaveLength(0);
  await expect(userService.unlinkIdentity({ userId: ana._id, host: 'gitlab' })).rejects.toMatchObject({ code: 'GIT_HOST_IS_OWN' });
});

test('renewing a login renews the tokens of every host, and the git credentials are of the host asked', async () => {
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });

  const renewed = await userService.loginUserFromId({ userId: ana._id });
  expect(renewed.accessToken).toBe('gitlab-token-ana+');
  expect(renewed.identities[0].accessToken).toBe('github-token-ana-gh+');

  const credentials = await userService.getGitCredentials({ userId: ana._id, host: 'github' });
  expect(credentials).toMatchObject({ provider: 'github', username: 'ana-gh', token: 'github-token-ana-gh+' });
});

test('the profile is one host at a time: their own until they choose another they are signed in to', async () => {
  const { activeHostOf } = await import('../model/git/hosts.js');
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  expect(activeHostOf(ana)).toBe('gitlab');

  await expect(userService.setActiveHost({ userId: ana._id, host: 'github' })).rejects.toMatchObject({ code: 'GIT_HOST_NOT_LINKED' }); // never signed in to it
  await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });

  const chosen = await userService.setActiveHost({ userId: ana._id, host: 'github' });
  expect(activeHostOf(chosen)).toBe('github');
  await expect(userService.setActiveHost({ userId: ana._id, host: 'local' })).rejects.toMatchObject({ code: 'GIT_HOST_NOT_LINKED' }); // not on here

  const back = await userService.unlinkIdentity({ userId: ana._id, host: 'github' }); // forgetting the host of the profile goes back to their own
  expect(activeHostOf(back)).toBe('gitlab');
});

test('a session asked for right after linking an account has it (the renewal just made is not served again)', async () => {
  const ana = await userService.loginUserFromGitLab({ code: 'code-gl', host: 'gitlab' });
  await userService.loginUserFromId({ userId: ana._id }); // the page that opens renews the session...
  await userService.linkIdentity({ userId: ana._id, host: 'github', code: 'code-gh' });
  const again = await userService.loginUserFromId({ userId: ana._id }); // ...and the one that comes back from GitHub asks again at once
  expect(again.identities.map((identity) => identity.host)).toEqual(['github']);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
