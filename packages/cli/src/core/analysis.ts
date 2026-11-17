import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisJob } from './analysisWorker.js';

/**
 * Runs an analysis of a feature model off the thread of the window, and gives the answer back as a promise. A thread is made for
 * each one and ended when it answers (or when `signal` says to stop), so a slow analysis can be given up and costs nothing between
 * runs. What it answers is what linea-core's own functions return (numbers that are too big arrive as bigint).
 */

/** Where the worker's code is: next to this file when it runs from the sources, and in `dist` (next to or under it) when bundled. */
function workerFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'analysisWorker.ts'),
    path.join(here, 'analysisWorker.js'),
    path.join(here, 'core', 'analysisWorker.js'),
    path.join(here, '..', 'core', 'analysisWorker.js'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`The analysis worker is missing (looked in ${here}).`);
  return found;
}

export function analyzeOffThread<T>(job: AnalysisJob, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('The analysis was cancelled.'));
    const worker = new Worker(workerFile());
    const done = (): void => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      done();
      reject(new Error('The analysis was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<{ ok: true; result: T } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e: ErrorEvent) => {
      done();
      reject(new Error(e.message || 'The analysis stopped unexpectedly.'));
    };
    worker.postMessage(job);
  });
}
