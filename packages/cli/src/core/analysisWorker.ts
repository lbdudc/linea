import { analyzeLocalFeatureModel, analyzeLocalFeatureModelBdd, analyzeLocalMetric } from '@lbdudc/linea-core/workspace';

/**
 * The analysis of a feature model, in its own thread. Satisfiability, the BDD and the counting of configurations are all
 * computation, and on the thread of the window they stop it: the spinner, the keys, everything. Here they only keep this thread
 * busy, and the window goes on (see analysis.ts, which starts this and waits for its answer).
 */

export type AnalysisJob =
  | { kind: 'analyze'; dir: string; mode: 'SAT' | 'BDD' }
  | { kind: 'bdd'; dir: string }
  | { kind: 'metric'; dir: string; metric: string; mode: 'SAT' | 'BDD' };

declare const self: {
  onmessage: ((e: { data: AnalysisJob }) => void) | null;
  postMessage: (message: { ok: true; result: unknown } | { ok: false; error: string }) => void;
};

/**
 * What a thread can send is plain data. The analysis answers with what its solver built (objects with methods, sets, maps): this
 * keeps the data (numbers, bigints, strings, lists, records) and drops the rest.
 */
function plain(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  // an object of the solver's own (a feature, from the Python side) is known by its name
  const kind = Object.getPrototypeOf(value)?.constructor?.name;
  if (kind && kind !== 'Object' && kind !== 'Array' && kind !== 'Set' && kind !== 'Map') {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string') return name;
    const text = String(value);
    return text.startsWith('[object') ? undefined : text;
  }
  if (value instanceof Set) return [...value].map((v) => plain(v, seen));
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v, seen)]));
  if (Array.isArray(value)) return value.map((v) => plain(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const p = plain(v, seen);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

self.onmessage = async (e) => {
  const job = e.data;
  try {
    const result =
      job.kind === 'analyze'
        ? await analyzeLocalFeatureModel(job.dir, job.mode)
        : job.kind === 'bdd'
          ? await analyzeLocalFeatureModelBdd(job.dir)
          : await analyzeLocalMetric(job.dir, job.metric as never, job.mode);
    self.postMessage({ ok: true, result: plain(result) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message ?? String(err) });
  }
};
