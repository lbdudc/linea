import fs from 'node:fs';
import { LocalProvider, createGitCatalog, ensureRegistryRepository, publishFolder } from '@lbdudc/linea-git';
import { enabledHosts, gitConfig, registriesOf } from './index.js';
import { publishExamples } from './examples.js';

const TOKEN = 'registry';

/**
 * A LINEA that keeps its repositories itself has no GitLab to hold the metamodels and modules its lines are made of: they are published
 * into the local host from a folder (`REGISTRY_DIR`: `metamodels/<name>/`, `modules/<name>/`), and listed in the catalog `LINEA_REGISTRY`
 * names (`local:registry/index`). The example lines of its `examples/` go into the group `LINEA_EXAMPLES_GROUP` (`examples`), where everybody
 * can work in them. It can run at every start: a version or a line that is already there is left alone.
 */
export const bootstrapLocalRegistry = async ({ dir = process.env.REGISTRY_DIR, location = registriesOf().find((l) => l.startsWith('local:')), log = console } = {}) => {
  if (!enabledHosts().includes('local') || !location?.startsWith('local:') || !dir || !fs.existsSync(dir)) return false;
  const { dataDir, ...rest } = gitConfig('local').local;
  // the registry is made by the server itself, as an administrator of its own
  const provider = new LocalProvider({ ...rest, dataDir, resolveUser: () => ({ username: 'registry', admin: true }) });
  const root = location.slice('local:'.length).split('/')[0];
  if (!(await provider.findNamespace({ token: TOKEN, fullPath: root }))) await provider.createNamespace({ token: TOKEN, name: root });
  await ensureRegistryRepository({ provider, token: TOKEN, location });
  const catalog = createGitCatalog({ provider, token: TOKEN, location });
  const published = await publishFolder({ provider, token: TOKEN, dir, root, catalog });
  log.info(`[registry] ${location}: ${published.length} package(s) from ${dir}`);
  const group = process.env.LINEA_EXAMPLES_GROUP || 'examples';
  const examples = await publishExamples({ provider, token: TOKEN, root, group, dir, log: () => {} });
  if (examples.length) log.info(`[registry] ${group}: ${examples.filter((e) => e.status === 'published').length} example line(s) from ${dir}/examples`);
  return true;
};
