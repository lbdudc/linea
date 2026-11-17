import { Container } from 'typedi';
import MigrationService from '../../model/services/MigrationService.js';
import { asyncHandler } from '../common/asyncHandler.js';

export default class MigrationController {
  migrationService = Container.get(MigrationService);

  status = asyncHandler(async (req, res) => {
    const result = await this.migrationService.status({ lineId: req.params.lineId, userId: req.userId });
    res.status(200).send(result);
  });

  impact = asyncHandler(async (req, res) => {
    const result = await this.migrationService.impact({
      lineId: req.params.lineId,
      userId: req.userId,
      content: req.body.content,
      modules: req.body.modules,
      metamodels: req.body.metamodels,
    });
    res.status(200).send(result);
  });
}

Container.set(MigrationController, new MigrationController());
