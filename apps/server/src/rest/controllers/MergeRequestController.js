import { Container } from 'typedi';
import MergeRequestService from '../../model/services/MergeRequestService.js';
import { asyncHandler } from '../common/asyncHandler.js';

// `kind` is `line` or `product`: the router that mounts these says which one it is
export default class MergeRequestController {
  service = Container.get(MergeRequestService);

  #target = (req) => ({ kind: req.mergeRequestKind, id: req.params.id, host: req.query.host, userId: req.userId });
  #number = (req) => Number(req.params.number);

  saveTemplate = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.saveTemplate({ ...this.#target(req), name: req.params.name, content: req.body.content }));
  });

  deleteTemplate = asyncHandler(async (req, res) => {
    await this.service.deleteTemplate({ ...this.#target(req), name: req.params.name });
    res.status(204).end();
  });

  getMeta = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.getMeta(this.#target(req)));
  });

  list = asyncHandler(async (req, res) => {
    const { state, author, reviewer, labels, search, sourceBranch, targetBranch, page, perPage, origin } = req.query;
    const filter = {
      ...(state ? { state } : {}), ...(author ? { author } : {}), ...(reviewer ? { reviewer } : {}),
      ...(labels ? { labels: String(labels).split(',').filter(Boolean) } : {}), ...(search ? { search } : {}),
      ...(sourceBranch ? { sourceBranch } : {}), ...(targetBranch ? { targetBranch } : {}),
      ...(page ? { page: Number(page) } : {}), ...(perPage ? { perPage: Number(perPage) } : {}),
    };
    res.status(200).send(await this.service.list({ ...this.#target(req), filter, origin: origin ?? 'all' }));
  });

  get = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.get({ ...this.#target(req), number: this.#number(req) }));
  });

  create = asyncHandler(async (req, res) => {
    const { title, description, sourceBranch, targetBranch, labels, reviewers } = req.body;
    res.status(201).send(await this.service.create({ ...this.#target(req), fields: { title, description, sourceBranch, targetBranch, labels, reviewers } }));
  });

  update = asyncHandler(async (req, res) => {
    const { title, description, labels, reviewers, state } = req.body;
    const changes = Object.fromEntries(Object.entries({ title, description, labels, reviewers, state }).filter(([, value]) => value !== undefined));
    res.status(200).send(await this.service.update({ ...this.#target(req), number: this.#number(req), changes }));
  });

  diff = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.diff({ ...this.#target(req), number: this.#number(req) }));
  });

  threads = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.threads({ ...this.#target(req), number: this.#number(req) }));
  });

  comment = asyncHandler(async (req, res) => {
    const { body, position, threadId } = req.body;
    res.status(201).send(await this.service.comment({ ...this.#target(req), number: this.#number(req), body, position, threadId }));
  });

  resolve = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.resolve({ ...this.#target(req), number: this.#number(req), threadId: req.params.threadId, resolved: Boolean(req.body.resolved) }));
  });

  merge = asyncHandler(async (req, res) => {
    const { squash, deleteSourceBranch, message } = req.body ?? {};
    const outcome = await this.service.merge({ ...this.#target(req), number: this.#number(req), options: { squash: Boolean(squash), deleteSourceBranch: Boolean(deleteSourceBranch), ...(message ? { message } : {}) } });
    res.status(outcome.merged ? 200 : 409).send(outcome);
  });

  approve = asyncHandler(async (req, res) => {
    await this.service.approve({ ...this.#target(req), number: this.#number(req) });
    res.status(200).send({ approved: true });
  });
}

Container.set(MergeRequestController, new MergeRequestController());
