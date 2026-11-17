import { LineaCoreError, checkProduct, cipFragmentPath, cipMarkers, deriveModularProductToZip, describeCips, listOfferedModels, normalizeProductSpec, readMetamodelBundle, resolveSpl, seedProductModels, selectionText } from '@lbdudc/linea-core';
import { createEngine } from './engine.js';
import { zipContents, zipEntries } from '../zipEntries.js';

const encoder = new TextEncoder();

/** The files of a package with the changes not committed yet laid over them. Nothing is written anywhere. */
export const withChanges = ({ files, changes }) => {
  const changed = new Map(changes.map((change) => [change.path, change]));
  const created = changes.filter((change) => change.action !== 'delete').map((change) => change.path);
  return {
    ...files,
    read: ({ path }) => {
      const change = changed.get(path);
      if (!change) return files.read({ path });
      return Promise.resolve(change.action === 'delete' ? undefined : encoder.encode(change.content ?? ''));
    },
    list: async ({ dir }) => {
      const under = (path) => dir === '' || path.startsWith(`${dir}/`);
      const listed = (await files.list({ dir })).filter((path) => changed.get(path)?.action !== 'delete');
      return [...new Set([...listed, ...created.filter(under)])].sort();
    },
  };
};

/** A source that reads `location` with those changes on it, and each of `others` (`{ location, changes }`) with its own. */
export const sourceWithChanges = ({ source, location, changes, others = [] }) => {
  const byLocation = new Map(others.filter((other) => other.location !== location && other.changes.length > 0).map((other) => [other.location, other.changes]));
  if (changes.length > 0) byLocation.set(location, changes);
  return byLocation.size === 0 ? source : {
    ...source,
    listVersions: (args) => source.listVersions(args),
    revision: (args) => source.revision?.(args),
    open: async (args) => {
      const files = await source.open(args);
      const laid = byLocation.get(args.location);
      return laid ? withChanges({ files, changes: laid }) : files;
    },
  };
};

/**
 * A module on its own, as the SPL with nothing else in it would have it: the modules and metamodels it needs come along, and so do
 * `alongside` (`{ location, version }`), modules it does not need that are wanted in the trial too.
 */
export const resolveModule = ({ source, location, version, alongside = [] }) => resolveSpl({
  spl: { name: 'trial', kind: 'modular', metamodels: {}, modules: { ...Object.fromEntries(alongside.map((other) => [other.location, other.version])), [location]: version } },
  source,
});

const featureRows = (tree) => {
  const rows = [];
  const walk = (node, depth, kind) => {
    rows.push({ name: node.name, depth, kind });
    for (const group of node.groups ?? []) for (const child of group.features) walk(child, depth + 1, group.kind);
  };
  if (tree) walk(tree.root, 0, 'root');
  return rows;
};

const featureNames = (tree) => {
  if (!tree?.root) return null;
  const names = new Set();
  const walk = (node) => {
    names.add(node.name);
    for (const group of node.groups ?? []) group.features.forEach(walk);
  };
  walk(tree.root);
  return names;
};

const selectedIn = (text = '') => [...text.matchAll(/^\s*select\s+(\S+)/gm)].map((match) => match[1]);

const failureOf = (error, location) => {
  if (!(error instanceof LineaCoreError)) throw error;
  return { ok: false, error: error.message, diagnostics: error.diagnostics ?? [{ severity: 'error', package: location, message: error.message }] };
};

const mainPathOf = (fragment) => fragment.replace('.cip.', '.cipmain.');
const decoder = new TextDecoder();

const memoryModule = (location, entries) => ({
  location,
  files: {
    list: async ({ dir }) => Object.keys(entries).filter((path) => dir === '' || path.startsWith(`${dir}/`)),
    read: async ({ path }) => (path in entries ? encoder.encode(entries[path]) : undefined),
  },
});

/** The composition of one file from its main file and fragments as they are given, with nothing read from anywhere. */
const composeInMemory = async ({ target, main, fragments, start, end }) => {
  const config = { '.linea/config/config.json': JSON.stringify({ delimiters: [{ extension: ['cip'], start, end }] }) };
  const modules = [
    memoryModule(main.from, { ...config, [main.path]: main.text }),
    ...fragments.map((fragment) => memoryModule(fragment.from, { ...config, [fragment.path]: fragment.text })),
  ];
  return (await describeCips({ modules })).compositions.find((composition) => composition.target === target);
};

const openElsewhere = async ({ source, elsewhere }) => (await Promise.all(elsewhere.map(async (candidate) => {
  try {
    const files = await source.open(candidate);
    const listed = new Set(await files.list({ dir: 'code' }));
    return { location: candidate.location, version: candidate.version, files, listed };
  } catch {
    return null;
  }
}))).filter(Boolean);

const textOf = async (other, path) => {
  if (!other.listed.has(path)) return undefined;
  const content = await other.files.read({ path });
  return content === undefined ? undefined : decoder.decode(content);
};

const withMainFrom = async ({ composition, opened, start, end }) => {
  if (composition.main || composition.fragments.length === 0) return composition;
  const path = mainPathOf(composition.fragments[0].path);
  for (const other of opened) {
    const text = await textOf(other, path);
    if (text === undefined) continue;
    const joined = await composeInMemory({ target: composition.target, main: { from: other.location, path, text }, fragments: composition.fragments, start, end });
    return { ...joined, main: { ...joined.main, outside: true } };
  }
  return composition;
};

const withFragmentsFrom = async ({ composition, opened, start, end }) => {
  if (!composition.main || composition.points.length === 0) return composition;
  const path = cipFragmentPath({ main: composition.main.path });
  const present = new Set(composition.fragments.map((fragment) => fragment.from));
  const names = new Set(composition.points.map((point) => point.name));
  const extra = [];
  for (const other of opened) {
    if (other.location === composition.main.from || present.has(other.location)) continue;
    const text = await textOf(other, path);
    if (text === undefined || !cipMarkers({ text, start, end }).some((name) => names.has(name))) continue;
    extra.push({ from: other.location, path, text });
  }
  if (extra.length === 0) return composition;
  const outside = new Set(extra.map((fragment) => fragment.from));
  const joined = await composeInMemory({ target: composition.target, main: composition.main, fragments: [...composition.fragments, ...extra], start, end });
  return {
    ...joined,
    main: composition.main,
    fragments: joined.fragments.map((fragment) => (outside.has(fragment.from) ? { ...fragment, outside: true } : fragment)),
    points: joined.points.map((point) => {
      const elsewhere = point.providers.filter((from) => outside.has(from));
      const providers = point.providers.filter((from) => !outside.has(from));
      return elsewhere.length ? { ...point, providers, elsewhere } : { ...point, providers };
    }),
    orphans: joined.orphans.filter((orphan) => !outside.has(orphan.from)),
  };
};

/**
 * A module on its own leaves out the modules that use it, but in an SPL they come along. Each of `elsewhere` (`{ location, version }`,
 * the other modules of the registry) is looked into: a fragment whose main file is in none of the modules resolved gets that main file,
 * marked `outside`, and the fragments those modules add to a main file join it too, marked `outside`: the composition is then the whole
 * file, and a marker one of them fills says so in `elsewhere` instead of being `unfilled`.
 */
export const withMainsElsewhere = async ({ cips, source, modules, elsewhere = [] }) => {
  if (cips.compositions.length === 0) return cips;
  const known = new Set(modules.map((module) => module.location));
  const opened = await openElsewhere({ source, elsewhere: elsewhere.filter((candidate) => !known.has(candidate.location)) });
  if (opened.length === 0) return cips;
  const { start, end } = cips;
  const compositions = await Promise.all(cips.compositions.map(async (composition) => withFragmentsFrom({ composition: await withMainFrom({ composition, opened, start, end }), opened, start, end })));
  return { ...cips, compositions };
};

/**
 * What it takes to try a module: the metamodels it needs, with the smallest valid model of each, the features to choose from, and its
 * code insertion points. A module that cannot be resolved says why instead of failing.
 */
const requirersOf = (module) => [...new Set((module.requiredBy ?? []).filter((by) => by !== 'spl').map((by) => by.replace(/@[^@/]+$/, '')))];

export const describeModuleTrial = async ({ source, location, version, alongside = [], elsewhere = [] }) => {
  try {
    const resolved = await resolveModule({ source, location, version, alongside });
    const seeded = await seedProductModels({ resolved, createEngine });
    return {
      ok: true,
      location,
      version,
      modules: resolved.modules.map((module) => ({ location: module.location, version: module.version, requiredBy: requirersOf(module) })),
      metamodels: seeded.metamodels.map(({ name, extension, requires }) => ({ name, extension, requires, seed: seeded.models[name] ?? '' })),
      offered: seeded.configuration.models.map(({ metamodel, text }) => ({ metamodel, text })),
      features: featureRows(seeded.configuration.featureModel),
      featureModel: seeded.configuration.featureModel ?? null,
      selected: selectedIn(seeded.models.featureselection),
      diagnostics: seeded.diagnostics,
      bundle: await readMetamodelBundle({ resolved }),
      contributed: await listOfferedModels({ resolved }),
      configuration: (seeded.configuration.models ?? []).map(({ metamodel, level, text }) => ({ metamodel, level, text })),
      cips: await withMainsElsewhere({ cips: await describeCips({ modules: resolved.modules }), source, modules: resolved.modules, elsewhere }),
    };
  } catch (error) {
    return { location, version, modules: [], metamodels: [], offered: [], features: [], featureModel: null, selected: [], cips: { compositions: [] }, ...failureOf(error, location) };
  }
};

const givenModels = ({ seeded, models, features }) => {
  const given = { ...seeded.models, ...models };
  const known = featureNames(seeded.configuration.featureModel);
  const chosen = features && known ? features.filter((name) => known.has(name)) : features;
  if (chosen && seeded.configuration.featureModel && given.featureselection !== undefined) {
    given.featureselection = selectionText({ model: seeded.configuration.featureModel.name, features: chosen });
  }
  return { given, chosen };
};

/**
 * Whether some models (laid over the smallest valid ones) and features are right for a module, as they would be for a product. Nothing is
 * made. When they are, `context` is what the templates of the product are run with: the transformation and the helpers composed from the
 * modules, and the product's spec (its features and models), so that the browser can work out `data` and the conditions of the annotations.
 */
export const checkModuleTrial = async ({ source, location, version, alongside = [], models = {}, features }) => {
  try {
    const resolved = await resolveModule({ source, location, version, alongside });
    const seeded = await seedProductModels({ resolved, createEngine });
    const { given, chosen } = givenModels({ seeded, models, features });
    const report = await checkProduct({ resolved, models: given, createEngine });
    if (!report.ok) return { ok: false, diagnostics: report.diagnostics };
    const chosenFeatures = report.models?.features ?? chosen ?? [];
    const spec = normalizeProductSpec({ spec: { basicData: { name: 'trial', version: '0.0.0' }, features: chosenFeatures } });
    return {
      ok: true,
      diagnostics: report.diagnostics,
      context: {
        transformation: report.configuration.plan.transformation,
        extraJs: report.configuration.plan.extraJs,
        spec: { ...spec, features: chosenFeatures, models: report.models, modelsByMetamodel: report.modelsByMetamodel ?? {} },
      },
    };
  } catch (error) {
    return failureOf(error, location);
  }
};

/**
 * Derives a module with some models and features, as a product would, with nothing made: no product, no repository. `models` (metamodel
 * name -> text) are laid over the smallest valid ones. `contents: true` also answers what every text file holds, to compare with another run.
 */
export const deriveModuleTrial = async ({ source, location, version, alongside = [], models = {}, features, spec, include = [], contents = false, zip: wantZip = false }) => {
  try {
    const resolved = await resolveModule({ source, location, version, alongside });
    const seeded = await seedProductModels({ resolved, createEngine });
    const { given, chosen } = givenModels({ seeded, models, features });
    const sample = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
    const zip = await deriveModularProductToZip({
      resolved,
      models: given,
      createEngine,
      spec: normalizeProductSpec({ spec: { ...sample, basicData: { name: 'trial', version: '0.0.0', ...(sample.basicData && typeof sample.basicData === 'object' ? sample.basicData : {}) }, features: chosen ?? [] } }),
    });
    const files = zipEntries(zip);
    return {
      ok: true,
      files,
      size: zip.length,
      ...(contents || include.length ? { contents: await zipContents(zip, contents ? files : include) } : {}),
      ...(wantZip ? { zip: Buffer.from(zip).toString('base64') } : {}),
    };
  } catch (error) {
    return failureOf(error, location);
  }
};
