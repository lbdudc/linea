import { LineaCoreError, checkSpl, createMemoryPackageSource, resolveSpl } from '@lbdudc/linea-core';
import { withOverlay } from '@lbdudc/linea-git';
import { createPackageSource } from './hosts.js';
import { createEngine } from './engine.js';
import { summarizeResolved } from './resolvedSummary.js';

const CHECK_LOCATION = 'memory:check';

/**
 * What it takes to resolve a package as it is on `main`, published or not: what its version needs is resolved from tags as usual, but
 * the package itself is read from its branch. A metamodel is only ever used through a module, so it is resolved through one made up
 * for the purpose.
 */
export const workingCopyResolution = ({ token, userId, kind, location, manifest }) => {
  const base = createPackageSource({
    token,
    userId,
    overrides: { [location]: { version: manifest.version, ref: 'main' } },
  });

  let source = base;
  let spl = { name: 'check', kind: 'modular', metamodels: {}, modules: { [location]: manifest.version } };
  if (kind === 'metamodel') {
    const overlay = createMemoryPackageSource({
      packages: {
        [CHECK_LOCATION]: {
          '0.0.0': {
            '.linea/module.json': JSON.stringify({ name: 'check', version: '0.0.0', requires: { metamodels: { [location]: manifest.version } } }),
          },
        },
      },
    });
    source = withOverlay({ base, overlay, locations: new Set([CHECK_LOCATION]) });
    spl = { name: 'check', kind: 'modular', metamodels: {}, modules: { [CHECK_LOCATION]: '0.0.0' } };
  }
  return { source, spl };
};

/** Checks a package as it is on `main` (see `workingCopyResolution`). */
export const checkWorkingCopy = async ({ token, userId, kind, location, manifest }) => {
  const { source, spl } = workingCopyResolution({ token, userId, kind, location, manifest });

  try {
    const resolved = await resolveSpl({ spl, source });
    // a package is checked on its own: there is no SPL around it, so no feature model
    const report = await checkSpl({ resolved, createEngine, configuration: false });
    return { ...report, resolved: summarizeResolved(resolved) };
  } catch (error) {
    if (!(error instanceof LineaCoreError)) throw error;
    return { ok: false, diagnostics: [{ severity: 'error', package: location, message: error.message }], metamodels: [], featureModel: '', resolved: [] };
  }
};
