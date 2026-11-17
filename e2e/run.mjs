/**
 * LINEA in Chrome, one configuration of git hosts and plugins after another: each scenario starts its own stack (see lib/stack.mjs),
 * walks through it in a browser as the people it has, and stops it. Chrome is the one installed on this machine.
 *
 *   npm test                    every scenario
 *   npm test -- hosts           the scenarios whose name has "hosts"
 *   HEADED=1 npm test           with the browser window
 */
import { chromium } from 'playwright-core';
import { startStack } from './lib/stack.mjs';
import { local } from './scenarios/local.mjs';
import { gitlabOnly } from './scenarios/gitlab.mjs';
import { githubOnly } from './scenarios/github.mjs';
import { allHosts } from './scenarios/allHosts.mjs';
import { declared } from './scenarios/declared.mjs';
import { localSecurity } from './scenarios/localSecurity.mjs';
import { hostChanges, agentsNeedGitlab } from './scenarios/hostChanges.mjs';
import { upgrade } from './scenarios/upgrade.mjs';

const scenarios = [local, gitlabOnly, githubOnly, allHosts, declared, localSecurity, hostChanges, agentsNeedGitlab, upgrade];
const only = process.argv.slice(2);
const chosen = scenarios.filter((scenario) => only.length === 0 || only.some((word) => scenario.name.includes(word)));

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const results = [];

for (const [slot, scenario] of chosen.entries()) {
  const started = Date.now();
  process.stdout.write(`\n■ ${scenario.name}\n`);
  let stack;
  try {
    stack = await startStack({ name: scenario.name.replace(/\W+/g, '-'), slot, ...scenario.stack });
    const steps = [];
    const step = async (title, fn) => {
      try {
        await fn();
        steps.push({ title, ok: true });
        console.log(`  ✓ ${title}`);
      } catch (error) {
        steps.push({ title, ok: false, error });
        console.log(`  ✗ ${title}\n      ${String(error.message).split('\n').join('\n      ')}`);
        throw error;
      }
    };
    await scenario.run({ browser, stack, step });
    results.push({ name: scenario.name, ok: true, seconds: (Date.now() - started) / 1000 });
  } catch (error) {
    results.push({ name: scenario.name, ok: false, seconds: (Date.now() - started) / 1000 });
    if (!stack) console.log(`  ✗ the stack did not start\n      ${String(error.message).split('\n').join('\n      ')}`);
    if (stack && process.env.VERBOSE) console.log(stack.output());
  } finally {
    await stack?.stop();
  }
}

await browser.close();
console.log('\n' + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.seconds.toFixed(0)}s)`).join('\n'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
