import express from 'express';
import { Container } from 'typedi';
import { requireAdmin } from '../common/auth.js';
import HealthController from '../controllers/HealthController.js';

const healthRouter = express.Router();
const healthController = Container.get(HealthController);

healthRouter.get('/', healthController.live);
healthRouter.get('/ready', healthController.ready);
healthRouter.get('/details', requireAdmin, healthController.details);

export default healthRouter;
