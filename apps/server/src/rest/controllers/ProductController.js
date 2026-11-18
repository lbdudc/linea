import { dispatchIoError } from '../../ws/ioErrorHandlers.js';
import { Container } from 'typedi';
import ProductService from '../../model/services/ProductService.js';
import ProductCiService from '../../model/services/ProductCiService.js';
import ConflictService from '../../model/services/ConflictService.js';
import LogService from '../../model/services/LogService.js';
import LineService from '../../model/services/LineService.js';
import ModularService from '../../model/services/modules/ModularService.js';
import { asyncHandler } from '../common/asyncHandler.js';
import { pipelinesByVersion } from '../../model/services/versionPipelines.js';
import { mapLimit } from '../../model/services/recent.js';
import { normalizeProductSpec } from '@lbdudc/linea-core';
import { hostOf } from '../../model/git/hosts.js';
import { instance } from '../../config/instanceSettings.js';

const normalizeProductDefaults = (productDto) => {
  productDto.spec = normalizeProductSpec({ spec: productDto.spec });
  return productDto;
};

// The archives go as the zip itself to a client that asks for `application/zip` (a third less to send, nothing to decode in the browser),
// and as base64 text to the ones that always got that (the command line, the agents).
const sendZip = (req, res, zip) => {
  if (String(req.headers.accept ?? '').includes('application/zip')) {
    res.status(200).type('application/zip').send(zip);
  } else {
    res.status(200).send(zip.toString('base64'));
  }
};

export default class ProductController {
  productService = Container.get(ProductService);
  conflictService = Container.get(ConflictService);
  productCiService = Container.get(ProductCiService);
  lineService = Container.get(LineService);
  modularService = Container.get(ModularService);
  logService = Container.get(LogService);

  createProduct = asyncHandler(async (req, res) => {
    const product = await this.productService.createProduct({...req.body, userId: req.userId});
    res.status(200).send(product);
  });

  findProductById = asyncHandler(async (req, res) => {
    if (req.query.brief === '1') {
      res.status(200).send(normalizeProductDefaults((await this.productService.findBrief({ id: req.params.id, userId: req.userId })).toObject()));
      return;
    }
    const { product, members, line, deployment, level } = await this.productService.findProductDetails({ ...req.params, userId: req.userId });

    const productDto = normalizeProductDefaults(product.toObject());
    productDto.deployment = deployment;
    productDto.myLevel = level;
    productDto.members = members.map((member) => ({ username: member.username, role: member.accessLevel ?? member.access_level }));
    productDto.line = { id: product.lineId, name: line?.deletedName ?? line?.name ?? null, modular: Boolean(line?.modular), kind: line?.kind, deleted: !line || Boolean(line.deletedAt) };
    productDto.delayedDeletion = this.lineService.deletesLater(product);

    res.status(200).send(productDto);
  });

  findByGitProject = asyncHandler(async (req, res) => {
    const { product, specSource, specReason } = await this.productService.findByGitProjectId({
      projectId: req.params.projectId, userId: req.userId, specFromRepo: req.query.spec === '1', host: req.query.host,
    });
    res.status(200).send({ ...normalizeProductDefaults(product.toObject()), specSource, specReason });
  });

  findEnrolledProducts = asyncHandler(async (req, res) => {
    const products = await this.productService.findEnrolledProducts({userId: req.userId});
    const lastSyncMap = await this.logService.findLastSyncByProductIds({
      productIds: products.map(p => p._id),
    });
    // the products of one line ask for the same line: one lookup each
    const lines = new Map();
    const lineOf = (lineId) => {
      const key = String(lineId);
      if (!lines.has(key)) lines.set(key, this.lineService.describeLineOfProduct({ lineId, userId: req.userId }));
      return lines.get(key);
    };
    const productsDto = await Promise.all(products.map(async p => {
      // a line that cannot be looked up (stale repoId, deleted project, etc.) is no reason to hide the product
      const { name: lineName, deleted: lineDeleted } = await lineOf(p.lineId);
      return {
        _id: p._id,
        name: p.spec.basicData.name,
        version: p.spec.basicData.version,
        line: lineName,
        lineId: p.lineId,
        lineDeleted,
        delayedDeletion: this.lineService.deletesLater(p),
        createdAt: p.spec.basicData.createdAt,
        lastSyncAt: lastSyncMap[String(p._id)] ?? null,
        repo: p.repo,
        gitHost: hostOf(p)
      };
    }));
    res.status(200).send(productsDto);
  });

  restoreProduct = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineService.restoreProduct({ repoId: req.body.repoId, userId: req.userId }));
  });

  findInactiveProducts = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineService.findInactiveProducts({ userId: req.userId }));
  });

  deleteProduct = asyncHandler(async (req, res) => {
    await this.productService.deleteProduct({...req.params, userId: req.userId});
    res.sendStatus(204);
  });

  updateProduct = asyncHandler(async (req, res) => {
    const product = await this.productService.updateProduct({...req.body, ...req.params, userId: req.userId});
    const productDto = normalizeProductDefaults(product.toObject());
    productDto.deployment = product.$locals?.deployment;
    if (product.$locals?.modelImport) productDto.modelImport = product.$locals.modelImport;
    res.status(200).send(productDto);
  });

  getProductDeployment = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductDeployment({ ...req.params, userId: req.userId }));
  });

  listProductVersions = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.listProductVersions({ id: req.params.id, userId: req.userId }));
  });

  getProductVersion = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductVersion({
      ...req.params, previous: req.query.previous, userId: req.userId,
    }));
  });

  downloadVersionZip = asyncHandler(async (req, res) => {
    const zip = await this.productService.downloadVersionZip({ ...req.params, userId: req.userId });
    sendZip(req, res, zip);
  });

  downloadGenerationBundle = asyncHandler(async (req, res) => {
    const zip = await this.productService.generationBundle({ ...req.params, userId: req.userId });
    sendZip(req, res, zip);
  });

  getConflicts = asyncHandler(async (req, res) => {
    res.status(200).send(await this.conflictService.getConflicts({ id: req.params.id, userId: req.userId }));
  });

  resolveConflicts = asyncHandler(async (req, res) => {
    res.status(200).send(await this.conflictService.resolveConflicts({
      id: req.params.id, userId: req.userId, number: req.params.number, resolutions: req.body?.resolutions,
    }));
  });

  restoreVersion = asyncHandler(async (req, res) => {
    const product = await this.productService.discardSavedSpec({
      id: req.params.id, version: req.params.version, parts: req.body?.parts, userId: req.userId,
    });
    const productDto = normalizeProductDefaults(product.toObject());
    productDto.deployment = product.$locals?.deployment;
    res.status(200).send(productDto);
  });

  discardSavedSpec = asyncHandler(async (req, res) => {
    const product = await this.productService.discardSavedSpec({ ...req.params, parts: req.body?.parts, userId: req.userId });
    const productDto = normalizeProductDefaults(product.toObject());
    productDto.deployment = product.$locals?.deployment;
    res.status(200).send(productDto);
  });

  renameProduct = asyncHandler(async (req, res) => {
    const product = await this.productService.renameProduct({...req.body, ...req.params, userId: req.userId});
    res.status(200).send(product);
  });

  decideProductUpdate = asyncHandler(async (req, res) => {
    const answer = await this.productService.decideUpdate({ id: req.params.id, number: req.params.number, decision: req.body.decision, userId: req.userId }, async (event) => {
      const now = new Date();
      req.app.get('io').to(req.userId).emit('generation', { ...event, createdAt: now });
      await this.logService.createLog({ ...event, createdAt: now, userId: req.userId, productId: req.params.id });
    });
    res.status(200).send(answer);
  });

  generateProduct = async (req, res, next) => {
    try {
      let stepStartedAt = Date.now();
      const product = await this.productService.generateProduct({...req.params, bump: req.body?.bump, userId: req.userId}, async event => {
        const now = new Date();
        const durationMs = now.getTime() - stepStartedAt;
        stepStartedAt = now.getTime();
        req.app.get('io').to(req.userId).emit('generation', {...event, productId: req.params.id, durationMs, createdAt: now});
        await this.logService.createLog({...event, durationMs, createdAt: now, userId: req.userId, productId: req.params.id});
      });
      res.status(200).send(product);
    } catch (error) {
      dispatchIoError(error, req);
      next(error);
    }
  };

  getModels = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.getProductModels({ id: req.params.id, userId: req.userId, summary: req.query.summary === 'true' }));
  });

  // `?ids=a,b,c`: the same product ids a list shows, so one request stands for what used to be one per product and kind
  #idsOf = (req) => [...new Set(String(req.query.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 40);

  getProductsDeletable = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductsDeletable({ ids: this.#idsOf(req), userId: req.userId }));
  });

  getProductsStatus = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductsStatus({ ids: this.#idsOf(req), userId: req.userId, features: req.query.features === 'true' }));
  });

  getGenerationSettings = asyncHandler(async (req, res) => {
    res.status(200).send({ concurrency: instance('generationConcurrency') });
  });

  cancelGeneration = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.cancelGeneration({ id: req.params.id, userId: req.userId }));
  });

  previewGeneration = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.previewGeneration({ id: req.params.id, bump: req.body?.bump, userId: req.userId }));
  });

  getProductsDeployments = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductsDeployments({ ids: this.#idsOf(req), userId: req.userId }));
  });

  // health + pending changes (+ the last pipeline with `?with=pipelines`) of the same ids in one request: the side bar and the lists asked for the three apart
  getProductsSummary = asyncHandler(async (req, res) => {
    const ids = this.#idsOf(req);
    const withPipelines = String(req.query.with ?? '').split(',').includes('pipelines');
    const [status, deployments, pipelines] = await Promise.all([
      this.productService.getProductsStatus({ ids, userId: req.userId }),
      this.productService.getProductsDeployments({ ids, userId: req.userId }),
      withPipelines ? this.productService.getProductsPipelines({ ids, userId: req.userId }) : undefined,
    ]);
    res.status(200).send({ status, deployments, ...(withPipelines ? { pipelines } : {}) });
  });

  getProductsPipelines = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.getProductsPipelines({ ids: this.#idsOf(req), userId: req.userId }));
  });

  saveModel = asyncHandler(async (req, res) => {
    const { id, metamodel } = req.params;
    const saved = await this.modularService.saveProductModel({ id, metamodel, content: req.body.content, layouts: req.body.layouts, userId: req.userId });
    // the features of the spec index the selection: they follow it
    if (Array.isArray(saved.features)) await this.productService.setFeatures({ id, userId: req.userId, features: saved.features });
    // the product has something saved that no generation has deployed, if it was a change: the lists must not keep saying otherwise
    this.productService.forgetStatuses(id);
    res.status(200).send(saved);
  });

  /** Saves the feature selection of a product given as feature names (see ModularService.saveProductSelection). */
  saveSelection = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const saved = await this.modularService.saveProductSelection({ id, features: req.body.features, userId: req.userId });
    if (Array.isArray(saved.features)) await this.productService.setFeatures({ id, userId: req.userId, features: saved.features });
    this.productService.forgetStatuses(id);
    res.status(200).send(saved);
  });

  saveLayouts = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.saveProductLayouts({ id: req.params.id, layouts: req.body.layouts, userId: req.userId }));
  });

  checkModels = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.checkProductModels({ id: req.params.id, models: req.body?.models, userId: req.userId }));
  });

  syncModels = asyncHandler(async (req, res) => {
    const synced = await this.modularService.syncProductModels({ id: req.params.id, userId: req.userId });
    // the models are what the product's saved state is made of: what the lists say about undeployed changes may be different now
    this.productService.forgetStatuses(req.params.id);
    res.status(200).send(synced);
  });

  getProductHealth = asyncHandler(async (req, res) => {
    const health = await this.productService.getProductHealth({ ...req.params, userId: req.userId });
    res.status(200).send(health);
  });

  getProductActivity = asyncHandler(async (req, res) => {
    const activity = await this.productService.getProductActivity({...req.params, userId: req.userId});
    res.status(200).send(activity);
  });

  // CI/CD of the product: its pipeline configuration, its runners, and the merge requests of its generations with their checks
  getProductCi = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.getCi({ id: req.params.id, userId: req.userId }));
  });

  saveProductCi = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.saveCi({ id: req.params.id, userId: req.userId, config: req.body }));
  });

  setProductCiRunners = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.setInstanceRunners({ id: req.params.id, userId: req.userId, enabled: req.body.instanceRunners }));
  });

  listProductMergeRequests = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.listMergeRequests({ id: req.params.id, userId: req.userId }));
  });

  getLatestProductMergeRequest = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.getLatestMergeRequest({ id: req.params.id, userId: req.userId }));
  });

  getProductJobTrace = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productCiService.getJobTrace({ id: req.params.id, userId: req.userId, jobId: req.params.jobId, lines: req.query.lines }));
  });

  getProductMergeRequest = asyncHandler(async (req, res) => {
    const request = await this.productCiService.getMergeRequest({ id: req.params.id, userId: req.userId, number: req.params.number });
    if (!request) return res.status(404).json({ error: 'error_messages.merge_request_not_found' });
    res.status(200).send(request);
  });

  getProductPipeline = asyncHandler(async (req, res) => {
    const pipeline = await this.productService.getProductPipeline({ ...req.params, userId: req.userId });
    res.status(200).send(pipeline);
  });

  // { [version]: pipeline } for the versions of the history that have one
  #versionPipelinesOf = async ({ id, userId }) => {
    const [pipelines, deployed] = await Promise.all([
      this.productService.listProductPipelines({ id, userId }),
      this.logService.findDeployments({ productId: id, rowsPerPage: 200 }),
    ]);
    return pipelinesByVersion({ deployments: deployed.rows ?? [], pipelines });
  };

  getVersionPipelines = asyncHandler(async (req, res) => {
    res.status(200).send(await this.#versionPipelinesOf({ id: req.params.id, userId: req.userId }));
  });

  // { [productId]: { [version]: pipeline } } for several products in one request (a product that cannot be read has none)
  getProductsVersionPipelines = asyncHandler(async (req, res) => {
    const ids = this.#idsOf(req);
    const entries = await mapLimit(ids, 6, async (id) => {
      try {
        return [id, await this.#versionPipelinesOf({ id, userId: req.userId })];
      } catch (error) {
        console.error(`[ProductController] the version pipelines of product ${id} could not be read:`, error);
        return [id, {}];
      }
    });
    res.status(200).send(Object.fromEntries(entries));
  });

  getProductPipelineById = asyncHandler(async (req, res) => {
    const answer = await this.productService.getProductPipelineById({ ...req.params, userId: req.userId });
    res.status(200).send(answer);
  });

  retryProductPipeline = asyncHandler(async (req, res) => {
    const pipeline = await this.productService.retryProductPipeline({ ...req.params, userId: req.userId });
    res.status(200).send(pipeline);
  });

  cancelProductPipeline = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.cancelProductPipeline({ ...req.params, userId: req.userId }));
  });

  cancelProductJob = asyncHandler(async (req, res) => {
    res.status(200).send(await this.productService.cancelProductJob({ ...req.params, userId: req.userId }));
  });

  getProductConflicts = asyncHandler(async (req, res) => {
    const conflicts = await this.productService.getProductConflicts({ ...req.params, userId: req.userId });
    res.status(200).send(conflicts);
  });

  generateZip = asyncHandler(async (req, res) => {
    const zip = await this.productService.generateZip({...req.body, ...req.params, userId: req.userId});
    sendZip(req, res, zip);
  });

  reconcileProducts = asyncHandler(async (req, res) => {
    const prune = req.query.prune === 'true';
    const result = await this.productService.reconcileProducts({ userId: req.userId, prune });
    res.status(200).json(result);
  });
}

Container.set(ProductController, new ProductController());
