import { newContext, navLabels, signInLocal, signInWith, apiAs, lineNames, assert } from '../lib/ui.mjs';

/**
 * An administrator changes the hosts of a LINEA that already has lines: nothing changes hands, a host with lines needs a yes to go,
 * and another tab hears when a plugin is switched off.
 */
export const hostChanges = {
  name: 'changing hosts and plugins keeps what is there',
  stack: { hosts: ['gitlab'], plugins: ['analytics-plugin'] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();
    const second = await (await newContext(browser)).newPage();

    await step('on GitLab alone, the administrator has a line', async () => {
      await signInWith(page, base, 'gitlab');
      assert.equal((await apiAs(page, api, 'POST', '/lines', { name: 'Kept', version: '1.0.0', description: 'e2e', kind: 'plain' })).status, 200);
      assert.deepEqual(await lineNames(page, api), ['Kept']);
    });

    await step('switching the repositories of the server on does not make them the primary host, and the line stays', async () => {
      await page.goto(`${base}/settings/git-hosts`);
      const local = page.locator('[data-host=local]');
      await local.getByRole('button', { name: 'Enable' }).click();
      await local.getByRole('button', { name: 'Disable' }).waitFor();
      const hosts = (await apiAs(page, api, 'GET', '/settings/git-hosts')).body;
      assert.equal(hosts.primary, 'gitlab');
      assert.deepEqual(hosts.hosts.filter((host) => host.enabled).map((host) => host.id).sort(), ['gitlab', 'local']);
      assert.deepEqual(await lineNames(page, api), ['Kept']);
    });

    await step('the administrator makes the repositories of the server primary, and GitLab again', async () => {
      const local = page.locator('[data-host=local]');
      await local.getByRole('button', { name: 'Make primary' }).click();
      await local.getByText('Primary', { exact: true }).waitFor();
      assert.equal((await apiAs(page, api, 'GET', '/settings/git-hosts')).body.primary, 'local');
      await page.locator('[data-host=gitlab]').getByRole('button', { name: 'Make primary' }).click();
      await page.locator('[data-host=gitlab]').getByText('Primary', { exact: true }).waitFor();
      assert.equal((await apiAs(page, api, 'GET', '/settings/git-hosts')).body.primary, 'gitlab');
    });

    await step('the host of the registry cannot be switched off', async () => {
      const refused = await apiAs(page, api, 'PUT', '/settings/git-hosts/gitlab', { enabled: false, force: true });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.match(refused.body.detail, /registry/);
    });

    await step('switching off a host with people on it says so and waits for a yes; the server refuses it without one', async () => {
      // a person of the server itself: people are on it
      assert.equal((await apiAs(page, api, 'POST', '/users', { username: 'ana', password: 'ana-pass-12' })).status, 201);
      const refused = await apiAs(page, api, 'PUT', '/settings/git-hosts/local', { enabled: false });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.ok(refused.body.preview?.users >= 1, JSON.stringify(refused.body));
      await page.goto(`${base}/settings/git-hosts`);
      const local = page.locator('[data-host=local]');
      await local.getByRole('button', { name: 'Disable' }).click();
      await local.getByText(/line\(s\)/).waitFor();
      await local.getByRole('button', { name: 'Cancel' }).click();
      await local.getByText(/line\(s\)/).waitFor({ state: 'detached' });
      assert.equal((await apiAs(page, api, 'GET', '/settings/git-hosts')).body.hosts.find((host) => host.id === 'local').enabled, true);
    });

    await step('another tab of the same administrator hears that a plugin was switched off (and starts over)', async () => {
      await second.goto(`${base}/`);
      // the second tab signs in as the same person and shows the plugin in the navigation
      await signInWith(second, base, 'gitlab');
      // (this plugin adds no menu: the page is marked, and a reload is what takes the mark away)
      await second.evaluate(() => { window.__tabMark = 'before'; });
      await page.goto(`${base}/settings/plugins`);
      await page.getByRole('button', { name: 'Catalog' }).click();
      const card = page.locator('[data-plugin=analytics-plugin]');
      await card.getByRole('button', { name: 'Disable' }).click();
      await card.getByRole('button', { name: 'Enable' }).waitFor();
      await second.waitForFunction(() => window.__tabMark === undefined, null, { timeout: 15_000 });
    });

    await context.close();
    await second.context().close();
  },
};

/** The agents' service speaks only GitLab: with the repositories of the server alone the plugin is off, hidden, and says why. */
export const agentsNeedGitlab = {
  name: 'a plugin that needs GitLab is off without it',
  stack: { hosts: ['local'], plugins: ['agents-plugin'] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();

    await step('the plugin was asked for, and is not among those the page loads', async () => {
      await signInLocal(page, base, 'dev', 'devdevdev');
      const enabled = (await apiAs(page, api, 'GET', '/plugins/enabled')).body;
      assert.ok(!enabled.some((plugin) => plugin.id === 'agents-plugin'), JSON.stringify(enabled));
      assert.ok(!(await navLabels(page)).includes('Agents'));
    });

    await step('the Plugins page says why, and the server refuses to switch it on', async () => {
      const listed = (await apiAs(page, api, 'GET', '/plugins')).body.find((plugin) => plugin.id === 'agents-plugin');
      assert.match(listed.unavailable, /needs one of these git hosts to be on: gitlab/);
      await page.goto(`${base}/settings/plugins`);
      await page.getByText(/Not available here/).first().waitFor();
      const enable = await apiAs(page, api, 'POST', '/plugins/agents-plugin/enable');
      assert.equal(enable.status, 409, JSON.stringify(enable.body));
    });

    await context.close();
  },
};
