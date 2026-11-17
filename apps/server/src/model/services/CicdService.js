import { Container } from 'typedi';
import LineService from './LineService.js';
import ProductService from './ProductService.js';
import LogRepository from '../repositories/LogRepository.js';
import SyncRun from '../entities/syncRun.js';
import Line from '../entities/line.js';
import { byDay, staleness, topFailing, windows } from './dashboardMetrics.js';

const MAX_DAYS = 365;
const RUNS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Every run, a generation or a sync, goes through the same steps: derive → checks → merge → deployed. The server only knows
// how far it got from what it kept; the checks of a pipeline and the open request are the host's, and the page adds them.
export const STEPS = ['derive', 'checks', 'merge', 'deployed'];

/** `stage`: the step it is at; `state`: how that step stands (`ok` when it is over, `run`, `wait`, `bad`). */
export const generationStage = ({ outcome, live = false }) => {
  if (live) return { stage: 'derive', state: 'run' };
  if (outcome === 'error') return { stage: 'derive', state: 'bad' };
  if (outcome === 'cancelled') return { stage: 'derive', state: 'stop' };
  return { stage: 'deployed', state: 'ok' };
};

export const syncStage = ({ status }) => {
  switch (status) {
    case 'running': return { stage: 'derive', state: 'run' };
    case 'failed': return { stage: 'derive', state: 'bad' };
    case 'mr': return { stage: 'merge', state: 'wait' };
    case 'merged': return { stage: 'deployed', state: 'ok' };
    // nothing to bring, or only told: it stops after deriving
    default: return { stage: 'derive', state: 'ok' };
  }
};

/** The syncs outcome counted for the chart: a sync that found nothing or did its job is a success. */
const syncOutcome = (status) => (status === 'failed' ? 'error' : status === 'skipped' ? null : 'success');

/**
 * What the CI/CD views show of the generations and syncs of what the user can see: how many are waiting, running or failing, how
 * many ran each day, and the latest ones as a single list. `lineId`/`productId` narrow it to one SPL or one product.
 */
export default class CicdService {
  lineService = Container.get(LineService);
  productService = Container.get(ProductService);
  logRepository = Container.get(LogRepository);

  getOverview = async ({ userId, lineId = null, productId = null, days = 14, kind = null, now = Date.now(), tzOffsetMinutes = 0 }) => {
    const window = Math.min(Math.max(parseInt(days, 10) || 14, 1), MAX_DAYS);
    const [lines, products] = await Promise.all([
      this.lineService.findEnrolledLines({ userId }),
      this.productService.findEnrolledProducts({ userId }),
    ]);
    const liveLines = lines.filter((l) => !l.archived && (!lineId || String(l._id) === String(lineId)));
    const liveProducts = products.filter((p) => !p.archived
      && (!lineId || String(p.lineId) === String(lineId))
      && (!productId || String(p._id) === String(productId)));
    const scope = { lineIds: liveLines.map((l) => l._id), productIds: liveProducts.map((p) => p._id) };
    const ids = liveProducts.map((p) => p._id);
    const lineNames = new Map(liveLines.map((l) => [String(l._id), l.name]));
    const names = new Map(liveProducts.map((p) => [String(p._id), { name: p.spec?.basicData?.name, lineId: String(p.lineId) }]));

    const from = now - window * DAY_MS;
    const [deployments, generations, syncs, latestSyncs, lastSyncById] = await Promise.all([
      this.logRepository.findDeploymentOutcomes({ scope: { ...scope, lineIds: productId ? [] : scope.lineIds }, from }),
      this.logRepository.findDeployments({ scope: { ...scope, lineIds: productId ? [] : scope.lineIds }, productId: productId ?? undefined, lineId: lineId ?? undefined, page: 1, rowsPerPage: RUNS }),
      SyncRun.find({ productId: { $in: ids }, startedAt: { $gte: new Date(from) } }).sort({ startedAt: -1 }).limit(500).lean(),
      SyncRun.aggregate([
        { $match: { productId: { $in: ids } } },
        { $sort: { startedAt: -1 } },
        { $group: { _id: '$productId', status: { $first: '$status' }, run: { $first: '$_id' } } },
      ]),
      productId ? {} : this.logRepository.findLastSyncByProductIds(ids),
    ]);

    // the days: generations and syncs together
    const series = byDay(deployments.filter((d) => !productId || ids.some((id) => String(id) === String(d.productId))), { days: window, now, tzOffsetMinutes });
    const keyOf = (time) => {
      const d = new Date(time - tzOffsetMinutes * 60_000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    const byDate = new Map(series.map((day) => [day.date, day]));
    for (const run of syncs) {
      const outcome = syncOutcome(run.status);
      const bucket = byDate.get(keyOf(new Date(run.startedAt).getTime()));
      if (outcome && bucket) { bucket[outcome === 'error' ? 'error' : 'success']++; bucket.total++; }
    }

    const asGeneration = (row) => ({
      kind: 'generation',
      id: `g-${row.productId}-${row.version}`,
      productId: String(row.productId),
      productName: row.productName,
      lineId: row.lineId ? String(row.lineId) : null,
      lineName: row.lineName,
      version: row.version,
      outcome: row.outcome,
      at: row.deployedAt ?? row.startedAt,
      link: row.link || null,
      ...generationStage({ outcome: row.outcome }),
    });
    const asSync = (run) => ({
      kind: 'sync',
      id: `s-${run._id}`,
      productId: String(run.productId),
      productName: names.get(String(run.productId))?.name,
      lineId: String(run.lineId),
      lineName: lineNames.get(String(run.lineId)),
      version: run.version,
      lineVersion: run.lineVersion,
      status: run.status,
      files: run.files,
      // the number is what finds the request (a host without web pages, the local one, has no url for it)
      mr: run.mr?.number ? { number: run.mr.number, url: run.mr.url ?? '' } : null,
      featuresAdded: run.featuresAdded ?? [],
      featuresRemoved: run.featuresRemoved ?? [],
      reason: run.reason ?? null,
      trigger: run.trigger,
      at: run.finishedAt ?? run.startedAt,
      ...syncStage(run),
    });
    const runs = [
      ...(kind === 'sync' ? [] : generations.rows.map(asGeneration)),
      ...(kind === 'generation' ? [] : syncs.slice(0, RUNS).map(asSync)),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, RUNS);

    const deletedLines = new Set((await Line.find({ deletedAt: { $ne: null } }).select('_id').lean()).map((line) => String(line._id)));
    const syncable = (id) => !deletedLines.has(String(names.get(id)?.lineId));
    const latest = new Map(latestSyncs.map((l) => [String(l._id), l.status]));
    const inWindow = (at) => new Date(at).getTime() >= from;
    const failedGenerations = deployments.filter((d) => d.outcome === 'error' && inWindow(d.deployedAt)).length;
    const counts = {
      runningSyncs: syncs.filter((run) => run.status === 'running').length,
      awaitingMerge: [...latest.values()].filter((s) => s === 'mr').length,
      outdated: [...latest].filter(([id, s]) => s === 'drift' && syncable(id)).length,
      failed: failedGenerations + syncs.filter((run) => run.status === 'failed').length,
      products: liveProducts.length,
    };
    const outdated = [...latest].filter(([id, s]) => s === 'drift' && syncable(id)).map(([id]) => ({ productId: id, ...(names.get(id) ?? {}) }));

    // what the page shows beside the runs (how up to date the products are, which ones fail most): they used to come from a second request,
    // GET /dashboard, that aggregated the same deployments again
    const { start, end } = windows([], { days: window, now });
    const productInfo = new Map(liveProducts.map((p) => [String(p._id), { name: p.spec?.basicData?.name, lineName: lineNames.get(String(p.lineId)) ?? null }]));
    const { recent, stale7, stale30, stale90, never } = staleness({ products: liveProducts, lastSyncById, now });
    const freshness = productId ? null : { recent, stale7, stale30, stale90, never };
    const failing = productId ? [] : topFailing(deployments, { products: productInfo, from: start, to: end });

    return { days: window, counts, series, runs, outdated, freshness, topFailing: failing };
  };
}

Container.set(CicdService, new CicdService());
