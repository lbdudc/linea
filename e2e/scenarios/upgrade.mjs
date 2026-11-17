import { createRequire } from 'node:module';
import { newContext, signInWith, apiAs, lineNames, assert } from '../lib/ui.mjs';

// the server's own copy of the driver: the e2e has none of its own
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));

/**
 * A LINEA from before records named their git host: users, lines and products with no `gitHost` belong to "the primary host". An
 * administrator then switches the repositories of the server on, and nothing may change hands.
 */
export const upgrade = {
  name: 'an installation from before hosts were named keeps its data when hosts change',
  stack: { hosts: ['gitlab'], plugins: [] },
  async run({ browser, stack, step }) {
    const { base, api } = stack;
    const context = await newContext(browser);
    const page = await context.newPage();
    const mongoPort = Number(new URL(api).port) - 3300 + 27030;

    const unname = async () => {
      const mongoose = require('mongoose');
      const connection = await mongoose.createConnection(`mongodb://127.0.0.1:${mongoPort}/splalm?replicaSet=rs0&directConnection=true`).asPromise();
      try {
        for (const name of ['users', 'lines', 'products']) await connection.db.collection(name).updateMany({}, { $unset: { gitHost: '' } });
        await connection.db.collection('githostsettings').deleteMany({ host: '_primary' });
      } finally {
        await connection.close();
      }
    };

    await step('there is a line, as there would be after an old version', async () => {
      await signInWith(page, base, 'gitlab');
      assert.equal((await apiAs(page, api, 'POST', '/lines', { name: 'Old', version: '1.0.0', description: 'e2e', kind: 'plain' })).status, 200);
      await unname(); // …and nothing says which host it is on
      assert.deepEqual(await lineNames(page, api), ['Old']);
    });

    await step('the primary host cannot be handed over while records name no host', async () => {
      await apiAs(page, api, 'PUT', '/settings/git-hosts/local', { enabled: true });
      const refused = await apiAs(page, api, 'PUT', '/settings/git-hosts/primary', { host: 'local' });
      assert.equal(refused.status, 409, JSON.stringify(refused.body));
      assert.match(refused.body.detail, /name no host/);
    });

    await step('with the server\'s repositories on, GitLab is still the primary host and the old line is still the same person\'s', async () => {
      const hosts = (await apiAs(page, api, 'GET', '/settings/git-hosts')).body;
      assert.equal(hosts.primary, 'gitlab');
      assert.deepEqual(hosts.hosts.filter((host) => host.enabled).map((host) => host.id).sort(), ['gitlab', 'local']);
      await page.goto(`${base}/lines`);
      await page.getByText('Old').first().waitFor({ timeout: 20_000 });
      assert.deepEqual(await lineNames(page, api), ['Old']);
    });

    await context.close();
  },
};
