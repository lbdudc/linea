/**
 * Publishes the metamodels and modules of a folder to a git host, one repository each, so that LINEA reads them from there.
 * The work is `publishFolder` of `@lbdudc/linea-git`, the same the LINEA CLI uses (`/publish`); this is the command line for it.
 *
 * GitLab:
 *   GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=<token with api scope> \
 *     node scripts/publish-registry.mjs --group <path of an existing group> [--dir <folder>] [--dry-run]
 *
 * GitHub:
 *   GITHUB_TOKEN=<token with repo scope> [GITHUB_API_URL=https://github.example.com/api/v3] \
 *     node scripts/publish-registry.mjs --host github --owner <user or organisation> [--dir <folder>] [--dry-run]
 *
 * Local (the repositories of a LINEA that keeps them itself):
 *   node scripts/publish-registry.mjs --host local --data-dir <folder of the repositories> --group <group, made when missing> [--dir <folder>] [--registry local:<group>/index]
 *
 * Add `--registry <location>` (e.g. `gitlab:linea/registry`, `github:acme/linea-registry`) to also register everything it publishes in the
 * catalog of that repository (`registry.json`, made when missing): the repository a LINEA server names in LINEA_REGISTRY.
 *
 * <folder> holds `metamodels/<name>/` and `modules/<name>/` (default: the LINEA workspace root, three levels up). They end up as
 *   GitLab  <group>/metamodels/<name>   topic linea-metamodel      <group>/modules/<name>   topic linea-module
 *   GitHub  <owner>/<name>              topic linea-metamodel      <owner>/<name>           topic linea-module
 * with every file of the folder on `main` and the tag `v<version>` of its manifest. It can be run again: a version that is already
 * tagged is left alone (raise the version in the manifest to publish a new one).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitCatalog, createGitProvider, ensureRegistryRepository, publishFolder } from '@lbdudc/linea-git';
import { publishExamples } from '../src/model/git/examples.js';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const host = option('host') ?? 'gitlab';
const dir = path.resolve(option('dir') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
const dryRun = args.includes('--dry-run');

const usage = (message) => {
  console.error(message);
  process.exit(2);
};

let config;
let token;
let root;
if (host === 'local') {
  token = 'registry';
  root = option('group');
  const dataDir = option('data-dir') ?? process.env.LINEA_REPOS_DIR;
  if (!dataDir || !root) usage('Usage: node scripts/publish-registry.mjs --host local --data-dir <folder> --group <group> [--dir <folder>] [--registry local:<group>/index]');
  config = { provider: 'local', local: { dataDir, resolveUser: () => ({ username: 'registry', admin: true }) } };
} else if (host === 'github') {
  token = process.env.GITHUB_TOKEN;
  root = option('owner');
  if (!token || !root) usage('Usage: GITHUB_TOKEN=… node scripts/publish-registry.mjs --host github --owner <user or organisation> [--dir <folder>] [--dry-run]');
  config = { provider: 'github', github: { apiUrl: process.env.GITHUB_API_URL, webUrl: process.env.GITHUB_URL } };
} else {
  token = process.env.GITLAB_TOKEN;
  root = option('group');
  if (!process.env.GITLAB_URL || !token || !root) usage('Usage: GITLAB_URL=… GITLAB_TOKEN=… node scripts/publish-registry.mjs --group <group path> [--dir <folder>] [--dry-run]');
  config = { provider: 'gitlab', gitlab: { url: process.env.GITLAB_URL } };
}

const provider = createGitProvider(config);
if (host === 'local' && !dryRun && !(await provider.findNamespace({ token, fullPath: root }))) {
  console.log(`+ group ${root}`);
  await provider.createNamespace({ token, name: root });
}
const registry = option('registry');
if (registry && !dryRun) {
  const { created, path: registryPath } = await ensureRegistryRepository({ provider, token, location: registry });
  if (created) console.log(`+ registry ${registryPath}`);
}
const catalog = registry && !dryRun ? createGitCatalog({ provider, token, location: registry }) : undefined;
const results = await publishFolder({ provider, token, dir, root, dryRun, skipPublished: true, catalog, log: (line) => console.log(line) });
for (const { path: repositoryPath, version } of results.filter(({ status }) => status === 'already-published')) {
  console.log(`= ${repositoryPath}  v${version} is already published`);
}
await publishExamples({ provider, token, root, dir, dryRun, log: (line) => console.log(line) });
console.log(dryRun
  ? 'Dry run: nothing was written.'
  : `Done. LINEA lists them under Modules${registry ? ` (registered in ${registry}: start the server with LINEA_REGISTRY=${registry})` : ' (it reads the repositories you are a member of)'}.`);
