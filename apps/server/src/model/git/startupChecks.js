import { execFileSync } from 'node:child_process';
import { enabledHosts, primaryHost, registriesOf, registryHostOf } from './index.js';

const MIN_GIT = [2, 38]; // merge-tree --write-tree, which the local host merges with

/** Fails when the local host is on and `git` is missing or too old: it would answer 500 on every merge instead of saying why. */
export const checkGitVersion = ({ run = () => execFileSync('git', ['--version'], { encoding: 'utf8' }) } = {}) => {
  if (!enabledHosts().includes('local')) return null;
  let output;
  try {
    output = run();
  } catch {
    throw new Error('The local git host needs git on the PATH, and there is none.');
  }
  const [major, minor] = (/(\d+)\.(\d+)/.exec(output) ?? []).slice(1).map(Number);
  if (major === undefined || major < MIN_GIT[0] || (major === MIN_GIT[0] && minor < MIN_GIT[1])) {
    throw new Error(`The local git host needs git ${MIN_GIT.join('.')} or newer (this is ${output.trim()}).`);
  }
  return `${major}.${minor}`;
};

/** What is wrong with the configuration as a whole, as warnings: nothing that stops the server, everything an administrator would look for. */
export const configProblems = ({ declared = {}, env = process.env } = {}) => {
  const problems = [];
  const on = enabledHosts();
  if (declared.primary && declared.primary !== primaryHost()) problems.push(`gitHosts.primary is ${declared.primary}, which is not on: ${primaryHost()} is the primary host.`);
  for (const location of registriesOf(env.LINEA_REGISTRY)) {
    const host = registryHostOf(location);
    if (!host) problems.push(`LINEA_REGISTRY=${location} names no host (write it as <host>:<group>/<repository>, e.g. ${primaryHost()}:${location}).`);
    else if (!on.includes(host)) problems.push(`LINEA_REGISTRY=${location} is on ${host}, which is not on: no module or metamodel can be read.`);
  }
  return problems;
};
