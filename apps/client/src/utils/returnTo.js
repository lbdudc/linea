// Where a person was going when they had to log in. The OAuth round trip loses the query, so the path is kept in sessionStorage.
const KEY = 'linea:returnTo'

const stored = () => {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

const forget = () => {
  try { sessionStorage.removeItem(KEY) } catch { /* private window */ }
}

const IN_APP_PATH = /^\/(?!\/)/

/** Keeps where a person was going across the OAuth round trip, which loses the query. Only a path of this origin is kept. */
export const rememberReturnTo = (path) => {
  if (typeof path !== 'string' || !IN_APP_PATH.test(path)) return
  try { sessionStorage.setItem(KEY, path) } catch { /* private window: the home page it is */ }
}

/** Where to go once logged in: the requested path, or the one kept across the round trip, or the home page. A kept path is used once. */
export const afterLoginTarget = (redirect) => {
  if (redirect) return redirect
  const kept = stored()
  if (kept) forget()
  return kept || '/'
}
