import express from 'express';
import { requireAuth } from '../common/auth.js';
import { Container } from 'typedi';
import LogController from '../controllers/LogController.js';

const logRouter = express.Router();
const logController = Container.get(LogController);

logRouter.get('/metrics', requireAuth, logController.getMetrics);
logRouter.get('/deployments', requireAuth, logController.listDeployments);
logRouter.get('/:id/versions', requireAuth, logController.findVersions);
logRouter.get('/:id/:version', requireAuth, logController.find);

export default logRouter;