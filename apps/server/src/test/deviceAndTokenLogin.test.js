import { vi, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';

// a GitLab with the device flow and a GitHub without it; the tokens it knows are the ones in `known`
const known = new Map(); // token -> host user
let polls = [];
const gitlab = {
  kind: 'gitlab',
  authConfig: () => ({ kind: 'gitlab', clientId: 'c', redirectUri: 'http://app/login', url: 'http://gitlab', authorizeUrl: 'http://gitlab/authorize', scope: 'api' }),
  exchangeCode: async ({ code, redirectUri }) => {
    known.set(`tok-${code}`, { username: code, avatarUrl: 'a.png' });
    gitlab.lastRedirect = redirectUri;
    return { accessToken: `tok-${code}`, refreshToken: null };
  },
  getUser: async ({ token }) => { if (!known.has(token)) throw new Error('401'); return known.get(token); },
  refreshToken: async ({ accessToken }) => ({ accessToken, refreshToken: null }),
  startDeviceAuthorization: async () => ({ deviceCode: 'dc', userCode: 'AAAA-BBBB', verificationUri: 'http://gitlab/device', expiresIn: 600, interval: 5 }),
  pollDeviceAuthorization: async ({ deviceCode }) => {
    const next = polls.shift();
    if (next instanceof Error) throw next;
    if (next === 'done') { known.set('tok-dev', { username: 'dev', avatarUrl: 'd.png' }); return { status: 'done', tokens: { accessToken: 'tok-dev', refreshToken: null } }; }
    return { status: 'pending', interval: 5, deviceCode };
  },
  rollback: async () => {},
};
const github = { ...gitlab, kind: 'github', startDeviceAuthorization: undefined, pollDeviceAuthorization: undefined };
let deviceFlow = true;

vi.mock('../model/git/index.js', async () => ({
  hostDescriptor: (await import('@lbdudc/linea-git')).hostDescriptor,
  enabledHosts: () => ['gitlab', 'github'],
  primaryHost: () => 'gitlab',
  getGitProvider: ({ host } = {}) => (host === 'github' ? github : gitlab),
  hostTerms: (host) => ({ name: host }),
  hostSettings: (host) => (host === 'gitlab' ? { deviceFlow } : {}),
  gitConfig: (host = 'gitlab') => ({ provider: host, gitlab: { url: 'http://gitlab' }, github: { webUrl: 'http://github', apiUrl: 'http://github/api' } }),
}));

const { default: UserService } = await import('../model/services/UserService.js');
const { default: userRouter } = await import('../rest/routers/userRouter.js');
const { onError } = await import('../rest/common/onError.js');
const { signInLimiter } = await import('../rest/common/rateLimit.js');
const userService = Container.get(UserService);

const app = express();
app.use(express.json());
app.use('/api/users', userRouter);
app.use(onError);

beforeAll(setup);
beforeEach(() => { known.clear(); polls = []; deviceFlow = true; signInLimiter.clear(); });
afterEach(clear);
afterAll(teardown);

test('the config says which hosts can sign in from a terminal, by token and by password', async () => {
  const { hosts } = (await request(app).get('/api/users/config')).body;
  expect(hosts.find((h) => h.id === 'gitlab')).toMatchObject({ device: true, token: true, password: false });
  expect(hosts.find((h) => h.id === 'github')).toMatchObject({ device: false, token: true });
  deviceFlow = false;
  expect((await request(app).get('/api/users/config')).body.hosts.find((h) => h.id === 'gitlab').device).toBe(false);
});

test('a token signs in someone who has signed in before, and is never kept', async () => {
  await userService.loginUserFromGitLab({ code: 'ana', host: 'gitlab' }); // ana exists now
  known.set('glpat-ana', { username: 'ana' });

  const res = await request(app).post('/api/users/login/gitlab/token').send({ token: 'glpat-ana' });
  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ username: 'ana', hosts: ['gitlab'] });
  const stored = JSON.stringify((await User.findOne({ username: 'ana' }).lean()));
  expect(stored).not.toContain('glpat-ana');
});

test('a token of a host account nobody signed in with is 403 NO_LINEA_ACCOUNT, and a token the host does not know is 401', async () => {
  known.set('glpat-new', { username: 'newbie' });
  const nobody = await request(app).post('/api/users/login/gitlab/token').send({ token: 'glpat-new' });
  expect(nobody.status).toBe(403);
  expect(nobody.body.error).toBe('error_messages.no_linea_account');
  expect(await User.countDocuments({ username: 'newbie' })).toBe(0);

  expect((await request(app).post('/api/users/login/gitlab/token').send({ token: 'nope' })).status).toBe(401);
  expect((await request(app).post('/api/users/login/gitlab/token').send({})).status).toBe(400); // no token at all is a malformed request
});

test('a disabled person cannot sign in with a token', async () => {
  const user = await userService.loginUserFromGitLab({ code: 'ana', host: 'gitlab' });
  await User.updateOne({ _id: user._id }, { disabled: true });
  known.set('glpat-ana', { username: 'ana' });
  expect((await request(app).post('/api/users/login/gitlab/token').send({ token: 'glpat-ana' })).status).toBe(401);
});

test('wrong tokens are counted: after too many the door closes', async () => {
  let last;
  for (let n = 0; n < 40; n += 1) last = await request(app).post('/api/users/login/gitlab/token').send({ token: `bad-${n}` });
  expect(last.status).toBe(429);
});

test('the device flow starts, is pending, then signs in and makes the person like any code sign-in', async () => {
  const start = await request(app).post('/api/users/device/gitlab');
  expect(start.status).toBe(200);
  expect(start.body).toMatchObject({ deviceCode: 'dc', userCode: 'AAAA-BBBB', verificationUri: 'http://gitlab/device' });

  polls = ['pending', 'done'];
  const pending = await request(app).post('/api/users/login/gitlab/device').send({ device_code: 'dc' });
  expect(pending.status).toBe(202);
  expect(pending.body).toMatchObject({ status: 'pending', interval: 5 });
  const done = await request(app).post('/api/users/login/gitlab/device').send({ device_code: 'dc' });
  expect(done.status).toBe(200);
  expect(done.body.user).toMatchObject({ username: 'dev' });
  expect(done.body.token).toBeTruthy();
});

test('the device flow answers what ended it: expired 410, denied 403, off in the host 409, none 400', async () => {
  const error = (reason) => Object.assign(new Error(reason), { name: 'GitDeviceFlowError', reason });
  for (const [reason, status] of [['expired_token', 410], ['access_denied', 403], ['device_flow_disabled', 409]]) {
    polls = [error(reason)];
    expect((await request(app).post('/api/users/login/gitlab/device').send({ device_code: 'dc' })).status).toBe(status);
  }
  expect((await request(app).post('/api/users/device/github')).status).toBe(400); // no flow in GitHub's provider here
  deviceFlow = false;
  expect((await request(app).post('/api/users/device/gitlab')).status).toBe(400); // an administrator turned it off
});

test('a device sign-in can link an account to the person who is signed in', async () => {
  const me = await userService.loginUserFromGitLab({ code: 'ana', host: 'github' });
  const { generateToken } = await import('../rest/common/auth.js');
  const jwt = generateToken({ userId: me._id, username: me.username });
  await User.updateOne({ _id: me._id }, { $push: { activeSessions: { token: jwt, expiresAt: new Date(Date.now() + 3600e3), sessionId: 's' } } });

  polls = ['done'];
  const res = await request(app).post('/api/users/identities/gitlab/device').set('Authorization', `Bearer ${jwt}`).send({ device_code: 'dc' });
  expect(res.status).toBe(200);
  expect(res.body.hosts).toEqual(['github', 'gitlab']);
});

test('a native link takes the code of a terminal (loopback redirect) and refuses any other redirect', async () => {
  const me = await userService.loginUserFromGitLab({ code: 'ana', host: 'github' });
  const { generateToken } = await import('../rest/common/auth.js');
  const jwt = generateToken({ userId: me._id, username: me.username });
  await User.updateOne({ _id: me._id }, { $push: { activeSessions: { token: jwt, expiresAt: new Date(Date.now() + 3600e3), sessionId: 's' } } });
  const link = (body, auth = true) => request(app).post('/api/users/identities/gitlab/native').set(auth ? { Authorization: `Bearer ${jwt}` } : {}).send(body);

  expect((await link({ code: 'ana-gl', redirect_uri: 'http://127.0.0.1:53682/callback' }, false)).status).toBe(401);
  expect((await link({ code: 'ana-gl', redirect_uri: 'http://evil.example/callback' })).status).toBe(400);
  const ok = await link({ code: 'ana-gl', redirect_uri: 'http://127.0.0.1:53682/callback' });
  expect(ok.status).toBe(200);
  expect(ok.body.hosts).toEqual(['github', 'gitlab']);
  expect(gitlab.lastRedirect).toBe('http://127.0.0.1:53682/callback');
});
