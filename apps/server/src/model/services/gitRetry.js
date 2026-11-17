const BASE_DELAY_MS = 50;
const MAX_DELAY_MS = 800;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Full jitter: a random wait up to a cap that doubles with each attempt. */
export const backoffDelay = (attempt) => {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.floor(Math.random() * cap);
};

export const isRetryableConflict = (err) => err?.status === 400 || err?.status === 409;
export const isNotFound = (err) => err?.status === 404;
