import { test, expect } from 'vitest';
import { summarize, windows, byDay, byLine, byMonth, staleness, topFailing } from '../model/services/dashboardMetrics.js';

// 2026-03-15 12:00 UTC
const NOW = Date.UTC(2026, 2, 15, 12);
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);
const dep = (outcome, ago) => ({ outcome, deployedAt: daysAgo(ago) });

test('summarize counts outcomes and rates them as whole percentages', () => {
  const s = summarize([dep('success', 0), dep('success', 0), dep('warning', 0), dep('error', 0)]);
  expect(s).toEqual({ total: 4, success: 2, warning: 1, error: 1, successRate: 50, conflictRate: 25 });
});

test('summarize has no rate when there is nothing to rate', () => {
  expect(summarize([])).toEqual({ total: 0, success: 0, warning: 0, error: 0, successRate: null, conflictRate: null });
});

test('windows splits the last N days from the N before', () => {
  const deployments = [
    dep('success', 0), dep('success', 3), dep('error', 6),          // current 7 days
    dep('success', 8), dep('warning', 10), dep('success', 13),      // previous 7 days
    dep('success', 30),                                              // neither
  ];
  const { current, previous } = windows(deployments, { days: 7, now: NOW });
  expect(current.total).toBe(3);
  expect(current.error).toBe(1);
  expect(previous.total).toBe(3);
  expect(previous.warning).toBe(1);
});

test('byMonth ends with the month of now and ignores older deployments', () => {
  const months = byMonth([dep('success', 0), dep('error', 40), dep('success', 400)], { months: 3, now: NOW });
  expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
  expect(months[2].success).toBe(1);
  expect(months[1].error).toBe(1);
  expect(months.reduce((n, m) => n + m.success + m.warning + m.error, 0)).toBe(2);
});

test('staleness buckets products and lists the stalest first, never-synced before the oldest', () => {
  const product = (id, name, lastSyncAt) => ({ _id: id, lineId: 'l1', spec: { basicData: { name } }, lastSyncAt });
  const products = [
    product('a', 'fresh', daysAgo(1)),
    product('b', 'week', daysAgo(10)),
    product('c', 'month', daysAgo(40)),
    product('d', 'quarter', daysAgo(120)),
    product('e', 'never', undefined),
    product('f', 'from-log', daysAgo(400)),
  ];
  const result = staleness({ products, lastSyncById: { f: daysAgo(2) }, now: NOW });
  expect(result).toMatchObject({ recent: 2, stale7: 1, stale30: 1, stale90: 1, never: 1 });
  expect(result.stalest.map((p) => p.name)).toEqual(['never', 'quarter', 'month', 'week']);
  expect(result.stalest[0].lastSyncAt).toBeNull();
});

test('byDay makes one bucket per day, ending today, and counts a deployment on the day of whoever looks', () => {
  const days = byDay([dep('success', 0), dep('error', 0), dep('warning', 2)], { days: 4, now: NOW });
  expect(days.map((d) => d.date)).toEqual(['2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']);
  expect(days[3]).toEqual({ date: '2026-03-15', success: 1, warning: 0, error: 1, total: 2 });
  expect(days[1]).toEqual({ date: '2026-03-13', success: 0, warning: 1, error: 0, total: 1 });
  // 23:30 UTC on the 14th is already the 15th for somebody two hours east of UTC (the browser reports -120)
  const late = [{ outcome: 'success', deployedAt: new Date(Date.UTC(2026, 2, 14, 23, 30)) }];
  expect(byDay(late, { days: 2, now: NOW, tzOffsetMinutes: 0 }).map((d) => d.total)).toEqual([1, 0]);
  expect(byDay(late, { days: 2, now: NOW, tzOffsetMinutes: -120 }).map((d) => d.total)).toEqual([0, 1]);
});

test('byLine groups the window by line, failing lines first, and skips products it does not know', () => {
  const productLine = new Map([['p1', 'a'], ['p2', 'a'], ['p3', 'b']]);
  const lineNames = new Map([['a', 'Alpha'], ['b', 'Beta']]);
  const d = (productId, outcome, ago) => ({ productId, outcome, deployedAt: daysAgo(ago) });
  const { start, end } = windows([], { days: 7, now: NOW });
  const rows = byLine(
    [d('p1', 'success', 1), d('p2', 'success', 2), d('p3', 'error', 1), d('p3', 'success', 3), d('p9', 'error', 1), d('p1', 'error', 30)],
    { productLine, lineNames, from: start, to: end },
  );
  expect(rows.map((r) => r.name)).toEqual(['Beta', 'Alpha']);
  expect(rows[0]).toMatchObject({ total: 2, error: 1, success: 1, successRate: 50 });
  expect(rows[1]).toMatchObject({ total: 2, success: 2, successRate: 100 });
});

test('topFailing lists the products with most failures in the window and ignores healthy and unknown ones', () => {
  const products = new Map([['p1', { name: 'One', lineName: 'A' }], ['p2', { name: 'Two', lineName: 'A' }], ['p3', { name: 'Three', lineName: 'B' }]]);
  const d = (productId, outcome, ago) => ({ productId, outcome, deployedAt: daysAgo(ago) });
  const { start, end } = windows([], { days: 7, now: NOW });
  const rows = topFailing(
    [d('p1', 'error', 1), d('p1', 'error', 2), d('p1', 'success', 3), d('p2', 'warning', 1), d('p3', 'success', 1), d('p9', 'error', 1), d('p2', 'error', 40)],
    { products, from: start, to: end },
  );
  expect(rows.map((r) => r.name)).toEqual(['One', 'Two']);
  expect(rows[0]).toMatchObject({ error: 2, total: 3 });
  expect(rows[1]).toMatchObject({ warning: 1, error: 0, total: 1 });
});
