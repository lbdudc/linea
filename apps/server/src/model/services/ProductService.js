import Product from "../entities/product.js"
import { getGitProvider, primaryHost } from '../git/index.js';
import { createdAtOf, correctProductDates } from './hostDates.js';
import { deleteEmptyLineNamespace, deleteProductOnHost } from '@lbdudc/linea-git';
import { activeHostOf, hostOf, tokenFor, usernameOn } from '../git/hosts.js';
import { properties } from '../connectors/properties.js'
import { PermissionError, isLineDeleted, assertLineAlive, UserNotFoundError, AlreadyExistentProductError, LineNotFoundError, ProductNotFoundError, NoDeployedSnapshotError, NoPipelineError, NoPendingUpdateError, LinePlatformNotFoundError } from '../errors/errors.js';
import { timed } from '../../rest/common/serverTiming.js';
import {
  extractArchive, deriveModularProductToZip,
  normalizeProductSpec,
} from '@lbdudc/linea-core';
import { zipEntries, zipContents } from './zipEntries.js';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import {
  loadContext, downloadAndUnzipLine, downloadOldProduct,
  runEngine, unzipOldProduct, prettifyAndDiff, checkEmptyDiff,
  saveProductVersion, mergeGenerationBranch, createVersionTag, mergeUpdateBranch,
} from './generatePipeline.js'
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from 'uuid';
import { Container } from "typedi";
import DataSource from "../connectors/DataSource.js";
import { trialSpecOf } from './trialSpec.js';
import PermissionChecker from "./PermissionChecker.js";
import LineRepository from "../repositories/LineRepository.js";
import ProductRepository from "../repositories/ProductRepository.js";
import UserRepository from "../repositories/UserRepository.js";
import LogRepository from "../repositories/LogRepository.js";
import ProductsIndexService from "./ProductsIndexService.js";
import ProductSpecService, {
  ProductSpecFileError, logSpecWriteFailure, fallbackSpecOf, indexOnlySpec, minimalSpec, deploymentStatus,
} from "./ProductSpecService.js";
import { isVersion, compareVersions } from "./versionTags.js";
import UserService from './UserService.js';
import ProductCiService, { versionOfTitle } from './ProductCiService.js';
import ChangelogService from './ChangelogService.js';
import { isSyncDescription } from './changelogs.js';
import { renderPipeline } from './ci/pipelineConfig.js';
import ModularService from "./modules/ModularService.js";
import { createEngine } from "./modules/engine.js";
import domainEvents, { DOMAIN_EVENTS } from "../events/domainEvents.js";
import { createRecent, mapLimit } from "./recent.js";
import { singleFlight } from "./singleFlight.js";
import { ACCESS } from '@lbdudc/linea-git';
import SyncRun from '../entities/syncRun.js';
import { takeLock, productLockId } from './productLock.js';
import { effectiveSync, nextSyncFor } from './scheduler/schedule.js';
import { removeWorkDir } from './workDirs.js';
import JSZip from 'jszip';
import { describeChanges } from './changeDiffs.js';
import { beginRun, endRun, requestCancel, GenerationCancelledError } from './generationRuns.js';

// What the home page and the lists ask for again and again: whether a product is valid, its open change requests, its last pipeline.
// Kept for a short time per user and product, and forgotten as soon as this server changes the product.
const statuses = createRecent({ ttlMs: 45_000, limit: 2000 });
// the open change requests and the deployment state of a product: shown at once from the last answer (up to half an hour old) while a
// new one is worked out, which every redeploy of this server and every first visit used to wait for (3-10 s with a dozen products)
const snapshots = createRecent({ ttlMs: 45_000, staleMs: 30 * 60_000, limit: 2000 });
// the health of a product only changes with its spec or with the model of its line, and both forget it: it is kept longer
const healths = createRecent({ ttlMs: 180_000, staleMs: 30 * 60_000, limit: 2000 });
const forgetProduct = (id) => {
  statuses.forget((key) => key.endsWith(`|${id}`));
  snapshots.forget((key) => key.endsWith(`|${id}`));
  healths.forget((key) => key.endsWith(`|${id}`));
};
// a new feature model makes what was found of the products of the line wrong: it is asked for again
domainEvents.on(DOMAIN_EVENTS.LINE_MODEL_CHANGED, () => { statuses.forget((key) => key.startsWith('health|')); snapshots.forget((key) => key.startsWith('conflicts|')); healths.clear(); });
const STATUS_CONCURRENCY = 6;

// A rollback failure must never replace the error that triggered it — that's
// how a real cause (e.g. a commit rejected for an invalid path) turned into a
// generic, undiagnosable "connecting with GitLab" message. Best-effort undo:
// log if it fails, but always let the original error propagate.
const rollbackGitlabSession = async (git) => {
  try {
    await git.rollback();
  } catch (rollbackError) {
    console.error('[ProductService] git.rollback() failed — git-host state may need manual cleanup:', rollbackError);
  }
};

// The open change requests of the generation pipeline target baseBranch (generating) or defaultBranch (update). One call without a
// branch filter holds them all; only a project with a full page of them is asked once per branch, so none is pushed past the cutoff.
const MR_PAGE = 20; // what one answer of the git host holds
const getGenerationMergeRequests = async ({ token, projectId, host }) => {
  const git = getGitProvider({ host });
  const { baseBranch, defaultBranch } = properties.git;
  const all = await git.listChangeRequests({ token, id: projectId, state: 'opened' });
  if (all.length < MR_PAGE) return all.filter((mr) => mr.targetBranch === baseBranch || mr.targetBranch === defaultBranch);
  const [baseMRs, defaultMRs] = await Promise.all([
    git.listChangeRequests({ token, id: projectId, state: 'opened', targetBranch: baseBranch }),
    git.listChangeRequests({ token, id: projectId, state: 'opened', targetBranch: defaultBranch }),
  ]);
  const byIid = new Map();
  for (const mr of [...baseMRs, ...defaultMRs]) byIid.set(mr.number, mr);
  return [...byIid.values()];
};

export default class ProductService {
  dataSource = Container.get(DataSource);
  permissionChecker = Container.get(PermissionChecker);
  userRepository = Container.get(UserRepository);
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  logRepository = Container.get(LogRepository);
  productsIndexService = Container.get(ProductsIndexService);
  productSpecService = Container.get(ProductSpecService);
  modularService = Container.get(ModularService);
  productCiService = Container.get(ProductCiService);

  // Trims Mongo to its index once `spec` is known to be in GitLab. Goes through a fresh document so the caller's one keeps
  // the full spec it is about to return.
  #trimMongoSpec = async ({ product, spec }) => {
    const doc = await this.productRepository.findById(product._id);
    if (!doc) throw new ProductNotFoundError();
    doc.spec = indexOnlySpec(spec);
    doc.specInRepo = true;
    await this.productRepository.save(doc);
  };

  // The product's spec as it really is: for a modular product, basicData/dataModel/statics are not in spec.json
  // (see minimalSpec) — composed from its models instead. `product.spec` already as-is for a plain line.
  #composedSpecOf = async ({ token, userId, line, product }) => {
    if (!line?.modular || isLineDeleted(line)) return product.spec;
    const composed = await this.modularService.composeProductSpec({ token, userId, line, product }).catch((error) => {
      console.error(`[ProductService] the spec of product ${product._id} could not be composed, serving the stored one:`, error);
      return null;
    });
    if (!composed?.data) return product.spec;
    return {
      ...product.spec,
      basicData: {
        ...composed.data.basicData,
        name: product.spec.basicData.name,
        version: product.spec.basicData.version,
        createdAt: product.spec.basicData.createdAt,
      },
      dataModel: composed.data.dataModel ?? product.spec.dataModel,
      statics: composed.data.statics ?? product.spec.statics,
    };
  };

  // Writes the full spec to GitLab and only then trims Mongo, so a failed write never loses the configuration.
  #moveSpecToRepo = async ({ token, product, spec }) => {
    await this.productSpecService.writeSpec({
      token, host: hostOf(product), productProjectId: product.repo.id, spec, isFiller: Boolean(product.specFiller),
    });
    await this.#trimMongoSpec({ product, spec });
  };

  // Saved-but-not-deployed, counting the models when the last generation kept the ones it used.
  #deploymentOf = async ({ token, product, deployed, spec }) => {
    let models;
    if (deployed?.models) {
      models = await this.modularService.storedModels({ token, host: hostOf(product), productProjectId: product.repo.id })
        .catch(() => undefined);
    }
    // nothing has ever been generated: whatever is saved is not deployed (without a record this would read as "unknown", i.e. up to date)
    if (!deployed && (product.spec?.basicData?.version ?? '0.0.0') === '0.0.0') {
      return { pending: true, version: null, deployedAt: null, restorable: false, modelsChanged: null };
    }
    return deploymentStatus({ deployed, spec: normalizeProductSpec({ spec }), models });
  };

  // `deployed`: this generation left the code in the product, so what it derived from is the new deployment record — the
  // deployment record keeps the full spec (composed from the models, for a modular line), not the minimal one spec.json has.
  // `models`: the models of the product it used.
  #syncProductSpecAfterGenerate = async ({ token, userId, line, product, deployed = true, models = {}, lineRef = null }) => {
    try {
      const spec = product.toObject().spec;
      // spec.json of a modular product holds the full spec composed from its models once it has been generated,
      // not the minimal one created with: there is now code derived from it, worth seeing without composing it again.
      const composedSpec = line.modular ? await this.#composedSpecOf({ token, userId, line, product }).catch(() => spec) : spec;
      await this.#moveSpecToRepo({ token, product, spec: composedSpec });
      if (deployed) {
        await this.productSpecService.writeDeployed({
          token, host: hostOf(product), productProjectId: product.repo.id, spec: normalizeProductSpec({ spec: composedSpec }), models, lineRef, lineVersion: line.version,
        });
      }
      return composedSpec;
    } catch (specError) {
      logSpecWriteFailure(`generateProduct: product ${product._id} version bumped but spec commit failed`, specError);
    }
    return null;
  };

  createProduct = async ({ userId, lineId, spec }) => {
    const line = await this.lineRepository.findById(lineId);
    if (!line) {
      throw new LineNotFoundError();
    }
    const git = getGitProvider({ host: hostOf(line) });
    const session = await this.dataSource.startTransaction();
    try {
      const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER}, git);

        const foundProduct = await this.productRepository.findByName(spec.basicData.name, lineId, { session });

        if (foundProduct) {
            throw new AlreadyExistentProductError();
        }

        // the product's selection is a model of its own (`models/featureselection.featureselection`, checked by the feature metamodel); the
        // features in the spec are the index of it. What the person chose in advance (a configuration of the feature model) starts it.
        const chosen = Array.isArray(spec.features) ? spec.features.filter((f) => typeof f === 'string') : [];
        spec.features = chosen;

        const product = new Product({ lineId, spec, gitHost: hostOf(line) });
        await this.productRepository.save(product, { session });

        const token = tokenFor(user, hostOf(line));

        const group = await git.createNamespace({ token, name: product.spec.basicData.name, parentId: line.namespaceId });

        const repo = await git.createRepository({ token, name: product.spec.basicData.name, namespaceId: group.id, topics: ['product'], defaultBranch: properties.git.baseBranch });
        product.repo.namespaceId = repo.namespaceId ?? group.id;
        product.repo.id = repo.id;

        await git.createBranch({ token, id: repo.id, branch: properties.git.defaultBranch, ref: properties.git.baseBranch });
        await git.setDefaultBranch({ token, id: repo.id, branch: properties.git.defaultBranch });

        product.repo.webUrl = repo.webUrl;
        product.repo.webIdeUrl = repo.webIdeUrl;

        await this.productRepository.save(product, { session });

        await this.dataSource.commitTransaction(session);

        try {
          await this.productsIndexService.addProduct({
            token, host: hostOf(line), lineProjectId: line.repoId,
            name: product.spec.basicData.name,
            repositorio: repo.path,
            version: product.spec.basicData.version,
          });
        } catch (indexError) {
          console.error(`[productsIndex] createProduct: product ${product._id} (${repo.id}) created but products.json commit failed on line ${line.repoId}:`, indexError?.message ?? indexError);
        }

        try {
          // A modular product's basicData/dataModel/etc. are composed from its models at read time
          // (ModularService.composeProductSpec); spec.json only keeps what is not model content.
          const specToWrite = line.modular ? minimalSpec(product.toObject().spec) : product.toObject().spec;
          await this.#moveSpecToRepo({ token, product, spec: specToWrite });
        } catch (specError) {
          logSpecWriteFailure(`createProduct: product ${product._id} (${repo.id}) created but spec commit failed`, specError);
        }

        try {
          const seeded = await this.modularService.seedModels({ token, userId, line, product, features: chosen });
          // what the selection comes to, with what the feature model implies, is what the spec indexes
          if (seeded && Array.isArray(seeded.features)) {
            product.spec.features = seeded.features;
            await this.#moveSpecToRepo({ token, product, spec: line.modular ? minimalSpec(product.toObject().spec) : product.toObject().spec });
          }
        } catch (modelsError) {
          console.error(`[models] createProduct: product ${product._id} (${repo.id}) created but its initial models could not be added:`, modelsError?.message ?? modelsError);
        }

        // Dev convenience only: LINEA_LOCAL_PRODUCTS_DIR is set by the local dev stack (server/dev/up.sh), never in
        // production. Mirrors what was just committed; generateProduct below overwrites the same folder once there is
        // generated code to show instead.
        if (process.env.LINEA_LOCAL_PRODUCTS_DIR) {
          const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-export-'));
          try {
            const zip = await git.downloadArchive({ token, id: repo.id });
            const { dir } = await extractArchive({ source: await streamToBuffer(zip), destDir: scratch, prefix: '' });
            const dest = path.join(process.env.LINEA_LOCAL_PRODUCTS_DIR, product.spec.basicData.name);
            fs.rmSync(dest, { recursive: true, force: true });
            fs.cpSync(dir, dest, { recursive: true });
          } catch (exportError) {
            console.error(`[localExport] createProduct: product ${product._id} (${repo.id}) created but local export failed:`, exportError?.message ?? exportError);
          } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
          }
        }

        return product;
    } catch (error) {
        await this.dataSource.abortTransaction(session);
        await rollbackGitlabSession(git);
        throw error;
    }
}

  findProductById = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });

      const user = await timed('permission', () => this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER}, git));

      const { spec: resolvedSpec, source } = await timed('spec', () => this.productSpecService.getSpecFromHostOrCache({
        token: tokenFor(user, hostOf(product)), host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
        context: `findProductById: product ${product._id}`,
      }));
      product.spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;

      return product;

    }

  findMembersByProductId = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git);
    return git.getMembers({ token: tokenFor(user, hostOf(product)), id: product.repo.id });
  }

  /**
   * What the page of a product shows, with one permission check and the reads side by side: the product with its spec, its members, its
   * line. (Its feature model is a model of the feature metamodel, which comes with its models: see `getProductModels`.)
   */
  /** The product as stored, for someone who can read it: no members, no spec, no deployment (`GET /products/:id?brief=1`). */
  findBrief = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, getGitProvider({ host: hostOf(product) }));
    return product;
  };

  /** The product made in a git project (a webhook only knows the project), for someone who can read it. */
  findByGitProjectId = async ({ projectId, userId, specFromRepo = false, host }) => {
    const product = await this.productRepository.findByRepoId(Number(projectId), undefined, host ?? primaryHost());
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git);
    if (!specFromRepo) return { product, specSource: null, specReason: null };
    // the spec as the git host has it; when it cannot be read the stored one is served and the caller is told why
    const { spec, source, reason } = await this.productSpecService.getSpecFromHostOrCache({
      token: tokenFor(user, hostOf(product)), host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
      context: `findByGitProjectId: product ${product._id}`,
    });
    product.spec = source === 'repo' ? normalizeProductSpec({ spec }) : spec;
    return { product, specSource: source, specReason: reason };
  };

  findProductDetails = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await timed('permission', () => this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git));
    const token = tokenFor(user, hostOf(product));
    const line = await this.lineRepository.findById(product.lineId);
    const [resolved, members, , deployed] = await Promise.all([
      timed('spec', () => this.productSpecService.getSpecFromHostOrCache({
        token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
        context: `findProductById: product ${product._id}`,
      })),
      timed('members', () => git.getMembers({ token, id: product.repo.id })),
      isLineDeleted(line) ? null : this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER }, git),
      // a record that cannot be read just means "unknown", not a page that fails
      timed('deployed', () => this.productSpecService.readDeployed({ token, host: hostOf(product), productProjectId: product.repo.id })).catch(() => null),
    ]);
    product.spec = resolved.source === 'repo' ? normalizeProductSpec({ spec: resolved.spec }) : resolved.spec;
    // basicData/dataModel/statics are not in spec.json for a modular product (see minimalSpec): compose them
    // from the models so the page shows what is really there, not the bookkeeping-only stub.
    product.spec = await timed('compose', () => this.#composedSpecOf({ token, userId, line, product }));
    // what is saved is compared as it is in the repository (what a generation records and the lists compare): composed from the
    // models it lacks what the generation added to it, and would never match the record
    const deployment = await timed('deployment', () => this.#deploymentOf({ token, product, deployed, spec: resolved.spec }));
    // what the person may do here: the level the host gives them (an administrator of LINEA is not limited by it)
    const level = user.admin ? ACCESS.OWNER : (members.find((member) => member.username === usernameOn(user, hostOf(product)))?.accessLevel ?? 0);
    return { product, members, line, deployment, level };
  };

  deleteProduct = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const session = await this.dataSource.startTransaction();
    try {
      const line = await this.lineRepository.findById(product.lineId, { session });
      const user = await this.userRepository.findById(userId);
      if (!user) throw new UserNotFoundError();
      // Needed both by the GitLab deletes below and, after the transaction, by
      // the products.json update — so it lives out here, not inside the branch.
      const token = tokenFor(user, hostOf(product));

      // A product already known to be gone/pending deletion on GitLab (flagged
      // the same way the products list is) has nothing left for a per-project
      // permission check or the delete calls below to act on — both would just
      // fail against a project that no longer meaningfully exists. Check the
      // line instead (still live) and skip straight to removing the local
      // record. A failed enrollment check itself (GitLab hiccup) falls back to
      // the normal path rather than assuming either way.
      const enrolled = await git.listRepositories({ token: tokenFor(user, hostOf(product)), topic: 'product' }).catch(() => null);
      const stillOnGitlab = enrolled === null || enrolled.some((p) => p.id === product.repo.id);

      if (stillOnGitlab) {
        await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.OWNER}, git);

        // Deleting only the group leaves the project itself unmarked: GitLab's
        // delayed-deletion flag (checked by getEnrolledProjects) is set on the
        // project resource, not inherited from a group-level deletion, so the
        // project keeps showing up in the enrolled-projects listing and
        // reconciliation re-creates it as a "new" product on the next fetch.
        //
        // Only a 404 (already gone — a prior attempt that got this far but
        // failed before the DB record was removed, or someone deleting it
        // directly on GitLab) is tolerated here. Swallowing every failure
        // indiscriminately is actively wrong: if deleteProject fails for a
        // real reason, the project stays fully enrolled and unmarked, so
        // reconciliation resurrects it as a "new" product on the very next
        // login — worse than the stuck record this is meant to fix.
        await deleteProductOnHost({ provider: git, token, product: { repositoryId: product.repo.id, namespaceId: product.repo.namespaceId } });
      } else if (!isLineDeleted(line)) {
        await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.OWNER}, git);
      } else if (!user.admin && String(line?.ownerId) !== String(user._id)) {
        throw new PermissionError();
      }

      await this.productRepository.deleteById(product._id, { session });

      await this.dataSource.commitTransaction(session);
      forgetProduct(id);

      if (line?.deletedAt) {
        await this.#removeDeletedLineIfEmpty({ line, token, git });
      } else if (line?.repoId) {
        let repositorio = null;
        try {
          repositorio = new URL(product.repo.webUrl).pathname.replace(/^\//, '');
        } catch {
          repositorio = null;
        }
        if (repositorio) {
          try {
            await this.productsIndexService.removeProduct({ token, host: hostOf(line), lineProjectId: line.repoId, repositorio });
          } catch (indexError) {
            console.error(`[productsIndex] deleteProduct: product ${product._id} deleted but products.json removal failed on line ${line.repoId}:`, indexError?.message ?? indexError);
          }
        } else {
          console.error(`[productsIndex] deleteProduct: product ${product._id} deleted but could not derive "repositorio" from repo.webUrl (${product.repo.webUrl}) — products.json on line ${line.repoId} needs manual cleanup or reconcile.`);
        }
      }

    } catch (error) {
      await this.dataSource.abortTransaction(session);
      await rollbackGitlabSession(git);
      throw error;
    }
  }

  #removeDeletedLineIfEmpty = async ({ line, token, git }) => {
    if (await this.productRepository.countByLineId(line._id) > 0) return;
    try {
      await deleteEmptyLineNamespace({ provider: git, token, namespaceId: line.namespaceId });
      await this.lineRepository.deleteById(line._id);
    } catch (error) {
      console.error(`[deleteProduct] the last product of deleted line ${line._id} is gone but its namespace ${line.namespaceId} could not be removed:`, error?.message ?? error);
    }
  };

  #discoverProductSpec = async ({ token, project, host }) => {
    try {
      const spec = await this.productSpecService.readSpec({ token, productProjectId: project.id, host });
      if (spec) {
        const normalized = normalizeProductSpec({ spec });
        const createdAt = project.createdAt ?? (normalized.basicData.createdAt || undefined);
        return { spec: { ...normalized, basicData: { ...normalized.basicData, createdAt } }, specFiller: false };
      }
    } catch (err) {
      if (!(err instanceof ProductSpecFileError)) throw err;
      console.error(`[productSpec] discover: project ${project.id} (${project.name}) has an unreadable .linea/spec.draft.json, falling back to a filler spec:`, err.message);
    }
    return {
      spec: { basicData: { name: project.name, version: '0.0.0', ...createdAtOf(project) } },
      specFiller: true,
    };
  };

  // LINEA shows one remote at a time: the products of the host of the person's profile
  #hostsOf = (user) => [activeHostOf(user)];

  findEnrolledProducts = async ({ userId }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();

    const lists = await Promise.all(this.#hostsOf(user).map((host) => this.#enrolledOn({ user, host, userId })));
    return lists.flat().sort((a, b) => b.createdAt - a.createdAt);
  }

  #enrolling = singleFlight();

  /** The products of a user on one host: the `product` repositories their token reaches there, made products here when they were not. */
  #enrolledOn = ({ user, host, userId }) => this.#enrolling(`${host}:${userId}`, () => this.#loadEnrolledOn({ user, host }));

  #loadEnrolledOn = async ({ user, host }) => {
    const token = tokenFor(user, host);
    const gitlabProjects = await getGitProvider({ host }).listRepositories({ token, topic: 'product' });
    const repoIds = gitlabProjects.map(p => p.id);

    const existing = await this.productRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
    const existingIds = new Set(existing.map(p => p.repo.id));
    const newProjects = gitlabProjects.filter(p => !existingIds.has(p.id));

    for (const project of newProjects) {
      const parentGroupId = project.parentNamespaceId;
      if (!parentGroupId) continue;

      const line = await this.lineRepository.findByNamespaceId(parentGroupId, undefined, host);
      if (!line) continue;

      const { spec, specFiller } = await this.#discoverProductSpec({ token, project, host });
      const product = new Product({
        lineId: line._id,
        spec,
        specFiller,
        gitHost: host,
        repo: {
          id: project.id,
          namespaceId: project.namespaceId,
          webUrl: project.webUrl,
          webIdeUrl: project.webIdeUrl,
        },
      });
      await this.productRepository.save(product);
    }

    await correctProductDates({ products: existing, projects: gitlabProjects, repository: this.productRepository });

    if (newProjects.length === 0) return existing;
    return this.productRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
  }

  reconcileProducts = async ({ userId, prune = false }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();

    const total = { created: [], unlinked: [], skipped: 0, archived: [] };
    for (const host of this.#hostsOf(user)) {
      const done = await this.#reconcileOn({ user, host, prune });
      total.created.push(...done.created);
      total.unlinked.push(...done.unlinked);
      total.skipped += done.skipped;
      total.archived.push(...done.archived);
    }
    return total;
  };

  #reconcileOn = async ({ user, host, prune }) => {
    const token = tokenFor(user, host);
    const gitlabProjects = await getGitProvider({ host }).listRepositories({ token, topic: 'product' });

    const repoIds = gitlabProjects.map(p => p.id);
    const liveIdSet = new Set(repoIds);
    const existing = await this.productRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
    const existingIds = new Set(existing.map(p => p.repo.id));

    const newProjects = gitlabProjects.filter(p => !existingIds.has(p.id));
    const created = [];
    const unlinked = [];

    for (const project of newProjects) {
      const parentGroupId = project.parentNamespaceId;
      if (!parentGroupId) {
        unlinked.push({ name: project.name, reason: 'no_parent_group' });
        continue;
      }

      const line = await this.lineRepository.findByNamespaceId(parentGroupId, undefined, host);
      if (!line) {
        unlinked.push({ name: project.name, reason: 'parent_line_not_found' });
        continue;
      }

      const { spec, specFiller } = await this.#discoverProductSpec({ token, project, host });
      const product = new Product({
        lineId: line._id,
        spec,
        specFiller,
        gitHost: host,
        repo: {
          id: project.id,
          namespaceId: project.namespaceId,
          webUrl: project.webUrl,
          webIdeUrl: project.webIdeUrl,
        },
      });

      await this.productRepository.save(product);
      created.push({ id: product._id, name: project.name, lineName: line.name });
    }

    // Prune: archive DB products of this host whose project no longer appears in the user's enrolled list.
    const archived = [];
    if (prune) {
      const allProducts = await this.productRepository.getAll();
      for (const product of allProducts) {
        if (product.archived || hostOf(product) !== host) continue;
        if (product.repo?.id && !liveIdSet.has(product.repo.id)) {
          product.archived = true;
          await this.productRepository.save(product);
          archived.push({ id: product._id, name: product.spec?.basicData?.name });
        }
      }
    }

    return { created, unlinked, skipped: existing.length, archived };
  };

  updateProduct = async ({ id, spec, importedSpec, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const session = await this.dataSource.startTransaction();
    try {

      const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.MAINTAINER}, git);

      // Saving writes the spec to GitLab, where it lives, and nothing else: no code is derived and the version stays what the
      // last generation left it. Saving again just overwrites it.
      let savedSpec = null;
      let composedSpec = null;
      let modelImport = null;
      if (spec) {
        const token = tokenFor(user, hostOf(product));
        const line = await this.lineRepository.findById(product.lineId);
        assertLineAlive(line);
        // A product of a line with models keeps its data in them: push into them what the form edits, or the whole file that was
        // imported (via each metamodel's import mapping); then spec.json is written, for a modular line with what they now hold.
        if (line.modular || line.kind === 'project') {
          const source = importedSpec && typeof importedSpec === 'object'
            ? { ...importedSpec, features: spec.features ?? [] }
            : { basicData: spec.basicData, statics: spec.statics ?? [], features: spec.features ?? [] };
          try {
            modelImport = { imported: Boolean(importedSpec), ...(await this.modularService.importProductSpec({ token, userId, line, product, spec: source })) };
          } catch (importError) {
            console.error(`[models] updateProduct: product ${product._id} spec saved but its models could not be updated:`, importError?.message ?? importError);
            modelImport = { updated: [], invalid: [], skipped: [], errors: [String(importError?.message ?? importError)], transformed: false };
          }
        }
        // What is now actually in the models (the import above may not have taken every field as given): spec.json of a
        // modular product holds this, not the minimal one — that is only for a product that has never been saved or generated.
        const composed = line.modular
          ? await this.#composedSpecOf({ token, userId, line, product: { spec, repo: product.repo, gitHost: product.gitHost } }).catch(() => spec)
          : spec;
        // A failed write fails the save: GitLab is the only place the spec is kept, so there is no second copy to fall back on.
        await this.productSpecService.writeSpec({
          token, host: hostOf(product), productProjectId: product.repo.id, isFiller: false,
          mutate: (current) => {
            // the version belongs to the generation, not to whatever the client sent
            const version = current?.basicData?.version ?? product.spec.basicData.version;
            // the features are what the product's selection model comes to: saving the form does not change them
            savedSpec = { ...composed, features: current?.features ?? spec.features ?? [], basicData: { ...composed.basicData, version } };
            return savedSpec;
          },
        });
        product.spec = indexOnlySpec(savedSpec);
        product.specInRepo = true;
        product.specFiller = false;
        composedSpec = savedSpec;
      }

      await this.productRepository.save(product, { session });

      await this.dataSource.commitTransaction(session);
      forgetProduct(id);
      if (modelImport) {
        this.forgetStatuses(id);
        product.$locals.modelImport = modelImport;
      }

      if (savedSpec) {
        // Mongo was saved without it; the caller gets the composed spec back, as it does from findProductById.
        product.spec = composedSpec;
        const deployed = await this.productSpecService.readDeployed({
          token: tokenFor(user, hostOf(product)), host: hostOf(product), productProjectId: product.repo.id,
        }).catch(() => null);
        product.$locals.deployment = await this.#deploymentOf({ token: tokenFor(user, hostOf(product)), product, deployed, spec: composedSpec });
      }

      return product;
    } catch (error) {
      await this.dataSource.abortTransaction(session);
      await rollbackGitlabSession(git);
      throw error;
    }
  }

  /**
   * The features of a product's spec are the index of its feature selection (the model `featureselection`, which the feature metamodel
   * completes): this is called when the selection was saved, with the features it comes to. Nothing else of the spec changes.
   */
  setFeatures = async ({ id, userId, features }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.DEVELOPER }, git);
    const token = tokenFor(user, hostOf(product));
    const line = await this.lineRepository.findById(product.lineId);
    assertLineAlive(line);
    const current = await this.productSpecService.getSpecFromHostOrCache({
      token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
      context: `setFeatures: product ${product._id}`,
    });
    const spec = normalizeProductSpec({ spec: current.spec });
    if (JSON.stringify(spec.features) === JSON.stringify(features)) return false;
    // Saving a model (this follows every model save) is also an update: spec.json of a modular product gets what its
    // models now actually compose to, not just `features` patched onto whatever was there before.
    const composed = line.modular
      ? await this.#composedSpecOf({ token, userId, line, product: { spec: { ...spec, features }, repo: product.repo, gitHost: product.gitHost } }).catch(() => ({ ...spec, features }))
      : { ...spec, features };
    let saved = null;
    await this.productSpecService.writeSpec({
      token, host: hostOf(product), productProjectId: product.repo.id, isFiller: false,
      mutate: (stored) => {
        const version = stored?.basicData?.version ?? composed.basicData.version;
        saved = { ...composed, basicData: { ...composed.basicData, version }, features };
        return saved;
      },
    });
    product.spec = indexOnlySpec(saved);
    product.specInRepo = true;
    await this.productRepository.save(product);
    forgetProduct(id);
    return true;
  };

  /**
   * What is saved against what the last generation derived from, to see what a generation would deploy.
   * `deployed` is null when the product has no generation that kept its spec.
   */
  getProductDeployment = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git);
    const token = tokenFor(user, hostOf(product));
    const [resolved, deployed] = await Promise.all([
      this.productSpecService.getSpecFromHostOrCache({
        token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
        context: `getProductDeployment: product ${product._id}`,
      }),
      this.productSpecService.readDeployed({ token, host: hostOf(product), productProjectId: product.repo.id }),
    ]);
    const saved = normalizeProductSpec({ spec: resolved.spec });
    // the models are compared with the ones of the last generation, when it kept them
    const savedModels = deployed?.models
      ? await this.modularService.storedModels({ token, host: hostOf(product), productProjectId: product.repo.id }).catch(() => null)
      : null;
    return {
      saved,
      deployed: deployed?.spec ? normalizeProductSpec({ spec: deployed.spec }) : null,
      models: { saved: savedModels, deployed: deployed?.models ?? null },
      version: deployed?.version ?? null,
      deployedAt: deployed?.deployedAt ?? null,
    };
  };

  #versionContext = async ({ id, userId, accessLevel = 20 }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel }, git);
    return { git, product, token: tokenFor(user, hostOf(product)), projectId: product.repo.id, host: hostOf(product) };
  };

  // The snapshot of a version; the one of the last generation also comes from its deployment record for products that
  // were generated before every version kept its own.
  #snapshotOf = async ({ token, projectId, version, deployed, host }) => {
    const snapshot = await this.productSpecService.readVersionSnapshot({ token, productProjectId: projectId, version, host });
    if (snapshot) return snapshot;
    return deployed?.version === version && deployed.spec ? deployed : null;
  };

  /**
   * The versions of a product, newest first: `{ current, versions: [{ version, deployedAt, current }] }`. The ones that have a tag (each
   * generation keeps its own), and the last deployed one even when it has none (a product older than the tags).
   */
  listProductVersions = async ({ id, userId }) => {
    const { token, projectId, host, product } = await this.#versionContext({ id, userId });
    const deployed = await this.productSpecService.readDeployed({ token, productProjectId: projectId, host }).catch(() => null);
    const names = new Set(await this.productSpecService.listVersionSnapshots({ token, productProjectId: projectId, host }));
    if (deployed?.spec && isVersion(deployed.version)) names.add(deployed.version);
    const current = deployed?.version ?? product?.spec?.basicData?.version ?? null;
    const versions = await Promise.all([...names].sort((a, b) => compareVersions(b, a)).map(async (version) => {
      const snapshot = await this.#snapshotOf({ token, projectId, version, deployed, host }).catch(() => null);
      return { version, deployedAt: snapshot?.deployedAt ?? null, current: version === current };
    }));
    return { current, versions };
  };

  /**
   * One version with what it was generated from, and the version before it, to see what it changed. Asks for little: the tag of
   * the version, and the one of `previous` when the caller knows it (the history does). Only without it, or when that one kept
   * nothing, are the tags listed to find the closest one before.
   */
  getProductVersion = async ({ id, userId, version, previous: hinted }) => {
    if (!isVersion(version)) throw new NoDeployedSnapshotError();
    const { token, projectId, host } = await this.#versionContext({ id, userId });
    const deployed = await this.productSpecService.readDeployed({ token, productProjectId: projectId, host }).catch(() => null);
    const snapshot = await this.#snapshotOf({ token, projectId, version, deployed, host });
    if (!snapshot) throw new NoDeployedSnapshotError();

    let previous = null;
    if (isVersion(hinted) && compareVersions(hinted, version) < 0) {
      previous = await this.#snapshotOf({ token, projectId, version: hinted, deployed, host });
    }
    if (!previous) {
      const listed = await this.productSpecService.listVersionSnapshots({ token, productProjectId: projectId, host });
      const known = new Set(listed);
      if (deployed?.spec && isVersion(deployed.version)) known.add(deployed.version);
      const before = [...known].filter((v) => compareVersions(v, version) < 0).sort(compareVersions).at(-1) ?? null;
      previous = before ? await this.#snapshotOf({ token, projectId, version: before, deployed, host }) : null;
    }

    const view = (s) => ({
      version: s.version, deployedAt: s.deployedAt ?? null,
      spec: normalizeProductSpec({ spec: s.spec }), models: s.models ?? null,
    });
    return { ...view(snapshot), previous: previous ? view(previous) : null };
  };

  /**
   * The code of a version, derived again: the generation is run with the spec and the models of that version, on the platform
   * and the modules of the line as they were then. Nothing is kept of it: the archive is made, handed over and forgotten.
   */
  downloadVersionZip = async ({ id, userId, version }) => {
    if (!isVersion(version)) throw new NoDeployedSnapshotError();
    const { git, product, token, projectId, host } = await this.#versionContext({ id, userId });
    const deployed = await this.productSpecService.readDeployed({ token, productProjectId: projectId, host }).catch(() => null);
    const snapshot = await this.#snapshotOf({ token, projectId, version, deployed, host });
    if (!snapshot) throw new NoDeployedSnapshotError();

    const line = await this.lineRepository.findById(product.lineId);
    assertLineAlive(line);
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.MINIMAL }, git);

    return this.#deriveZip({
      token, userId, product, line,
      spec: normalizeProductSpec({ spec: snapshot.spec }),
      // a generation that did not say which models it used, is derived with the ones the product has now
      models: snapshot.models ?? undefined,
      // the commit of the line it was generated from; older generations did not say, and are derived on the line as it is
      lineRef: snapshot.line?.commit ?? undefined,
    });
  };

  /**
   * What a person needs to look into a generation that went wrong, as one archive: its log (with how long each step took), the spec of
   * the product and the models it holds now. Read-only; nothing of it is kept.
   */
  generationBundle = async ({ id, userId, version }) => {
    const { product, token, host } = await this.#versionContext({ id, userId, accessLevel: ACCESS.REPORTER });
    const entries = await this.logRepository.findByProductIdAndVersionOrderByCreatedAtAsc(product._id, version);
    if (!entries.length) throw new NoDeployedSnapshotError();
    const rows = entries.map((entry) => ({
      at: entry.createdAt, type: entry.type, message: entry.message, params: entry.params ?? [], durationMs: entry.durationMs ?? null, link: entry.link ?? null,
    }));
    const startedAt = rows[0].at;
    const finishedAt = rows[rows.length - 1].at;
    const ended = rows.filter((row) => ['error', 'warning', 'success', 'cancelled'].includes(row.type));
    const summary = {
      product: product.spec?.basicData?.name ?? null, productId: String(product._id), version,
      outcome: ended.length ? ended[ended.length - 1].type : 'success',
      startedAt, finishedAt, totalMs: rows.some((row) => row.durationMs !== null) ? rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) : new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    };
    const text = [
      `${summary.product} v${version}: ${summary.outcome}, ${summary.totalMs} ms`,
      ...rows.map((row) => `${new Date(row.at).toISOString()} ${row.type.padEnd(9)} ${row.message}${row.params.length ? ` ${JSON.stringify(row.params)}` : ''}${row.durationMs === null ? '' : ` (${row.durationMs} ms)`}`),
    ].join('\n');
    const models = await this.modularService.storedModels({ token, host, productProjectId: product.repo.id, fresh: true }).catch(() => ({}));
    const zip = new JSZip();
    zip.file('run.json', JSON.stringify(summary, null, 2));
    zip.file('log.txt', `${text}\n`);
    zip.file('log.json', JSON.stringify(rows, null, 2));
    zip.file('spec.json', JSON.stringify(product.spec ?? {}, null, 2));
    for (const [name, content] of Object.entries(models)) zip.file(`models/${name}`, content);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  /**
   * Puts what the last generation used back as the saved one: what was saved since is dropped, the version is not touched.
   * `parts` limits it: 'features' (the feature selection), 'fields' (the rest of the spec) and 'model:<name>' (one model). Without it,
   * everything goes back.
   */
  discardSavedSpec = async ({ id, userId, parts, version }) => {
    const { product, token, projectId, host } = await this.#versionContext({ id, userId, accessLevel: ACCESS.MAINTAINER });
    assertLineAlive(await this.lineRepository.findById(product.lineId));

    const deployed = await this.productSpecService.readDeployed({ token, productProjectId: projectId, host });
    // `version`: go back to what an older generation used instead of the last one
    const source = version ? await this.#snapshotOf({ token, projectId, version, deployed, host }) : deployed;
    if (!source?.spec) throw new NoDeployedSnapshotError();

    const everything = !Array.isArray(parts) || parts.length === 0;
    const wants = (part) => everything || parts.includes(part);
    const modelNames = Object.keys(source.models ?? {}).filter((name) => wants(`model:${name}`));

    let restored = null;
    if (wants('features') || wants('fields')) {
      await this.productSpecService.writeSpec({
        token, host, productProjectId: projectId, isFiller: false,
        mutate: (current) => {
          // the version belongs to the generation: whatever is restored, it stays what it is
          const currentVersion = current?.basicData?.version ?? source.spec.basicData?.version;
          const base = current ?? source.spec;
          const next = { ...base };
          if (wants('fields')) {
            for (const key of Object.keys(source.spec)) if (key !== 'features') next[key] = source.spec[key];
          }
          if (wants('features')) next.features = source.spec.features;
          next.basicData = { ...next.basicData, version: currentVersion };
          restored = next;
          return restored;
        },
      });
      await this.#trimMongoSpec({ product, spec: restored });
    }
    // the models go back to the ones that generation used
    if (modelNames.length) {
      await this.modularService.restoreStoredModels({
        token, host, productProjectId: projectId,
        models: Object.fromEntries(modelNames.map((name) => [name, source.models[name]])),
      });
    }
    forgetProduct(id);

    // when only models were restored the spec is read as it is
    if (!restored) {
      const { spec: current } = await this.productSpecService.getSpecFromHostOrCache({
        token, host, productProjectId: projectId, fallbackSpec: fallbackSpecOf(product),
        context: `discardSavedSpec: product ${product._id}`,
      });
      restored = current;
    }
    product.spec = normalizeProductSpec({ spec: restored });
    product.$locals.deployment = await this.#deploymentOf({ token, product, deployed, spec: product.spec });
    return product;
  };

  renameProduct = async ({ id, name, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const session = await this.dataSource.startTransaction();
    try {
      const oldName = product.spec.basicData.name;
      const line = await this.lineRepository.findById(product.lineId, { session });
      assertLineAlive(line);

      const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.MAINTAINER}, git);

      if (name !== oldName) {
        const taken = await this.productRepository.findByName(name, product.lineId, { session });
        if (taken && String(taken._id) !== String(product._id)) throw new AlreadyExistentProductError();
      }

      product.spec.basicData.name = name;

      const token = tokenFor(user, hostOf(product));
      await git.renameNamespace({ token, id: product.repo.namespaceId, name });
      const repo = await git.renameRepository({ token, id: product.repo.id, name });
      product.repo.webUrl = repo.webUrl;
      product.repo.webIdeUrl = repo.webIdeUrl;

      await this.productRepository.save(product, { session });

      await this.dataSource.commitTransaction(session);
      forgetProduct(id);

      if (line?.repoId) {
        try {
          await this.productsIndexService.renameProduct({ token, host: hostOf(line), lineProjectId: line.repoId, from: oldName, to: name });
        } catch (indexError) {
          console.error(`[productsIndex] renameProduct: product ${product._id} renamed ${oldName} -> ${name} but products.json commit failed on line ${line.repoId}:`, indexError?.message ?? indexError);
        }
      }

      try {
        const mongoSpec = product.toObject().spec;
        await this.productSpecService.writeSpec({
          token, host: hostOf(product), productProjectId: product.repo.id,
          mutate: (current) => {
            const base = current ?? mongoSpec;
            return { ...base, basicData: { ...base.basicData, name } };
          },
          isFiller: Boolean(product.specFiller),
        });
      } catch (specError) {
        logSpecWriteFailure(`renameProduct: product ${product._id} renamed ${oldName} -> ${name} but spec commit failed`, specError);
      }

      return product;
    } catch (error) {
      await this.dataSource.abortTransaction(session);
      await rollbackGitlabSession(git);
      throw error;
    }
  }

  // The code of a spec as a zip, from the platform of its line and the modules it pins. Nothing is written but a scratch folder.
  // `models` (metamodel name -> text) are the ones of the product unless they are given; `lineRef` is the commit (or branch) of the line.
  // `overrides` ([{ path, action: 'create' | 'update' | 'delete', content }]) change the platform before deriving: a proposal tried out.
  // `prepare` ({ token, userId, lineOutput }) replaces the product's own preparation (a trial has no product).
  #deriveZip = async ({ token, userId, product, line, spec, models, lineRef, overrides = [], prepare }) => {
    const git = getGitProvider({ host: hostOf(line) });
    const tmp = path.join(properties.paths.output, uuidv4());
    try {
      const lineZip = await git.downloadArchive({ token, id: line.repoId, ref: lineRef });
      const lineZipBuffer = await streamToBuffer(lineZip);
      const { dir: lineOutput } = await extractArchive({
        source: lineZipBuffer,
        destDir: path.join(tmp, 'line'),
        prefix: '',
      });

      const root = fs.realpathSync(lineOutput);
      for (const { path: file, action, content } of overrides) {
        const dest = path.resolve(root, file);
        if (!dest.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error(`${file} is outside the platform`), { code: 'ISSUE_REFUSED', status: 400 });
        // a link in the line's repository must not take a write out of it, and a folder is not a file
        let at = root;
        for (const part of path.relative(root, dest).split(path.sep)) {
          at = path.join(at, part);
          const stat = fs.lstatSync(at, { throwIfNoEntry: false });
          if (stat?.isSymbolicLink() || (stat?.isDirectory() && at === dest)) throw Object.assign(new Error(`${file} cannot be changed`), { code: 'ISSUE_REFUSED', status: 400 });
        }
        if (action === 'delete') fs.rmSync(dest, { force: true });
        else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, content ?? '', 'utf8');
        }
      }

      const modular = prepare
        ? await prepare({ token, userId, lineOutput })
        : await this.modularService.prepareDerivation({ token, userId, product, lineOutput, models });
      if (!modular) throw new LinePlatformNotFoundError('This line has no spl.json: it was made before lines had one, and is not supported any more.');
      return await deriveModularProductToZip({ ...modular, spec, createEngine });
    } finally {
      removeWorkDir(tmp);
    }
  };

  /**
   * Tries a derivation of a line's platform for a configuration (`features`), without making a product or a repository. `lineRef` (a
   * branch or commit) and `overrides` (files changed and not committed) derive from the platform as a proposal would leave it.
   * `include` (paths of the derived product) also returns what those files hold as `contents`, to see the output of one file;
   * `zip` returns the whole derived product as base64 (to download it). `spec` is a sample of the product's spec (its basic data and
   * other models) the templates see as `data`.
   * Needs developer access. `{ ok: true, files, size, contents? }`, or `{ ok: false, error, diagnostics }` when the derivation fails.
   */
  tryDerivation = async ({ lineId, features = [], lineRef, overrides = [], include = [], zip: wantZip = false, spec: sample, models, userId }) => {
    const line = await this.lineRepository.findById(lineId);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.DEVELOPER }, git);
    const token = tokenFor(user, hostOf(line));
    // `sample`: a product's spec to try with (basic data, other models...), to see what the templates make of it; `features` always wins
    const spec = trialSpecOf({ sample, features });
    try {
      const zip = await this.#deriveZip({
        token, userId, product: null, line, spec, lineRef: lineRef || undefined, overrides,
        prepare: ({ lineOutput }) => this.modularService.prepareTrial({ token, userId, lineOutput, features, models }),
      });
      return { ok: true, files: zipEntries(zip), size: zip.length, ...(include.length ? { contents: await zipContents(zip, include) } : {}), ...(wantZip ? { zip: Buffer.from(zip).toString('base64') } : {}) };
    } catch (error) {
      if (error instanceof LinePlatformNotFoundError || error?.status === 400 || error?.status === 403 || error?.status === 404) throw error;
      return { ok: false, error: String(error?.message ?? error), diagnostics: error?.diagnostics ?? [] };
    }
  };

  // `spec` is the one to derive from (what the editor holds); without it, the one that is saved.
  // `lineRef` (a commit or branch of the line) and `overrides` derive from the platform as a proposal would leave it; nothing is written.
  generateZip = async ({ id, spec, userId, lineRef, overrides }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });

    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER}, git);

    const line = await this.lineRepository.findById(product.lineId);
    assertLineAlive(line);

    await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.MINIMAL}, git);

    // trying out a platform that is not the line's own (another ref, edited files) is a developer's business, not a reader's
    if (lineRef || overrides?.length) {
      await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.DEVELOPER }, git);
    }

    const token = tokenFor(user, hostOf(product));

    if (!spec) {
      const resolved = await this.productSpecService.getSpecFromHostOrCache({
        token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
        context: `generateZip: product ${product._id}`,
      });
      spec = normalizeProductSpec({ spec: resolved.spec });
    }

    return this.#deriveZip({ token, userId, product, line, spec, lineRef: lineRef || undefined, overrides: overrides ?? [] });
  };

  /**
   * What a generation would change in the code of the product, without making it: the same derivation and the same comparison
   * with the code that is in the repository, with nothing written to GitLab or Mongo (a scratch folder, removed after).
   * Returns { version, previousVersion, changed, counts: { create, update, delete }, files: [{ path, action }], truncated }.
   */
  previewGeneration = async ({ id, userId, bump }) => {
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, uuid);
    const found = await this.productRepository.findById(id);
    if (!found) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(found) });
    const silent = async () => {};
    try {
      const { product, line, token, newVersion, previousVersion, logError } = await loadContext({
        id, userId, session: undefined, log: silent, bump,
        productRepository: this.productRepository,
        lineRepository: this.lineRepository,
        permissionChecker: this.permissionChecker,
        git,
        productSpecService: this.productSpecService,
      });

      await this.modularService.assertProductFits({ token, userId, product, line });
      const ci = await this.#ciOf({ git, token, product });
      const { lineOutput } = await downloadAndUnzipLine({ token, line, tmp, newVersion, log: silent, logError, git });
      const modular = await this.modularService.prepareDerivation({ token, userId, product, lineOutput });
      const { productZip } = await downloadOldProduct({ token, product, logError });

      // As the generation does: first at the version it has, to know whether there is anything to commit at all (a version
      // that differs in every file would otherwise hide that there is nothing), and only then with the version it would get.
      const currentOutput = path.resolve(path.join(tmp, 'current'));
      await runEngine({ lineOutput, product, newProductOutput: currentOutput, logError, modular });
      const { oldProductOutput } = await unzipOldProduct({ productZip, product, tmp });
      const current = await prettifyAndDiff({ newProductOutput: currentOutput, oldProductOutput, newVersion: previousVersion, log: silent, ciFile: ci.file });
      if (current.actions.length === 0) {
        return {
          version: previousVersion, previousVersion, changed: false,
          counts: { create: 0, update: 0, delete: 0 }, files: [], truncated: false,
        };
      }

      product.spec.basicData.version = newVersion;
      const newProductOutput = path.resolve(path.join(tmp, 'new'));
      await runEngine({ lineOutput, product, newProductOutput, logError, modular });
      const { actions } = await prettifyAndDiff({ newProductOutput, oldProductOutput, newVersion, log: silent, ciFile: ci.file });

      return {
        version: newVersion,
        previousVersion,
        changed: actions.length > 0,
        ...describeChanges({ actions, oldDir: oldProductOutput }),
      };
    } finally {
      removeWorkDir(tmp);
    }
  };

  generateProduct = async ({ id, userId, bump: asked }, log) => {
    const startedAt = new Date();
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, uuid);
    const found = await this.productRepository.findById(id);
    if (!found) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(found) });
    // the bump of the request, else the one the product is set to
    const bump = asked ?? found?.generation?.bump;
    const autoMerge = found?.generation?.autoMerge !== false;
    // One thing at a time on a product: a second generation, or a sync, is refused (409) while this one runs.
    const releaseLock = await takeLock(productLockId(id), 'generate', { owner: userId });
    const run = beginRun(id, userId);
    let attemptedVersion = null;
    // Opened right before the one write this needs (stage 8) and committed right after, not here: everything before
    // it is a GitLab download or spl-js-engine run, routinely slower than Mongo's default transaction timeout (60s) —
    // held open across that, the transaction was aborted out from under the save it was meant to protect.
    let session = null;
    try {
      // ── Stage 1: resolve entities, permissions, version ─────────────────────
      let { product, line, token, newVersion, previousVersion, logError } = await loadContext({
        id, userId, session: undefined, log, bump,
        productRepository: this.productRepository,
        lineRepository: this.lineRepository,
        permissionChecker: this.permissionChecker,
        git,
        productSpecService: this.productSpecService,
      });
      attemptedVersion = newVersion;
      run.checkpoint();

      // A selection that does not fit the SPL is known from the models alone: it is told before anything is downloaded for the derivation.
      await log({ version: newVersion, type: 'info', message: 'log.checking_selection' });
      await this.modularService.assertProductFits({ token, userId, product, line }).catch(async (error) => {
        await logError(error.message);
        throw error;
      });
      run.checkpoint();

      const ci = await this.#ciOf({ git, token, product });
      // a token the host no longer accepts is renewed (a wait for the checks of a pipeline can outlast it)
      const renewToken = async () => tokenFor(await Container.get(UserService).loginUserFromId({ userId }), hostOf(product));

      // ── Stage 2 + 3: download line platform and old product (sequential) ────
      // The commit of the line this generation derives from, downloaded by that commit: it is what the zip of this version is
      // derived from again later, with the same platform and modules.
      const lineRef = await git.getBranch({ token, id: line.repoId, branch: 'main' })
        .then((branch) => branch.lastCommit?.id ?? null)
        .catch(() => null);
      const { lineOutput }  = await downloadAndUnzipLine({ token, line, tmp, newVersion, log, logError, git, ref: lineRef ?? undefined });
      run.checkpoint();
      // null for a plain line; for one made of modules, the packages its lockfile pins and the product's models
      const modular = await this.modularService.prepareDerivation({ token, userId, product, lineOutput, newVersion, log });
      run.checkpoint();
      const { productZip }  = await downloadOldProduct({ token, product, logError });
      run.checkpoint();

      // ── Stage 4: generate new product files with spl-js-engine ──────────────
      // Still at previousVersion here (see loadContext) — generating with the
      // version already bumped meant the version string itself always differed
      // from what's committed, so the diff below could never come back empty
      // even when nothing about the product actually changed.
      // This pass reports the derivation phases, as it is the one that always runs and takes the time; its diff stays silent, and so does
      // the second pass below, which would show "composing the platform" twice in a row. Real errors still reach the user: logError is unaffected.
      const silentLog = async () => {};
      const newProductOutput = path.resolve(path.join(tmp, 'new'));
      await runEngine({ lineOutput, product, newProductOutput, newVersion, log, logError, modular });
      run.checkpoint();

      // ── Stage 5: unzip old product for diff comparison ───────────────────────
      const { oldProductOutput } = await unzipOldProduct({ productZip, product, tmp });

      // ── Stage 6: format + diff ───────────────────────────────────────────────
      let { actions } = await prettifyAndDiff({ newProductOutput, oldProductOutput, newVersion: previousVersion, log: silentLog, ciFile: ci.file });
      run.checkpoint();

      // ── Stage 7: guard against genuine empty diffs ───────────────────────────
      await checkEmptyDiff({ actions, previousVersion, log });

      if (actions.length === 0) {
        // Nothing to commit — don't bump the version, tag baseBranch, or open an
        // update MR. Doing so anyway produces an empty "0 +0 -0" MR with nothing
        // for a reviewer to look at (this product's config just never touched
        // whatever changed on the line), which then sits stuck forever if the
        // project requires an approval that has nothing meaningful to approve.
        // Nothing was ever written to Mongo on this path, so there is no transaction to commit.
        // The version this generation was going to be never existed: what it logged under it (the download of the platform...) must
        // not make the history list a version that has no code, no tag and no snapshot.
        if (newVersion !== previousVersion) {
          await this.logRepository.deleteByProductIdAndVersionSince(product._id, newVersion, startedAt)
            .catch((logError) => console.error(`[generateProduct] could not drop the logs of the unreleased v${newVersion}:`, logError.message));
        }
        // A generation that stopped after its code reached the base branch (the merge was reported as conflicting, the server went down...)
        // leaves the version without its tag and its update to the default branch: asking again finds the code already there. Finish it.
        const unfinishedVersion = await this.#unfinishedUpdate({ token, product, previousVersion, git });
        // the version the code already is: the one of the update that was finished, else the one the product had
        const settledVersion = unfinishedVersion ?? previousVersion;
        let unfinishedOverridden = false;
        if (unfinishedVersion) {
          await createVersionTag({ token, product, newVersion: unfinishedVersion, git });
          await this.#supersedeDecision(product);
          const merged = await mergeUpdateBranch({ token, product, newVersion: unfinishedVersion, log, logError, git, ci: ci.wait, renewToken });
          const { updateConflicts } = merged;
          token = merged.token;
          unfinishedOverridden = merged.checksOverridden;
          if (merged.checksFailed) {
            return await this.#awaitDecision({
              token, userId, line, product, result: { ...product.toObject() }, merged, version: unfinishedVersion, previousVersion, models: modular?.models ?? {}, lineRef, resolved: modular?.resolved,
            });
          }
          if (updateConflicts) {
            const pending = { ...product.toObject() };
            pending.conflicts = true;
            pending.stage = 'update';
            pending.deployment = { pending: true, version: previousVersion };
            pending.spec.basicData.version = previousVersion;
            domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
              productId: String(product._id), lineId: String(product.lineId), userId, conflicts: true, stage: 'update', version: previousVersion,
            });
            return pending;
          }
        }
        // What was saved is what the code already is, so there is nothing pending any more.
        const composedSpec = await this.#composedSpecOf({ token, userId, line, product }).catch(() => product.spec);
        if (composedSpec?.basicData) composedSpec.basicData.version = settledVersion;
        try {
          await this.#moveSpecToRepo({ token, product, spec: composedSpec });
          await this.productSpecService.writeDeployed({
            token, host: hostOf(product), productProjectId: product.repo.id, spec: normalizeProductSpec({ spec: composedSpec }),
            models: modular?.models ?? {}, lineRef, lineVersion: line.version,
          });
        } catch (deployedError) {
          logSpecWriteFailure(`generateProduct: product ${product._id} is up to date but its deployment record could not be written`, deployedError);
        }
        const result = { ...product.toObject(), spec: composedSpec };
        if (unfinishedOverridden) result.checksDecision = 'merge';
        result.deployment = { pending: false, version: settledVersion };
        result.spec.basicData.version = settledVersion;
        // Lets the client tell "nothing to commit" apart from "generated a new
        // version" — they both resolve successfully with no conflicts.
        result.changed = false;
        domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
          productId: String(product._id), lineId: String(product.lineId), userId, conflicts: false, stage: null, version: settledVersion,
        });
        return result;
      }

      // A real, non-version change exists — only now bump the version and
      // regenerate, so the committed content (and its re-computed diff) actually
      // reflects the new version number instead of leaving it at previousVersion.
      product.spec.basicData.version = newVersion;
      const finalProductOutput = path.resolve(path.join(tmp, 'new-versioned'));
      await runEngine({ lineOutput, product, newProductOutput: finalProductOutput, newVersion, log: silentLog, logError, modular });
      ({ actions } = await prettifyAndDiff({ newProductOutput: finalProductOutput, oldProductOutput, newVersion, log, ciFile: ci.file }));
      run.commit();

      // ── Stage 8: persist version bump ────────────────────────────────────────
      // The transaction only ever needed to protect this one save: open it right here, and close it right after,
      // so it is never held across the GitLab merges below (each its own round trip, sometimes its own wait for CI).
      session = await this.dataSource.startTransaction();
      const { result } = await saveProductVersion({ product, session, productRepository: this.productRepository });
      await this.dataSource.commitTransaction(session);
      session = null;

      // ── Stage 9: merge generation branch → baseBranch (when files changed) ──
      if (actions.length > 0) {
        const { generationConflicts, token: mergedWith } = await mergeGenerationBranch({ actions, token, product, newVersion, log, logError, git, renewToken });
        token = mergedWith ?? token;

        if (generationConflicts) {
          result.conflicts = true;
          result.stage = 'generating';
          result.deployment = { pending: true, version: previousVersion };
          await this.#syncProductSpecAfterGenerate({ token, userId, line, product, deployed: false, models: modular?.models ?? {} });
          domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
            productId: String(product._id), lineId: String(product.lineId), userId, conflicts: true, stage: 'generating', version: newVersion,
          });
          return result;
        }
      }

      // ── Stage 10: tag baseBranch with new version ────────────────────────────
      await createVersionTag({ token, product, newVersion, git });

      // ── Stage 11: merge update MR baseBranch → defaultBranch ────────────────
      await this.#supersedeDecision(product);
      const merged = await mergeUpdateBranch({ token, product, newVersion, log, logError, git, ci: ci.wait, renewToken, merge: autoMerge });
      const { updateConflicts } = merged;
      token = merged.token;

      // A product set not to merge its own updates stops here: the request is open for a person, and until it is merged the
      // code on the default branch is still the old version, so the deployment is still pending.
      if (!autoMerge) {
        result.conflicts = false;
        result.awaitingMerge = true;
        result.mergeRequest = { number: merged.updateMergeRequest.number, url: merged.updateMergeRequest.webUrl ?? '' };
        result.deployment = { pending: true, version: previousVersion };
        await this.#syncProductSpecAfterGenerate({ token, userId, line, product, deployed: false });
        domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
          productId: String(product._id), lineId: String(product.lineId), userId, conflicts: false, stage: null, version: newVersion,
        });
        return result;
      }

      if (merged.checksFailed) {
        return await this.#awaitDecision({
          token, userId, line, product, result, merged, version: newVersion, previousVersion, models: modular?.models ?? {}, lineRef, resolved: modular?.resolved,
        });
      }

      if (updateConflicts) {
        result.conflicts = true;
        result.stage = 'update';
        result.deployment = { pending: true, version: previousVersion };
        await this.#syncProductSpecAfterGenerate({ token, userId, line, product, deployed: false });
        domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
          productId: String(product._id), lineId: String(product.lineId), userId, conflicts: true, stage: 'update', version: newVersion,
        });
        return result;
      }

      result.conflicts = false;
      if (merged.checksOverridden) result.checksDecision = 'merge';
      result.deployment = { pending: false, version: newVersion };
      const composedSpec = await this.#syncProductSpecAfterGenerate({ token, userId, line, product, models: modular?.models ?? {}, lineRef });
      if (composedSpec) result.spec = composedSpec;
      if (modular) {
        await this.modularService.updateProductManifest({ token, product, resolved: modular.resolved })
          .catch((manifestError) => console.error(`[modules] generateProduct: product ${product._id} generated but its manifest could not be updated:`, manifestError?.message ?? manifestError));
      }
      domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
        productId: String(product._id), lineId: String(product.lineId), userId, conflicts: false, stage: null, version: newVersion,
      });

      // Dev convenience only: LINEA_LOCAL_PRODUCTS_DIR is set by the local dev stack (server/dev/up.sh), never in
      // production. Mirrors exactly what is now in GitLab (the same archive download createProduct uses), so the
      // local folder is never a reconstruction that could drift from what was actually committed.
      if (process.env.LINEA_LOCAL_PRODUCTS_DIR) {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-export-'));
        try {
          const zip = await git.downloadArchive({ token, id: product.repo.id });
          const { dir } = await extractArchive({ source: await streamToBuffer(zip), destDir: scratch, prefix: '' });
          const dest = path.join(process.env.LINEA_LOCAL_PRODUCTS_DIR, product.spec.basicData.name);
          fs.rmSync(dest, { recursive: true, force: true });
          fs.cpSync(dir, dest, { recursive: true });
        } catch (exportError) {
          console.error(`[localExport] generateProduct: product ${product._id} generated but local export failed:`, exportError?.message ?? exportError);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      }

      return result;

    } catch (error) {
      if (error instanceof GenerationCancelledError) {
        await log({ version: attemptedVersion, type: 'cancelled', message: 'log.cancelled' }).catch(() => {});
        return { cancelled: true, productId: String(id) };
      }
      console.log(error);
      if (session) await this.dataSource.abortTransaction(session).catch(() => {});
      await rollbackGitlabSession(git);
      throw error;
    } finally {
      endRun(id, run);
      await releaseLock();
      forgetProduct(id);
      removeWorkDir(tmp);
    }
  }

  /**
   * Stops the generation of a product that is running on this server, as long as it has not started writing. Answers `idle` (nothing
   * running), `committing` (too late: it is already writing) or `cancelling` (it stops at its next checkpoint, leaving the repository
   * and the product as they were).
   */
  cancelGeneration = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges(
      { userId, repoId: product.repo.id, accessLevel: ACCESS.MAINTAINER },
      getGitProvider({ host: hostOf(product) }),
    );
    return { status: requestCancel(id) };
  };

  /**
   * Puts the code of the product back in line with its SPL: derives the spec that is DEPLOYED (not the one being edited) with
   * the SPL as it is now, and compares it with the code in the repository. It never raises the version nor tags: a change of
   * the spec is a generation. What it does with a difference is `behavior`: `check` only reports it, `mr` brings it to the
   * request bigbang -> main and leaves that for a person to merge, `merge` merges it (after the checks, as a generation does).
   * Returns the SyncRun. A product that is busy (LockedError, 409) is not synced.
   */
  syncProduct = async ({ id, userId, trigger = 'manual', behavior: forced = null }, onEvent = async () => {}) => {
    const tmp = path.join(properties.paths.output, uuidv4());
    const found = await this.productRepository.findById(id);
    if (!found) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(found) });
    const silent = async () => {};
    const { product, line, token, logError } = await loadContext({
      id, userId, session: undefined, log: silent,
      productRepository: this.productRepository, lineRepository: this.lineRepository,
      permissionChecker: this.permissionChecker, git, productSpecService: this.productSpecService,
    });
    const behavior = forced ?? effectiveSync(found, line).behavior;
    const releaseLock = await takeLock(productLockId(id), 'sync', { owner: userId });
    const run = await SyncRun.create({ productId: product._id, lineId: product.lineId, trigger, userId, behavior });
    // Whatever the outcome, the product remembers it looked, and the scheduler is told when to come back.
    const finish = async (fields) => {
      const finishedAt = new Date();
      Object.assign(run, fields, { finishedAt });
      await run.save();
      await Product.updateOne({ _id: product._id }, { $set: { lastSyncAt: finishedAt, nextSyncAt: nextSyncFor(found, line, finishedAt) } });
      await onEvent({ productId: String(product._id), status: run.status });
      return run.toObject();
    };
    try {
      const host = hostOf(product);
      const deployed = await this.productSpecService.readDeployed({ token, productProjectId: product.repo.id, host });
      if (!deployed?.spec) return await finish({ status: 'skipped', reason: 'never-deployed' });
      const version = deployed.version ?? deployed.spec.basicData?.version;
      Object.assign(run, { version, lineVersion: line.version });

      // A request to the default branch that names a version is a generation that did not finish: a sync must not take it over.
      if (behavior !== 'check') {
        const open = await git.listChangeRequests({ token, id: product.repo.id, state: 'opened', targetBranch: properties.git.defaultBranch });
        const standing = open.find((request) => request.sourceBranch === properties.git.baseBranch);
        if (standing && versionOfTitle(standing.title)) {
          return await finish({ status: 'skipped', reason: 'update-pending', mr: { number: standing.number, url: standing.webUrl } });
        }
      }

      product.spec = normalizeProductSpec({ spec: deployed.spec });
      product.spec.basicData.version = version;
      const ci = await this.#ciOf({ git, token, product });
      const renewToken = async () => tokenFor(await Container.get(UserService).loginUserFromId({ userId }), host);
      const lineRef = await git.getBranch({ token, id: line.repoId, branch: 'main' }).then((branch) => branch.lastCommit?.id ?? null).catch(() => null);
      const { lineOutput } = await downloadAndUnzipLine({ token, line, tmp, newVersion: version, log: silent, logError, git, ref: lineRef ?? undefined });
      const modular = await this.modularService.prepareDerivation({ token, userId, product, lineOutput, models: deployed.models });
      const { productZip } = await downloadOldProduct({ token, product, logError, git });
      const newProductOutput = path.resolve(path.join(tmp, 'new'));
      await runEngine({ lineOutput, product, newProductOutput, logError, modular });
      const { oldProductOutput } = await unzipOldProduct({ productZip, product, tmp });
      const { actions } = await prettifyAndDiff({ newProductOutput, oldProductOutput, newVersion: version, log: silent, ciFile: ci.file });

      // The features the product has follow its SPL: one the SPL gained as mandatory comes in, one it lost goes out (OPT-068).
      const reconciled = await this.#reconcileFeatures({ id, userId, line, current: deployed.spec.features });
      let deployedSpec = deployed.spec;
      if (reconciled.features) {
        Object.assign(run, { featuresAdded: reconciled.added, featuresRemoved: reconciled.removed });
        deployedSpec = { ...deployed.spec, features: reconciled.features };
        await this.setFeatures({ id, userId, features: reconciled.features })
          .catch((error) => console.error(`[syncProduct] product ${id}: its features could not be brought in line with the SPL:`, error?.message ?? error));
      }

      const recordDeployed = (current = token) => this.productSpecService.writeDeployed({
        token: current, host, productProjectId: product.repo.id, spec: deployedSpec, models: deployed.models ?? {}, lineRef, lineVersion: line.version,
      }).catch((error) => logSpecWriteFailure(`syncProduct: product ${product._id} is in line with its SPL but its deployment record could not be written`, error));

      if (actions.length === 0) {
        await recordDeployed();
        return await finish({ status: 'unchanged' });
      }
      Object.assign(run, { files: actions.length });
      if (behavior === 'check') return await finish({ status: 'drift' });

      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      const label = `Sync with SPL v${line.version}`;
      const { generationConflicts, generationMergeRequest, token: mergedWith } = await mergeGenerationBranch({
        actions, token, product, newVersion: version, log: silent, logError, git, renewToken,
        branch: `sync/${stamp}`, message: label, title: `${label}: bring ${properties.git.baseBranch} up to date`,
      });
      if (generationConflicts) {
        return await finish({ status: 'failed', reason: 'conflicts', mr: { number: generationMergeRequest.number, url: generationMergeRequest.webUrl } });
      }
      // not ending in a version: that is how an unfinished generation is told from a sync (see versionOfTitle)
      await this.#supersedeDecision(product);
      const merged = await mergeUpdateBranch({
        token: mergedWith ?? token, product, newVersion: version, log: silent, logError, git, ci: ci.wait, renewToken,
        title: `${label} (product v${version})`, merge: behavior === 'merge',
      });
      const mr = { number: merged.updateMergeRequest.number, url: merged.updateMergeRequest.webUrl };
      // what the dependencies bring is the description of the request a person will merge (one that was merged on the spot is not read)
      if (behavior !== 'merge') await this.#describeSync({ git, token: mergedWith ?? token, product, line, mr, id });
      if (behavior !== 'merge') return await finish({ status: 'mr', mr });
      if (merged.checksFailed) return await finish({ status: 'failed', reason: 'checks', mr });
      if (merged.updateConflicts) return await finish({ status: 'failed', reason: 'conflicts', mr });
      await recordDeployed(merged.token);
      if (modular) {
        await this.modularService.updateProductManifest({ token: merged.token, product, resolved: modular.resolved })
          .catch((error) => console.error(`[modules] syncProduct: product ${product._id} synced but its manifest could not be updated:`, error?.message ?? error));
      }
      return await finish({ status: 'merged', mr });
    } catch (error) {
      console.error(`[syncProduct] product ${id}:`, error?.message ?? error);
      await rollbackGitlabSession(git);
      await finish({ status: 'failed', reason: String(error?.message ?? error).slice(0, 300) }).catch(() => {});
      error.syncRunRecorded = true; // the scheduler does not record it again
      throw error;
    } finally {
      await releaseLock();
      forgetProduct(id);
      removeWorkDir(tmp);
    }
  };

  // What the features of a product come to against its SPL now, and how that differs from the ones it had: `features` is null when
  // nothing can be said (a plain line, or a product that does not fit its SPL).
  #reconcileFeatures = async ({ id, userId, line, current }) => {
    const none = { features: null, added: [], removed: [] };
    if (!line) return none;
    // what cannot be said does not stop the sync: it goes on with the features it had
    const health = await Promise.resolve().then(() => this.modularService.getProductHealth({ id, userId })).catch(() => null);
    if (!health?.valid || !Array.isArray(health.features) || !health.features.length) return none;
    const before = new Set(current ?? []);
    const after = new Set(health.features);
    const added = [...after].filter((feature) => !before.has(feature));
    const removed = [...before].filter((feature) => !after.has(feature));
    return added.length || removed.length ? { features: health.features, added, removed } : none;
  };

  // Puts the changelog of the dependencies in the description of the sync's request. A description a person wrote is left alone: only an empty
  // one, or one this wrote before (it starts with the same heading), is replaced. A failure changes nothing.
  #describeSync = async ({ git, token, product, line, mr, id }) => {
    try {
      const description = await Container.get(ChangelogService).syncDescription({ product, line, token });
      if (!description) return;
      const current = (await git.getMergeRequest({ token, id: product.repo.id, number: mr.number }))?.description ?? '';
      if (current.trim() && !isSyncDescription(current)) return;
      await git.updateMergeRequest({ token, id: product.repo.id, number: mr.number, changes: { description } });
    } catch (error) {
      console.warn(`[syncProduct] product ${id}: the changelog could not be put in !${mr.number}: ${error?.message ?? error}`);
    }
  };

  // The syncs of a product, newest first.
  listSyncs = async ({ id, userId, limit = 50 }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, getGitProvider({ host: hostOf(product) }));
    return SyncRun.find({ productId: id }).sort({ startedAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  };

  // Whether the version the product is at never got its tag on the base branch: the stages that follow the generation branch did not run.
  // A product that has no version yet (0.0.0) has nothing to finish. An answer that cannot be read counts as finished.
  #unfinishedUpdate = async ({ token, product, previousVersion, git }) => {
    try {
      // A request to the default branch that is still open is an update that did not finish (the wait for its checks was cut short, the
      // server went down...): it is finished with the version it names, whatever the tag or the saved version say.
      const open = await git.listChangeRequests({ token, id: product.repo.id, state: 'opened', targetBranch: properties.git.defaultBranch });
      const standing = open.find((request) => request.sourceBranch === properties.git.baseBranch);
      const named = standing ? versionOfTitle(standing.title) : null;
      if (named) return named;
      if (!previousVersion || previousVersion === '0.0.0') return null;
      // an update that a person rejected has its code on the base branch but not on the default one: asking again offers it again
      const requests = await git.listChangeRequests({ token, id: product.repo.id, state: 'all', targetBranch: properties.git.defaultBranch });
      const [latest] = requests.filter((request) => request.sourceBranch === properties.git.baseBranch)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      if (latest?.state === 'closed' && versionOfTitle(latest.title) === previousVersion) return previousVersion;
      const tag = await git.getTag({ token, id: product.repo.id, tag: `${properties.git.baseBranch}-${previousVersion}` });
      return tag === null ? previousVersion : null;
    } catch {
      return null;
    }
  };

  getProductHealth = ({ id, userId }) => healths.get(`health|${userId}|${id}`, () => this.#computeHealth({ id, userId }));

  // The CI of the product as a generation needs it: the configuration kept in its repository, and the pipeline file it renders to
  // (null when CI is off, here or on the host, or the host has no GitLab pipeline). A configuration that cannot be read is no reason to fail
  // a generation.
  #ciOf = async ({ git, token, product }) => {
    try {
      const [kept, onHost] = await Promise.all([
        this.productCiService.loadConfig({ git, token, projectId: product.repo.id }),
        Promise.resolve(git.pipelinesEnabled?.({ token, id: product.repo.id })).catch(() => null),
      ]);
      const config = onHost === false ? { ...kept, enabled: false } : kept;
      const file = hostOf(product) === 'gitlab' ? renderPipeline(config, properties.git) : null;
      return { config, file, wait: config.enabled && file !== null && config.waitForChecks ? config : null };
    } catch (error) {
      console.error(`[ci] product ${product._id}: its CI configuration could not be read, generating without it:`, error?.message ?? error);
      return { config: null, file: null, wait: null };
    }
  };

  // Whether the product's models are valid for its line, its feature selection above all, and the features the selection comes to.
  #computeHealth = async ({ id, userId }) => this.modularService.getProductHealth({ id, userId });

  // A new update takes over the standing request: what it waited for a person to decide is not what it holds any more.
  #supersedeDecision = (product) => Product.updateOne({ _id: product._id }, { $set: { pendingUpdate: null } });

  // The checks of an update did not pass: its merge request stays open for a person, with what recording the deployment will need then.
  // One that was rejected without asking has nothing left to decide.
  #awaitDecision = async ({ token, userId, line, product, result, merged, version, previousVersion, models, lineRef, resolved }) => {
    const composedSpec = await this.#syncProductSpecAfterGenerate({ token, userId, line, product, deployed: false, models });
    const { number, webUrl } = merged.updateMergeRequest;
    const data = JSON.stringify({ spec: composedSpec, models, lineRef, manifest: resolved ? this.modularService.productManifest({ product, resolved }) : null });
    await Product.updateOne({ _id: product._id }, { $set: { pendingUpdate: merged.rejected ? null : { number, version, data } } });
    result.conflicts = false;
    if (merged.rejected) result.checksDecision = 'reject';
    else result.checksFailed = merged.checksFailed;
    result.mergeRequest = { number, url: webUrl ?? '' };
    result.deployment = { pending: true, version: previousVersion };
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
      productId: String(product._id), lineId: String(product.lineId), userId, conflicts: false, stage: null, version,
    });
    return result;
  };

  /**
   * What a person decides about an update whose checks did not pass: `merge` takes it to the default branch all the same, and only then
   * is it what is deployed; `reject` closes its merge request, so the default branch stays as it was. Generating again offers it again.
   */
  decideUpdate = async ({ id, userId, number, decision }, log) => {
    const { git, token, projectId } = await this.#pipelineAccess({ id, userId, accessLevel: ACCESS.MAINTAINER });
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const host = hostOf(product);
    const { baseBranch, defaultBranch } = properties.git;
    const releaseLock = await takeLock(productLockId(id), 'decision', { owner: userId });
    try {
      const open = await git.listChangeRequests({ token, id: projectId, state: 'opened', targetBranch: defaultBranch });
      const request = open.find((candidate) => candidate.number === Number(number) && candidate.sourceBranch === baseBranch);
      if (!request) throw new NoPendingUpdateError();
      const pending = product.pendingUpdate?.number === request.number ? product.pendingUpdate : null;
      const version = pending?.version ?? versionOfTitle(request.title) ?? product.spec?.basicData?.version;
      const tell = async (type, message, params) => {
        const entry = { version, type, message, params, link: request.webUrl };
        await log(entry);
        return { ...entry, createdAt: new Date() };
      };
      const settle = () => Product.updateOne({ _id: product._id }, { $set: { pendingUpdate: null } });

      if (decision === 'reject') {
        await git.updateMergeRequest({ token, id: projectId, number: request.number, changes: { state: 'closed' } });
        await settle();
        const deployed = await this.productSpecService.readDeployed({ token, host, productProjectId: projectId }).catch(() => null);
        const entry = await tell('warning', 'log.update_rejected', [version]);
        return { decision, version, log: entry, deployment: { pending: true, version: deployed?.version ?? null } };
      }

      const conflicts = await git.mergeChangeRequest({ token, id: projectId, number: request.number, deleteSourceBranch: false });
      if (conflicts) {
        const entry = await tell('warning', 'log.conflicts_merge_request', [baseBranch, defaultBranch]);
        return { decision, version, conflicts: true, log: entry, mergeRequest: { number: request.number, url: request.webUrl ?? '' } };
      }
      const entry = await tell('success', 'log.merged_merge_request', [baseBranch, defaultBranch]);
      await settle();
      const stored = pending ? JSON.parse(pending.data) : {};
      try {
        const line = await this.lineRepository.findById(product.lineId);
        const spec = stored.spec ?? await this.#composedSpecOf({ token, userId, line, product });
        const models = stored.models ?? await this.modularService.storedModels({ token, host, productProjectId: projectId }).catch(() => ({}));
        await this.productSpecService.writeDeployed({ token, host, productProjectId: projectId, spec: normalizeProductSpec({ spec }), models, lineRef: stored.lineRef ?? null, lineVersion: line?.version ?? null });
        if (stored.manifest) await this.modularService.writeProductManifest({ token, product, manifest: stored.manifest });
      } catch (recordError) {
        logSpecWriteFailure(`decideUpdate: product ${product._id} merged but its deployment record could not be written`, recordError);
      }
      domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, {
        productId: String(product._id), lineId: String(product.lineId), userId, conflicts: false, stage: null, version,
      });
      return { decision, version, log: entry, deployment: { pending: false, version } };
    } finally {
      await releaseLock();
      forgetProduct(id);
    }
  };

  // The pipeline the last commit of the product started: its jobs, and what the failed one printed last. Not kept: it is what
  // the dialog that follows a generation asks every few seconds.
  getProductPipeline = async ({ id, userId }) => {
    const { git, token, projectId, ref } = await this.#pipelineAccess({ id, userId });
    const pipeline = await this.#latestPipeline({ git, token, projectId, ref });
    if (!pipeline) return { pipeline: null, jobs: [], failed: null };
    const jobs = pipeline.id === undefined ? [] : await git.getPipelineJobs({ token, id: projectId, pipelineId: pipeline.id }).catch(() => []);
    const failedJob = jobs.find((job) => job.status === 'failed');
    const trace = failedJob ? await git.getJobTrace({ token, id: projectId, jobId: failedJob.id }).catch(() => '') : '';
    return {
      pipeline,
      jobs,
      failed: failedJob ? { id: failedJob.id, name: failedJob.name, trace } : null,
    };
  }

  // The last pipelines of the repository, newest first: what the versions of the history are matched with.
  listProductPipelines = ({ id, userId }) => statuses.get(`pipelinelist|${userId}|${id}`, async () => {
    const { git, token, projectId } = await this.#pipelineAccess({ id, userId });
    return git.listPipelines({ token, id: projectId, perPage: 100 }).catch(() => []);
  });

  // The jobs of one pipeline of the product (an older one than the last).
  getProductPipelineById = async ({ id, userId, pipelineId }) => {
    const { git, token, projectId } = await this.#pipelineAccess({ id, userId });
    const jobs = await git.getPipelineJobs({ token, id: projectId, pipelineId }).catch(() => []);
    const failedJob = jobs.find((job) => job.status === 'failed');
    const trace = failedJob ? await git.getJobTrace({ token, id: projectId, jobId: failedJob.id }).catch(() => '') : '';
    return { pipeline: null, jobs, failed: failedJob ? { id: failedJob.id, name: failedJob.name, trace } : null };
  }

  // Runs the failed jobs of the last pipeline again.
  retryProductPipeline = async ({ id, userId }) => {
    const { git, token, projectId, ref } = await this.#pipelineAccess({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const pipeline = await this.#latestPipeline({ git, token, projectId, ref });
    if (!pipeline || pipeline.id === undefined) throw new NoPipelineError();
    await git.retryPipeline({ token, id: projectId, pipelineId: pipeline.id });
    return this.getProductPipeline({ id, userId });
  }

  // Stops a pipeline of the product (or one job of it) that has not finished: a check that is no longer wanted.
  cancelProductPipeline = async ({ id, userId, pipelineId }) => {
    const { git, token, projectId } = await this.#pipelineAccess({ id, userId, accessLevel: ACCESS.DEVELOPER });
    await git.cancelPipeline({ token, id: projectId, pipelineId });
    return { canceled: true };
  }

  cancelProductJob = async ({ id, userId, jobId }) => {
    const { git, token, projectId } = await this.#pipelineAccess({ id, userId, accessLevel: ACCESS.DEVELOPER });
    await git.cancelJob({ token, id: projectId, jobId });
    return { canceled: true };
  }

  #latestPipeline = async ({ git, token, projectId, ref }) => {
    const [onBranch, ofRequest] = await Promise.all([
      // a project with CI/CD off refuses to tell of its pipelines: it has none to follow
      git.getLatestPipeline({ token, id: projectId, ref }).catch((error) => {
        if (git.isAuthError?.(error)) throw error;
        return null;
      }),
      this.productCiService.latestChecksPipeline({ git, token, projectId }).catch(() => null),
    ]);
    // the checks of an update that is still waiting are what is being looked at, whatever else ran since
    if (ofRequest?.ofOpenRequest) return ofRequest;
    if (!onBranch || !ofRequest) return onBranch ?? ofRequest;
    return new Date(ofRequest.createdAt) > new Date(onBranch.createdAt) ? ofRequest : onBranch;
  }

  #pipelineAccess = async ({ id, userId, accessLevel = 20 }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({
      userId,
      repoId: product.repo.id,
      accessLevel,
    }, git);
    return { git, token: tokenFor(user, hostOf(product)), projectId: product.repo.id, ref: properties.git.defaultBranch };
  }

  getProductActivity = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({
      userId,
      repoId: product.repo.id,
      accessLevel: ACCESS.REPORTER,
    }, git);

    const token = tokenFor(user, hostOf(product));
    const projectId = product.repo.id;
    const baseBranch = properties.git.baseBranch;
    const defaultBranch = properties.git.defaultBranch;

    const [commitsResult, mrsResult, pipelinesResult, bigbangResult] = await Promise.allSettled([
      git.getCommits({ token, id: projectId, ref: defaultBranch, perPage: 10 }),
      getGenerationMergeRequests({ token, projectId, host: hostOf(product) }),
      git.getLatestPipeline({ token, id: projectId, ref: defaultBranch }),
      git.getBranch({ token, id: projectId, branch: baseBranch }),
    ]);

    const commits = commitsResult.status === 'fulfilled' ? commitsResult.value : [];
    const mrs = mrsResult.status === 'fulfilled' ? mrsResult.value : [];
    const pipeline = pipelinesResult.status === 'fulfilled' ? pipelinesResult.value : null;
    const bigbang = bigbangResult.status === 'fulfilled' ? bigbangResult.value : null;

    const conflictingMRs = mrs.filter(mr => mr.hasConflicts);

    return {
      recentCommits: commits.slice(0, 7).map(c => ({
        id: c.shortId,
        message: c.title,
        author: c.authorName,
        date: c.createdAt,
        webUrl: c.webUrl,
      })),
      lastCommit: commits[0] ? {
        id: commits[0].shortId,
        message: commits[0].title,
        author: commits[0].authorName,
        date: commits[0].createdAt,
      } : null,
      bigbangLastCommit: bigbang?.lastCommit ? {
        id: bigbang.lastCommit.shortId,
        message: bigbang.lastCommit.title,
        author: bigbang.lastCommit.authorName,
        date: bigbang.lastCommit.createdAt,
      } : null,
      openMRs: mrs.length,
      conflictingMRs: conflictingMRs.length,
      lastPipeline: pipeline ? {
        status: pipeline.status,
        ref: pipeline.ref,
        date: pipeline.createdAt,
        webUrl: pipeline.webUrl,
      } : null,
    };
  }

  getProductConflicts = ({ id, userId }) => snapshots.get(`conflicts|${userId}|${id}`, () => this.#computeConflicts({ id, userId }));

  #computeConflicts = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges(
      { userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER },
      git
    );
    const mrs = await getGenerationMergeRequests({
      token: tokenFor(user, hostOf(product)),
      projectId: product.repo.id,
    });
    const conflicting = mrs.filter(mr => mr.hasConflicts)
    return { openMRs: mrs.length, conflictingMRs: conflicting.length, firstConflictNumber: conflicting[0]?.number ?? null };
  }

  /**
   * Whether each of these products is valid and how many change requests of its are open, in one answer: what a list of products shows
   * next to each of them. One that cannot be read says so with `valid: null` instead of failing the rest.
   */
  // What a list needs to say which products have saved changes that no generation has deployed: little per product (the record of
  // the last generation and the saved spec; the models only when the spec did not already differ), and kept for a short time.
  #computeDeployment = async ({ id, userId }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges(
      { userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git,
    );
    const token = tokenFor(user, hostOf(product));
    const [deployed, resolved] = await Promise.all([
      this.productSpecService.readDeployed({ token, host: hostOf(product), productProjectId: product.repo.id }),
      this.productSpecService.getSpecFromHostOrCache({
        token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
        context: `getProductsDeployments: product ${product._id}`,
      }),
    ]);
    const status = await this.#deploymentOf({ token, product, deployed, spec: resolved.spec });
    return { pending: status.pending, version: status.version, restorable: status.restorable, modelsChanged: status.modelsChanged, changedModels: status.changedModels ?? [], specChanged: status.specChanged ?? null };
  };

  getProductsDeployments = async ({ ids, userId }) => {
    const entries = await mapLimit(ids, STATUS_CONCURRENCY, async (id) => {
      try {
        return [id, await snapshots.get(`deployment|${userId}|${id}`, () => this.#computeDeployment({ id, userId }))];
      } catch {
        // a product that cannot be read is "unknown", not a list that fails
        return [id, { pending: null, version: null, restorable: false }];
      }
    });
    return Object.fromEntries(entries);
  };

  // What a change made outside this service (the models) has to tell it: what it kept about the product is no longer true.
  forgetStatuses = (id) => forgetProduct(id);

  getProductsDeletable = async ({ ids, userId }) => {
    const entries = await mapLimit(ids, STATUS_CONCURRENCY, async (id) => {
      try {
        const product = await this.productRepository.findById(id);
        if (!product) throw new ProductNotFoundError();
        return [id, await this.permissionChecker.hasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.OWNER }, getGitProvider({ host: hostOf(product) }))];
      } catch {
        return null;
      }
    });
    return Object.fromEntries(entries.filter(Boolean));
  };

  // `features`: the features each product's selection comes to, for the pages that compare products (they used to ask for each product's health apart)
  getProductsStatus = async ({ ids, userId, features = false }) => {
    const lastGenerations = await this.logRepository.findLastOutcomeByProductIds(ids).catch(() => ({}));
    const entries = await mapLimit(ids, STATUS_CONCURRENCY, async (id) => {
      const [health, conflicts] = await Promise.allSettled([
        this.getProductHealth({ id, userId }),
        this.getProductConflicts({ id, userId }),
      ]);
      return [id, {
        health: health.status === 'fulfilled'
          ? { valid: health.value.valid, error: health.value.error, errorType: health.value.errorType, ...(features ? { features: health.value.features ?? [] } : {}) }
          : { valid: null },
        conflicts: conflicts.status === 'fulfilled' ? conflicts.value : { openMRs: 0, conflictingMRs: 0 },
        lastGeneration: lastGenerations[String(id)] ?? null,
      }];
    });
    return Object.fromEntries(entries);
  };

  /** The state of the last pipeline of each of these products (one call to the git host each, kept for a short while). */
  getProductsPipelines = async ({ ids, userId }) => {
    const entries = await mapLimit(ids, STATUS_CONCURRENCY, async (id) => {
      try {
        const pipeline = await statuses.get(`pipeline|${userId}|${id}`, async () => {
          const product = await this.productRepository.findById(id);
          if (!product) throw new ProductNotFoundError();
          const git = getGitProvider({ host: hostOf(product) });
          const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.REPORTER }, git);
          return git.getLatestPipeline({ token: tokenFor(user, hostOf(product)), id: product.repo.id, ref: properties.git.defaultBranch });
        });
        return [id, { status: pipeline?.status ?? null, webUrl: pipeline?.webUrl ?? null }];
      } catch {
        return [id, { status: null, webUrl: null }];
      }
    });
    return Object.fromEntries(entries);
  };
}

Container.set(ProductService, new ProductService());