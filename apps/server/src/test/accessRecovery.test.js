import { test, expect, beforeAll, beforeEach, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import User from '../model/entities/user.js';
import { setup, clear, teardown } from './setup.js';
import { onError } from '../rest/common/onError.js';
import { configureGitHosts } from '../model/git/index.js';
import { configureInstance } from '../config/instanceSettings.js';
import { mongoInstanceStore } from '../model/entities/instanceSetting.js';
import { hashPassword } from '../model/git/localAccounts.js';
import { signInLimiter } from '../rest/common/rateLimit.js';
import settingsRouter from '../rest/routers/settingsRouter.js';
import userRouter from '../rest/routers/userRouter.js';

beforeAll(async () => { await setup(); await configureGitHosts({ file: { local: {} } }); });
beforeEach(async () => { await configureInstance({ store: mongoInstanceStore }); signInLimiter.clear(); });
afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); await clear(); }); // audit entries are written after the answer
afterAll(async () => { await configureInstance({}); await configureGitHosts({}); await teardown(); });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', userRouter);
  app.use(onError);
  return app;
};

const account = (username, admin = false) => new User({ username, admin, gitHost: 'local', passwordHash: 'x' }).save();
const signIn = async (app, username, password, agent) => {
  const res = await request(app).post('/api/users/login/local').set('User-Agent', agent).send({ username, password });
  return res;
};
const makeLoginable = async (username, admin = false) => {
  const user = await account(username, admin);
  await User.updateOne({ _id: user._id }, { passwordHash: await hashPassword('correct-horse') });
  return user;
};
const auditActions = async (app, root) => (await request(app).get('/api/settings/audit').set('Authorization', `Bearer ${root}`)).body.map((entry) => entry.action);

describe('sessions', () => {
  test('a person sees their sign-ins, ends one, the others, or all; a renewal is the same sign-in', async () => {
    const app = buildApp();
    await makeLoginable('ana');
    const laptop = (await signIn(app, 'ana', 'correct-horse', 'Mozilla/5.0 (Macintosh) Chrome/120')).body.token;
    const phone = (await signIn(app, 'ana', 'correct-horse', 'Mozilla/5.0 (iPhone) Safari')).body.token;
    const renewed = await request(app).post('/api/users/loginFromServiceToken').set('Authorization', `Bearer ${laptop}`).set('User-Agent', 'Mozilla/5.0 (Macintosh) Chrome/120');
    expect(renewed.status).toBe(200);

    let list = (await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${renewed.body.token}`)).body;
    expect(list).toHaveLength(2); // the renewal did not make a third
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.find((s) => s.current).userAgent).toMatch(/Macintosh/);
    expect(JSON.stringify(list)).not.toContain(laptop);

    const phoneSession = list.find((s) => /iPhone/.test(s.userAgent));
    expect((await request(app).delete(`/api/users/me/sessions/${phoneSession.id}`).set('Authorization', `Bearer ${renewed.body.token}`)).status).toBe(204);
    expect((await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${phone}`)).status).toBe(401);
    expect((await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${laptop}`)).status).toBe(200); // the old token of the same sign-in still lives

    const other = (await signIn(app, 'ana', 'correct-horse', 'Firefox')).body.token;
    expect((await request(app).delete('/api/users/me/sessions?others=true').set('Authorization', `Bearer ${other}`)).status).toBe(204);
    expect((await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${renewed.body.token}`)).status).toBe(401);
    list = (await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${other}`)).body;
    expect(list).toHaveLength(1);

    expect((await request(app).delete('/api/users/me/sessions').set('Authorization', `Bearer ${other}`)).status).toBe(204);
    expect((await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${other}`)).status).toBe(401);
  });

  test('an administrator signs a person out everywhere; others cannot', async () => {
    const app = buildApp();
    await makeLoginable('root', true);
    const ana = await makeLoginable('ana');
    await makeLoginable('bea');
    const rootToken = (await signIn(app, 'root', 'correct-horse', 'a')).body.token;
    const anaToken = (await signIn(app, 'ana', 'correct-horse', 'b')).body.token;
    const beaToken = (await signIn(app, 'bea', 'correct-horse', 'c')).body.token;
    expect((await request(app).delete(`/api/users/${ana._id}/sessions`).set('Authorization', `Bearer ${beaToken}`)).status).toBe(403);
    expect((await request(app).delete(`/api/users/${ana._id}/sessions`).set('Authorization', `Bearer ${rootToken}`)).status).toBe(204);
    expect((await request(app).get('/api/users/me/sessions').set('Authorization', `Bearer ${anaToken}`)).status).toBe(401);
    expect(await auditActions(app, rootToken)).toContain('user.sign-out-everywhere');
  });
});

describe('sign-ins in the audit log', () => {
  test('administrators signing in and a lock are recorded once; ordinary sign-ins and wrong passwords are not', async () => {
    const app = buildApp();
    await makeLoginable('root', true);
    await makeLoginable('ana');
    await signIn(app, 'ana', 'correct-horse', 'x');
    const root = (await signIn(app, 'root', 'correct-horse', 'x')).body.token;
    await request(app).put('/api/settings/instance').set('Authorization', `Bearer ${root}`).send({ maxFailedSignIns: 2 });
    for (let n = 0; n < 4; n += 1) await signIn(app, 'ana', 'wrong', 'x');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const actions = await auditActions(app, root);
    expect(actions.filter((action) => action === 'auth.signin')).toHaveLength(1);
    expect(actions.filter((action) => action === 'auth.lockout')).toHaveLength(1);
  });
});

describe('importing a config file', () => {
  const importing = (app, token, text, apply = false) => request(app).post('/api/settings/import').set('Authorization', `Bearer ${token}`).send({ text, apply });

  test('says what would change, changes only when told to, and never removes', async () => {
    const app = buildApp();
    await makeLoginable('root', true);
    const root = (await signIn(app, 'root', 'correct-horse', 'x')).body.token;
    await request(app).put('/api/settings/instance').set('Authorization', `Bearer ${root}`).send({ lockMinutes: 30 });
    const file = 'instance:\n  lockMinutes: 30\n  maxFailedSignIns: 5\n  minPasswordLength: 12\n';

    const dry = await importing(app, root, file);
    expect(dry.status).toBe(200);
    expect(dry.body.applied).toBeNull();
    expect(dry.body.changes.map((change) => change.id)).toEqual(['maxFailedSignIns', 'minPasswordLength']); // lockMinutes is the same already
    expect(JSON.stringify(dry.body)).not.toContain('run');
    expect((await request(app).get('/api/settings/instance').set('Authorization', `Bearer ${root}`)).body.values.maxFailedSignIns).toBe(10);

    const done = await importing(app, root, file, true);
    expect(done.body.applied.every((result) => result.ok)).toBe(true);
    const values = (await request(app).get('/api/settings/instance').set('Authorization', `Bearer ${root}`)).body.values;
    expect(values).toMatchObject({ maxFailedSignIns: 5, minPasswordLength: 12, lockMinutes: 30 });
    expect((await importing(app, root, file)).body.changes).toEqual([]); // nothing left to do
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await auditActions(app, root)).toContain('settings.import');
  });

  test('shows each key before and after, keeps the applied config and puts it back', async () => {
    const app = buildApp();
    await makeLoginable('root', true);
    const root = (await signIn(app, 'root', 'correct-horse', 'x')).body.token;
    const file = 'instance:\n  maxFailedSignIns: 5\n  minPasswordLength: 12\n';
    const dry = await importing(app, root, file);
    expect(dry.body.changes.find((change) => change.id === 'maxFailedSignIns').rows).toEqual([{ key: 'maxFailedSignIns', before: '10', after: '5' }]);
    expect((await request(app).get('/api/settings/import/history').set('Authorization', `Bearer ${root}`)).body).toEqual([]);

    await importing(app, root, file, true);
    const history = (await request(app).get('/api/settings/import/history').set('Authorization', `Bearer ${root}`)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ by: 'root', failed: 0, rolledBackAt: null });
    expect(history[0].changes.map((change) => change.id).sort()).toEqual(['maxFailedSignIns', 'minPasswordLength']);

    const back = await request(app).post(`/api/settings/import/${history[0].id}/rollback`).set('Authorization', `Bearer ${root}`);
    expect(back.body.results.every((result) => result.ok)).toBe(true);
    const values = (await request(app).get('/api/settings/instance').set('Authorization', `Bearer ${root}`)).body.values;
    expect(values).toMatchObject({ maxFailedSignIns: 10, minPasswordLength: 8 });
    expect((await request(app).post(`/api/settings/import/${history[0].id}/rollback`).set('Authorization', `Bearer ${root}`)).status).toBe(409);
    expect((await request(app).get('/api/settings/import/history').set('Authorization', `Bearer ${root}`)).body[0].rolledBackAt).not.toBeNull();
  });

  test('a file that is not valid is refused, a secret from the environment is not copied, and only administrators import', async () => {
    const app = buildApp();
    await makeLoginable('root', true);
    await makeLoginable('ana');
    const root = (await signIn(app, 'root', 'correct-horse', 'x')).body.token;
    const ana = (await signIn(app, 'ana', 'correct-horse', 'x')).body.token;
    expect((await importing(app, root, 'a: [b')).status).toBe(400);
    expect((await importing(app, ana, 'instance: {}')).status).toBe(403);
    // eslint-disable-next-line no-template-curly-in-string
    const withSecret = await importing(app, root, 'gitHosts:\n  github:\n    enabled: true\n    clientId: abc\n    clientSecret: ${GITHUB_CLIENT_SECRET}\n');
    expect(withSecret.status).toBe(200);
    expect(withSecret.body.notes.join('\n')).toMatch(/clientSecret.*not copied/);
    const github = withSecret.body.changes.find((change) => change.id === 'github');
    expect(github.summary.join('\n')).toMatch(/enabled/);
    expect(JSON.stringify(withSecret.body)).not.toMatch(/GITHUB_CLIENT_SECRET.*GITHUB_CLIENT_SECRET.*GITHUB_CLIENT_SECRET/);
  });
});

describe('who a git token belongs to', () => {
  test('is remembered for a moment, and forgotten at once when an account changes', async () => {
    const { resolveLocalUser, forgetLocalUsers } = await import('../model/git/localAccounts.js');
    const { localTokenOf } = await import('../model/git/localToken.js');
    const ana = await makeLoginable('ana');
    const token = localTokenOf(ana);
    expect(await resolveLocalUser(token)).toMatchObject({ username: 'ana' });
    await User.updateOne({ _id: ana._id }, { disabled: true });
    expect(await resolveLocalUser(token)).toMatchObject({ username: 'ana' }); // still the answer of a moment ago
    forgetLocalUsers();
    expect(await resolveLocalUser(token)).toBeNull();
  });
});
