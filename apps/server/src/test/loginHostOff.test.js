import { vi, test, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';

// a person of GitLab who also signed in to GitHub: GitLab gets switched off
let on = ['gitlab', 'github'];
const renewed = [];
vi.mock('../model/git/index.js', () => ({
  enabledHosts: () => on,
  primaryHost: () => 'gitlab',
  getGitProvider: ({ host } = {}) => {
    if (!on.includes(host)) throw Object.assign(new Error(`${host} is off`), { code: 'GIT_HOST_UNAVAILABLE' });
    return {
      kind: host,
      refreshToken: async ({ accessToken }) => { renewed.push(host); return { accessToken: `${accessToken}+`, refreshToken: 'r' }; },
      getUser: async () => ({ avatarUrl: 'a.png' }),
      rollback: async () => {},
    };
  },
}));

const { default: UserService } = await import('../model/services/UserService.js');
const userService = Container.get(UserService);

beforeAll(setup);
afterEach(async () => { await clear(); on = ['gitlab', 'github']; renewed.length = 0; });
afterAll(teardown);

const ana = () => User.create({ username: 'ana', gitHost: 'gitlab', accessToken: 't', refreshToken: 'r', identities: [{ host: 'github', username: 'ana-gh', accessToken: 'g', refreshToken: 'r' }] });

test('a person whose own host is off still signs in through another host of theirs', async () => {
  const user = await ana();
  on = ['github'];
  const session = await userService.loginUserFromId({ userId: user._id });
  expect(session.username).toBe('ana');
  expect(renewed).toEqual(['github']);
});

test('with none of their hosts on the session fails, and says which host is off', async () => {
  const user = await ana();
  on = ['local'];
  await expect(userService.loginUserFromId({ userId: user._id })).rejects.toMatchObject({ code: 'GIT_HOST_UNAVAILABLE' });
});
