import express from 'express';
import { Container } from 'typedi';
import MigrationController from '../controllers/MigrationController.js';
import { requireAuth } from '../common/auth.js';
import { impactValidator } from '../validators/migrationValidators.js';

const migrationRouter = express.Router();
const migrationController = Container.get(MigrationController);

migrationRouter.get('/lines/:lineId/status', requireAuth, migrationController.status);
migrationRouter.post('/lines/:lineId/impact', requireAuth, impactValidator, migrationController.impact);

export default migrationRouter;
