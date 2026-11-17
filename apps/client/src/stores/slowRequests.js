import { reactive } from 'vue'

// A request that takes seconds is indistinguishable from one that hangs: the page shows skeletons and nothing says why. After
// SLOW_AFTER_MS the shell says so (and stops saying so when the slow requests are over).

export const SLOW_AFTER_MS = 3000

export const slowRequests = reactive({ count: 0 })

const timers = new Map()
const slow = new Set()

/** A request starts: it is told slow if it has not ended after SLOW_AFTER_MS. `token` is any object that identifies it. */
export const requestStarted = (token, after = SLOW_AFTER_MS) => {
  if (timers.has(token)) return
  timers.set(token, setTimeout(() => {
    timers.delete(token)
    slow.add(token)
    slowRequests.count = slow.size
  }, after))
}

/** The request ended (answered, failed or cancelled). */
export const requestEnded = (token) => {
  clearTimeout(timers.get(token))
  timers.delete(token)
  if (slow.delete(token)) slowRequests.count = slow.size
}
