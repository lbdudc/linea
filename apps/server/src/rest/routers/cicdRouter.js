import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import { asyncHandler } from '../common/asyncHandler.js';
import CicdService from '../../model/services/CicdService.js';

const cicdRouter = express.Router();

// The generations and syncs of what the user can see (`?lineId=` an SPL, `?productId=` a product), with the counts and the days.
cicdRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const text = (value) => (typeof value === 'string' && value ? value : undefined);
  const tz = Number.parseInt(req.query.tz, 10);
  res.json(await Container.get(CicdService).getOverview({
    userId: req.userId,
    lineId: text(req.query.lineId),
    productId: text(req.query.productId),
    days: req.query.days,
    kind: ['generation', 'sync'].includes(req.query.kind) ? req.query.kind : null,
    tzOffsetMinutes: Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0,
  }));
}));

export default cicdRouter;
