// In-memory record of the last run of each periodic job, read by /api/health/ready.
const jobs = new Map();

export const registerJob = (name, intervalMs) => {
  jobs.set(name, { name, intervalMs, registeredAt: Date.now(), lastRunAt: null, lastOk: null, lastError: null, previousFailed: false });
};

export const recordRun = (name, error = null) => {
  const job = jobs.get(name) ?? { name, intervalMs: null, registeredAt: Date.now() };
  jobs.set(name, {
    ...job,
    previousFailed: job.lastOk === false,
    lastRunAt: new Date().toISOString(),
    lastOk: !error,
    lastError: error ? String(error?.message ?? error) : null,
  });
};

export const getJobs = () => [...jobs.values()];
export const resetJobs = () => jobs.clear();
