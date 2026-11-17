import { Container } from 'typedi';
import ReleaseService from '../../model/services/ReleaseService.js';
import { asyncHandler } from '../common/asyncHandler.js';

// `kind` is 'line' or 'product': the router that mounts the handlers says which
export default class ReleaseController {
  releaseService = Container.get(ReleaseService);

  for = (kind) => ({
    list: asyncHandler(async (req, res) => {
      res.status(200).send(await this.releaseService.list({ kind, id: req.params.id, userId: req.userId }));
    }),
    get: asyncHandler(async (req, res) => {
      res.status(200).send(await this.releaseService.get({ kind, id: req.params.id, userId: req.userId, version: req.params.version }));
    }),
    retry: asyncHandler(async (req, res) => {
      res.status(200).send(await this.releaseService.retry({ kind, id: req.params.id, userId: req.userId, version: req.params.version }));
    }),
    backfill: asyncHandler(async (req, res) => {
      res.status(200).send(await this.releaseService.backfill({ kind, id: req.params.id, userId: req.userId }));
    }),
  });
}

Container.set(ReleaseController, new ReleaseController());
