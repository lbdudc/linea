import express from 'express';
import { requireAuth } from '../common/auth.js';
import { Container } from 'typedi';
import DashboardController from '../controllers/DashboardController.js';

const dashboardRouter = express.Router();
const dashboardController = Container.get(DashboardController);

dashboardRouter.get('/', requireAuth, dashboardController.getSummary);

export default dashboardRouter;
