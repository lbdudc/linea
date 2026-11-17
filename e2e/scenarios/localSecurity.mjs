import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { newContext, signInLocal, signOut, apiAs, assert } from '../lib/ui.mjs';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@x', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@x' } });
const refused = async (promise) => { try { await promise; } catch (error) { return String(error.stderr ?? error); } throw new Error('git should have refused'); };

/** The repositories of the server itself, with accounts: what git over HTTP lets a person do, and what happens to a token. */
export const localSecurity = {
  name: 'local host security: git permissions, protected branch, tokens, sign-in limits',
  stack: { hosts: ['local'], plugins: [] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const gitBase = api.replace(/\/api$/, '/git');
    const work = mkdtempSync(path.join(tmpdir(), 'linea-e2e-git-'));
    const admin = await newContext(browser);
    const page = await admin.newPage();
    let line;
    let anaToken;
    let anaSession;

    const credentialsOf = async (username, password) => {
      const login = await fetch(`${api}/users/login/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      assert.equal(login.status, 200);
      const { token } = await login.json();
      const creds = await (await fetch(`${api}/users/git-credentials`, { headers: { Authorization: `Bearer ${token}` } })).json();
      return { session: token, git: creds.token };
    };
    const cloneUrl = (username, token) => `${gitBase.replace('://', `://${username}:${token}@`)}/${line.webUrl.split('/git/')[1]}.git`;

    try {
      await step('the administrator makes accounts for ana and bob', async () => {
        await signInLocal(page, base, 'dev', 'devdevdev');
        for (const username of ['ana', 'bob']) {
          const made = await apiAs(page, api, 'POST', '/users', { username, password: `${username}-pass-12` });
          assert.equal(made.status, 201, JSON.stringify(made.body));
        }
        // a name that would be a path or a group is not an account
        assert.equal((await apiAs(page, api, 'POST', '/users', { username: 'registry', password: 'registry-pass' })).status, 400);
      });

      await step('ana makes a line and clones its repository with her git token', async () => {
        const creds = await credentialsOf('ana', 'ana-pass-12');
        anaSession = creds.session;
        anaToken = creds.git;
        const made = await fetch(`${api}/lines`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anaSession}` }, body: JSON.stringify({ name: 'Secure', version: '1.0.0', description: 'e2e', kind: 'plain' }) });
        const text = await made.text();
        assert.equal(made.status, 200, text);
        line = JSON.parse(text);
        await git(work, 'clone', '--quiet', cloneUrl('ana', anaToken), 'ana');
      });

      await step('the default branch cannot be force-pushed or deleted, not even by the owner; other branches are free', async () => {
        const ana = path.join(work, 'ana');
        writeFileSync(path.join(ana, 'notes.txt'), 'one');
        await git(ana, 'add', '.');
        await git(ana, 'commit', '--quiet', '-m', 'one');
        await git(ana, 'push', '--quiet', 'origin', 'HEAD');
        await git(ana, 'commit', '--quiet', '--amend', '-m', 'rewritten');
        assert.match(await refused(git(ana, 'push', '--force', 'origin', 'HEAD')), /force-pushed/);
        const branch = (await git(ana, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
        assert.match(await refused(git(ana, 'push', 'origin', `:${branch}`)), /cannot be deleted/);
        await git(ana, 'push', '--quiet', 'origin', 'HEAD:refs/heads/topic');
        await git(ana, 'push', '--quiet', '--force', 'origin', 'HEAD:refs/heads/topic');
      });

      await step('ana makes bob a reporter in the Members dialog: he can clone, he cannot push', async () => {
        const context = await newContext(browser);
        const anaPage = await context.newPage();
        await signInLocal(anaPage, base, 'ana', 'ana-pass-12');
        await anaPage.goto(`${base}/lines/${line._id}`);
        // members are managed from the menu of the line's header
        await anaPage.locator('.detalle-cabecera__mas').click();
        await anaPage.locator('.overflow-menu .p-menu-item:has(.pi-users)').click();
        await anaPage.locator('input[name=member-username]').fill('bob');
        await anaPage.locator('button[name=add-member]').click();
        await anaPage.locator('[data-member=bob]').waitFor();
        // a reporter: the select of his row
        const set = await fetch(`${api}/lines/${line._id}/members/bob`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anaSession}` }, body: JSON.stringify({ role: 20 }) });
        assert.equal(set.status, 200);
        await context.close();

        const bob = await credentialsOf('bob', 'bob-pass-12');
        await git(work, 'clone', '--quiet', cloneUrl('bob', bob.git), 'bob');
        writeFileSync(path.join(work, 'bob', 'bob.txt'), 'bob');
        await git(path.join(work, 'bob'), 'add', '.');
        await git(path.join(work, 'bob'), 'commit', '--quiet', '-m', 'bob');
        assert.match(await refused(git(path.join(work, 'bob'), 'push', 'origin', 'HEAD:refs/heads/bobs')), /403|not allowed/i);
      });

      await step('a regenerated token closes the old one at once, on git and on the API', async () => {
        const context = await newContext(browser);
        const anaPage = await context.newPage();
        await signInLocal(anaPage, base, 'ana', 'ana-pass-12');
        await anaPage.locator('.user-dropdown-btn').click();
        await anaPage.locator('[data-account-menu]').click();
        await anaPage.locator('button[name=regenerate-token]').click();
        await anaPage.locator('[data-account-dialog] input[readonly]').waitFor();
        const fresh = await anaPage.locator('[data-account-dialog] input[readonly]').inputValue();
        assert.match(fresh, /^[0-9a-f]{64}$/);
        assert.notEqual(fresh, anaToken);
        await context.close();

        assert.match(await refused(git(work, 'ls-remote', cloneUrl('ana', anaToken))), /401|Authentication failed|could not read/i);
        await git(work, 'ls-remote', cloneUrl('ana', fresh));
        const old = await fetch(`${api}/users/git-credentials`, { headers: { Authorization: `GitToken ${anaToken}` } });
        assert.equal(old.status, 401);
        const renewed = await fetch(`${api}/users/git-credentials`, { headers: { Authorization: `GitToken ${fresh}` } });
        assert.equal(renewed.status, 200);
      });

      await step('wrong passwords close the door for a while, for that person only', async () => {
        for (let i = 0; i < 10; i += 1) {
          const res = await fetch(`${api}/users/login/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: 'not-the-one' }) });
          assert.equal(res.status, 401);
        }
        const blocked = await fetch(`${api}/users/login/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: 'bob-pass-12' }) });
        assert.equal(blocked.status, 429);
        const other = await fetch(`${api}/users/login/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ana', password: 'ana-pass-12' }) });
        assert.equal(other.status, 200);
      });

      await step('a disabled account cannot sign in; the administrator can turn it back on', async () => {
        await signOut(page).catch(() => undefined);
        await signInLocal(page, base, 'dev', 'devdevdev');
        await page.goto(`${base}/settings/users`);
        await page.locator('[data-user=ana] button[name=toggle-disabled]').click();
        await page.locator('[data-user=ana] .p-tag', { hasText: 'Disabled' }).waitFor();
        const res = await fetch(`${api}/users/login/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ana', password: 'ana-pass-12' }) });
        assert.equal(res.status, 401);
        await page.locator('[data-user=ana] button[name=toggle-disabled]').click();
        await page.locator('[data-user=ana] .p-tag', { hasText: 'Disabled' }).waitFor({ state: 'detached' });
      });
    } finally {
      await admin.close();
      rmSync(work, { recursive: true, force: true });
    }
  },
};
