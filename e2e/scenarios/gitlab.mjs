import { newContext, navLabels, signInWith, signOut, apiAs, lineNames, assert } from '../lib/ui.mjs';

/** A GitLab as the only git host, and the analytics plugin: people sign in with GitLab, there is no account form. */
export const gitlabOnly = {
  name: 'gitlab only, analytics plugin',
  stack: { hosts: ['gitlab'], plugins: ['analytics-plugin'] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();

    await step('the login page has the button of GitLab and no form for accounts of the server', async () => {
      await page.goto(`${base}/login`);
      await page.locator('button[name=gitlab-submit]').waitFor();
      assert.equal(await page.locator('input[name=username]').count(), 0);
      assert.equal(await page.locator('button[name=github-submit]').count(), 0);
    });

    await step('signing in with GitLab: the user of ADMIN_USERS is an administrator and sees the configuration', async () => {
      await signInWith(page, base, 'gitlab');
      const labels = await navLabels(page);
      for (const label of ['Configuration']) assert.ok(labels.includes(label), `${label} in ${labels}`);
      assert.equal(await page.locator('[data-profile-switcher]').count(), 0); // one remote: nothing to switch
    });

    await step('Git hosts says GitLab is on and primary, and the repositories of the server are off', async () => {
      await page.goto(`${base}/settings/git-hosts`);
      const gitlab = page.locator('[data-host=gitlab]');
      await gitlab.waitFor();
      await gitlab.getByText('Primary').waitFor();
      assert.ok(await gitlab.getByText('On', { exact: true }).count() > 0);
      assert.ok(await page.locator('[data-host=local]').getByText('Off', { exact: true }).count() > 0);
    });

    await step('Plugins shows the analytics plugin enabled', async () => {
      await page.goto(`${base}/settings/plugins`);
      await page.locator('[data-plugin=analytics-plugin]').getByText('Enabled', { exact: true }).waitFor();
    });

    await step('a line made on GitLab is listed, and another sign-in is the same person', async () => {
      assert.equal((await apiAs(page, api, 'POST', '/lines', { name: 'GitlabLine', version: '1.0.0', description: 'e2e', kind: 'plain' })).status, 200);
      await page.goto(`${base}/lines`);
      await page.getByText('GitlabLine').first().waitFor({ timeout: 20_000 });
      await signOut(page);
      await signInWith(page, base, 'gitlab');
      assert.deepEqual(await lineNames(page, api), ['GitlabLine']);
      assert.equal((await apiAs(page, api, 'GET', '/users')).body.filter((user) => user.host === 'gitlab').length, 1);
    });

    await step('the CI/CD tab of a product: its runs, and in its settings the checks and the runners', async () => {
      const line = (await apiAs(page, api, 'GET', '/lines/enrolled')).body.find((candidate) => candidate.name === 'GitlabLine');
      const made = await apiAs(page, api, 'POST', '/products', { lineId: String(line._id), spec: { basicData: { name: 'CiProduct', version: '0.0.0' } } });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      const id = String(made.body._id);

      await page.goto(`${base}/products/${id}?tab=cicd`);
      await page.locator('[name=cicd-activity]').waitFor({ timeout: 20_000 });
      await page.locator('[name=activity-empty]').waitFor(); // nothing has been generated or synced: no run, so no merge request

      await page.locator('[name=cicd-mode-config]').click();
      await page.locator('form[name=cicd-config]').waitFor();
      assert.equal(await page.locator('[name=cicd-tags]').count(), 0); // CI is off: only its switch
      assert.equal(await page.locator('[name=cicd-unsaved]').count(), 0); // and nothing changed yet
      await page.locator('[name=cicd-enabled]').click();
      await page.locator('[name=cicd-tags]').waitFor();
      await page.locator('[name=cicd-tags]').fill('deploy, e2e');
      await page.locator('[name=cicd-save]').click();
      await page.locator('[name=cicd-unsaved]').waitFor({ state: 'detached' });

      const saved = (await apiAs(page, api, 'GET', `/products/${id}/ci`)).body;
      assert.equal(saved.config.enabled, true);
      assert.deepEqual(saved.config.tags, ['deploy', 'e2e']);
      assert.ok(saved.rendered.includes('client_build:'), 'the pipeline file is rendered from the jobs');
      assert.equal(saved.supported, true);
      const wrong = await apiAs(page, api, 'PUT', `/products/${id}/ci`, { ...saved.config, mode: 'yaml', yaml: 'a: [' });
      assert.equal(wrong.status, 400);

      await page.locator('[name=cicd-instance-runners]').waitFor(); // the runners are on the same page, under the checks
      assert.equal((await apiAs(page, api, 'GET', `/products/${id}/merge-requests`)).body.length, 0);
    });

    await context.close();
  },
};
