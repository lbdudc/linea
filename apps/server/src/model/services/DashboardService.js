import { Container } from "typedi";
import LineService from "./LineService.js";
import ProductService from "./ProductService.js";
import LogRepository from "../repositories/LogRepository.js";
import { byDay, byLine, byMonth, staleness, topFailing, windows } from "./dashboardMetrics.js";

const MAX_DAYS = 365;
const RECENT_ROWS = 8;
const MONTHS = 6;

/**
 * The numbers of the home page in one answer, for what the user can see: their enrolled lines and products, and the
 * deployments logged for them. Health and CI are not here: they need one call to the git host per product, so the page
 * loads them on its own.
 */
export default class DashboardService {
  lineService = Container.get(LineService);
  productService = Container.get(ProductService);
  logRepository = Container.get(LogRepository);

  getSummary = async ({ userId, days = 14, lineId = null, now = Date.now(), tzOffsetMinutes = 0 }) => {
    const window = Math.min(Math.max(parseInt(days, 10) || 14, 1), MAX_DAYS);

    const [lines, products] = await Promise.all([
      this.lineService.findEnrolledLines({ userId }),
      this.productService.findEnrolledProducts({ userId }),
    ]);
    // with a `lineId` the summary is the one of that line: the same figures, for its products only
    const only = lineId ? String(lineId) : null
    const liveLines = lines.filter((l) => !l.archived && (!only || String(l._id) === only))
    const liveProducts = products.filter((p) => !p.archived && (!only || String(p.lineId) === only))

    const scope = {
      lineIds: liveLines.map((l) => l._id),
      productIds: liveProducts.map((p) => p._id),
    };

    // far enough back for the window, the window before it (to compare) and the months of the trend
    const monthsStart = new Date(now);
    monthsStart.setUTCMonth(monthsStart.getUTCMonth() - (MONTHS - 1), 1);
    monthsStart.setUTCHours(0, 0, 0, 0);
    const from = Math.min(now - 2 * window * 24 * 60 * 60 * 1000, monthsStart.getTime());

    const [deployments, lastSyncById, recent] = await Promise.all([
      this.logRepository.findDeploymentOutcomes({ scope, from }),
      this.logRepository.findLastSyncByProductIds(scope.productIds),
      this.logRepository.findDeployments({ scope, page: 1, rowsPerPage: RECENT_ROWS }),
    ]);

    const { current, previous, start, end } = windows(deployments, { days: window, now });
    const lineNames = new Map(liveLines.map((l) => [String(l._id), l.name]));
    const productInfo = new Map(liveProducts.map((p) => [
      String(p._id),
      { name: p.spec?.basicData?.name, lineName: lineNames.get(String(p.lineId)) ?? null },
    ]));
    const productLine = new Map(liveProducts.map((p) => [String(p._id), String(p.lineId)]));
    const stale = staleness({ products: liveProducts, lastSyncById, now });

    return {
      days: window,
      lines: {
        total: liveLines.length,
        modular: liveLines.filter((l) => l.kind === 'modular').length,
        project: liveLines.filter((l) => l.kind === 'project').length,
        archived: lines.length - liveLines.length,
      },
      products: {
        total: liveProducts.length,
        staleness: {
          recent: stale.recent,
          stale7: stale.stale7,
          stale30: stale.stale30,
          stale90: stale.stale90,
          never: stale.never,
        },
        stalest: stale.stalest.map((p) => ({ ...p, lineName: lineNames.get(String(p.lineId)) ?? null })),
      },
      deployments: {
        current,
        previous,
        byMonth: byMonth(deployments, { months: MONTHS, now }),
        byDay: byDay(deployments, { days: window, now, tzOffsetMinutes }),
        byLine: byLine(deployments, { productLine, lineNames, from: start, to: end }),
        topFailing: topFailing(deployments, { products: productInfo, from: start, to: end }),
      },
      recent: recent.rows,
    };
  };
}

Container.set(DashboardService, new DashboardService());
