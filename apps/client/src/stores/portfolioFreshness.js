// How old what the app knows about the lines and products of the user is, and who to tell when a change makes it wrong.
// Kept apart from the composable that loads it so the HTTP layer can say "something changed" without importing the services.

let loadedAt = 0
let onStale = null
let timer = null

// a creation is followed by a few more writes (the index, the spec): one reload after they settle, not one per write
const RELOAD_DELAY_MS = 400

export const portfolioFreshness = {
  /** The portfolio has just been loaded. */
  loaded() {
    loadedAt = Date.now()
  },

  isFresh(maxAgeMs) {
    return Date.now() - loadedAt < maxAgeMs
  },

  /** A line or a product was created, changed or deleted: what was loaded is no longer right. */
  changed() {
    loadedAt = 0
    if (!onStale) return
    clearTimeout(timer)
    timer = setTimeout(() => onStale?.(), RELOAD_DELAY_MS)
  },

  /** Something changed that the next page to show the portfolio must ask for again, but nothing is reloaded now. */
  stale() {
    loadedAt = 0
  },

  /** Who reloads the portfolio when it is stale (the composable that holds it). */
  listen(callback) {
    onStale = callback
  },
}

// the writes of the API that leave the lines and the products as they were: questions asked with a body, and the models of a product
const READS = /\/(analyze|check|preview|models|layouts)(\/|$)/

/** Whether a request that succeeded changed a line or a product. */
export const changesPortfolio = ({ method, url }) => {
  if (!method || method.toLowerCase() === 'get') return false
  const path = String(url ?? '').split('?')[0]
  return /^\/(lines|products)(\/|$)/.test(path) && !READS.test(path)
}
