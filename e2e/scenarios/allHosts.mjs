import { newContext, navLabels, signInLocal, signOut, apiAs, lineNames, assert } from '../lib/ui.mjs';

const CONFIG_NAV = ['Configuration'];

const openUserMenu = async (page) => {
  await page.locator('.user-dropdown-btn').click();
  await page.locator('.user-menu__heading').first().waitFor();
};

/** Adds the account on a host to who is signed in, through the host's own page (the dev ones land straight back). */
const connect = async (page, base, host) => {
  await page.goto(`${base}/`);
  await openUserMenu(page);
  const linked = page.waitForResponse((res) => res.url().endsWith(`/api/users/identities/${host}`) && res.request().method() === 'POST', { timeout: 30_000 });
  await page.locator(`[data-git-connect=${host}]`).click();
  assert.equal((await linked).status(), 200);
  await page.waitForURL((url) => url.pathname === '/' && !url.searchParams.has('code'), { timeout: 30_000 });
  await page.locator('.app-nav__item').first().waitFor();
};

/** Picks a remote in the profile switch: the app starts over on it. */
const switchTo = async (page, host) => {
  await page.locator('[data-profile-switcher] button').click();
  await page.locator(`[data-profile=${host}]`).click();
  await page.locator(`[data-profile-switcher][data-active-profile=${host}]`).waitFor({ timeout: 30_000 });
  await page.locator('.app-nav__item').first().waitFor();
};

const offered = async (page) => {
  await page.locator('[data-profile-switcher] button').click();
  const hosts = await page.locator('[data-profile]').evaluateAll((items) => items.map((item) => item.getAttribute('data-profile')));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/profile-switch-${hosts.join('-')}.png` });
  await page.keyboard.press('Escape');
  return hosts;
};

const shownOnLinesPage = async (page, base) => {
  await page.goto(`${base}/lines`);
  await page.waitForLoadState('networkidle');
  return page.locator('.app-main').innerText();
};

/**
 * The three git hosts on at once, the repositories of the server first: a person signs in to more than one and works on one at a time,
 * choosing the remote (the profile). The analytics plugin is on.
 */
export const allHosts = {
  name: 'all hosts (local, gitlab, github) and the analytics plugin: one remote at a time',
  stack: { hosts: ['local', 'gitlab', 'github'], plugins: ['analytics-plugin'] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();

    await step('the login page has the form of the server and the buttons of GitLab and GitHub', async () => {
      await page.goto(`${base}/login`);
      await page.locator('input[name=username]').waitFor();
      await page.locator('button[name=gitlab-submit]').waitFor();
      await page.locator('button[name=github-submit]').waitFor();
    });

    await step('the administrator signs in with the account of the server: it has one remote, so no profile switch yet', async () => {
      await signInLocal(page, base, 'dev', 'devdevdev');
      assert.equal(await page.locator('[data-profile-switcher]').count(), 0);
      await openUserMenu(page);
      assert.equal(await page.locator('.user-menu__row[data-git-host]').count(), 3);
      assert.equal(await page.locator('[data-git-connect=local], [data-git-disconnect=local]').count(), 0); // already connected, and it is who they are: it cannot go
      await page.keyboard.press('Escape');
      assert.equal((await apiAs(page, api, 'POST', '/lines', { name: 'LineLocal', version: '1.0.0', description: 'e2e', kind: 'plain' })).status, 200);
    });

    await step('GitHub is connected from the user menu, and the profile switch appears with two remotes', async () => {
      await connect(page, base, 'github');
      await page.locator('[data-profile-switcher]').waitFor();
      assert.deepEqual(await offered(page), ['local', 'github']);
      assert.equal(await page.locator('[data-profile-switcher]').getAttribute('data-active-profile'), 'local'); // connecting does not change the remote
    });

    await step('GitLab is connected too: three remotes to choose from', async () => {
      await connect(page, base, 'gitlab');
      assert.deepEqual(await offered(page), ['local', 'gitlab', 'github']);
    });

    await step('signing out of GitLab keeps the session and the other remotes; it can be connected again', async () => {
      await openUserMenu(page);
      const gone = page.waitForResponse((res) => res.url().endsWith('/api/users/identities/gitlab') && res.request().method() === 'DELETE', { timeout: 30_000 });
      await page.locator('[data-git-disconnect=gitlab]').click();
      assert.equal((await gone).status(), 200);
      await page.locator('[data-git-connect=gitlab]').waitFor();
      assert.deepEqual(await offered(page), ['local', 'github']);
      await connect(page, base, 'gitlab');
      assert.deepEqual(await offered(page), ['local', 'gitlab', 'github']);
    });

    await step('on the server remote only its lines are shown, not those of the others', async () => {
      assert.deepEqual(await lineNames(page, api), ['LineLocal']);
      assert.match(await shownOnLinesPage(page, base), /LineLocal/);
    });

    await step('switching to GitHub starts over on it: no lines yet, its words, and a new line is made there', async () => {
      await switchTo(page, 'github');
      assert.deepEqual(await lineNames(page, api), []);
      assert.doesNotMatch(await shownOnLinesPage(page, base), /LineLocal/);
      await page.goto(`${base}/add`);
      await page.getByText('The GitHub group that will hold the repository.').waitFor();
      const made = await apiAs(page, api, 'POST', '/lines', { name: 'LineGithub', version: '1.0.0', description: 'e2e', kind: 'plain' });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      assert.equal(made.body.gitHost, 'github');
      assert.deepEqual(await lineNames(page, api), ['LineGithub']);
    });

    await step('switching to GitLab: its own (empty) list, its words, and a line made there', async () => {
      await switchTo(page, 'gitlab');
      assert.deepEqual(await lineNames(page, api), []);
      await page.goto(`${base}/add`);
      await page.getByText('The GitLab group that will hold the repository.').waitFor();
      const made = await apiAs(page, api, 'POST', '/lines', { name: 'LineGitlab', version: '1.0.0', description: 'e2e', kind: 'plain' });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      assert.equal(made.body.gitHost, 'gitlab');
      assert.deepEqual(await lineNames(page, api), ['LineGitlab']);
    });

    await step('back on the server remote only its line is there, with the words of the server', async () => {
      await switchTo(page, 'local');
      assert.deepEqual(await lineNames(page, api), ['LineLocal']);
      const text = await shownOnLinesPage(page, base);
      assert.match(text, /LineLocal/);
      assert.doesNotMatch(text, /LineGithub|LineGitlab/);
    });

    await step('the remote chosen is kept: signing out and in again lands on it', async () => {
      await switchTo(page, 'github');
      await signOut(page);
      await signInLocal(page, base, 'dev', 'devdevdev');
      await page.locator('[data-profile-switcher]').waitFor();
      assert.equal(await page.locator('[data-profile-switcher]').getAttribute('data-active-profile'), 'github');
      assert.deepEqual(await lineNames(page, api), ['LineGithub']);
    });

    // the dev GitHub and GitLab only have one person, `dev`, so the second person is an account of the server
    await step('someone with only an account of the server is no administrator, sees no configuration, no profile switch, and only the server remote', async () => {
      assert.equal((await apiAs(page, api, 'POST', '/users', { username: 'ana', password: 'anapass12' })).status, 201);
      const second = await newContext(browser);
      const other = await second.newPage();
      await signInLocal(other, base, 'ana', 'anapass12');
      const labels = await navLabels(other);
      for (const label of CONFIG_NAV) assert.ok(!labels.includes(label), `${label} must not be in ${labels}`);
      assert.equal(await other.locator('[data-profile-switcher]').count(), 0);
      assert.equal((await apiAs(other, api, 'GET', '/settings/git-hosts')).status, 403);
      assert.equal((await apiAs(other, api, 'GET', '/plugins')).status, 403);
      const lines = await lineNames(other, api);
      assert.ok(lines.includes('LineLocal') && !lines.includes('LineGithub') && !lines.includes('LineGitlab'), `${lines}`);
      await other.goto(`${base}/settings/git-hosts`);
      await other.waitForURL((url) => url.pathname === '/');

      // the server does not let her work on a remote she has no account on, nor on one that does not exist
      assert.equal((await apiAs(other, api, 'PUT', '/users/profile', { host: 'github' })).status, 403);
      assert.equal((await apiAs(other, api, 'PUT', '/users/profile', { host: 'nowhere' })).status, 400);
      assert.equal((await apiAs(other, api, 'PUT', '/users/profile', { host: 'local' })).status, 200);
      const made = await apiAs(other, api, 'POST', '/lines', { name: 'LineOfAna', version: '1.0.0', description: 'e2e', kind: 'plain', host: 'github' });
      assert.equal(made.status, 403, 'a line cannot be made on a remote she is not signed in to');
      await second.close();
    });

    await step('the administrator switches GitHub off in Git hosts: it goes from the choices, and the profile falls back to their own remote', async () => {
      await page.goto(`${base}/settings/git-hosts`);
      const github = page.locator('[data-host=github]');
      await github.getByRole('button', { name: 'Disable' }).click();
      // it has a line and a person on it: the page says so and waits for a yes
      await github.getByText(/line\(s\)/).waitFor();
      await github.getByRole('button', { name: 'Switch off anyway' }).click();
      await github.getByRole('button', { name: 'Enable' }).waitFor();
      await page.goto(`${base}/`);
      await page.locator('[data-profile-switcher]').waitFor();
      assert.equal(await page.locator('[data-profile-switcher]').getAttribute('data-active-profile'), 'local');
      assert.deepEqual(await offered(page), ['local', 'gitlab']);
      assert.deepEqual(await lineNames(page, api), ['LineLocal']);
    });

    await step('and switched on again, it is back, with the line it had', async () => {
      await page.goto(`${base}/settings/git-hosts`);
      await page.locator('[data-host=github]').getByRole('button', { name: 'Enable' }).click();
      await page.locator('[data-host=github]').getByRole('button', { name: 'Disable' }).waitFor();
      await page.goto(`${base}/`);
      await page.locator('[data-profile-switcher]').waitFor();
      assert.deepEqual(await offered(page), ['local', 'gitlab', 'github']);
      await switchTo(page, 'github');
      assert.deepEqual(await lineNames(page, api), ['LineGithub']);
    });

    await context.close();
  },
};
