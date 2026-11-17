import { Container } from 'typedi';
import NotificationService from '../../model/services/NotificationService.js';
import { asyncHandler } from '../common/asyncHandler.js';

export default class NotificationController {
  service = Container.get(NotificationService);

  list = asyncHandler(async (req, res) => {
    const { unread, page } = req.query;
    res.status(200).send(await this.service.list({ userId: req.userId, unread: unread === 'true', page: page ? Number(page) : 1 }));
  });

  markRead = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.markRead({ userId: req.userId, ids: req.body?.ids }));
  });

  remove = asyncHandler(async (req, res) => {
    res.status(200).send(await this.service.remove({ userId: req.userId, id: req.params.id }));
  });
}

Container.set(NotificationController, new NotificationController());
