import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// Where the time of a request went, in the `Server-Timing` header (the browser's network panel shows it) and, for a slow one, in the
// log. A request that takes seconds is otherwise indistinguishable from one that hangs, and nothing says whether it was the database,
// the git host or the work itself.

const store = new AsyncLocalStorage();
const SLOW_MS = Number(process.env.LINEA_SLOW_REQUEST_MS ?? 1500);

const token = (name) => String(name).replace(/[^\w-]/g, '_');

/** Times `work()` under `name` in the request that is running (it is just `work()` outside one). */
export const timed = async (name, work) => {
  const current = store.getStore();
  if (!current) return work();
  const started = performance.now();
  try {
    return await work();
  } finally {
    current.spans.push({ name: token(name), ms: performance.now() - started });
  }
};

const describe = (spans, total) => [...spans, { name: 'total', ms: total }].map(({ name, ms }) => `${name};dur=${ms.toFixed(1)}`).join(', ');

export const serverTiming = (req, res, next) => {
  const current = { spans: [], started: performance.now() };
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (!res.headersSent) res.setHeader('Server-Timing', describe(current.spans, performance.now() - current.started));
    return writeHead.apply(this, args);
  };
  res.on('finish', () => {
    const total = performance.now() - current.started;
    if (total >= SLOW_MS) console.warn(`[slow] ${req.method} ${req.originalUrl} ${total.toFixed(0)} ms: ${describe(current.spans, total)}`);
  });
  store.run(current, next);
};
