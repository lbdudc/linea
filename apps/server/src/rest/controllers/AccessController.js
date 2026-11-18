import { Container } from 'typedi';
import AccessService from '../../model/services/AccessService.js';
import { asyncHandler } from '../common/asyncHandler.js';

/** Who has access to the repositories of a line and its products on the git host, and what LINEA writes there. */
export default class AccessController {
  accessService = Container.get(AccessService);

  line = asyncHandler(async (req, res) => {
    res.status(200).send(await this.accessService.line({ id: req.params.id, userId: req.userId }));
  });

  setLine = asyncHandler(async (req, res) => {
    const result = await this.accessService.setLine({ id: req.params.id, userId: req.userId, username: req.params.username, level: req.body.role, ip: req.ip });
    res.status(200).send({ ...result, access: await this.accessService.line({ id: req.params.id, userId: req.userId }) });
  });

  removeLine = asyncHandler(async (req, res) => {
    const result = await this.accessService.removeLine({ id: req.params.id, userId: req.userId, username: req.params.username, ip: req.ip });
    res.status(200).send({ ...result, access: await this.accessService.line({ id: req.params.id, userId: req.userId }) });
  });

  reapplyLine = asyncHandler(async (req, res) => {
    const result = await this.accessService.reapply({ id: req.params.id, userId: req.userId, removeUnknown: req.body?.removeUnknown === true, ip: req.ip });
    res.status(200).send({ ...result, access: await this.accessService.line({ id: req.params.id, userId: req.userId }) });
  });

  users = asyncHandler(async (req, res) => {
    res.status(200).send(await this.accessService.searchUsers({ id: req.params.id, userId: req.userId, query: req.query.q }));
  });

  product = asyncHandler(async (req, res) => {
    res.status(200).send(await this.accessService.product({ id: req.params.id, userId: req.userId }));
  });

  setProduct = asyncHandler(async (req, res) => {
    await this.accessService.setProduct({ id: req.params.id, userId: req.userId, username: req.params.username, level: req.body.role, ip: req.ip });
    res.status(200).send(await this.accessService.product({ id: req.params.id, userId: req.userId }));
  });

  clearProduct = asyncHandler(async (req, res) => {
    await this.accessService.clearProduct({ id: req.params.id, userId: req.userId, username: req.params.username, ip: req.ip });
    res.status(200).send(await this.accessService.product({ id: req.params.id, userId: req.userId }));
  });
}

Container.set(AccessController, new AccessController());
