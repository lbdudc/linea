import { Container } from 'typedi';
import RepositoryService from '../../model/services/RepositoryService.js';
import { asyncHandler } from '../common/asyncHandler.js';

// `kind` is `line` or `product`: the router that mounts these says which one it is
export default class RepositoryController {
  service = Container.get(RepositoryService);

  #target = (req) => ({ kind: req.repositoryKind, id: req.params.id, host: req.query.host, userId: req.userId });

  info = asyncHandler(async (req, res) => res.status(200).send(await this.service.info(this.#target(req))));
  listBranches = asyncHandler(async (req, res) => res.status(200).send(await this.service.listBranches(this.#target(req))));
  getBranch = asyncHandler(async (req, res) => res.status(200).send(await this.service.getBranch({ ...this.#target(req), branch: req.query.name })));
  createBranch = asyncHandler(async (req, res) => res.status(201).send(await this.service.createBranch({ ...this.#target(req), branch: req.body.branch, ref: req.body.ref })));
  listFiles = asyncHandler(async (req, res) => res.status(200).send(await this.service.listFiles({ ...this.#target(req), ref: req.query.ref })));
  getFile = asyncHandler(async (req, res) => {
    const file = await this.service.getFile({ ...this.#target(req), path: req.query.path, ref: req.query.ref });
    if (!file) return res.status(404).send({ error: 'file_not_found' });
    return res.status(200).send(file);
  });
  listCommits = asyncHandler(async (req, res) => res.status(200).send(await this.service.listCommits({ ...this.#target(req), ref: req.query.ref, perPage: req.query.perPage && Number(req.query.perPage) })));
  compare = asyncHandler(async (req, res) => res.status(200).send(await this.service.compare({ ...this.#target(req), from: req.query.from, to: req.query.to })));
  pushHook = asyncHandler(async (req, res) => res.status(200).send(await this.service.ensurePushHook(this.#target(req))));
  archive = asyncHandler(async (req, res) => {
    const stream = await this.service.archive({ ...this.#target(req), ref: req.query.ref });
    res.status(200).type('application/zip');
    await new Promise((resolve, reject) => {
      stream.on('error', (error) => (res.headersSent ? (res.destroy(error), resolve()) : reject(error)));
      // a client that goes away stops the host's download as well
      res.on('close', () => { if (!res.writableFinished) stream.destroy?.(); resolve(); });
      stream.pipe(res);
    });
  });
  commit = asyncHandler(async (req, res) => res.status(201).send(await this.service.commit({ ...this.#target(req), branch: req.body.branch, message: req.body.message, actions: req.body.actions })));
}

Container.set(RepositoryController, new RepositoryController());
