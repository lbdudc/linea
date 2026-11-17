import { createHash } from 'node:crypto';
import { Container } from 'typedi';
import { getGitProvider } from '../git/index.js';
import { sleep, backoffDelay, isRetryableConflict, isNotFound } from './gitRetry.js';
import { keepVersionTag, readVersionTag, listVersionTags } from './versionTags.js';
import { keepVersionRelease, recordReleaseFailure } from './versionReleases.js';

const SPEC_PATH = '.linea/spec.draft.json';
// What the last generation derived from: its version and a hash of the spec it used. A spec.json whose hash differs
// from it is saved but not deployed.
const DEPLOYED_PATH = '.linea/spec.json';
const DEFAULT_REF = 'main';
const MAX_ATTEMPTS = 5;
const READ_MAX_ATTEMPTS = 3;

// The health and the deployment status of a product, asked for by the same page at the same time, each read the same file of the same
// repository: a read that is on its way is joined by the other. Nothing is kept once it is answered, so a change is never hidden.
const reading = new Map();
const readingOnce = (key, load) => {
  const running = reading.get(key);
  if (running) return running;
  const call = load().finally(() => { if (reading.get(key) === call) reading.delete(key); });
  reading.set(key, call);
  return call;
};

const serializeSpecFile = (spec) => `${JSON.stringify({ spec }, null, 2)}\n`;

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};

// Stable across key order, so two saves of the same content hash the same.
// Over the JSON round trip, which is what a later read of spec.json sees (dates become strings, undefined goes away).
export const specHash = (spec) => createHash('sha256').update(JSON.stringify(sortKeys(JSON.parse(JSON.stringify(spec))))).digest('hex');

// Saved-but-not-deployed from a deployment record and the spec as it is now: pending is null when there is no record to compare with.
// `models` (metamodel name -> text) are what the product holds besides its spec; they only count when the record kept the ones it
// was generated from (older records did not), and when they are known.
export const deploymentStatus = ({ deployed, spec, models }) => {
  if (!deployed) return { pending: null, version: null, deployedAt: null, restorable: false, modelsChanged: null };
  const comparable = Boolean(deployed.models) && models !== undefined;
  // line endings do not make a model different (the browser's editor writes CRLF where the generation wrote LF)
  const eol = (text) => (typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text);
  const same = (name) => eol(models?.[name]) === eol(deployed.models?.[name]);
  const names = comparable ? [...new Set([...Object.keys(models), ...Object.keys(deployed.models)])] : [];
  const modelsChanged = comparable ? names.some((name) => !same(name)) : null;
  // which metamodels' models differ from the ones deployed (a model that is new or gone counts), for the list to mark them
  const changedModels = names.filter((name) => !same(name)).sort();
  return {
    changedModels,
    specChanged: deployed.specHash !== specHash(spec),
    pending: deployed.specHash !== specHash(spec) || modelsChanged === true,
    version: deployed.version ?? null,
    deployedAt: deployed.deployedAt ?? null,
    // whether what was deployed is kept, so the changes can be compared and discarded
    restorable: Boolean(deployed.spec),
    modelsChanged,
  };
};

// What Mongo keeps of a product once its spec is in GitLab: enough to list it and nothing of its configuration.
export const indexOnlySpec = (spec) => ({
  basicData: {
    name: spec.basicData?.name,
    version: spec.basicData?.version ?? '0.0.0',
    createdAt: spec.basicData?.createdAt,
    database: {},
    extra: {},
    testEnvironment: { image: '', command: '' },
    languages: spec.basicData?.languages ?? ['en', 'es', 'gl'],
    SRID: spec.basicData?.SRID ?? '4326',
  },
  dataModel: { cells: [] },
  features: [],
  statics: [],
  sensor: { dsl: '', parsed: null },
});

// The spec Mongo can stand in for GitLab with: none once the product's spec lives in GitLab, so an outage fails loudly
// instead of serving (and later saving) an empty one.
export const fallbackSpecOf = (product) => (product.specInRepo ? null : product.spec);

// What .linea/spec.draft.json keeps for a product of a MODULAR line: everything else (database, extra, languages, SRID,
// dataModel, statics...) is composed from its models (ModularService.composeProductSpec) instead of duplicated here.
// A plain line has no models to compose from, so its spec.json keeps the full shape (writeSpec is called with the
// spec as-is for those, not through this helper).
export const minimalSpec = (spec) => ({
  basicData: {
    name: spec.basicData?.name,
    version: spec.basicData?.version ?? '0.0.0',
    createdAt: spec.basicData?.createdAt,
  },
  features: spec.features ?? [],
});

export class ProductSpecFileError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductSpecFileError';
  }
}

export class ProductSpecUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductSpecUnavailableError';
  }
}

export class ProductSpecFillerRejectedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductSpecFillerRejectedError';
  }
}

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE']);

// A token the host no longer accepts is not "the host is down": it is answered as such (401), so the client renews the session and asks
// again. Served from the cache as an infrastructure failure, the person got a 503 that nothing could recover from, after waiting for the
// retries of a call that was never going to work.
const isAuthFailure = (err, host) => {
  try {
    return getGitProvider({ host }).isAuthError(err);
  } catch {
    return false;
  }
};

const classifySpecFallback = (err) => {
  if (typeof err?.status === 'number') return 'infra';
  if (NETWORK_ERROR_CODES.has(err?.code)) return 'infra';
  return null;
};

const logSpecReadFallback = (context, reason, error) => {
  if (reason === 'infra') {
    console.error(
      `[productSpec] SPEC FROM CACHE (infra) — ${context}: no se pudo leer .linea/spec.draft.json de GitLab ` +
      '(red, permisos, o GitLab caído) — sirviendo el spec cacheado de Mongo, que puede estar desactualizado. ' +
      'Esto NO es "producto sin fichero todavía": es un fallo de infraestructura, revisar la conectividad/permisos:',
      error?.message ?? error
    );
    return;
  }
  console.info(
    `[productSpec] SPEC FROM CACHE (absent) — ${context}: no hay .linea/spec.draft.json todavía (producto anterior a ` +
    'esta migración, o seguía marcado specFiller) — sirviendo el spec cacheado de Mongo.'
  );
};

const parseSpecFile = (content) => {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ProductSpecFileError(`.linea/spec.draft.json is not valid JSON: ${err.message}`, { cause: err });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProductSpecFileError('.linea/spec.draft.json must be a JSON object with a "spec" key.');
  }
  if (!('spec' in parsed) || parsed.spec === null || typeof parsed.spec !== 'object' || Array.isArray(parsed.spec)) {
    throw new ProductSpecFileError('.linea/spec.draft.json is missing a valid "spec" object (wrong/future format, or corrupt).');
  }
  return parsed.spec;
};

export default class ProductSpecService {
  readSpec = async ({ token, productProjectId, ref = DEFAULT_REF, host }) => {
    let meta;
    try {
      meta = await readingOnce(`${host}|${token}|${productProjectId}|${ref}|${SPEC_PATH}`, () => getGitProvider({ host }).getFileRevision({ token, id: productProjectId, path: SPEC_PATH, ref }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    const content = Buffer.from(meta.content, 'base64').toString('utf8');
    return parseSpecFile(content);
  };

  #readWithRetry = async ({ token, productProjectId, ref, host }) => {
    let lastError;
    for (let attempt = 1; attempt <= READ_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.readSpec({ token, productProjectId, ref, host });
      } catch (err) {
        if (err instanceof ProductSpecFileError || isAuthFailure(err, host)) throw err;
        lastError = err;
        if (attempt === READ_MAX_ATTEMPTS) break;
        await sleep(backoffDelay(attempt));
      }
    }
    throw lastError;
  };

  getSpecFromHostOrCache = async ({ token, productProjectId, ref = DEFAULT_REF, fallbackSpec, context, host }) => {
    const noSpec = (reason, cause) => new ProductSpecUnavailableError(
      `No hay spec de ${context} que servir: .linea/spec.draft.json no se pudo leer de GitLab (${reason}) y Mongo ya no guarda el spec completo.`,
      { cause }
    );
    try {
      const spec = await this.#readWithRetry({ token, productProjectId, ref, host });
      if (spec) return { spec, source: 'repo', reason: null };
      if (!fallbackSpec) throw noSpec('ausente');
      logSpecReadFallback(context, 'absent');
      return { spec: fallbackSpec, source: 'mongo', reason: 'absent' };
    } catch (err) {
      if (err instanceof ProductSpecFileError || err instanceof ProductSpecUnavailableError || isAuthFailure(err, host)) throw err;

      const reason = classifySpecFallback(err);
      if (reason === null) throw err;
      if (!fallbackSpec) throw noSpec(reason, err);
      logSpecReadFallback(context, reason, err);
      return { spec: fallbackSpec, source: 'mongo', reason };
    }
  };

  // { version, specHash, deployedAt } of the last generation, or null for a product that has none yet.
  readDeployed = async ({ token, productProjectId, ref = DEFAULT_REF, host }) => {
    try {
      const meta = await readingOnce(`${host}|${token}|${productProjectId}|${ref}|${DEPLOYED_PATH}`, () => getGitProvider({ host }).getFileRevision({ token, id: productProjectId, path: DEPLOYED_PATH, ref }));
      const parsed = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
      return parsed && typeof parsed.specHash === 'string' ? parsed : null;
    } catch (err) {
      if (isNotFound(err) || err instanceof SyntaxError) return null;
      throw err;
    }
  };

  // Records that `spec` is what the code in the product was generated from. Overwrites; nothing to commit when unchanged.
  writeDeployed = async ({ token, productProjectId, spec, models = {}, lineRef = null, lineVersion = null, ref = DEFAULT_REF, host }) => {
    // the spec itself goes along with its hash: it is what "see the differences" and "discard what was saved" go back to
    const record = { version: spec.basicData?.version ?? null, specHash: specHash(spec), deployedAt: new Date().toISOString(), spec, models, line: { commit: lineRef, version: lineVersion } };
    const same = (current) => (
      current?.specHash === record.specHash && current?.version === record.version && current?.spec
      && current?.models && specHash(current.models) === specHash(models)
      && (current?.line?.commit ?? null) === lineRef
      && (current?.line?.version ?? null) === lineVersion
    );
    const read = async (path) => {
      try {
        const meta = await getGitProvider({ host }).getFileRevision({ token, id: productProjectId, path, ref });
        return { revision: meta.revision, current: JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')) };
      } catch (err) {
        if (!isNotFound(err) && !(err instanceof SyntaxError)) throw err;
        return { revision: err instanceof SyntaxError ? undefined : null, current: null };
      }
    };
    const content = `${JSON.stringify(record, null, 2)}\n`;

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const actions = [];

      const deployed = await read(DEPLOYED_PATH);
      if (!same(deployed.current)) {
        actions.push(deployed.revision
          ? { action: 'update', path: DEPLOYED_PATH, content, expectedRevision: deployed.revision }
          : { action: 'create', path: DEPLOYED_PATH, content });
      }

      if (!actions.length) {
        await this.#keepVersion({ token, productProjectId, record, content, ref, host });
        return { committed: false };
      }
      try {
        await getGitProvider({ host }).commit({
          token, id: productProjectId, branch: ref, message: 'Update product deployment', actions, track: false,
        });
        await this.#keepVersion({ token, productProjectId, record, content, ref, host });
        return { committed: true };
      } catch (err) {
        lastError = err;
        if (!isRetryableConflict(err) || attempt === MAX_ATTEMPTS) break;
        await sleep(backoffDelay(attempt));
      }
    }
    throw lastError;
  };

  // A version is kept the first time it is generated: its tag is not moved when the same version is generated again.
  // Its release (with the changelog) is made once the tag is there. Neither fails the generation: a failure is logged on the product.
  #keepVersion = async ({ token, productProjectId, record, content, ref, host }) => {
    try {
      await keepVersionTag({ token, projectId: productProjectId, version: record.version, ref, message: content, host });
    } catch (error) {
      await recordReleaseFailure({ host, projectId: productProjectId, kind: 'product', version: record.version, step: 'tag', error });
      return;
    }
    await keepVersionRelease({ token, projectId: productProjectId, version: record.version, host, kind: 'product', name: record.spec?.basicData?.name });
  };

  // The snapshot of one version ({ version, deployedAt, spec, models }), or null when that generation did not keep it.
  readVersionSnapshot = ({ token, productProjectId, version, host }) =>
    readVersionTag({ token, projectId: productProjectId, version, host, isSnapshot: (parsed) => Boolean(parsed.spec) });

  // The versions that kept their snapshot, newest first.
  listVersionSnapshots = ({ token, productProjectId, host }) => listVersionTags({ token, projectId: productProjectId, host });

  // Saved-but-not-deployed: true/false, or null when the product has no deployment record to compare with.
  deploymentOf = async ({ token, productProjectId, spec, models, ref = DEFAULT_REF, host }) => {
    return deploymentStatus({ deployed: await this.readDeployed({ token, productProjectId, ref, host }), spec, models });
  };

  writeSpec = async ({ token, productProjectId, spec, mutate, ref = DEFAULT_REF, isFiller, host }) => {
    if (typeof isFiller !== 'boolean') {
      throw new TypeError(
        'writeSpec requires an explicit boolean `isFiller` — pass Boolean(product.specFiller). ' +
        'See ADR-036: omitting it used to silently disable the filler safeguard.'
      );
    }
    if (typeof mutate !== 'function' && spec === undefined) {
      throw new TypeError('writeSpec requires either `spec` (a fixed value) or `mutate` (a function of the current spec).');
    }
    const computeNext = typeof mutate === 'function' ? mutate : () => spec;

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let lastCommitId = null;
      let existingContent = null;
      let currentSpec = null;
      try {
        const meta = await getGitProvider({ host }).getFileRevision({ token, id: productProjectId, path: SPEC_PATH, ref });
        lastCommitId = meta.revision;
        existingContent = Buffer.from(meta.content, 'base64').toString('utf8');
        currentSpec = parseSpecFile(existingContent);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }

      if (isFiller && lastCommitId !== null) {
        throw new ProductSpecFillerRejectedError(
          `refusing to overwrite existing .linea/spec.draft.json on project ${productProjectId} with a filler spec`
        );
      }

      const content = serializeSpecFile(computeNext(currentSpec));

      if (existingContent === content) {
        return { attempts: attempt, commitId: null, committed: false };
      }

      const action = lastCommitId
        ? { action: 'update', path: SPEC_PATH, content, expectedRevision: lastCommitId }
        : { action: 'create', path: SPEC_PATH, content };

      try {
        const commit = await getGitProvider({ host }).commit({
          token, id: productProjectId, branch: ref, message: 'Update product spec', actions: [action], track: false,
        });
        return { attempts: attempt, commitId: commit?.id ?? null, committed: true };
      } catch (err) {
        lastError = err;
        if (!isRetryableConflict(err) || attempt === MAX_ATTEMPTS) break;
        await sleep(backoffDelay(attempt));
      }
    }
    throw new Error(
      `product spec commit did not converge after ${MAX_ATTEMPTS} attempts on project ${productProjectId}: ${lastError?.message ?? lastError}`,
      { cause: lastError }
    );
  };
}

Container.set(ProductSpecService, new ProductSpecService());

export const logSpecWriteFailure = (context, error) => {
  if (error instanceof TypeError) {
    console.error(
      `[productSpec] BUG — ${context}: este punto de llamada no pasa \`isFiller\`. ` +
      'No se ha escrito nada (la guarda falla cerrada), pero el spec de este producto ' +
      'se ha quedado sin sincronizar. Arréglalo en el código, no es un fallo transitorio:',
      error.message
    );
    return;
  }
  console.error(`[productSpec] ${context}:`, error?.message ?? error);
};
