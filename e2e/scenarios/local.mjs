import { newContext, navLabels, signInLocal, signOut, apiAs, assert } from '../lib/ui.mjs';

const openMenu = async (page) => {
  await page.locator('.user-dropdown-btn').click();
  await page.locator('.user-menu__row').first().waitFor();
};

const CONFIG_NAV = ['Configuration'];

/** Only the repositories on the server itself, no plugin: configuration belongs to administrators, who also make the others. */
export const local = {
  name: 'local host only, no plugins: administrators configure, people use',
  stack: { hosts: ['local'], plugins: [] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const admin = await newContext(browser);
    const adminPage = await admin.newPage();

    await step('the login page asks for an account of this server, with no button of another host', async () => {
      await adminPage.goto(`${base}/login`);
      await adminPage.locator('input[name=username]').waitFor();
      assert.equal(await adminPage.locator('button[name=gitlab-submit], button[name=github-submit]').count(), 0);
    });

    await step('the administrator sees the configuration in the navigation, and no profile switch (there is one remote)', async () => {
      await signInLocal(adminPage, base, 'dev', 'devdevdev');
      const labels = await navLabels(adminPage);
      for (const label of CONFIG_NAV) assert.ok(labels.includes(label), `${label} in ${labels}`);
      assert.equal(await adminPage.locator('[data-profile-switcher]').count(), 0);
    });

    await step('the administrator makes an account for ana in the Users page', async () => {
      await adminPage.goto(`${base}/settings/users`);
      await adminPage.locator('button[name=add-user]').click();
      await adminPage.locator('input[name=new-username]').fill('ana');
      await adminPage.locator('#new-password').fill('anapass12');
      await adminPage.locator('button[name=save-user]').click();
      await adminPage.locator('[data-user=ana]').waitFor();
      assert.equal(await adminPage.locator('[data-user=ana] .p-tag').count(), 0);
    });

    await step('the administrator installs and switches on a plugin from the Plugins page, and off again', async () => {
      await adminPage.goto(`${base}/settings/plugins`);
      await adminPage.getByRole('button', { name: 'Catalog' }).click();
      const card = adminPage.locator('[data-plugin=analytics-plugin]');
      await card.getByRole('button', { name: 'Install' }).click();
      await card.getByRole('button', { name: 'Enable' }).click();
      await card.getByRole('button', { name: 'Disable' }).waitFor();
      const enabled = (await apiAs(adminPage, api, 'GET', '/plugins/enabled')).body;
      assert.ok(enabled.some((plugin) => plugin.id === 'analytics-plugin'), 'analytics-plugin is enabled');
      await card.getByRole('button', { name: 'Disable' }).click();
      await card.getByRole('button', { name: 'Enable' }).waitFor();
      assert.ok(!(await apiAs(adminPage, api, 'GET', '/plugins/enabled')).body.some((plugin) => plugin.id === 'analytics-plugin'), 'analytics-plugin is off');
      await card.getByRole('button', { name: 'Enable' }).click(); // left on, for what comes next
      await card.getByRole('button', { name: 'Disable' }).waitFor();
    });

    await step('the administrator sets how many wrong passwords lock the door, and the server obeys it', async () => {
      await adminPage.goto(`${base}/settings/sign-in`);
      const field = adminPage.locator('[data-setting=maxFailedSignIns] input');
      await field.fill('3');
      await field.press('Tab'); // the number is taken when the field is left
      await adminPage.getByRole('button', { name: 'Save' }).click();
      await adminPage.getByText('Saved.').first().waitFor();
      assert.equal((await apiAs(adminPage, api, 'GET', '/settings/instance')).body.values.maxFailedSignIns, 3);
      const wrong = async () => (await apiAs(adminPage, api, 'POST', '/users/login/local', { username: 'ghost', password: 'wrong-password' })).status;
      assert.deepEqual([await wrong(), await wrong(), await wrong(), await wrong()], [401, 401, 401, 429]);
    });

    await step('the audit log shows who did it, and the account made before', async () => {
      await adminPage.goto(`${base}/settings/audit`);
      await adminPage.locator('[data-audit="settings.instance"]').first().waitFor();
      await adminPage.locator('[data-audit="user.create"]').first().waitFor();
      assert.match(await adminPage.locator('[data-audit="user.create"]').first().innerText(), /dev/);
    });

    await step('the configuration file can be downloaded, with what was just set', async () => {
      await adminPage.goto(`${base}/settings/backup`);
      const [download] = await Promise.all([adminPage.waitForEvent('download'), adminPage.locator('[data-backup=config]').click()]);
      assert.equal(download.suggestedFilename(), 'linea.config.yml');
      const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
      assert.match(text, /instance:\n {2}maxFailedSignIns: 3/);
    });

    await step('a person sees where they are signed in, and ends the other sign-ins', async () => {
      const other = await newContext(browser);
      const otherPage = await other.newPage();
      await signInLocal(otherPage, base, 'dev', 'devdevdev');
      await adminPage.goto(`${base}/`);
      await openMenu(adminPage);
      await adminPage.locator('[data-sessions-menu]').click();
      await adminPage.locator('[data-session]').nth(1).waitFor(); // this one and the other browser
      assert.equal(await adminPage.locator('[data-session]').count(), 2);
      await adminPage.locator('[data-end-others]').click();
      await adminPage.locator('[data-session]').nth(1).waitFor({ state: 'detached' });
      await otherPage.goto(`${base}/lines`);
      await otherPage.waitForURL((url) => url.pathname === '/login', { timeout: 20_000 });
      await other.close();
      await adminPage.keyboard.press('Escape');
    });

    await step('a configuration file is checked before anything changes, and applied on a yes', async () => {
      await adminPage.goto(`${base}/settings/backup`);
      await adminPage.locator('input[name=config-file]').setInputFiles({ name: 'linea.config.yml', mimeType: 'text/yaml', buffer: Buffer.from('instance:\n  maxFailedSignIns: 6\n  lockMinutes: 20\n') });
      await adminPage.locator('[data-change="instance:maxFailedSignIns"]').waitFor();
      await adminPage.locator('[data-change="instance:lockMinutes"]').waitFor();
      assert.equal((await apiAs(adminPage, api, 'GET', '/settings/instance')).body.values.maxFailedSignIns, 3); // only looked at
      await adminPage.locator('[data-backup=apply]').click();
      await adminPage.getByText('change(s) made').first().waitFor();
      const { values } = (await apiAs(adminPage, api, 'GET', '/settings/instance')).body;
      assert.equal(values.maxFailedSignIns, 6);
      assert.equal(values.lockMinutes, 20);
    });

    await step('ana signs in: no configuration in the navigation, and the profile switch is not there either', async () => {
      await signOut(adminPage);
      await signInLocal(adminPage, base, 'ana', 'anapass12');
      const labels = await navLabels(adminPage);
      for (const label of CONFIG_NAV) assert.ok(!labels.includes(label), `${label} must not be in ${labels}`);
      for (const label of ['Lines', 'Products', 'CI/CD']) assert.ok(labels.includes(label), `${label} in ${labels}`);
    });

    await step('ana typing the address of a configuration page is sent home', async () => {
      for (const path of ['/settings', '/settings/plugins', '/settings/git-hosts', '/settings/users', '/settings/sign-in', '/settings/audit', '/settings/backup']) {
        await adminPage.goto(`${base}${path}`);
        await adminPage.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
      }
    });

    await step('the server refuses her the configuration even if she asks it herself', async () => {
      for (const [method, path] of [['GET', '/plugins'], ['GET', '/plugins/config.yml'], ['PUT', '/plugins/analytics-plugin/settings'], ['POST', '/plugins/analytics-plugin/disable'], ['GET', '/settings/git-hosts'], ['PUT', '/settings/git-hosts/github'], ['GET', '/settings/instance'], ['PUT', '/settings/instance'], ['GET', '/settings/audit'], ['POST', '/settings/import'], ['DELETE', '/users/000000000000000000000000/sessions'], ['GET', '/users'], ['POST', '/users'], ['PUT', '/users/000000000000000000000000/admin']]) {
        const { status } = await apiAs(adminPage, api, method, path, {});
        assert.equal(status, 403, `${method} ${path}`);
      }
      assert.equal((await apiAs(adminPage, api, 'GET', '/plugins/enabled')).status, 200); // what the page needs to start stays open
    });

    await step('what is for everyone still works for her: she makes a line', async () => {
      const made = await apiAs(adminPage, api, 'POST', '/lines', { name: 'AnasLine', version: '1.0.0', description: 'e2e', kind: 'plain' });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      await adminPage.goto(`${base}/lines`);
      await adminPage.getByText('AnasLine').first().waitFor({ timeout: 20_000 });
    });

    await step('the administrator makes ana an administrator, and she then sees the configuration', async () => {
      await signOut(adminPage);
      await signInLocal(adminPage, base, 'dev', 'devdevdev');
      await adminPage.goto(`${base}/settings/users`);
      await adminPage.locator('[data-user=ana] button[name=toggle-admin]').click();
      await adminPage.locator('[data-user=ana] .p-tag').waitFor();
      await signOut(adminPage);
      await signInLocal(adminPage, base, 'ana', 'anapass12');
      const labels = await navLabels(adminPage);
      for (const label of CONFIG_NAV) assert.ok(labels.includes(label), `${label} in ${labels}`);
    });

    await step('the last administrator cannot be taken away', async () => {
      await adminPage.goto(`${base}/settings/users`);
      await adminPage.locator('[data-user=dev] button[name=toggle-admin]').click(); // two administrators: allowed
      await adminPage.locator('[data-user=dev] .p-tag').waitFor({ state: 'detached' });
      await adminPage.locator('[data-user=ana] button[name=toggle-admin]').click(); // she is the last one
      await adminPage.getByText('There must be at least one administrator.').first().waitFor();
      assert.ok(await adminPage.locator('[data-user=ana] .p-tag').count() > 0);
    });

    await admin.close();
  },
};
