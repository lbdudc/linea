import { newContext, navLabels, signInLocal, apiAs, assert } from '../lib/ui.mjs';

// What a deployment says in a linea.config.yml: GitLab is the primary host, the server's own repositories and GitHub are on as well,
// and one plugin: all of it is the file's, and the administrator cannot change it from the pages.
const CONFIG = ({ data }) => `gitHosts:
  primary: gitlab
  local:
    dataDir: ${data}/repos
  github: {}
plugins:
  analytics-plugin:
    enabled: true
`;

/** The configuration is a file: its hosts and plugins are locked in the pages, and the file can be downloaded again. */
export const declared = {
  name: 'declared in linea.config.yml (gitlab primary + local + github, analytics plugin): locked for everyone',
  stack: { hosts: ['gitlab', 'github'], plugins: [], config: CONFIG },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();

    await step('the login page offers the three hosts', async () => {
      await page.goto(`${base}/login`);
      await page.locator('input[name=username]').waitFor();
      await page.locator('button[name=gitlab-submit]').waitFor();
      await page.locator('button[name=github-submit]').waitFor();
      assert.equal((await (await fetch(`${api}/users/config`)).json()).primary, 'gitlab');
    });

    await step('the administrator sees every host on, GitLab as the primary, and the file\'s hosts locked', async () => {
      await signInLocal(page, base, 'dev', 'devdevdev');
      await page.goto(`${base}/settings/git-hosts`);
      for (const host of ['local', 'github']) {
        const card = page.locator(`[data-host=${host}]`);
        await card.waitFor();
        await card.getByText('linea.config.yml').waitFor();
        assert.equal(await card.getByRole('button', { name: 'Disable' }).isDisabled(), true, `${host} cannot be switched off from the page`);
      }
      // GitLab is on from the environment, not from the file: only the file's are locked
      const gitlab = page.locator('[data-host=gitlab]');
      await gitlab.getByText('Primary').waitFor();
      assert.equal(await gitlab.getByText('linea.config.yml').count(), 0);
    });

    await step('the plugin of the file is locked in the Plugins page too', async () => {
      await page.goto(`${base}/settings/plugins`);
      const card = page.locator('[data-plugin=analytics-plugin]');
      await card.getByText('linea.config.yml').waitFor();
      assert.equal(await card.getByRole('button', { name: 'Disable' }).isDisabled(), true);
    });

    await step('and the server says no as well to a change of what the file declares', async () => {
      const host = await apiAs(page, api, 'PUT', '/settings/git-hosts/github', { enabled: false });
      assert.ok(host.status >= 400 && host.status < 500, `git host: ${host.status}`);
      const plugin = await apiAs(page, api, 'POST', '/plugins/analytics-plugin/disable', {});
      assert.ok(plugin.status >= 400 && plugin.status < 500, `plugin: ${plugin.status}`);
      assert.ok((await apiAs(page, api, 'GET', '/plugins/enabled')).body.some((entry) => entry.id === 'analytics-plugin'));
    });

    await step('the config of the deployment can be downloaded by the administrator, with no secret in it', async () => {
      const { status, body } = await apiAs(page, api, 'GET', '/plugins/config.yml');
      assert.equal(status, 200);
      assert.match(body, /primary: gitlab/);
      assert.doesNotMatch(body, /dev-secret/);
    });

    await step('the modules live on the primary host: after connecting GitLab, the Modules page lists them', async () => {
      await page.goto(`${base}/`);
      await page.locator('.user-dropdown-btn').click();
      const linked = page.waitForResponse((res) => res.url().endsWith('/api/users/identities/gitlab') && res.request().method() === 'POST', { timeout: 30_000 });
      await page.locator('[data-git-connect=gitlab]').click();
      assert.equal((await linked).status(), 200);
      await page.waitForURL((url) => url.pathname === '/' && !url.searchParams.has('code'), { timeout: 30_000 });
      await page.goto(`${base}/modules`);
      await page.getByText('main-component').first().waitFor({ timeout: 30_000 });
    });

    await step('a plain person sees none of it', async () => {
      assert.equal((await apiAs(page, api, 'POST', '/users', { username: 'ana', password: 'anapass12' })).status, 201);
      const second = await newContext(browser);
      const other = await second.newPage();
      await signInLocal(other, base, 'ana', 'anapass12');
      const labels = await navLabels(other);
      for (const label of ['Configuration']) assert.ok(!labels.includes(label), `${label} must not be in ${labels}`);
      assert.equal((await apiAs(other, api, 'GET', '/plugins/config.yml')).status, 403);
      await second.close();
    });

    await context.close();
  },
};
