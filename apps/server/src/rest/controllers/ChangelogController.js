import { Container } from 'typedi';
import ChangelogService from '../../model/services/ChangelogService.js';
import { asyncHandler } from '../common/asyncHandler.js';

const text = (value) => (typeof value === 'string' ? value : undefined);

export default class ChangelogController {
  changelogService = Container.get(ChangelogService);

  line = asyncHandler(async (req, res) => {
    res.status(200).send(await this.changelogService.line({ id: req.params.id, userId: req.userId, from: text(req.query.from), to: text(req.query.to) }));
  });

  product = asyncHandler(async (req, res) => {
    const { from, to, lineFrom, lineTo } = req.query;
    res.status(200).send(await this.changelogService.product({ id: req.params.id, userId: req.userId, from: text(from), to: text(to), lineFrom: text(lineFrom), lineTo: text(lineTo) }));
  });

  packageByLocation = asyncHandler(async (req, res) => {
    res.status(200).send(await this.changelogService.packageByLocation({ location: text(req.query.location), userId: req.userId, from: text(req.query.from), to: text(req.query.to) }));
  });

  package = asyncHandler(async (req, res) => {
    res.status(200).send(await this.changelogService.package({ id: Number(req.params.id), userId: req.userId, from: text(req.query.from), to: text(req.query.to) }));
  });
}

Container.set(ChangelogController, new ChangelogController());
