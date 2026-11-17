// Pure helpers behind the dashboard summary: they take deployments ({ outcome, deployedAt }) and products and know nothing
// about Mongo or the git host, so the numbers can be checked on their own.

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = ['success', 'warning', 'error'];

const monthKey = (date) => new Date(date).toISOString().slice(0, 7);
const startOfUtcDay = (date) => {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Totals of a list of deployments. Rates are whole percentages, or `null` when there is nothing to rate. */
export const summarize = (deployments) => {
  const counts = { success: 0, warning: 0, error: 0 };
  for (const d of deployments) if (d.outcome in counts) counts[d.outcome]++;
  const total = counts.success + counts.warning + counts.error;
  const rate = (n) => (total > 0 ? Math.round((n / total) * 100) : null);
  return { total, ...counts, successRate: rate(counts.success), conflictRate: rate(counts.warning) };
};

/** The deployments that ended in [from, to). */
const inWindow = (deployments, from, to) =>
  deployments.filter((d) => {
    const t = new Date(d.deployedAt).getTime();
    return t >= from && t < to;
  });

/** The current window (the last `days` days, today included) and the `days` before it, for the change between them. */
export const windows = (deployments, { days, now = Date.now() }) => {
  const end = startOfUtcDay(now) + DAY_MS;
  const start = end - days * DAY_MS;
  const before = start - days * DAY_MS;
  return {
    current: summarize(inWindow(deployments, start, end)),
    previous: summarize(inWindow(deployments, before, start)),
    start,
    end,
  };
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * One bucket per day, the last `days` of them ending with the day of `now`, oldest first. A day is the one on the wall of whoever asks:
 * `tzOffsetMinutes` is what `Date#getTimezoneOffset()` says there (minutes west of UTC), so a deployment at 23:30 local is that day.
 */
export const byDay = (deployments, { days = 14, now = Date.now(), tzOffsetMinutes = 0 } = {}) => {
  const shift = tzOffsetMinutes * 60_000;
  const keyOf = (time) => {
    const d = new Date(time - shift);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  const today = startOfUtcDay(now - shift);
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = keyOf(today + shift - i * DAY_MS + 1);
    buckets.set(key, { date: key, success: 0, warning: 0, error: 0, total: 0 });
  }
  for (const d of deployments) {
    const bucket = buckets.get(keyOf(new Date(d.deployedAt).getTime()));
    if (bucket && OUTCOMES.includes(d.outcome)) {
      bucket[d.outcome]++;
      bucket.total++;
    }
  }
  return [...buckets.values()];
};

/**
 * The deployments of [from, to) per product line, with the lines that failed most first.
 * `productLine` maps a product id to its line id; `lineNames` maps a line id to its name. Deployments of products that are
 * not in the map (deleted, or not enrolled) are left out.
 */
export const byLine = (deployments, { productLine, lineNames, from, to, limit = 8 }) => {
  const rows = new Map();
  for (const d of inWindow(deployments, from, to)) {
    const lineId = productLine.get(String(d.productId));
    if (!lineId || !OUTCOMES.includes(d.outcome)) continue;
    if (!rows.has(lineId)) rows.set(lineId, { lineId, name: lineNames.get(lineId) ?? null, success: 0, warning: 0, error: 0 });
    rows.get(lineId)[d.outcome]++;
  }
  return [...rows.values()]
    .map((r) => {
      const total = r.success + r.warning + r.error;
      return { ...r, total, successRate: total > 0 ? Math.round((r.success / total) * 100) : null };
    })
    .sort((a, b) => b.error - a.error || b.total - a.total || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
};

/**
 * The products with most failed deployments in [from, to), worst first. Only products that had a failure or a conflict count.
 * `products` maps a product id to { name, lineName }.
 */
export const topFailing = (deployments, { products, from, to, limit = 5 }) => {
  const rows = new Map();
  for (const d of inWindow(deployments, from, to)) {
    if (d.outcome !== 'error' && d.outcome !== 'warning') continue;
    const id = String(d.productId);
    const known = products.get(id);
    if (!known) continue;
    if (!rows.has(id)) rows.set(id, { productId: id, name: known.name, lineName: known.lineName ?? null, error: 0, warning: 0, total: 0 });
    rows.get(id)[d.outcome]++;
  }
  // `total` counts every deployment of the product in the window, so the failure share is honest
  const totals = new Map();
  for (const d of inWindow(deployments, from, to)) totals.set(String(d.productId), (totals.get(String(d.productId)) ?? 0) + 1);
  return [...rows.values()]
    .map((r) => ({ ...r, total: totals.get(r.productId) ?? r.error + r.warning }))
    .sort((a, b) => b.error - a.error || b.warning - a.warning || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
};

/** One bucket per month, the last `months` of them ending with the month of `now`, oldest first. */
export const byMonth = (deployments, { months = 6, now = Date.now() }) => {
  const current = new Date(now);
  const buckets = new Map();
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKey(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 1));
    buckets.set(key, { month: key, success: 0, warning: 0, error: 0 });
  }
  for (const d of deployments) {
    const bucket = buckets.get(monthKey(d.deployedAt));
    if (bucket && d.outcome in bucket) bucket[d.outcome]++;
  }
  return [...buckets.values()];
};

/**
 * How long ago each product was last synced: the newest of its own `lastSyncAt` and its last log.
 * `recent` is up to a week, `stale7` more than a week, `stale30` more than 30 days, `stale90` more than 90, `never` has no sync at all.
 */
export const staleness = ({ products, lastSyncById = {}, now = Date.now(), stalestCount = 6 }) => {
  const buckets = { recent: 0, stale7: 0, stale30: 0, stale90: 0, never: 0 };
  const dated = [];
  for (const p of products) {
    const candidates = [p.lastSyncAt, lastSyncById[String(p._id)]].filter(Boolean).map((v) => new Date(v).getTime());
    if (!candidates.length) {
      buckets.never++;
      dated.push({ product: p, at: null });
      continue;
    }
    const at = Math.max(...candidates);
    const age = (now - at) / DAY_MS;
    if (age > 90) buckets.stale90++;
    else if (age > 30) buckets.stale30++;
    else if (age > 7) buckets.stale7++;
    else buckets.recent++;
    dated.push({ product: p, at });
  }
  const stalest = dated
    .filter((d) => d.at === null || (now - d.at) / DAY_MS > 7)
    // never-synced first, then the oldest
    .sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity))
    .slice(0, stalestCount)
    .map(({ product, at }) => ({
      _id: product._id,
      name: product.spec?.basicData?.name,
      lineId: product.lineId,
      lastSyncAt: at === null ? null : new Date(at),
    }));
  return { ...buckets, stalest };
};

export { OUTCOMES };
