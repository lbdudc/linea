import { startGitlabDouble } from '@lbdudc/linea-git/testing';
import { publishFeatureMetamodel } from './featureMetamodel.js';

let double = null;
let previousHostname;

export async function setupGitlabDouble() {
  double = await startGitlabDouble();
  previousHostname = process.env.GITLAB_HOSTNAME;
  // an address in the environment is what puts GitLab on
  process.env.GITLAB_HOSTNAME = double.url;
  await publishFeatureMetamodel(double);
}

export async function resetGitlabDouble() {
  double?.reset();
  // every SPL has the feature metamodel: it is back where it was
  if (double) await publishFeatureMetamodel(double);
}

export async function teardownGitlabDouble() {
  await double?.close();
  double = null;
  if (previousHostname === undefined) delete process.env.GITLAB_HOSTNAME;
  else process.env.GITLAB_HOSTNAME = previousHostname;
}

export function gitlabDouble() {
  if (!double) throw new Error('gitlabDouble() called before setupGitlabDouble() — check hook order.');
  return double;
}
