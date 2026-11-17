// What a page showed the last time, kept in this browser per user: the next visit draws it at once and asks the server behind it. It is
// only a head start (private windows and full storage just mean no head start), and a different person on the same browser gets their own.
const userKey = (name) => {
  try {
    const payload = JSON.parse(atob(localStorage.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.userId ? `linea.snapshot.${name}.${payload.userId}` : null
  } catch {
    return null
  }
}

const MAX_AGE_MS = 7 * 24 * 3600_000

export function readSnapshot(name) {
  try {
    const key = userKey(name)
    const saved = key && JSON.parse(localStorage.getItem(key))
    return saved && Date.now() - saved.at < MAX_AGE_MS ? saved.value : null
  } catch {
    return null
  }
}

export function writeSnapshot(name, value) {
  try {
    const key = userKey(name)
    if (key) localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }))
  } catch {
    // storage full or blocked
  }
}
