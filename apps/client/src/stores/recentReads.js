// Answers of the API that several pages ask for in a row (the tabs of a line are pages of their own, and each one asks for the line,
// and for what may be done with it, when it opens): kept for a short while so changing tab does not ask again. Anything that changes a
// line or a product forgets them all (see boot/axios.js), so what is shown is never older than the last change made from here.

const TTL_MS = 20_000
const kept = new Map()

/** `load()`'s answer for `key`, from the last 20 s when it is there; the answer is shared, so callers copy what they edit. */
export const recentRead = (key, load, ttlMs = TTL_MS) => {
  const found = kept.get(key)
  if (found && Date.now() - found.at < ttlMs) return found.answer
  const answer = load()
  const entry = { at: Date.now(), answer }
  kept.set(key, entry)
  // a failure is not kept: the next ask tries again
  answer.catch(() => { if (kept.get(key) === entry) kept.delete(key) })
  return answer
}

export const forgetRecentReads = () => kept.clear()
