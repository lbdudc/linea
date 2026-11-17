/**
 * generatePipeline — named stage functions for the product generation workflow.
 *
 * Each stage has an explicit input/output contract and a single responsibility.
 * The transaction lifecycle, git rollback, temp-dir cleanup, and
 * domain event emission stay in the ProductService orchestrator so stages remain
 * testable without a running DB or GitLab instance.
 *
 * Stages in execution order:
 *  1. loadContext          – DB lookups, permission checks, version bump
 *  2. downloadAndUnzipLine – download + unzip the SPL platform archive
 *  3. downloadOldProduct   – download the existing product archive (old baseline)
 *  4. runEngine            – spl-js-engine generates the new product files
 *  5. unzipOldProduct      – unzip the old archive for diff comparison
 *  6. prettifyAndDiff      – format new output, compute file-action diff
 *  7. checkEmptyDiff       – detect no-op vs recovery-from-partial-run
 *  8. saveProductVersion   – persist version bump and build the result object
 *  9. mergeGenerationBranch – branch → commit → MR → auto-merge (generation→bigbang)
 * 10. createVersionTag     – tag the baseBranch with the new version
 * 11. mergeUpdateBranch    – MR → auto-merge (bigbang→main)
 */

import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor } from '../git/hosts.js';
import { properties } from '../connectors/properties.js';
import {
  incrementVersion, normalizeProductSpec,
  extractArchive, diffDirectories, formatDirectory,
  deriveModularProduct, FeatureSelectionInvalidError,
} from '@lbdudc/linea-core';
import { createEngine } from './modules/engine.js';
import { LinePlatformNotFoundError, assertLineAlive } from '../errors/errors.js';
import { ProductSpecUnavailableError, fallbackSpecOf } from './ProductSpecService.js';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import path from 'path';
import fs from 'node:fs';
import { waitForChecks } from './ProductCiService.js';
import { CI_FILE_PATH } from './ci/pipelineConfig.js';
import { ACCESS } from '@lbdudc/linea-git';

// Position in X.Y.Z of the part each bump raises (what incrementVersion's `index` takes).
const BUMP_INDEX = { major: 0, minor: 1, patch: 2 };

// ─── Stage 1: Load context ───────────────────────────────────────────────────
/**
 * Fetches product + line, verifies user permissions, reads the product's spec
 * from GitLab, and increments the version.
 * Returns { product, line, token, newVersion, logError }
 */
export async function loadContext({
  id, userId, session, log, bump = 'patch',
  productRepository, lineRepository, permissionChecker, git, productSpecService,
}) {
  const product = await productRepository.findById(id, { session });
  const user = await permissionChecker.checkUserExistsAndHasPrivileges(
    { userId, repoId: product.repo.id, accessLevel: ACCESS.MAINTAINER },
    git,
  );
  const line = await lineRepository.findById(product.lineId, { session });
  assertLineAlive(line);
  await permissionChecker.checkUserExistsAndHasPrivileges(
    { userId, repoId: line.repoId, accessLevel: ACCESS.MINIMAL },
    git,
  );

  const token = tokenFor(user, hostOf(product));

  const { spec: resolvedSpec, source, reason } = await productSpecService.getSpecFromHostOrCache({
    token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
    context: `generateProduct: product ${product._id}`,
  });

  if (reason === 'infra') {
    throw new ProductSpecUnavailableError(
      `No se pudo leer .linea/spec.draft.json del producto ${product._id} en el servidor git, así que no se sabe cuál es su spec real. ` +
      'La generación se cancela para no derivar con una caché posiblemente obsoleta ni sobrescribir el fichero bueno con ella. ' +
      'Reintenta cuando el servidor git responda.'
    );
  }

  product.spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;

  // Computed after reading the spec, so it counts from the version that really
  // is in .linea/spec.draft.json and not from the Mongo cache.
  const previousVersion = product.spec.basicData.version;
  const newVersion = incrementVersion({ version: previousVersion, index: BUMP_INDEX[bump] ?? 2 });
  // Deliberately NOT bumping product.spec.basicData.version here — the version
  // is only applied once a real (non-version) diff is confirmed, see
  // ProductService.generateProduct. Baking newVersion in unconditionally meant
  // the generated version string itself always differed from what's committed,
  // so even a product completely unaffected by a platform change looked like
  // it had something to commit — a spurious, version-only MR.

  const logError = (message, params) => log({ version: newVersion, type: 'error', message, params });

  return { product, line, token, newVersion, previousVersion, logError };
}

// ─── Stage 2: Download and unzip the SPL platform archive ───────────────────
/**
 * Downloads the line's archive.zip, extracts it, removes the zip, and emits
 * the "downloaded SPL" log entry.
 * Returns { lineOutput }
 */
export async function downloadAndUnzipLine({ token, line, tmp, newVersion, log, logError, git, ref }) {
  const lineZip = await (git ?? getGitProvider({ host: hostOf(line) })).downloadArchive({ token, id: line.repoId, ref }).catch(async (cause) => {
    console.error(`[generate] could not download the platform of line ${line.repoId} (ref ${ref ?? 'default'}):`, cause?.message ?? cause);
    await logError('error_messages.error_downloading_spl');
    throw new LinePlatformNotFoundError('Failed to download the SPL platform archive from the git host.');
  });

  const lineZipBuffer = await streamToBuffer(lineZip);

  const { dir: lineOutput } = await extractArchive({
    source: lineZipBuffer,
    destDir: path.join(tmp, 'line'),
    prefix: '',
  });

  await log({ version: newVersion, type: 'info', message: 'log.downloaded_spl' });

  return { lineOutput };
}

// ─── Stage 3: Download the existing product archive (old baseline) ───────────
/**
 * Downloads the product's archive.zip from the baseBranch ref.
 * The zip is unzipped later (stage 5) after the engine has run, but it is read in full here: a body that is left
 * unread while the engine runs is aborted by the request timeout and, when the generation fails in between, nobody
 * is listening for that error, which takes the whole server down.
 * Returns { productZip } (a Buffer)
 */
export async function downloadOldProduct({ token, product, logError, git }) {
  const productZip = await (git ?? getGitProvider({ host: hostOf(product) })).downloadArchive({
    token,
    id: product.repo.id,
    ref: properties.git.baseBranch,
  }).then(streamToBuffer).catch(async () => {
    await logError('error_messages.error_downloading_product');
    throw new LinePlatformNotFoundError('Failed to download the existing product archive from the git host.');
  });

  return { productZip };
}

// ─── Stage 4: Run spl-js-engine ──────────────────────────────────────────────
/**
 * Generates the new product files into newProductOutput.
 * Returns { newProductOutput } (the path is computed by the orchestrator and
 * echoed back so call sites can treat stage outputs as the sole source of truth).
 *
 * Doesn't clean up lineOutput itself — the orchestrator may call this a second
 * time against the same lineOutput once the version is actually bumped (see
 * ProductService.generateProduct); the whole tmp dir is removed at the end of
 * the run regardless, so there's nothing to lose by leaving it be here.
 */
const DERIVATION_MESSAGE = { check: 'log.checking_product', platform: 'log.composing_platform', derive: 'log.deriving_code' };

export async function runEngine({ lineOutput, product, newProductOutput, newVersion, log = async () => {}, logError, modular = null }) {
  try {
    // Every line is derived the same way: the platform is composed from what it is made of (the packages pinned by its lockfile, and its
    // own code), and the product's models are checked and handed to the transformations as `spec.models`; its features are its feature
    // selection's.
    if (!modular) throw new LinePlatformNotFoundError('This line has no spl.json: it was made before lines had one, and is not supported any more.');
    await deriveModularProduct({
      ...modular, spec: product.spec, createEngine, outputDir: newProductOutput,
      onProgress: (phase) => log({ version: newVersion, type: 'info', message: DERIVATION_MESSAGE[phase] }),
    });
  } catch (error) {
    if (error instanceof FeatureSelectionInvalidError) throw error;
    await logError(error.message);
    throw error;
  }

  return { newProductOutput };
}

// ─── Stage 5: Unzip the old product for diff comparison ──────────────────────
/**
 * Extracts the old product archive so diffDirectories can compare old vs new.
 * Returns { oldProductOutput }
 */
export async function unzipOldProduct({ productZip, product, tmp }) {
  const productPath = `${product.spec.basicData.name}-${properties.git.baseBranch}`;
  const productZipBuffer = Buffer.isBuffer(productZip) ? productZip : await streamToBuffer(productZip);
  const { dir: oldProductOutputRaw } = await extractArchive({
    source: productZipBuffer,
    destDir: path.join(tmp, 'old'),
    prefix: productPath,
  });
  const oldProductOutput = path.resolve(oldProductOutputRaw);
  return { oldProductOutput };
}

// ─── Stage 6: Prettify generated output and compute the file-action diff ─────
/**
 * Runs the formatter on newProductOutput, then computes the list of GitLab
 * file actions (create/update/delete) representing the delta.
 * Returns { actions }
 */
export async function prettifyAndDiff({ newProductOutput, oldProductOutput, newVersion, log, ciFile = null }) {
  await formatDirectory({ dir: newProductOutput });

  // The pipeline of the product is not derived from the line: it is the product's own CI configuration, rendered into what is
  // committed so it comes with the merge request whose checks it is for (and is not "removed" by a derivation that never had it).
  if (ciFile) fs.writeFileSync(path.join(newProductOutput, CI_FILE_PATH), ciFile);

  await log({ version: newVersion, type: 'info', message: 'log.prettied_code', params: [newVersion] });

  // `.linea/` is written by LINEA itself (spec, deployed record) and a generation never produces it: it is not something the
  // new output "removes". Deleting it here would conflict with the copy on the main branch the next time they are merged.
  const actions = diffDirectories({ oldDir: oldProductOutput, newDir: newProductOutput })
    .filter((action) => !(action.action === 'delete' && String(action.file_path).startsWith('.linea/')));

  await log({ version: newVersion, type: 'success', message: 'log.generated_product', params: [newVersion] });

  return { actions };
}

// ─── Stage 7: Handle the empty-diff case ─────────────────────────────────────
/**
 * An empty diff means the freshly generated product is byte-identical to what's
 * already committed — nothing to do. Most commonly this is entirely legitimate:
 * the product's own feature selection just doesn't touch whatever changed on the
 * line (e.g. a platform fix scoped to a feature this product never selects), so
 * regenerating it produces the same output as before. Log it and stop here;
 * there's no MR to open, no tag to create, no cascade stage left to run.
 */
export async function checkEmptyDiff({ actions, previousVersion, log }) {
  if (actions.length > 0) return;

  // type: 'success', not 'info' — this is the last log line generateProduct
  // emits on this path (see ProductService.js, which returns right after).
  // The client's generation dialog only stops its spinner and becomes
  // closeable on a 'success' | 'warning' | 'error' log, so an 'info' here
  // left the dialog spinning forever with no further message ever coming.
  await log({ version: previousVersion, type: 'success', message: 'log.empty_diff_up_to_date', params: [previousVersion] });
}

// ─── Stage 8: Persist version bump and build the result object ───────────────
/**
 * Saves the product (with its incremented version) inside the active transaction
 * and prepares the canonical result object with required defaults.
 * Returns { result }
 */
export async function saveProductVersion({ product, session, productRepository }) {
  await productRepository.save(product, { session });

  const result = { ...product.toObject() };
  result.spec = normalizeProductSpec({ spec: result.spec });

  return { result };
}

// ─── Stage 9: Merge generation branch → baseBranch ───────────────────────────
/**
 * Creates generationBranch off baseBranch, commits the diff actions, opens a
 * merge request, and attempts an auto-merge.
 * Returns { generationConflicts, generationMergeRequest }
 */
export async function mergeGenerationBranch({ actions, token, product, newVersion, log, logError, git, branch = null, message = null, title = null, renewToken = null }) {
  const wanted = branch ?? `${properties.git.generationBranch}/${newVersion}`;
  const generationBranch = await createFreeBranch({ git, token, id: product.repo.id, wanted }).catch(async () => {
    await logError('error_messages.error_creating_branch', [wanted]);
    throw new LinePlatformNotFoundError(`Failed to create branch "${wanted}".`);
  });

  await log({ version: newVersion, type: 'info', message: 'log.created_branch', params: [generationBranch, properties.git.baseBranch] });
  if (generationBranch !== wanted) {
    await log({ version: newVersion, type: 'warning', message: 'log.generation_branch_taken', params: [wanted, generationBranch] });
  }

  await git.commit({
    token, id: product.repo.id, branch: generationBranch,
    message: message ?? `Generated new product version: ${newVersion}`,
    actions: actions.map(({ file_path: filePath, path, ...rest }) => ({ ...rest, path: path ?? filePath })),
  }).catch(async () => {
    await logError('error_messages.error_committing_generation', [generationBranch]);
    throw new LinePlatformNotFoundError(`Failed to commit generated changes to "${generationBranch}".`);
  });

  await log({ version: newVersion, type: 'info', message: 'log.commited_generation', params: [generationBranch] });

  const generationMergeRequest = await git.createChangeRequest({
    token, id: product.repo.id,
    title: title ?? `Merge generated new product version: ${newVersion}`,
    sourceBranch: generationBranch, targetBranch: properties.git.baseBranch,
  }).catch(async () => {
    await logError('error_messages.error_creating_merge_request', [generationBranch, properties.git.baseBranch]);
    throw new LinePlatformNotFoundError(`Failed to create merge request from "${generationBranch}" to "${properties.git.baseBranch}".`);
  });

  await log({ version: newVersion, type: 'info', message: 'log.created_merge_request', params: [generationBranch, properties.git.baseBranch] });

  const { conflicts: generationConflicts, token: mergedWith } = await mergeRenewingToken({
    git, token, renewToken, id: product.repo.id, number: generationMergeRequest.number, deleteSourceBranch: true,
  }).catch(async (err) => {
    await logError('error_messages.error_merging', [generationBranch, properties.git.baseBranch]);
    throw new LinePlatformNotFoundError(`Failed to merge "${generationBranch}" into "${properties.git.baseBranch}": ${err?.message ?? err}`);
  });

  if (generationConflicts) {
    await log({
      version: newVersion, type: 'warning', message: 'log.conflicts_merge_request',
      params: [generationBranch, properties.git.baseBranch],
      link: generationMergeRequest.webUrl,
    });
  } else {
    await log({
      version: newVersion, type: 'info', message: 'log.merged_merge_request_deleted',
      params: [generationBranch, properties.git.baseBranch],
    });
  }

  return { generationConflicts, generationMergeRequest, token: mergedWith };
}

const MAX_BRANCH_ATTEMPTS = 20;

// A generation cut short (the server went down...) leaves its branch and its request behind, and the next one of that version would ask for the
// same branch. It goes on in one of its own: nothing is deleted, and the request that will never be merged is closed, which can be undone.
async function createFreeBranch({ git, token, id, wanted }) {
  for (let attempt = 1; attempt <= MAX_BRANCH_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? wanted : `${wanted}-${attempt}`;
    try {
      await git.createBranch({ token, id, branch: name, ref: properties.git.baseBranch });
      return name;
    } catch (error) {
      const taken = await Promise.resolve().then(() => git.getBranch({ token, id, branch: name })).then(Boolean, () => false);
      if (!taken) throw error;
      await closeRequestsOf({ git, token, id, branch: name });
    }
  }
  throw new Error(`Every branch like "${wanted}" is taken.`);
}

async function closeRequestsOf({ git, token, id, branch }) {
  try {
    const open = await git.listChangeRequests({ token, id, state: 'opened', targetBranch: properties.git.baseBranch });
    for (const request of open.filter((candidate) => candidate.sourceBranch === branch)) {
      await git.updateMergeRequest({ token, id, number: request.number, changes: { state: 'closed' } });
    }
  } catch (error) {
    console.error(`[generation] the request left open by "${branch}" could not be closed:`, error?.message ?? error);
  }
}

// The session of the person can be renewed in the middle of a generation (a page opened meanwhile), and that ends the token it began with.
async function mergeRenewingToken({ git, token, renewToken, ...merge }) {
  try {
    return { conflicts: await git.mergeChangeRequest({ token, ...merge }), token };
  } catch (error) {
    if (!renewToken || !git.isAuthError?.(error)) throw error;
    const fresh = await renewToken();
    return { conflicts: await git.mergeChangeRequest({ token: fresh, ...merge }), token: fresh };
  }
}

// ─── Stage 10: Tag the baseBranch ────────────────────────────────────────────
/**
 * Creates the version tag on baseBranch. Silently ignores failure — the tag
 * may already exist when recovering from a prior partial run.
 */
export async function createVersionTag({ token, product, newVersion, git }) {
  await git.createTag({
    token, id: product.repo.id,
    tag: `${properties.git.baseBranch}-${newVersion}`,
    ref: properties.git.baseBranch,
  }).catch(() => {});
}

const TOKEN_RENEW_AFTER_MS = 10 * 60_000;
const CHECKS_NOT_PASSED = new Set(['failed', 'canceled']);
const CHECKS_UNSETTLED = new Set([...CHECKS_NOT_PASSED, 'timeout']);

// ─── Stage 11: Merge update branch → defaultBranch ───────────────────────────
/**
 * Creates or renames the standing update MR (baseBranch→defaultBranch) and
 * attempts an auto-merge. With `merge: false` it only opens (or renames) the request and leaves it for a person to merge.
 * `title` is for the requests that are not a new version (a sync).
 * Returns { updateConflicts, updateMergeRequest }
 */
export async function mergeUpdateBranch({ token: given, product, newVersion, log, logError, git, ci = null, wait = waitForChecks, renewToken = null, title: requestTitle = null, merge = true }) {
  let token = given;
  const title = requestTitle ?? `Update to product version: ${newVersion}`;

  const updateMergeRequest = await git.createOrRenameChangeRequest({
    token, id: product.repo.id, title, sourceBranch: properties.git.baseBranch,
  }).catch(async () => {
    await logError('error_messages.error_creating_merge_request', [properties.git.baseBranch, properties.git.defaultBranch]);
    throw new LinePlatformNotFoundError(`Failed to create merge request from "${properties.git.baseBranch}" to "${properties.git.defaultBranch}".`);
  });

  await log({ version: newVersion, type: 'info', message: 'log.created_merge_request', params: [properties.git.baseBranch, properties.git.defaultBranch] });

  if (!merge) return { updateConflicts: false, updateMergeRequest, token };

  // The checks of the product run on this request: it is merged once they pass. When they do not, or are not over when the wait is up, `onChecksFailed`
  // says what follows: it stays open for a person to decide (`checksFailed`), it is merged all the same, or it is closed (`rejected`).
  // A product without CI has no pipeline, and nothing to wait for.
  let checksOverridden = false;
  if (ci?.waitForChecks) {
    const onFailed = ci.onChecksFailed ?? 'ask';
    await log({ version: newVersion, type: 'info', message: 'log.waiting_checks', link: updateMergeRequest.webUrl });
    await log({ version: newVersion, type: 'info', message: `log.checks_policy_${onFailed}` });
    const outcome = await wait({
      git, token, projectId: product.repo.id, number: updateMergeRequest.number, maxMs: (ci.waitMinutes ?? 30) * 60_000,
      onStatus: (pipeline) => log({ version: newVersion, type: 'info', message: 'log.checks_status', params: [pipeline.status], link: pipeline.webUrl }),
      renewToken,
      stopOnFailure: ci.mode === 'jobs',
    });
    // a long wait outlives the token it began with: the merge and what follows use a fresh one
    if (outcome.token) token = outcome.token;
    if (renewToken && outcome.waitedMs > TOKEN_RENEW_AFTER_MS) token = await renewToken().catch(() => token);
    if (outcome.status === 'none') await log({ version: newVersion, type: 'info', message: 'log.checks_none' });
    else if (outcome.status === 'timeout') await log({ version: newVersion, type: 'warning', message: 'log.checks_timeout', params: [ci.waitMinutes ?? 30], link: outcome.pipeline?.webUrl });
    else if (outcome.failedJob) await log({ version: newVersion, type: 'warning', message: 'log.checks_job_failed', params: [outcome.failedJob], link: outcome.pipeline?.webUrl });
    else if (CHECKS_NOT_PASSED.has(outcome.status)) await log({ version: newVersion, type: 'warning', message: 'log.checks_not_passed', params: [outcome.status], link: outcome.pipeline?.webUrl });
    else await log({ version: newVersion, type: outcome.status === 'success' ? 'info' : 'warning', message: 'log.checks_finished', params: [outcome.status], link: outcome.pipeline?.webUrl });
    if (CHECKS_UNSETTLED.has(outcome.status) && onFailed === 'merge') {
      await log({ version: newVersion, type: 'warning', message: 'log.checks_merge_anyway' });
      checksOverridden = true;
    } else if (CHECKS_UNSETTLED.has(outcome.status)) {
      const checksFailed = { status: outcome.status, job: outcome.failedJob ?? null, url: outcome.pipeline?.webUrl ?? '' };
      if (onFailed === 'reject') {
        const closed = await git.updateMergeRequest({ token, id: product.repo.id, number: updateMergeRequest.number, changes: { state: 'closed' } })
          .then(() => true, (error) => {
            console.error('[ci] the checks did not pass, but the merge request could not be closed:', error?.message ?? error);
            return false;
          });
        if (closed) {
          // nobody is waiting for what is still running any more: it would only hold the runners
          if (outcome.status === 'timeout' && outcome.pipeline?.id !== undefined) {
            await git.cancelPipeline({ token, id: product.repo.id, pipelineId: outcome.pipeline.id }).catch((error) => {
              console.error('[ci] the update was rejected, but its pipeline could not be stopped:', error?.message ?? error);
            });
          }
          await log({ version: newVersion, type: 'warning', message: 'log.update_rejected', params: [newVersion], link: updateMergeRequest.webUrl });
          return { updateConflicts: false, updateMergeRequest, token, checksFailed, rejected: true };
        }
      }
      await log({ version: newVersion, type: 'warning', message: 'log.checks_await_decision', link: updateMergeRequest.webUrl });
      return { updateConflicts: false, updateMergeRequest, token, checksFailed };
    }
  }

  const { conflicts: updateConflicts, token: mergedWith } = await mergeRenewingToken({
    git, token, renewToken, id: product.repo.id, number: updateMergeRequest.number, deleteSourceBranch: false,
  }).catch(async (err) => {
    await logError('error_messages.error_merging', [properties.git.baseBranch, properties.git.defaultBranch]);
    throw new LinePlatformNotFoundError(`Failed to merge "${properties.git.baseBranch}" into "${properties.git.defaultBranch}": ${err?.message ?? err}`);
  });

  if (updateConflicts) {
    await log({
      version: newVersion, type: 'warning', message: 'log.conflicts_merge_request',
      params: [properties.git.baseBranch, properties.git.defaultBranch],
      link: updateMergeRequest.webUrl,
    });
  } else {
    await log({
      version: newVersion, type: 'success', message: 'log.merged_merge_request',
      params: [properties.git.baseBranch, properties.git.defaultBranch],
    });
  }

  return { updateConflicts, updateMergeRequest, token: mergedWith, checksOverridden };
}
