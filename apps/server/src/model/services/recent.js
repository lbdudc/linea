/**
 * A few seconds of memory for answers that a page asks for over and over (the health of a product, the composed model of a line).
 * Callers that arrive while the answer is being worked out share it, and a failure is not kept.
 *
 * With `staleMs`, an answer older than `ttlMs` but not older than `ttlMs + staleMs` is still given at once while a new one is worked
 * out in the background, so a page does not wait for what it saw a minute ago. `forget` and `clear` drop stale answers too, and a
 * background answer that arrives after its key was forgotten is thrown away, so a change made through this server is never hidden.
 */
export const createRecent = ({ ttlMs, staleMs = 0, limit = 1000 }) => {
  const entries = new Map();
  return {
    get(key, load) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && now - hit.at < ttlMs) return hit.value;
      if (hit && now - hit.at < ttlMs + staleMs) {
        if (!hit.refreshing) {
          hit.refreshing = true;
          Promise.resolve().then(load).then(
            (answer) => { if (entries.get(key) === hit) entries.set(key, { at: Date.now(), value: Promise.resolve(answer) }); },
            () => { hit.refreshing = false; },
          );
        }
        return hit.value;
      }
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      const value = Promise.resolve().then(load);
      const entry = { at: now, value };
      entries.set(key, entry);
      value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
      return value;
    },
    /** Forgets every key for which `matches(key)` is true. */
    forget(matches) {
      for (const key of [...entries.keys()]) if (matches(key)) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
};

/** Runs `worker` on `items`, at most `limit` at a time; the results come back in the order of the items. */
export const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await worker(items[index], index);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};
