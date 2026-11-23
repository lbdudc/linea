import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitProvider, publishFolder } from '@lbdudc/linea-git';

// the metamodels repository (linea-metamodels, next to this checkout, or LINEA_METAMODELS_DIR): the feature metamodel is the one LINEA ships
const METAMODELS = path.join(process.env.LINEA_METAMODELS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../linea-metamodels'), 'metamodels');
const KINDS = ['grammars', 'constraints', 'specs', 'imports', 'scopes', 'visualizations', 'cases'];

/** The version of the feature metamodel of the workspace (it moves on with it: a test does not write it down). */
export const featureMetamodelVersion = () => JSON.parse(fs.readFileSync(path.join(METAMODELS, 'featuremodel', 'metamodel.json'), 'utf8')).version;

/**
 * Publishes the feature metamodel and the grammar it imports into a GitLab double, at `gitlab:linea/metamodels/featuremodel` (where a
 * server that was not told otherwise looks for it): every SPL has it, so every test that makes a line needs it to be there.
 */
export async function publishFeatureMetamodel(double) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-registry-'));
  try {
    for (const name of ['common', 'featuremodel']) {
      const target = path.join(folder, 'metamodels', name);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(path.join(METAMODELS, name, 'metamodel.json'), path.join(target, 'metamodel.json'));
      for (const kind of KINDS) {
        const source = path.join(METAMODELS, name, kind);
        if (fs.existsSync(source)) fs.cpSync(source, path.join(target, kind), { recursive: true });
      }
    }
    double.state.createGroup({ name: 'linea' });
    const provider = createGitProvider({ provider: 'gitlab', gitlab: { url: double.url } });
    await publishFolder({ provider, token: 'test', dir: folder, root: 'linea', log: () => {} });
    // the publication is set-up, not something the test did: the requests it made are not in the log the test reads
    double.state.requestLog.length = 0;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
