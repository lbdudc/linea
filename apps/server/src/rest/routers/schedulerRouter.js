import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import { asyncHandler } from '../common/asyncHandler.js';
import AutomationService from '../../model/services/AutomationService.js';
import LineService from '../../model/services/LineService.js';
import User from '../../model/entities/user.js';
import { syncScheduler } from '../../model/services/scheduler/index.js';

const schedulerRouter = express.Router();

// What the scheduler of syncs is doing: running, queued, coming in the next day. `?lineId=` or `?productId=` is the view of one SPL or one
// product (whoever can see it); without either, an administrator sees everything and anyone else the SPLs they work on.
schedulerRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const automation = Container.get(AutomationService);
  const { lineId, productId } = req.query;
  if (productId) {
    await automation.assertProductAccess({ id: String(productId), userId: req.userId });
    return res.json(await syncScheduler().status({ productIds: [String(productId)] }));
  }
  if (lineId) {
    await automation.assertLineAccess({ id: String(lineId), userId: req.userId });
    return res.json(await syncScheduler().status({ lineIds: [String(lineId)] }));
  }
  if (await User.exists({ _id: req.userId, admin: true })) return res.json(await syncScheduler().status());
  const lines = await Container.get(LineService).findEnrolledLines({ userId: req.userId });
  res.json(await syncScheduler().status({ lineIds: lines.map((line) => String(line._id)) }));
}));

export default schedulerRouter;
