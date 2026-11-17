import { newContext, navLabels, signInWith, apiAs, lineNames, assert } from '../lib/ui.mjs';

/** A GitHub as the only git host, and the analytics plugin: the words of the interface are GitHub's. */
export const githubOnly = {
  name: 'github only, analytics plugin',
  stack: { hosts: ['github'], plugins: ['analytics-plugin'] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();

    await step('the login page has the button of GitHub only', async () => {
      await page.goto(`${base}/login`);
      await page.locator('button[name=github-submit]').waitFor();
      assert.equal(await page.locator('button[name=gitlab-submit]').count(), 0);
      assert.equal(await page.locator('input[name=username]').count(), 0);
    });

    await step('signing in with GitHub: administrator, and the interface speaks of GitHub', async () => {
      await signInWith(page, base, 'github');
      const labels = await navLabels(page);
      for (const label of ['Configuration']) assert.ok(labels.includes(label), `${label} in ${labels}`);
      await page.goto(`${base}/add`);
      await page.getByText('The GitHub group that will hold the repository.').waitFor({ timeout: 20_000 });
      assert.equal(await page.getByText('GitLab').count(), 0);
    });

    await step('the plugin enabled at start is enabled for everyone', async () => {
      assert.ok((await apiAs(page, api, 'GET', '/plugins/enabled')).body.some((plugin) => plugin.id === 'analytics-plugin'));
    });

    await step('a line made on GitHub is listed', async () => {
      const made = await apiAs(page, api, 'POST', '/lines', { name: 'GithubLine', version: '1.0.0', description: 'e2e', kind: 'plain' });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      assert.deepEqual(await lineNames(page, api), ['GithubLine']);
      await page.goto(`${base}/lines`);
      await page.getByText('GithubLine').first().waitFor({ timeout: 20_000 });
    });

    await context.close();
  },
};
