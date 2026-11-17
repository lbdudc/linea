export class GenerationCancelledError extends Error {
  code = 'CANCELLED';
  status = 409;
  constructor() {
    super('The generation was cancelled.');
  }
}

const runs = new Map();

/**
 * The generations running on this server, by product. A person can cancel one until it starts writing (`commit()`): up to there
 * nothing has been changed in the repository or in the product, so stopping it at the next checkpoint leaves both as they were.
 */
export const beginRun = (productId, userId) => {
  const run = {
    userId: String(userId),
    startedAt: Date.now(),
    cancelRequested: false,
    committed: false,
    checkpoint() {
      if (this.cancelRequested && !this.committed) throw new GenerationCancelledError();
    },
    commit() {
      this.checkpoint();
      this.committed = true;
    },
  };
  runs.set(String(productId), run);
  return run;
};

export const endRun = (productId, run) => {
  if (runs.get(String(productId)) === run) runs.delete(String(productId));
};

/** `idle`: nothing is running for it; `committing`: it is already writing and cannot be stopped; `cancelling`: it stops at its next checkpoint. */
export const requestCancel = (productId) => {
  const run = runs.get(String(productId));
  if (!run) return 'idle';
  if (run.committed) return 'committing';
  run.cancelRequested = true;
  return 'cancelling';
};

export const runningGenerations = () => [...runs.entries()].map(([productId, run]) => ({ productId, userId: run.userId, since: new Date(run.startedAt), cancelling: run.cancelRequested, committed: run.committed }));
