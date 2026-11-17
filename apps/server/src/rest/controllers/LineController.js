import { Container } from 'typedi';
import LineService from '../../model/services/LineService.js';
import ModularService from '../../model/services/modules/ModularService.js';
import ProductService from '../../model/services/ProductService.js';
import LogRepository from '../../model/repositories/LogRepository.js';
import { asyncHandler } from '../common/asyncHandler.js';
import { FEATURE_MODEL_PATH } from '@lbdudc/linea-core';

export default class LineController {
  lineService = Container.get(LineService);
  modularService = Container.get(ModularService);
  logRepository = Container.get(LogRepository);
  productService = Container.get(ProductService);

  createLine = asyncHandler(async (req, res) => {
    const line = await this.lineService.createLine({...req.body, userId: req.userId});
    res.status(200).send(line);
  });

  findAvailableNamespaces = asyncHandler(async (req, res) => {
    const namespaces = await this.lineService.findAvailableNamespaces({ userId: req.userId, host: req.query.host });
    res.status(200).send(namespaces);
  });

  findEnrolledLines = asyncHandler(async (req, res) => {
    const lines = await this.lineService.findEnrolledLines({userId: req.userId});
    const linesDto = await Promise.all(lines.map(async l => ({
      ...l.toObject(),
      description: truncateDescription(l.description),
      productCount: await this.lineService.findProductsCountByLineId({userId: req.userId, id: l._id})
    })));
    res.status(200).send(linesDto);
  });

  restoreLine = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineService.restoreLine({ repoId: req.body.repoId, productRepoIds: req.body.productRepoIds, userId: req.userId }));
  });

  getLinesDeletable = asyncHandler(async (req, res) => {
    const ids = [...new Set(String(req.query.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 40);
    res.status(200).send(await this.lineService.getLinesDeletable({ ids, userId: req.userId }));
  });

  findInactiveLines = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineService.findInactiveLines({ userId: req.userId }));
  });

  deleteLine = asyncHandler(async (req, res) => {
    await this.lineService.deleteLine({ ...req.params, userId: req.userId, keepProductIds: req.body?.keepProductIds ?? [] });
    res.sendStatus(204);
  });

  findLineById = asyncHandler(async (req, res) => {
    // `?brief=1`: the line alone, for a caller that does not need its members and products (those are several calls to the git host)
    if (req.query.brief === '1') {
      res.status(200).send((await this.lineService.findLineById({...req.params, userId: req.userId})).toObject());
      return;
    }
    const line = await this.lineService.findLineById({...req.params, userId: req.userId});
    const [members, products] = await Promise.all([
      this.lineService.findMembersByLineId({...req.params, userId: req.userId}),
      this.lineService.findProductsByLineId({...req.params, userId: req.userId}),
    ]);
    const lineDto = line.toObject();
    lineDto.members = members.map(member => ({
      username: member.username,
      role: member.accessLevel ?? member.access_level
    }));
    const productIds = products.map(p => p._id);
    const lastSyncMap = await this.logRepository.findLastSyncByProductIds(productIds);
    lineDto.products = products.map(({ _id, lineId, spec, repo }) => ({
      _id,
      name: spec.basicData.name,
      version: spec.basicData.version,
      createdAt: spec.basicData.createdAt,
      lastSyncAt: lastSyncMap[String(_id)] ?? null,
      lineId,
      repo
    }));
    lineDto.delayedDeletion = this.lineService.deletesLater(line);
    res.status(200).send(lineDto);
  });

  // who works on the line, as the page shows them
  #membersDto = (members) => members.map((member) => ({ username: member.username, role: member.accessLevel ?? member.access_level }));

  listMembers = asyncHandler(async (req, res) => {
    res.status(200).send(this.#membersDto(await this.lineService.findMembersByLineId({ id: req.params.id, userId: req.userId })));
  });

  setMember = asyncHandler(async (req, res) => {
    res.status(200).send(this.#membersDto(await this.lineService.setMember({ id: req.params.id, userId: req.userId, username: req.params.username, accessLevel: req.body.role })));
  });

  removeMember = asyncHandler(async (req, res) => {
    res.status(200).send(this.#membersDto(await this.lineService.removeMember({ id: req.params.id, userId: req.userId, username: req.params.username })));
  });

  listVersions = asyncHandler(async (req, res) => {
    res.status(200).send(await this.lineService.listVersions({ id: req.params.id, userId: req.userId }));
  });

  getVersion = asyncHandler(async (req, res) => {
    const previous = typeof req.query.previous === 'string' ? req.query.previous : undefined;
    res.status(200).send(await this.lineService.getVersion({ id: req.params.id, userId: req.userId, version: req.params.version, previous }));
  });

  getFeatureModel = asyncHandler(async (req, res) => {
    const file = await this.lineService.getFeatureModel({...req.params, userId: req.userId});
    res.status(200).send(file);
  });

  previewFeatureModel = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.previewLineFeatureModel({ id: req.params.id, userId: req.userId, content: req.body?.content ?? '', ...(req.body?.metamodel ? { metamodel: req.body.metamodel } : {}) }));
  });

  // UVL -> the text a line keeps its feature model in (the CLI and the agents commit what they edited as UVL). Nothing is written.
  featureModelFromUvl = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.featureModelFromUvl({ id: req.params.id, userId: req.userId, uvl: req.body.uvl }));
  });

  saveFeatureModel = asyncHandler(async (req, res) => {
    await this.lineService.saveFeatureModel({...req.params, userId: req.userId, content: req.body.content, bump: req.body.bump || undefined, metamodel: req.body.metamodel || undefined});
    res.sendStatus(204);
  });

  /**
   * POST /:id/plan-branch
   * Creates a plan working branch (or reuses an existing one if `branch` is provided)
   * and commits the proposed FM content to it. Returns { branch } so the FM editor
   * can hand it to a changeset run as `input: { origin: 'branch', branch }`.
   */
  commitFmToPlanBranch = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { content, branch: existingBranch, message } = req.body;
    if (!content) { res.status(400).send({ error: 'errors.bad_request' }); return; }

    const lineService = this.lineService;
    let branch = existingBranch;

    if (!branch) {
      // Create a new plan branch from main.
      const result = await lineService.createPlanBranch({
        id,
        userId: req.userId,
        slug: 'fm-edit',
      });
      branch = result.branch;
    }

    // the feature model is a model of the feature metamodel: its text goes in as it is
    const toCommit = content;

    await lineService.commitToPlanBranch({
      id,
      userId: req.userId,
      branch,
      actions: [{ action: 'update', file_path: FEATURE_MODEL_PATH, content: toCommit }],
      message: message ?? 'FM edit from editor',
    });

    res.status(200).send({ branch });
  });

  /** The products of a line as stored, with their spec read from the git host when `spec=1` (what a tool that analyses the family needs). */
  listProducts = asyncHandler(async (req, res) => {
    // `cut=1`: fail (503) instead of serving a stored spec when the git host cannot be read: for a caller that must not decide on a stale one
    const products = await this.lineService.findProductsByLineId({ id: req.params.id, userId: req.userId, specFromRepo: req.query.spec === '1', cutOnInfra: req.query.cut === '1' });
    res.status(200).send(products.map((product) => product.toObject()));
  });

  /** Commits file changes to a plan branch (made from main when no branch is given). */
  commitToPlanBranch = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { actions, message } = req.body;
    const branch = req.body.branch ?? (await this.lineService.createPlanBranch({ id, userId: req.userId, slug: req.body.slug })).branch;
    await this.lineService.commitToPlanBranch({ id, userId: req.userId, branch, actions, message });
    res.status(200).send({ branch });
  });

  /** Tries a derivation of the line for a configuration; nothing is created. */
  tryDerivation = asyncHandler(async (req, res) => {
    const { features, lineRef, overrides, include, zip, spec, models } = req.body;
    res.status(200).send(await this.productService.tryDerivation({ lineId: req.params.id, features, lineRef, overrides, include, zip: zip === true, spec, models, userId: req.userId }));
  });

  getTrialModels = asyncHandler(async (req, res) => {
    res.status(200).send(await this.modularService.trialModels({ id: req.params.id, userId: req.userId, ref: req.query.ref }));
  });

  checkTrialModels = asyncHandler(async (req, res) => {
    const { models, features, lineRef, overrides, spec } = req.body;
    res.status(200).send(await this.modularService.checkTrialModels({ id: req.params.id, userId: req.userId, ref: lineRef, overrides, models, features, spec }));
  });

  /** Merges a plan branch into main through a merge request. */
  mergePlanBranch = asyncHandler(async (req, res) => {
    const result = await this.lineService.mergePlanBranch({ id: req.params.id, userId: req.userId, branch: req.body.branch, title: req.body.title });
    res.status(200).send(result);
  });

  reconcileLines = asyncHandler(async (req, res) => {
    const prune = req.query.prune === 'true';
    const result = await this.lineService.reconcileLines({ userId: req.userId, prune });
    res.status(200).json(result);
  });
}

const truncateDescription = (description, limit = 64) => {
  if (!description) return '';
  return description.length > limit ? description.substring(0, limit) + '...' : description;
};

Container.set(LineController, new LineController());
