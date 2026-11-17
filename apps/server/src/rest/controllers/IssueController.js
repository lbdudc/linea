import { Container } from 'typedi';
import IssueService from '../../model/services/IssueService.js';
import { asyncHandler } from '../common/asyncHandler.js';

// `kind` is `line` or `product`: the router that mounts these says which one it is
export default class IssueController {
  issueService = Container.get(IssueService);

  #target = (req) => ({ kind: req.issueKind, id: req.params.id, userId: req.userId });

  saveTemplate = asyncHandler(async (req, res) => {
    res.status(200).send(await this.issueService.saveTemplate({ ...this.#target(req), name: req.params.name, content: req.body.content }));
  });

  deleteTemplate = asyncHandler(async (req, res) => {
    await this.issueService.deleteTemplate({ ...this.#target(req), name: req.params.name });
    res.status(204).end();
  });

  getMeta = asyncHandler(async (req, res) => {
    res.status(200).send(await this.issueService.getMeta(this.#target(req)));
  });

  list = asyncHandler(async (req, res) => {
    const { state, author, assignee, labels, milestone, search, page, perPage } = req.query;
    const filter = {
      ...(state ? { state } : {}),
      ...(author ? { author } : {}),
      ...(assignee ? { assignee } : {}),
      ...(labels ? { labels: String(labels).split(',').filter(Boolean) } : {}),
      ...(milestone ? { milestone } : {}),
      ...(search ? { search } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(perPage ? { perPage: Number(perPage) } : {}),
    };
    res.status(200).send(await this.issueService.list({ ...this.#target(req), filter }));
  });

  get = asyncHandler(async (req, res) => {
    res.status(200).send(await this.issueService.get({ ...this.#target(req), number: Number(req.params.number) }));
  });

  create = asyncHandler(async (req, res) => {
    const { title, description, labels, assignees, milestone } = req.body;
    res.status(201).send(await this.issueService.create({ ...this.#target(req), fields: { title, description, labels, assignees, milestone } }));
  });

  update = asyncHandler(async (req, res) => {
    const { title, description, labels, assignees, milestone, state } = req.body;
    // only what was sent is changed
    const changes = Object.fromEntries(Object.entries({ title, description, labels, assignees, milestone, state }).filter(([, value]) => value !== undefined));
    res.status(200).send(await this.issueService.update({ ...this.#target(req), number: Number(req.params.number), changes }));
  });

  listComments = asyncHandler(async (req, res) => {
    res.status(200).send(await this.issueService.listComments({ ...this.#target(req), number: Number(req.params.number) }));
  });

  addComment = asyncHandler(async (req, res) => {
    res.status(201).send(await this.issueService.addComment({ ...this.#target(req), number: Number(req.params.number), body: req.body.body }));
  });
}

Container.set(IssueController, new IssueController());
