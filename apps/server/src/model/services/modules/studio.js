import { LineaCoreError, metamodelPath, readMetamodelFiles, readMetamodelText, resolveSpl } from '@lbdudc/linea-core';
import { workingCopyResolution } from './packageCheck.js';

const SCRIPT_FILES = { constraints: 'constraints', scope: 'scope', spec: 'spec', import: 'import' };

/** The files of one grammar, named as the metamodel studio names them (see `MetamodelFiles` in `@lbdudc/bango/studio`). */
const filesOfGrammar = ({ text, scripts, visualizations }) => ({
  grammar: text,
  ...Object.fromEntries(Object.entries(SCRIPT_FILES).filter(([, kind]) => scripts[kind] !== undefined).map(([key, kind]) => [key, scripts[kind]])),
  ...(visualizations === undefined ? {} : { visualizations }),
});

/**
 * Everything a metamodel studio needs to edit a metamodel package as it is on `main`: the files of the grammar it edits, the grammars it
 * needs (with theirs) at the versions its requirements resolve to, and its test cases. What cannot be resolved (a requirement that
 * is not published yet, say) is reported in `diagnostics` and the package is still editable, on its own.
 */
export const readStudio = async ({ token, userId, location, manifest }) => {
  const { source, spl } = workingCopyResolution({ token, userId, kind: 'metamodel', location, manifest });
  const diagnostics = [];

  let packages;
  let ownFiles;
  try {
    const resolved = await resolveSpl({ spl, source });
    packages = resolved.metamodels;
    ownFiles = resolved.metamodels.find((pkg) => pkg.location === location)?.files;
  } catch (error) {
    if (!(error instanceof LineaCoreError)) throw error;
    diagnostics.push({ severity: 'error', package: location, message: error.message });
    // on its own: the package as it is on main, without what it needs
    ownFiles = await source.open({ location, version: manifest.version });
    packages = [{ location, files: ownFiles }];
  }

  const own = [];
  const dependencies = {};
  for (const pkg of packages) {
    for (const grammar of await readMetamodelFiles({ pkg })) {
      if (pkg.location === location) own.push(grammar);
      else dependencies[grammar.grammar] = filesOfGrammar(grammar);
    }
  }

  // the grammar to edit is the one named like the metamodel; a package with several offers the others read-only
  const main = own.find((g) => g.grammar === manifest.name) ?? own[0];
  const metamodel = main?.grammar ?? manifest.name;
  for (const grammar of own) if (grammar !== main) dependencies[grammar.grammar] = filesOfGrammar(grammar);

  const cases = await readMetamodelText({ files: ownFiles, kind: 'cases', grammar: metamodel });
  return {
    location,
    version: manifest.version,
    metamodel,
    paths: studioPaths(metamodel),
    files: { ...(main ? filesOfGrammar(main) : { grammar: '' }), ...(cases === undefined ? {} : { cases }) },
    dependencies,
    diagnostics,
  };
};

/** The path of each file of the studio in the package: `grammars/<metamodel>.langium`, `constraints/<metamodel>.js`... */
const studioPaths = (metamodel) => ({
  grammar: metamodelPath({ kind: 'grammar', grammar: metamodel }),
  constraints: metamodelPath({ kind: 'constraints', grammar: metamodel }),
  scope: metamodelPath({ kind: 'scope', grammar: metamodel }),
  spec: metamodelPath({ kind: 'spec', grammar: metamodel }),
  import: metamodelPath({ kind: 'import', grammar: metamodel }),
  visualizations: metamodelPath({ kind: 'visualizations', grammar: metamodel }),
  cases: metamodelPath({ kind: 'cases', grammar: metamodel }),
});
