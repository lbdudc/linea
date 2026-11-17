import { Container } from "typedi";
import DashboardService from "../../model/services/DashboardService.js";
import { asyncHandler } from '../common/asyncHandler.js';

export default class DashboardController {
  dashboardService = Container.get(DashboardService);

  getSummary = asyncHandler(async (req, res) => {
    const tz = Number.parseInt(req.query.tz, 10);
    const summary = await this.dashboardService.getSummary({
      userId: req.userId,
      days: req.query.days,
      // only the numbers of one line, when the page is the one of that line
      lineId: typeof req.query.lineId === 'string' && req.query.lineId ? req.query.lineId : undefined,
      // minutes west of UTC, as the browser reports them: a day is the one on the wall of whoever looks at the chart
      tzOffsetMinutes: Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0,
    });
    res.status(200).send(summary);
  });
}

Container.set(DashboardController, new DashboardController());
