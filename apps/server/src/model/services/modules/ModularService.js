import { createHash } from 'node:crypto';
import { Container } from 'typedi';
import { timed } from '../../../rest/common/serverTiming.js';
import domainEvents, { DOMAIN_EVENTS } from '../../events/domainEvents.js';
import {
  FEATURE_MODEL_GRAMMAR,
  FEATURE_MODEL_PATH,
  LOCK_PATH,
  ModuleCheckError,
  SPL_MANIFEST_PATH,
  buildLineScaffold,
  buildSplManifest,
  checkProduct,
  checkSelections,
  checkSpl,
  createFsFiles,
  createMemoryPackageSource,
  incrementVersion,
  InvalidArgumentError,
  isLockCurrent,
  LineaCoreError,
  listOfferedModels,
  parseLock,
  parseSplManifest,
  featuresOf,
  parseUvl,
  prepareEngine,
  readMetamodelBundle,
  readPackageText,
  resolveSpl,
  seedProductModels,
  selectionText,
  serializeLock,
  serializeSplManifest,
} from '@lbdudc/linea-core';
import UserRepository from '../../repositories/UserRepository.js';
import LineRepository from '../../repositories/LineRepository.js';
import ProductRepository from '../../repositories/ProductRepository.js';
import PermissionChecker from '../PermissionChecker.js';
import { assertLineAlive, isLineDeleted, LineModularReadOnlyError, LineNotFoundError, LineNotModularError, PackageNotFoundError, ProductNotFoundError, UserNotFoundError } from '../../errors/errors.js';
import { ciKindOf, getGitProvider } from '../../git/index.js';
import { activeHostOf, hostOf, tokenFor, tokensOf } from '../../git/hosts.js';
import { createCachedPackageSource, createPackageSource, featureMetamodelLocation, overlayFiles, repositoryFiles, upsertFiles } from './hosts.js';
import { createEngine } from './engine.js';
import { runTransformation } from './transformation.js';
import { trialSpecOf } from '../trialSpec.js';
import { summarizeResolved } from './resolvedSummary.js';
import { createRecent } from '../recent.js';
import { keepLineVersion, packagesOf } from '../lineVersions.js';
import { ACCESS } from '@lbdudc/linea-git';

// the part of x.y.z a save raises: a change of the modules is a minor one unless the person says otherwise
const BUMP_INDEX = { major: 0, minor: 1, patch: 2 };

const MODELS_DIR = '.linea/models/';
const FEATURE_SELECTION = 'featureselection';
const TRANSFORMATION_PATH = 'src/platform/transformation.js';
/** where the nodes of the diagrams of a product's models were left: { metamodel: { view: { node: { x, y } } } } */
const LAYOUTS_PATH = '.linea/layouts.json';
const basenameOf = (path) => path.slice(MODELS_DIR.length).replace(/\.[^.]+$/, '');

/** Which modules and metamodels this product is made from, and at which version — refreshed on every generation. */
const PRODUCT_MANIFEST_PATH = '.linea/product.json';
const serializeProductManifest = ({ product, resolved }) => `${JSON.stringify({
  version: product.spec.basicData.version,
  modules: Object.fromEntries(resolved.modules.map((m) => [m.location, m.version])),
  models: Object.fromEntries(resolved.metamodels.map((m) => [m.manifest.name, m.version])),
}, null, 2)}\n`;

const isPoint = (p) => p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * The layouts of the diagrams that are well formed, for the metamodels the product has: what the browser keeps is data a person moved
 * around, so anything that is not a position of a node is dropped instead of stored.
 */
const cleanLayouts = (layouts, metamodels) => {
  const clean = {};
  for (const [metamodel, views] of Object.entries(layouts && typeof layouts === 'object' ? layouts : {})) {
    if (!metamodels.includes(metamodel) || !views || typeof views !== 'object') continue;
    for (const [view, nodes] of Object.entries(views)) {
      if (!nodes || typeof nodes !== 'object') continue;
      const points = Object.fromEntries(Object.entries(nodes).filter(([, p]) => isPoint(p)).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
      if (Object.keys(points).length) (clean[metamodel] ??= {})[view] = points;
    }
  }
  return clean;
};

// What a line says about itself (its manifest and lock) and what they resolve to, kept for a little while per user and repository:
// the home page and every page of a product ask for the composed model of the same line, and each used to read the manifest and
// resolve every module again. A write that this server makes to the line drops it. A change made somewhere else shows within the TTL.
const lines = createRecent({ ttlMs: 30_000, limit: 200 });
const forgetLine = (repoId) => lines.forget((key) => key.endsWith(`|${repoId}`));
/** Something other than this service changed the line's repository (a plan branch merged into main): what it has remembered is stale. */
export const forgetLineProject = forgetLine;

// The models a product repository holds: the overview and then the editors of the same page ask for them one after the other.
// Anything that writes them, or reads them to write, goes to the repository.
const storedModelsOf = createRecent({ ttlMs: 15_000, limit: 200 });
const forgetStored = (projectId) => storedModelsOf.forget((key) => key.endsWith(`|${projectId}`));

// What checking the models of a product against its line says is a function of the line (its resolved packages and files) and of the
// text of the models, and it is the slowest thing the product pages ask for (it runs the engine: ~1 s). The page of a product asks for
// it from several endpoints at once and again on every visit, so the answer is kept for as long as the line it was made against is
// (`resolved` is replaced when the line changes), one per distinct set of models.
const checks = new WeakMap();
const MAX_CHECKS_PER_LINE = 12;
const checkProductOnce = ({ resolved, spl, models, createEngine: engineOf }) => {
  let kept = checks.get(resolved);
  if (!kept || kept.spl !== spl) {
    kept = { spl, byModels: new Map() };
    checks.set(resolved, kept);
  }
  const key = createHash('sha1').update(JSON.stringify(Object.entries(models ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))).digest('hex');
  let report = kept.byModels.get(key);
  if (!report) {
    if (kept.byModels.size >= MAX_CHECKS_PER_LINE) kept.byModels.delete(kept.byModels.keys().next().value);
    report = timed('check', () => checkProduct({ resolved, spl, models, createEngine: engineOf }));
    kept.byModels.set(key, report);
    // a failure is not kept
    report.catch(() => { if (kept.byModels.get(key) === report) kept.byModels.delete(key); });
  }
  return report;
};

// What reading the metamodels of a line into a bundle gives (the editor's grammars and forms) is a function of the line's resolved
// packages, which are replaced when the line changes: read once per resolution, not on every visit to the model (it took ~0.26 s).
const bundles = new WeakMap();
const bundleOf = (resolved) => {
  let bundle = bundles.get(resolved);
  if (!bundle) {
    bundle = readMetamodelBundle({ resolved });
    bundles.set(resolved, bundle);
    bundle.catch(() => { if (bundles.get(resolved) === bundle) bundles.delete(resolved); });
  }
  return bundle;
};

/**
 * Whether the product fits its SPL, from what checking its models said. It is the same check a generation (and a sync) makes, so it
 * must fail on the same things: any error, not only the ones in the feature selection or the SPL. A product whose `gismodel` is wrong
 * for the new modules of its line is not healthy: generating it would answer `module_check_failed`.
 * The error told is the most telling one: the SPL's, then the selection's, then any other model's.
 */
export const healthOfReport = ({ report, fallbackFeatures }) => {
  // a model of a metamodel the SPL no longer has is dropped by the generation itself (see #reconcile): it does not make the product fail
  const errors = report.diagnostics.filter((d) => d.severity === 'error' && !/is not a metamodel of the products of this SPL/.test(d.message ?? ''));
  const inSpl = errors.find((d) => d.package === 'spl');
  const inSelection = errors.find((d) => d.file?.startsWith(`${MODELS_DIR}featureselection`));
  const failing = inSpl ?? inSelection ?? errors[0];
  const features = report.models?.features ?? fallbackFeatures ?? [];
  const errorType = !failing ? null : (failing === inSpl ? 'model' : (failing === inSelection ? 'selection' : 'models'));
  return { valid: !failing, features, error: failing ? `${failing.file ?? failing.package}: ${failing.message}` : null, errorType };
};

/**
 * The text of a feature selection without the features the feature model no longer has (a feature the SPL removed or renamed makes
 * the whole product fail its check: "Could not resolve reference to Feature named 'X'"). `known` is the set of names of the features.
 */
export const pruneSelection = ({ text, known }) => {
  const dropped = [];
  const kept = String(text ?? '').split('\n').filter((line) => {
    const selected = /^\s*select\s+(\S+)\s*$/.exec(line)?.[1];
    if (selected !== undefined && !known.has(selected)) {
      dropped.push(selected);
      return false;
    }
    return true;
  });
  return { text: kept.join('\n'), dropped };
};

/** The features every product has whatever it selects: the root and what hangs from it through mandatory groups only. */
export const mandatoryFeaturesOf = (tree) => {
  const found = new Set();
  const walk = (node) => {
    found.add(node.name);
    for (const group of node.groups) if (group.kind === 'mandatory') group.features.forEach(walk);
  };
  walk(tree.root);
  return found;
};

const trialSeeds = createRecent({ ttlMs: 60_000, limit: 100 });
const PLATFORM_CODE_DIR = 'src/platform/code';
const isPlatformCode = (path) => path === PLATFORM_CODE_DIR || path.startsWith(`${PLATFORM_CODE_DIR}/`);
const withoutPlatformCode = (files) => ({
  ...files,
  list: async ({ dir }) => (isPlatformCode(dir) ? [] : (await files.list({ dir })).filter((path) => !isPlatformCode(path))),
});

const failure = (error) => ({
  ok: false,
  diagnostics: [{ severity: 'error', package: 'spl', message: error.message }],
  metamodels: [],
  featureModel: '',
});

// two maps of package location -> range are the same composition whatever the order of their keys
const sameEntries = (a = {}, b = {}) => {
  const left = Object.entries(a ?? {}).sort(([x], [y]) => x.localeCompare(y));
  const right = Object.entries(b ?? {}).sort(([x], [y]) => x.localeCompare(y));
  return left.length === right.length && left.every(([key, value], i) => key === right[i][0] && JSON.stringify(value) === JSON.stringify(right[i][1]));
};

// the previews of the creation form: the same composition is asked for again as modules are added and taken out
const previews = createRecent({ ttlMs: 20_000, limit: 200 });
domainEvents.on(DOMAIN_EVENTS.GIT_PUSHED, () => previews.clear());

/**
 * Lines made of modules, and the products of those lines.
 *
 * Every line is a repository with `spl.json` (what it is made of: its kind, the metamodels and the modules it uses directly) and
 * `linea.lock.json` (every package it needs, pinned), and with its feature model in `models/featuremodel.featuremodel`: a model of the
 * feature metamodel. A product keeps one model per metamodel whose models are final (its feature selection among them) in `models/` of its
 * repository.
 */
export default class ModularService {
  userRepository = Container.get(UserRepository);
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  permissionChecker = Container.get(PermissionChecker);

  // the user's token on the host of `subject` (a line or a product; without one, the primary host)
  #token = async (userId, subject) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    return tokenFor(user, hostOf(subject));
  };

  // their token on every host they signed in to: what reads packages, which may be on a host other than the line's
  #tokens = async (userId) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    return tokensOf(user);
  };

  /** What a line says about itself (its manifest and lock), read from `ref` of its repository; `null` when it has no `spl.json`. */
  #context = async ({ token, userId, line, ref = 'main' }) => {
    const files = repositoryFiles({ token, id: line.repoId, ref, host: hostOf(line) });
    const splText = await readPackageText({ files, path: SPL_MANIFEST_PATH });
    if (splText === undefined) return null;
    const lockText = await readPackageText({ files, path: LOCK_PATH });
    let lock;
    try {
      lock = lockText === undefined ? undefined : parseLock({ content: lockText });
    } catch {
      lock = undefined; // a lock that cannot be read is made again
    }
    return {
      files,
      spl: parseSplManifest({ content: splText }),
      lock,
      source: createCachedPackageSource({ token, tokens: await this.#tokens(userId), userId }),
    };
  };

  /** The manifest and lock of a line as they were a moment ago (`null` when it is not modular), with what they resolve to as it is asked for. */
  #entryOf = ({ token, userId, line }) =>
    lines.get(`${userId}|${String(token).slice(-12)}|${line.repoId}`, async () => {
      const context = await this.#context({ token, userId, line });
      return context ? { context, resolved: null, report: null } : null;
    });

  #resolvedOf = (entry) => {
    entry.resolved ??= resolveSpl({ spl: entry.context.spl, source: entry.context.source, lock: entry.context.lock })
      .catch((error) => { entry.resolved = null; throw error; });
    return entry.resolved;
  };

  // What checking the SPL gives: its feature model (the SPL's own with the modules' grafted in, as a model of the feature metamodel
  // and as UVL) and everything that is wrong with it.
  #reportOf = (entry) => {
    entry.report ??= this.#resolvedOf(entry)
      .then((resolved) => checkSpl({ resolved, spl: entry.context.files, createEngine }))
      .catch((error) => { entry.report = null; throw error; });
    return entry.report;
  };

  #lineAndContext = async ({ userId, lineId, accessLevel, fresh = false }) => {
    const line = await this.lineRepository.findById(lineId);
    if (!line) throw new LineNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel }, getGitProvider({ host: hostOf(line) }));
    const token = await this.#token(userId, line);
    // what is about to be written is decided from what is there now, not from a moment ago
    if (fresh) forgetLine(line.repoId);
    const entry = await this.#entryOf({ token, userId, line });
    return { line, token, context: entry?.context ?? null, entry };
  };

  // ---------------------------------------------------------------- lines

  /** What a line is made of (its kind, metamodels and modules) and what that resolves to. */
  getLineModules = async ({ id, userId }) => {
    const { line, context, entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!context) throw new LineNotModularError();
    // the kind is what the repository says it is
    if (line.kind !== context.spl.kind) {
      line.kind = context.spl.kind;
      await this.lineRepository.save(line);
    }
    try {
      const resolved = await this.#resolvedOf(entry);
      const report = await this.#reportOf(entry);
      return {
        modular: context.spl.kind === 'modular',
        kind: context.spl.kind,
        spl: context.spl,
        lockCurrent: context.lock ? isLockCurrent({ lock: context.lock, resolved }) : false,
        packages: summarizeResolved(resolved),
        featureModel: report.featureModel,
      };
    } catch (error) {
      if (!(error instanceof LineaCoreError)) throw error;
      return { modular: context.spl.kind === 'modular', kind: context.spl.kind, spl: context.spl, lockCurrent: false, packages: [], featureModel: '', error: error.message };
    }
  };

  /**
   * The packages a line pins, for the views of a package that list where it is used: what the line asks for directly (the range in its
   * `spl.json`) and the version its lock resolved each one to. `null` when the line is not made of packages. Needs read access only.
   */
  linePins = async ({ line, userId }) => {
    const { context } = await this.#lineAndContext({ userId, lineId: line._id, accessLevel: ACCESS.REPORTER });
    if (!context) return null;
    const locked = {};
    for (const [location, entry] of Object.entries(context.lock?.packages ?? {})) locked[location] = { kind: entry.kind, version: entry.version };
    const products = (await this.productRepository.findByLineId(line._id)).map((p) => ({ id: String(p._id), name: p.spec?.basicData?.name ?? String(p._id) }));
    return {
      id: String(line._id), name: line.name, kind: context.spl.kind, version: line.version,
      modules: context.spl.modules ?? {}, metamodels: context.spl.metamodels ?? {}, locked, products,
    };
  };

  /** Whether the modules of a line (the ones given, or the saved ones) fit together: nothing is written. */
  checkLineModules = async ({ id, userId, modules, metamodels }) => {
    const { line, context, entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    const base = context?.spl ?? buildSplManifest({ name: line.name, kind: 'modular', featureMetamodel: featureMetamodelLocation(hostOf(line)) });
    const spl = { ...base, ...(modules ? { modules } : {}), ...(metamodels ? { metamodels } : {}) };
    // what the Modules page asks when it opens is the composition the line already has: its resolution and report are the ones kept for the line
    const saved = context && sameEntries(spl.modules, context.spl.modules) && sameEntries(spl.metamodels, context.spl.metamodels);
    try {
      if (saved) {
        const [resolved, report] = await Promise.all([this.#resolvedOf(entry), this.#reportOf(entry)]);
        return { ...report, packages: summarizeResolved(resolved) };
      }
      const resolved = await resolveSpl({ spl, source: context?.source ?? createPackageSource({ token: await this.#token(userId, line), tokens: await this.#tokens(userId), userId }), lock: context?.lock });
      const report = await checkSpl({ resolved, spl: context?.files, createEngine });
      return { ...report, packages: summarizeResolved(resolved) };
    } catch (error) {
      if (!(error instanceof LineaCoreError)) throw error;
      return { ...failure(error), packages: [] };
    }
  };

  /**
   * Sets the modules a line uses directly: resolves them, checks that they fit together, and commits `spl.json` and the lockfile.
   * A set of modules with errors is refused (`ModuleCheckError`, 422, with every diagnostic).
   */
  saveLineModules = async ({ id, userId, modules, metamodels, bump = 'minor' }) => {
    const { line, token, context } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.MAINTAINER, fresh: true });
    if (!context) throw new LineNotModularError();
    if (modules !== undefined && context.spl.kind !== 'modular') throw new LineNotModularError('Only a line made of modules has modules to change.');
    if (metamodels !== undefined && context.spl.kind === 'plain') throw new LineNotModularError('A plain line has no metamodels to change.');
    const spl = parseSplManifest({ content: JSON.stringify({ ...context.spl, ...(modules === undefined ? {} : { modules }), ...(metamodels === undefined ? {} : { metamodels }) }) });
    const source = context.source ?? createPackageSource({ token, tokens: await this.#tokens(userId), userId });
    const resolved = await resolveSpl({ spl, source, lock: context.lock });
    const report = await checkSpl({ resolved, spl: context.files ?? repositoryFiles({ token, id: line.repoId, ref: 'main', host: hostOf(line) }), createEngine });
    if (!report.ok) throw new ModuleCheckError(`The modules of "${line.name}" do not fit together`, report.diagnostics);

    await upsertFiles({
      token,
      host: hostOf(line),
      id: line.repoId,
      message: metamodels === undefined ? 'Update the modules of the SPL' : 'Update the packages of the SPL',
      files: {
        [SPL_MANIFEST_PATH]: serializeSplManifest({ spl }),
        [LOCK_PATH]: serializeLock({ lock: resolved.lock }),
      },
    });
    forgetLine(line.repoId);
    line.version = incrementVersion({ version: line.version, index: BUMP_INDEX[bump] ?? 1 });
    await this.lineRepository.save(line);
    domainEvents.emit(DOMAIN_EVENTS.LINE_MODEL_CHANGED, { lineId: String(line._id) });
    // the version this save reached is kept, with the modules and the model they compose
    const composed = await this.composedFeatureModel({ token, userId, line }).catch((error) => {
      console.error(`[ModularService] the feature model of "${line.name}" could not be composed for its version snapshot:`, error);
      return null;
    });
    await keepLineVersion({
      token, host: hostOf(line), projectId: line.repoId, version: line.version, name: line.name,
      snapshot: {
        modular: true,
        featureModel: composed === null ? null : { type: 'UVL', content: composed },
        modules: spl.modules,
        packages: packagesOf(summarizeResolved(resolved)),
      },
    });
    return { modular: true, spl, packages: summarizeResolved(resolved), report };
  };

  /**
   * Resolves and checks what a line that does not exist yet would be made of: its `kind`, and the `metamodels` (a project's) or `modules`
   * (a modular one's) it asks for. Nothing is written.
   * With `strict` what does not fit is refused (`ModuleCheckError`), and what comes back carries the manifest, the lock and the files to commit.
   */
  previewLine = async ({ userId, name, kind = 'plain', metamodels = {}, modules = {}, strict = false, signal, ci, host }) => {
    // The creation form asks again at every change and goes back to what it already asked (add a module, remove it): a creation
    // (`strict`) is always worked out afresh, a preview is kept for a few seconds per person and composition.
    if (strict) return this.#previewLineNow({ userId, name, kind, metamodels, modules, strict, signal, ci, host });
    const key = `${userId}|${host ?? ''}|${ci ?? ''}|${JSON.stringify([name, kind, metamodels, modules])}`;
    try {
      return await previews.get(key, () => this.#previewLineNow({ userId, name, kind, metamodels, modules, strict, signal, ci, host }));
    } catch (error) {
      // the request that was working it out was abandoned and this one joined it: work it out for this one
      if (signal?.aborted || error instanceof LineaCoreError) throw error;
      return this.#previewLineNow({ userId, name, kind, metamodels, modules, strict, signal, ci, host });
    }
  };

  #previewLineNow = async ({ userId, name, kind, metamodels, modules, strict, signal, ci, host }) => {
    // the packages are those of the registry of the host the person works on (or of the one the line is made on)
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    host ??= activeHostOf(user);
    ci ??= ciKindOf(host);
    const source = createPackageSource({ token: tokenFor(user, host), tokens: await this.#tokens(userId), userId, signal });
    try {
      const input = { name, kind, metamodels, modules, featureMetamodel: featureMetamodelLocation(host) };
      const spl = parseSplManifest({ content: serializeSplManifest({ spl: buildSplManifest(input) }) });
      const files = buildLineScaffold({ ...input, ci });
      // the SPL as it will be, with its own files: its feature model is checked with the rest
      const own = createMemoryPackageSource({ packages: { 'memory:spl': { '0.0.0': Object.fromEntries(files.map((f) => [f.path, f.content])) } } });
      const resolved = await timed('resolve', () => resolveSpl({ spl, source }));
      const report = await timed('check', async () => checkSpl({ resolved, spl: await own.open({ location: 'memory:spl', version: '0.0.0' }), createEngine }));
      if (strict && !report.ok) throw new ModuleCheckError(`What "${name}" asks for does not fit together`, report.diagnostics);
      const { configuration: _configuration, ...rest } = report;
      return { ...rest, packages: summarizeResolved(resolved), spl, lock: resolved.lock, files };
    } catch (error) {
      if (!(error instanceof LineaCoreError) || strict) throw error;
      return { ...failure(error), packages: [] };
    }
  };

  /** Resolves and checks a set of modules for a modular line that does not exist yet (see `previewLine`). */

  /**
   * The feature model the line would compose if its modules were `modules`: nothing is written. Read-only access is enough, it is what
   * the person sees before saving. Throws what resolving them throws (`LineaCoreError`) when they do not fit.
   */
  proposedFeatureModel = async ({ id, userId, modules, metamodels }) => {
    const { context } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!context || (modules !== undefined && context.spl.kind !== 'modular')) throw new LineNotModularError();
    const spl = parseSplManifest({ content: JSON.stringify({ ...context.spl, ...(modules === undefined ? {} : { modules }), ...(metamodels === undefined ? {} : { metamodels }) }) });
    const resolved = await resolveSpl({ spl, source: context.source, lock: context.lock });
    return (await checkSpl({ resolved, spl: context.files, createEngine })).featureModel;
  };

  /**
   * What the feature metamodel says of feature selections against a feature model: the line's own when `uvl` is not given, else that one
   * (UVL, as the editor of the model gives it). Used to see what a change of the model does to the products. One verdict per selection.
   */
  checkSelections = async ({ id, userId, uvl, selections }) => {
    const { entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!entry) throw new LineNotModularError();
    const resolved = await this.#resolvedOf(entry);
    const { engine } = await prepareEngine({ resolved, createEngine });
    const tree = parseUvl({ content: uvl ?? (await this.#reportOf(entry)).featureModel });
    return checkSelections({ engine, tree, selections });
  };

  /** The features every product of the line has (of the line's current feature model, or of `uvl`). */
  mandatoryFeatures = async ({ id, userId, uvl }) => {
    const { entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!entry) throw new LineNotModularError();
    return [...mandatoryFeaturesOf(parseUvl({ content: uvl ?? (await this.#reportOf(entry)).featureModel }))];
  };

  /**
   * A feature model given as UVL, as the text the line keeps it in (a model of the feature metamodel). For a tool that edits UVL and has
   * to commit the result; nothing is written. A UVL that does not parse is a `UvlParseError` (400).
   */
  featureModelFromUvl = async ({ id, userId, uvl }) => {
    const { entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!entry) throw new LineNotModularError();
    const resolved = await this.#resolvedOf(entry);
    const { engine } = await prepareEngine({ resolved, createEngine });
    const { texts, errors } = await engine.importJson({ featureModel: parseUvl({ content: uvl }) });
    const text = texts?.[FEATURE_MODEL_GRAMMAR];
    if (text === undefined) throw new InvalidArgumentError(`The feature metamodel did not make a model of the UVL: ${(errors ?? []).join('; ')}`);
    return { text };
  };

  /** The feature model the products of a line choose from, as UVL: the line's own with the ones of its modules grafted in. `null` for a line with no `spl.json`. */
  composedFeatureModel = async ({ token, userId, line }) => {
    const entry = await this.#entryOf({ token, userId, line });
    if (!entry) return null;
    return (await this.#reportOf(entry)).featureModel;
  };

  /**
   * The feature model of a line, as what it is: a model of the feature metamodel (bango's `featuremodel`), with the metamodel's grammars and
   * scripts so the page can edit it with bango. For a line made of modules it is the one they compose, and is read-only: change the modules.
   */
  getLineFeatureModel = async ({ id, userId }) => {
    const { line, context, entry } = await timed('context', () => this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.DEVELOPER }));
    if (!context) throw new LineNotModularError();
    const resolved = await timed('resolve', () => this.#resolvedOf(entry));
    const report = await timed('report', () => this.#reportOf(entry));
    const model = report.configuration?.models.find((m) => m.metamodel === FEATURE_MODEL_GRAMMAR);
    return {
      kind: context.spl.kind,
      modular: context.spl.kind === 'modular',
      readOnly: context.spl.kind === 'modular',
      metamodel: FEATURE_MODEL_GRAMMAR,
      file: FEATURE_MODEL_PATH,
      text: model?.text ?? null,
      // every model of a level above 0 the SPL has (the feature model among them): what its products' models are made from
      models: (report.configuration?.models ?? []).map((m) => ({
        metamodel: m.metamodel, level: m.level, text: m.text, file: m.file, stored: m.stored,
        // the feature model of a line made of modules is composed from them; the SPL's other models are its own
        readOnly: context.spl.kind === 'modular' && m.metamodel === FEATURE_MODEL_GRAMMAR,
      })),
      // the same model as UVL: what the analysis and the history work on
      uvl: report.featureModel,
      version: line.version,
      diagnostics: report.diagnostics.filter((d) => d.package === 'spl'),
      bundle: await timed('bundle', () => bundleOf(resolved)),
    };
  };

  /** Where the SPL keeps its model of a metamodel of a level above 0 (`PackageNotFoundError` when it has no such metamodel). */
  #modelPathOf = async ({ resolved, context, metamodel }) => {
    if (metamodel === FEATURE_MODEL_GRAMMAR) return FEATURE_MODEL_PATH;
    const report = await checkSpl({ resolved, spl: context.files, createEngine });
    const found = report.configuration?.models.find((m) => m.metamodel === metamodel);
    if (!found) throw new PackageNotFoundError(`"${metamodel}" is not a metamodel of a level above 0 of this line`);
    return found.file;
  };

  /**
   * What a feature model (a model of the feature metamodel, as the page is editing it) would be in this line: whether it fits with the rest
   * of the SPL, and its UVL, which the analysis works on. Nothing is written.
   */
  previewLineFeatureModel = async ({ id, userId, content, metamodel = FEATURE_MODEL_GRAMMAR }) => {
    const { context, entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.REPORTER });
    if (!context) throw new LineNotModularError();
    const resolved = await this.#resolvedOf(entry);
    const path = await this.#modelPathOf({ resolved, context, metamodel });
    const readOnly = context.spl.kind === 'modular' && metamodel === FEATURE_MODEL_GRAMMAR;
    const files = readOnly ? context.files : overlayFiles(context.files, { [path]: content });
    const report = await checkSpl({ resolved, spl: files, createEngine });
    return { ok: report.ok, diagnostics: report.diagnostics, uvl: report.featureModel };
  };

  /**
   * Saves the feature model of a line (a commit on `main`). It is checked first, with the rest of the SPL (`ModuleCheckError`, 422, with
   * every diagnostic, when it does not fit), and the version is raised when what it says changed (not for a change of layout or comments).
   */
  saveLineFeatureModel = async ({ id, userId, content, bump = 'minor', metamodel = FEATURE_MODEL_GRAMMAR }) => {
    const { line, token, context, entry } = await this.#lineAndContext({ userId, lineId: id, accessLevel: ACCESS.MAINTAINER, fresh: true });
    if (!context) throw new LineNotModularError();
    // the feature model of a line made of modules is composed from them; the SPL's other models are its own
    if (context.spl.kind === 'modular' && metamodel === FEATURE_MODEL_GRAMMAR) throw new LineModularReadOnlyError();
    const resolved = await this.#resolvedOf(entry);
    const path = await this.#modelPathOf({ resolved, context, metamodel });
    const before = await this.#reportOf(entry).catch(() => null);
    const report = await checkSpl({ resolved, spl: overlayFiles(context.files, { [path]: content }), createEngine });
    if (!report.ok) throw new ModuleCheckError(`The ${metamodel} model of "${line.name}" does not fit`, report.diagnostics);

    // the feature model changes the version when what it says changed; another model when its text did
    const was = before?.configuration?.models.find((m) => m.metamodel === metamodel);
    const bumped = metamodel === FEATURE_MODEL_GRAMMAR
      ? before === null || before.featureModel !== report.featureModel
      : !was || !was.stored || was.text !== content;
    await upsertFiles({ token, host: hostOf(line), id: line.repoId, message: `Update the ${metamodel} model`, files: { [path]: content } });
    forgetLine(line.repoId);
    if (bumped) line.version = incrementVersion({ version: line.version, index: BUMP_INDEX[bump] ?? 1 });
    await this.lineRepository.save(line);
    domainEvents.emit(DOMAIN_EVENTS.LINE_MODEL_CHANGED, { lineId: String(line._id) });
    if (bumped) {
      await keepLineVersion({
        token, host: hostOf(line), projectId: line.repoId, version: line.version, name: line.name,
        snapshot: { modular: false, featureModel: { type: 'UVL', content: report.featureModel }, modules: null, packages: packagesOf(summarizeResolved(resolved)) },
      });
    }
    return { version: line.version, bumped, uvl: report.featureModel };
  };

  // ------------------------------------------------------------- products

  #productContext = async ({ id, userId, accessLevel }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel }, getGitProvider({ host: hostOf(product) }));
    const line = await this.lineRepository.findById(product.lineId);
    assertLineAlive(line);
    const token = await this.#token(userId, product);
    const entry = await this.#entryOf({ token, userId, line });
    if (!entry) throw new LineNotModularError();
    const resolved = await this.#resolvedOf(entry);
    return { product, line, token, context: entry.context, resolved };
  };

  /** The models a product repository holds on `main`: metamodel name -> text. */
  #readStoredModels = async ({ token, productProjectId, host }) => {
    const git = getGitProvider({ host });
    const paths = (await git.listFiles({ token, id: productProjectId, ref: 'main' })).filter((path) => path.startsWith(MODELS_DIR));
    const models = {};
    const contents = await Promise.all(paths.map((path) => git.readFile({ token, id: productProjectId, path, ref: 'main' })));
    paths.forEach((path, index) => {
      if (contents[index] !== null) models[basenameOf(path)] = contents[index].toString('utf8');
    });
    return models;
  };

  #storedModels = ({ token, productProjectId, fresh = false, host }) => {
    if (fresh) forgetStored(productProjectId);
    return storedModelsOf.get(`${String(token).slice(-12)}|${productProjectId}`, () => this.#readStoredModels({ token, productProjectId, host }));
  };

  /** The models of a product repository as they are now (metamodel name -> text); `{}` when it has none. */
  storedModels = ({ token, productProjectId, fresh = false, host }) => this.#storedModels({ token, productProjectId, fresh, host });

  /**
   * Puts `models` (metamodel name -> text) back in the product repository: the ones that were changed since are written again.
   * A model that was added since is left alone. Returns the names that were restored.
   */
  restoreStoredModels = async ({ token, productProjectId, models, host }) => {
    const git = getGitProvider({ host });
    const paths = (await git.listFiles({ token, id: productProjectId, ref: 'main' })).filter((path) => path.startsWith(MODELS_DIR));
    const current = await this.#readStoredModels({ token, productProjectId, host });
    const files = {};
    const restored = [];
    for (const path of paths) {
      const name = basenameOf(path);
      if (name in models && models[name] !== current[name]) {
        files[path] = models[name];
        restored.push(name);
      }
    }
    if (restored.length) {
      await upsertFiles({ token, host, id: productProjectId, message: 'Discard the saved changes of the models', files });
      forgetStored(productProjectId);
    }
    return restored;
  };

  /** Where the nodes of the diagrams were left (`.linea/layouts.json`): `{}` when nobody has moved any. */
  #storedLayouts = async ({ token, productProjectId, host }) => {
    const bytes = await getGitProvider({ host }).readFile({ token, id: productProjectId, path: LAYOUTS_PATH, ref: 'main' }).catch(() => null);
    if (bytes === null) return {};
    try {
      const parsed = JSON.parse(bytes.toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };

  #modelsWithoutLine = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    if (!isLineDeleted(await this.lineRepository.findById(product.lineId))) return null;
    const git = getGitProvider({ host: hostOf(product) });
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git);
    const token = await this.#token(userId, product);
    const paths = (await git.listFiles({ token, id: product.repo.id, ref: 'main' })).filter((path) => path.startsWith(MODELS_DIR));
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    const metamodels = paths
      .filter((path) => basenameOf(path) in stored)
      .map((path) => ({ name: basenameOf(path), extension: path.slice(path.lastIndexOf('.') + 1), model: stored[basenameOf(path)], requires: [] }));
    return { metamodels, offered: [], configuration: [], diagnostics: [], readOnly: true };
  };

  /** What a product has to give a model of, the models it has, and what its modules offer (read-only). */
  getProductModels = async ({ id, userId, summary = false }) => {
    const orphan = await this.#modelsWithoutLine({ id, userId });
    if (orphan) return orphan;
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.REPORTER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    // checked here as well as in the browser: the overview of the product shows how each model stands before anyone opens an editor
    const { metamodels, diagnostics, configuration } = await checkProductOnce({ resolved, spl: context.files, models: stored, createEngine });
    const errorsIn = (info) => diagnostics.filter((d) => d.severity === 'error' && d.file === `${MODELS_DIR}${info.name}.${info.extension}`).length;
    const infos = metamodels.map((info) => ({ ...info, model: stored[info.name] ?? null, errors: errorsIn(info) }));
    const failing = diagnostics.filter((d) => d.severity === 'error');
    if (failing.length) console.warn(`[models] product ${id} has ${failing.length} model error(s):`, JSON.stringify(failing.slice(0, 5)));
    // the overview shows how each model stands; what an editor needs (the grammars, what the modules offer, the layouts) comes with the editor
    if (summary) return { metamodels: infos, diagnostics, summary: true };
    return {
      metamodels: infos,
      offered: await listOfferedModels({ resolved }),
      // the models of the SPL (its feature model) that the product's models are made from: offered to them, read-only
      configuration: configuration.models.map(({ metamodel, level, text }) => ({ metamodel, level, text })),
      // the grammars and scripts of the metamodels, as they are in GitLab at the versions the line's lockfile pins: the client loads them
      // into its own engine to give the forms and views
      bundle: await readMetamodelBundle({ resolved }),
      // where the nodes of the diagrams that metamodels bring were left (the same for everyone who works on the product)
      layouts: await this.#storedLayouts({ token, host: hostOf(product), productProjectId: product.repo.id }),
      diagnostics,
    };
  };

  /** Whether the models of a product (the stored ones, with `models` laid over them) are right for its line. Nothing is written. */
  checkProductModels = async ({ id, userId, models = {} }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.REPORTER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    const report = await checkProductOnce({ resolved, spl: context.files, models: { ...stored, ...models }, createEngine });
    const { models: _merged, configuration: _configuration, ...rest } = report;
    return rest;
  };

  /** Saves the model of one metamodel in the product repository (a commit on `main`), and says how the product's models stand. */
  saveProductModel = async ({ id, userId, metamodel, content, layouts }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: true });
    const report = await checkProductOnce({ resolved, spl: context.files, models: { ...stored, [metamodel]: content }, createEngine });
    const info = report.metamodels.find((m) => m.name === metamodel);
    if (!info) throw new PackageNotFoundError(`"${metamodel}" is not a metamodel of this line`);
    const files = { [`${MODELS_DIR}${metamodel}.${info.extension}`]: content };
    // the nodes of its diagrams are saved in the same commit, so the model and its picture do not part
    if (layouts !== undefined) files[LAYOUTS_PATH] = this.#layoutsFile(layouts, report.metamodels);
    await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: `Update the ${metamodel} model`, files });
    forgetStored(product.repo.id);
    // the features the product's selection comes to (its feature selection completed by the feature model): what the product index keeps
    const features = metamodel === 'featureselection' && report.ok ? report.models?.features : undefined;
    const { models: _merged, configuration: _configuration, ...rest } = report;
    return features === undefined ? rest : { ...rest, features };
  };

  /**
   * Saves a product's feature selection from the names of the features: the text of the `featureselection` model is made here, from the
   * name of the line's feature model, so a caller that only knows features does not need the format.
   */
  saveProductSelection = async ({ id, userId, features }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    const report = await checkProductOnce({ resolved, spl: context.files, models: stored, createEngine });
    const model = report.configuration?.featureModel?.name;
    if (!model) throw new PackageNotFoundError('the line has no feature model to select from');
    return this.saveProductModel({ id, userId, metamodel: 'featureselection', content: selectionText({ model, features }) });
  };

  #layoutsFile = (layouts, metamodels) => `${JSON.stringify(cleanLayouts(layouts, metamodels.map((m) => m.name)), null, 2)}
`;

  /** Saves where the nodes of the diagrams were left, when that is all that changed (a commit on `main`). */
  saveProductLayouts = async ({ id, userId, layouts }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: true });
    const report = await checkProductOnce({ resolved, spl: context.files, models: stored, createEngine });
    forgetStored(product.repo.id);
    await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: 'Move the nodes of the diagrams', files: { [LAYOUTS_PATH]: this.#layoutsFile(layouts, report.metamodels) } });
    return { saved: true };
  };

  /** The seeded models of the SPL with the name of the product in the `basic` one (see `seedModels`). */
  #seedFor = async ({ resolved, files, product }) => {
    const seeded = await seedProductModels({ resolved, spl: files, createEngine });
    // the metamodel's placeholder name (`newBasicModel`) would be the name of the product in its code and its jar: use the product's
    // (a word: the grammar of the metamodel takes an identifier here)
    const productName = String(product.spec?.basicData?.name ?? '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1');
    if (productName && typeof seeded.models.basic === 'string') {
      seeded.models.basic = seeded.models.basic.replace(/^(basic\s+)\S+/, (_, head) => `${head}${productName}`);
    }
    return seeded;
  };

  /**
   * A new product starts with the smallest valid model of each metamodel with final models. Its feature selection starts from the
   * `features` it was asked for (a configuration of the feature model), else from the smallest the feature model accepts. Returns the
   * features the selection comes to, with what the feature model implies: what the spec indexes.
   */
  seedModels = async ({ token, userId, line, product, features = [] }) => {
    const entry = await this.#entryOf({ token, userId, line });
    if (!entry) return false;
    const resolved = await this.#resolvedOf(entry);
    const seeded = await this.#seedFor({ resolved, files: entry.context.files, product });
    if (features.length && seeded.configuration.featureModel && seeded.models.featureselection !== undefined) {
      seeded.models.featureselection = selectionText({ model: seeded.configuration.featureModel.name, features });
    }
    const files = Object.fromEntries(seeded.metamodels.map((info) => [`${MODELS_DIR}${info.name}.${info.extension}`, seeded.models[info.name]]));
    files[PRODUCT_MANIFEST_PATH] = serializeProductManifest({ product, resolved });
    await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: 'Add the initial models', files });
    forgetStored(product.repo.id);
    const report = await checkProductOnce({ resolved, spl: entry.context.files, models: seeded.models, createEngine });
    return { features: report.models?.features ?? features };
  };

  /**
   * Whether the models of a product are valid for its line, its feature selection above all, and the features the selection comes to
   * (the selection completed by the feature model): `{ valid, features, error, errorType }`.
   */
  getProductHealth = async ({ id, userId }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.REPORTER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    const report = await checkProductOnce({ resolved, spl: context.files, models: stored, createEngine });
    return healthOfReport({ report, fallbackFeatures: product.spec?.features });
  };

  /** Rewrites `.linea/product.json` with the product's current version and the modules/metamodels it resolves to now (a commit on `main`). */
  updateProductManifest = async ({ token, product, resolved }) => this.writeProductManifest({ token, product, manifest: this.productManifest({ product, resolved }) });

  productManifest = ({ product, resolved }) => serializeProductManifest({ product, resolved });

  writeProductManifest = async ({ token, product, manifest }) => {
    await upsertFiles({
      token, host: hostOf(product), id: product.repo.id, message: 'Update the product manifest',
      files: { [PRODUCT_MANIFEST_PATH]: manifest },
    });
  };

  /**
   * Brings the models of a product in line with its SPL after the SPL changed its metamodels: the models of metamodels the SPL no
   * longer has are removed, and a metamodel the SPL gained gets its smallest valid model. With `commit` the repository is changed too
   * (one commit on `main`; the removed models stay in the history). Returns the resulting models and what changed.
   */
  #reconcile = async ({ token, product, resolved, files, models, commit }) => {
    const git = getGitProvider({ host: hostOf(product) });
    const engineMetamodels = await this.#seedFor({ resolved, files, product });
    const known = new Map(engineMetamodels.metamodels.map((info) => [info.name, info]));
    const removed = Object.keys(models).filter((name) => !known.has(name));
    const added = [...known.keys()].filter((name) => models[name] === undefined);
    if (!removed.length && !added.length) return { models, removed, added, committed: false };
    const next = {};
    for (const [name, text] of Object.entries(models)) if (known.has(name)) next[name] = text;
    for (const name of added) next[name] = engineMetamodels.models[name];
    let committed = false;
    if (commit) {
      const paths = (await git.listFiles({ token, id: product.repo.id, ref: 'main' })).filter((path) => path.startsWith(MODELS_DIR));
      const files = {};
      for (const path of paths) if (removed.includes(basenameOf(path))) files[path] = null;
      for (const name of added) files[`${MODELS_DIR}${name}.${known.get(name).extension}`] = engineMetamodels.models[name];
      await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: 'Adapt the models to the metamodels of the SPL', files });
      forgetStored(product.repo.id);
      committed = true;
    }
    return { models: next, removed, added, committed };
  };

  /** Adapts the models stored in a product repository to the current metamodels of its SPL (see `#reconcile`). */
  syncProductModels = async ({ id, userId }) => {
    const { product, token, context, resolved } = await this.#productContext({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: true });
    const { removed, added } = await this.#reconcile({ token, product, resolved, files: context.files, models: stored, commit: true });
    return { removed, added };
  };

  /**
   * The product's models merged into one document (`{ features, data: { basicData, dataModel, ... } }`), the same shape
   * `engine.build()` produces for derivation. `null` for a plain line, or when the stored models do not compose cleanly.
   */
  composeProductSpec = async ({ token, userId, line, product }) => {
    const entry = await this.#entryOf({ token, userId, line });
    if (!entry) return null;
    const resolved = await this.#resolvedOf(entry);
    const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id });
    if (!Object.keys(stored).length) return null;
    const report = await checkProductOnce({ resolved, spl: entry.context.files, models: stored, createEngine });
    return report.models ?? null;
  };

  /**
   * The inverse of `composeProductSpec`: runs the import mapping of each metamodel (`metamodels/<name>/imports/<name>.js`)
   * against the submitted spec's `basicData`/`dataModel`/`statics`, and writes back whichever model texts it produced.
   * Does nothing for a plain line (no models to update).
   */
  importProductSpec = async ({ token, userId, line, product, spec, write = true }) => {
    const entry = await this.#entryOf({ token, userId, line });
    if (!entry) return { updated: [], invalid: [], skipped: [], errors: [], transformed: false };
    const resolved = await this.#resolvedOf(entry);
    const { data, transformed, transformError } = await this.#specData({ files: entry.context.files, spec });
    const { engine, metamodels } = await prepareEngine({ resolved, createEngine });
    const baseline = await engine.importJson({ features: spec.features ?? [], data: {} });
    const result = await engine.importJson({ features: spec.features ?? [], data });
    const byName = new Map(metamodels.map((info) => [info.name, info]));
    const files = {};
    const updated = [];
    const invalid = [];
    const untouched = [];
    for (const [name, text] of Object.entries(result.texts ?? {})) {
      const info = byName.get(name);
      if (!info || info.level !== 0 || name === FEATURE_SELECTION) continue;
      if (baseline.texts?.[name] === text) {
        untouched.push(name);
        continue;
      }
      const errors = (result.problems?.[name] ?? []).filter((p) => p.severity === 'error');
      if (errors.length) {
        invalid.push({ metamodel: name, count: errors.length, errors: errors.slice(0, 5).map((p) => `${p.startLine + 1}:${p.startColumn + 1} ${p.message}`) });
        continue;
      }
      files[`${MODELS_DIR}${name}.${info.extension}`] = text;
      updated.push(name);
    }
    if (write && Object.keys(files).length) {
      await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: 'Update models from the submitted spec', files });
      forgetStored(product.repo.id);
    }
    let after = null;
    try {
      const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: write });
      const imported = Object.fromEntries(updated.map((name) => [name, files[`${MODELS_DIR}${name}.${byName.get(name).extension}`]]));
      const check = await checkProduct({ resolved, spl: entry.context.files, models: { ...stored, ...imported }, createEngine });
      const failing = check.diagnostics.filter((d) => d.severity === 'error');
      after = { ok: check.ok, errors: failing.length, diagnostics: failing.slice(0, 10) };
    } catch (error) {
      after = { ok: false, errors: 1, diagnostics: [{ severity: 'error', message: error?.message ?? String(error) }] };
    }
    const ignored = new Set(['featuremodel', FEATURE_SELECTION]);
    return {
      updated,
      untouched,
      invalid,
      skipped: (result.skipped ?? []).filter((name) => !ignored.has(name) && byName.get(name)?.level === 0),
      errors: [...(transformError ? [`transformation.js: ${transformError}`] : []), ...(result.errors ?? [])],
      transformed,
      after,
      texts: write ? undefined : files,
    };
  };

  #specData = async ({ files, spec }) => {
    const { features: _features, ...given } = spec ?? {};
    if (given.data && typeof given.data === 'object') return { data: given.data, transformed: false };
    const processed = Array.isArray(given.dataModel?.entities) && !Array.isArray(given.dataModel?.cells);
    if (processed) return { data: given, transformed: false };
    const transformation = await readPackageText({ files, path: TRANSFORMATION_PATH }).catch(() => undefined);
    if (!transformation) return { data: given, transformed: false };
    try {
      const data = runTransformation({ code: transformation, spec });
      return { data: { ...given, ...data }, transformed: true };
    } catch (error) {
      return { data: given, transformed: false, transformError: error?.message ?? String(error) };
    }
  };

  /**
   * What generation needs to derive a product of a modular line: the packages resolved from the line archive that was just downloaded
   * (pinned by its lockfile), and the models of the product. `null` for a plain line.
   */
  /**
   * The models a derivation starts from. The SPL may have changed its metamodels since the models were written (a module removed or
   * added): models of metamodels that are gone are left out and the ones that are new are seeded, so the product still derives. For
   * the repository's own models the repository is brought in line as well; a failure of that write does not stop the derivation.
   */
  #modelsToDerive = async ({ token, product, resolved, files, models }) => {
    const own = models === undefined;
    const current = own ? await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: true }) : models;
    try {
      const { models: adapted, removed, added } = await this.#reconcile({ token, product, resolved, files, models: current, commit: own });
      if (removed.length || added.length) console.warn(`[models] product ${product._id}: adapted to its SPL (removed ${removed.join(', ') || '-'}; added ${added.join(', ') || '-'})`);
      return await this.#withoutRemovedFeatures({ token, product, resolved, files, models: adapted, commit: own });
    } catch (error) {
      console.warn(`[models] product ${product._id}: could not adapt the models to its SPL:`, error?.message ?? error);
      return current;
    }
  };

  // A product's feature selection names features of its SPL; one the SPL removed makes the product fail its check, and the sync that is
  // meant to bring the product up to date cannot even start (OPT-068). The selection is brought in line: what the SPL no longer has is
  // dropped (the sync's request shows it as a change of the selection, with the commit that did it in the history).
  #withoutRemovedFeatures = async ({ token, product, resolved, files, models, commit }) => {
    if (typeof models.featureselection !== 'string') return models;
    const uvl = (await checkSpl({ resolved, spl: files, createEngine })).featureModel;
    const known = new Set(featuresOf({ tree: parseUvl({ content: uvl }) }).map((feature) => feature.name));
    if (!known.size) return models;
    const { text, dropped } = pruneSelection({ text: models.featureselection, known });
    if (!dropped.length) return models;
    console.warn(`[models] product ${product._id}: its feature selection lost ${dropped.join(', ')} (no longer in the SPL)`);
    if (commit) {
      await upsertFiles({ token, host: hostOf(product), id: product.repo.id, message: `Drop from the feature selection what the SPL no longer has: ${dropped.join(', ')}`, files: { [`${MODELS_DIR}featureselection.featureselection`]: text } });
      forgetStored(product.repo.id);
    }
    return { ...models, featureselection: text };
  };

  /**
   * What a trial derivation needs: like `prepareDerivation`, but with no product. The models are seeded from the SPL's metamodels and
   * the feature selection is `features` (the smallest the feature model accepts when none). `null` when the line has no spl.json.
   */
  prepareTrial = async ({ token, userId, lineOutput, features = [], models = {} }) => {
    const files = createFsFiles({ dir: lineOutput });
    const resolved = await this.#resolveFiles({ token, userId, files });
    if (!resolved) return null;
    const { models: trial } = await this.#trialModelsOf({ resolved, files, models, features });
    return { resolved, spl: files, models: trial };
  };

  #resolveFiles = async ({ token, userId, files }) => {
    const splText = await readPackageText({ files, path: SPL_MANIFEST_PATH });
    if (splText === undefined) return null;
    const lockText = await readPackageText({ files, path: LOCK_PATH });
    let lock;
    try {
      lock = lockText === undefined ? undefined : parseLock({ content: lockText });
    } catch {
      lock = undefined;
    }
    return resolveSpl({ spl: parseSplManifest({ content: splText }), source: createPackageSource({ token, tokens: await this.#tokens(userId), userId }), lock });
  };

  #trialModelsOf = async ({ resolved, files, models = {}, features = [], seedKey }) => {
    const seed = () => seedProductModels({ resolved, spl: files, createEngine });
    const seeded = await (seedKey ? trialSeeds.get(seedKey, seed) : seed());
    const known = new Set(seeded.metamodels.map((info) => info.name));
    const merged = { ...seeded.models };
    const warnings = [];
    for (const [name, text] of Object.entries(models ?? {})) {
      if (typeof text !== 'string') continue;
      if (known.has(name)) merged[name] = text;
      else warnings.push({ severity: 'warning', package: 'product', message: `"${name}" is not a metamodel of the products of this SPL: its model is left out.` });
    }
    const selectionGiven = typeof models?.featureselection === 'string';
    if (!selectionGiven && features.length && seeded.configuration.featureModel && merged.featureselection !== undefined) {
      merged.featureselection = selectionText({ model: seeded.configuration.featureModel.name, features: [...new Set(features)] });
    }
    return { models: merged, seeded, warnings };
  };

  #trialSpl = async ({ id, userId, ref, overrides = [] }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    assertLineAlive(line);
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.DEVELOPER }, getGitProvider({ host: hostOf(line) }));
    const token = await this.#token(userId, line);
    const changed = Object.fromEntries((overrides ?? []).map(({ path, action, content }) => [path, action === 'delete' ? null : String(content ?? '')]));
    const files = withoutPlatformCode(overlayFiles(repositoryFiles({ token, id: line.repoId, ref: ref || 'main', host: hostOf(line) }), changed));
    const resolved = await this.#resolveFiles({ token, userId, files });
    if (!resolved) throw new LineNotModularError();
    const relevant = Object.entries(changed).filter(([path]) => !isPlatformCode(path)).sort(([a], [b]) => a.localeCompare(b));
    const seedKey = `${userId}|${line.repoId}|${ref || 'main'}|${createHash('sha1').update(JSON.stringify(relevant)).digest('hex')}`;
    return { line, files, resolved, seedKey };
  };

  trialModels = async ({ id, userId, ref, overrides }) => {
    const { line, files, resolved, seedKey } = await this.#trialSpl({ id, userId, ref, overrides });
    try {
      const seeded = await trialSeeds.get(seedKey, () => seedProductModels({ resolved, spl: files, createEngine }));
      return {
        kind: line.kind ?? 'plain',
        metamodels: seeded.metamodels.map(({ name, extension, level, description, requires }) => ({ name, extension, level, description: description ?? null, requires: [...requires] })),
        models: seeded.models,
        featureModel: seeded.configuration.featureModel?.name ?? null,
        diagnostics: seeded.diagnostics,
        offered: await listOfferedModels({ resolved }),
        configuration: (seeded.configuration.models ?? []).map(({ metamodel, level, text }) => ({ metamodel, level, text })),
        bundle: await readMetamodelBundle({ resolved }),
      };
    } catch (error) {
      if (!(error instanceof LineaCoreError)) throw error;
      return { kind: line.kind ?? 'plain', ...failure(error), models: {}, featureModel: null };
    }
  };

  checkTrialModels = async ({ id, userId, ref, overrides, models, features, spec: sample }) => {
    let trial;
    try {
      trial = await this.#trialSpl({ id, userId, ref, overrides });
    } catch (error) {
      if (!(error instanceof LineaCoreError)) throw error;
      return { ...failure(error), features: [], spec: null, modelsByMetamodel: null, trialSpec: trialSpecOf({ sample, features: features ?? [] }) };
    }
    const { files, resolved, seedKey } = trial;
    try {
      const { models: merged, warnings } = await this.#trialModelsOf({ resolved, files, models, features, seedKey });
      const report = await checkProduct({ resolved, spl: files, models: merged, createEngine });
      return {
        ok: report.ok,
        diagnostics: [...warnings, ...report.diagnostics],
        metamodels: report.metamodels.map(({ name, extension, level }) => ({ name, extension, level })),
        features: report.models?.features ?? [],
        spec: report.models ?? null,
        modelsByMetamodel: report.modelsByMetamodel ?? null,
        trialSpec: report.ok
          ? { ...trialSpecOf({ sample, features: report.models?.features ?? features ?? [] }), models: report.models, modelsByMetamodel: report.modelsByMetamodel }
          : trialSpecOf({ sample, features: features ?? [] }),
      };
    } catch (error) {
      if (!(error instanceof LineaCoreError)) throw error;
      return { ...failure(error), features: [], spec: null, modelsByMetamodel: null, trialSpec: trialSpecOf({ sample, features: features ?? [] }) };
    }
  };

  /**
   * Whether the models of a product fit its SPL, decided before the derivation downloads anything: the SPL is read from its repository,
   * its packages come from the disk cache once they were opened before, and the models are the ones the derivation would use. Throws
   * `ModuleCheckError` as the derivation does; anything else that goes wrong is left for the derivation to report.
   */
  assertProductFits = async ({ token, userId, product, line }) => {
    let report;
    try {
      const entry = await this.#entryOf({ token, userId, line });
      if (!entry) return;
      const resolved = await this.#resolvedOf(entry);
      const stored = await this.#storedModels({ token, host: hostOf(product), productProjectId: product.repo.id, fresh: true });
      let models = stored;
      try {
        const reconciled = await this.#reconcile({ token, product, resolved, files: entry.context.files, models: stored, commit: false });
        models = await this.#withoutRemovedFeatures({ token, product, resolved, files: entry.context.files, models: reconciled.models, commit: false });
      } catch {
        models = stored;
      }
      report = await checkProductOnce({ resolved, spl: entry.context.files, models, createEngine });
    } catch {
      return;
    }
    if (report.ok) return;
    const errors = report.diagnostics.filter(({ severity }) => severity === 'error');
    throw new ModuleCheckError(
      `The product does not fit its SPL:\n- ${errors.map(({ package: from, file, message }) => `${from}${file === undefined ? '' : ` ${file}`}: ${message}`).join('\n- ')}`,
      report.diagnostics,
    );
  };

  prepareDerivation = async ({ token, userId, product, lineOutput, models, newVersion, log = async () => {} }) => {
    const files = createFsFiles({ dir: lineOutput });
    const splText = await readPackageText({ files, path: SPL_MANIFEST_PATH });
    if (splText === undefined) return null;
    const lockText = await readPackageText({ files, path: LOCK_PATH });
    const resolved = await resolveSpl({
      spl: parseSplManifest({ content: splText }),
      source: createCachedPackageSource({ token, tokens: await this.#tokens(userId), userId }),
      lock: lockText === undefined ? undefined : parseLock({ content: lockText }),
      onProgress: ({ kind, location, version, requiredBy }) => log({
        version: newVersion, type: 'info',
        message: kind === 'module' ? 'log.resolving_module' : 'log.resolving_metamodel',
        params: [location, version, requiredBy],
      }),
    });
    return {
      resolved,
      spl: files,
      // `models` when the caller has the ones to derive from (the zip of an old version); otherwise those of the repository
      models: await this.#modelsToDerive({ token, product, resolved, files, models }),
    };
  };
}

Container.set(ModularService, new ModularService());
