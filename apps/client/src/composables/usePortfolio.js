import { computed, getCurrentInstance, onBeforeUnmount, ref, shallowRef } from 'vue'
import lineService from 'src/services/lineService'
import productService from 'src/services/productService'
import { formatDate } from 'src/services/utils'
import { portfolioFreshness } from 'stores/portfolioFreshness'

// Health and open change requests are asked for in groups of products, a few groups at a time: a request per product and kind used to
// stand for what the page shows next to each row.
const STATUS_CHUNK = 10
const STATUS_PARALLEL = 2
// how long what was loaded is trusted when a page asks for it again (a change made by this app reloads it at once)
const FRESH_MS = 60_000

const lines = ref(null)
const products = ref(null)
export const healthMap = ref({})
export const conflictsMap = ref({})
export const generationMap = ref({})
// saved changes that no generation has deployed, by product id: { pending, version }
export const deploymentsMap = ref({})
const linesLoading = shallowRef(false)
const productsLoading = shallowRef(false)
const healthLoading = shallowRef(false)

let started = false
let inFlight = null

// What was loaded last is kept in this browser, per user, and shown at once the next time the app opens while the real answer is on its
// way: the lines and products come from the git host, which takes seconds, and every reload of the page used to start from a blank.
const SNAPSHOT_KEY = 'linea.portfolio.v1'
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600_000
const snapshotKey = () => {
  try {
    const payload = JSON.parse(atob(localStorage.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.userId ? `${SNAPSHOT_KEY}.${payload.userId}` : null
  } catch {
    return null
  }
}

function hydrate() {
  try {
    const key = snapshotKey()
    const saved = key && JSON.parse(localStorage.getItem(key))
    if (!saved || Date.now() - saved.at > SNAPSHOT_MAX_AGE_MS) return
    lines.value = saved.lines
    products.value = saved.products
    healthMap.value = saved.health ?? {}
    conflictsMap.value = saved.conflicts ?? {}
    generationMap.value = saved.generations ?? {}
    deploymentsMap.value = saved.deployments ?? {}
  } catch {
    // no snapshot, or one that cannot be read: it loads as before
  }
}

let saveTimer = null
function saveSnapshot() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const key = snapshotKey()
      if (!key || lines.value === null || products.value === null) return
      localStorage.setItem(key, JSON.stringify({
        at: Date.now(),
        lines: lines.value,
        products: products.value,
        health: healthMap.value,
        conflicts: conflictsMap.value,
        generations: generationMap.value,
        deployments: deploymentsMap.value,
      }))
    } catch {
      // storage full or blocked: it is only a head start
    }
  }, 500)
}

async function loadLines() {
  // what is already on screen stays until the new answer is here: coming back to the page does not blank it
  linesLoading.value = lines.value === null
  try {
    lines.value = (await lineService.findEnrolledLines()).map((line) => ({
      ...line,
      createdAtRaw: line.createdAt,
      createdAt: formatDate(line.createdAt),
    }))
  } catch {
    if (lines.value === null) lines.value = []
  } finally {
    linesLoading.value = false
  }
  saveSnapshot()
}

async function loadProducts() {
  productsLoading.value = products.value === null
  try {
    products.value = (await productService.findEnrolledLines()).map((product) => ({
      ...product,
      createdAtRaw: product.createdAt,
      createdAt: formatDate(product.createdAt),
    }))
  } catch {
    if (products.value === null) products.value = []
  } finally {
    productsLoading.value = false
  }
  saveSnapshot()
  // the statuses already asked for from the products of the snapshot are not asked for again when the same products come back
  const reuse = statusesOnSnapshot && statusIds === idsOf(products.value)
  statusesOnSnapshot = false
  productsLive = true
  if (statusesWanted && products.value.length && !reuse) loadStatuses()
  // loaded while no page showed them: what was known is of the products as they were, the next page to show them asks again
  else if (!statusesWanted) statusesAt = 0
}

// Health and pending changes are one call to the git host per group of products: they are loaded when a page shows them (the lists, the
// dashboard), not for every page that only needs the names of the lines and products (the side bar, the header of a product).
let statusesWanted = false
// the pages that show them and are open now: when the last one closes nobody wants them any more, and a reload of the portfolio (after
// every generation, for one) must not ask the git host for the state of every product while a page that does not show it is open
let statusesViewers = 0
let statusesAt = 0
let statusIds = ''
let statusesOnSnapshot = false
let productsLive = false
let statusesRunning = null
// aborts the health and pending-change requests that are on their way (the tree was collapsed, the last page that shows them closed)
let statusesAbort = new AbortController()
/**
 * Stops the status requests in flight and the ones queued; the next `ensureStatuses` loads them again. Does nothing while a page that
 * shows the statuses is open: they are still wanted.
 */
export function cancelStatuses() {
  if (statusesViewers > 0) return
  statusesAbort.abort()
  statusesAbort = new AbortController()
  statusesWanted = false
  statusesAt = 0
  healthLoading.value = false
}
const idsOf = (prods) => prods.map((product) => String(product._id)).join(',')

function loadStatuses() {
  statusIds = idsOf(products.value)
  statusesOnSnapshot = !productsLive
  statusesAt = Date.now()
  const running = loadSummary(products.value).finally(() => {
    if (statusesRunning === running) statusesRunning = null
  })
  statusesRunning = running
}

/**
 * Resolves when the health, change requests and pending changes of these products are in the maps: the portfolio loads them for the
 * products it knows (a page that asks for its own products waits for that instead of asking again), and the ones it does not know yet
 * (just created) are asked for by themselves.
 */
export async function ensureStatusesFor(ids) {
  const wanted = ids.map(String)
  await inFlight
  await statusesRunning
  const missing = wanted.filter((id) => !(id in healthMap.value))
  if (!missing.length) return
  // a page asking for its own products is not cancelled with the tree: it has a signal of its own
  const own = new AbortController().signal
  await Promise.all([fetchHealth(missing, own), fetchDeployments(missing, own)])
}

/** Asks for the health and pending changes of the products to be loaded (once, then again when they are older than a minute). */
export function ensureStatuses() {
  statusesWanted = true
  if (!products.value?.length) return statusesRunning ?? Promise.resolve()
  // Changing tab closes one page and opens the next: nobody wanted the statuses in between, but they are as fresh as they were (a
  // portfolio that was reloaded while nobody wanted them, or a cancel, left `statusesAt` at 0).
  if (statusesAt === 0 || Date.now() - statusesAt > FRESH_MS) loadStatuses()
  return statusesRunning ?? Promise.resolve()
}

/**
 * Asks for the pending changes (and the rest of the statuses, which travel in the same request) of the products: once, then again when
 * older than a minute. What is already on its way is waited for, not asked twice. A page asking for them is not cancelled with the tree:
 * it has a signal of its own.
 */
export async function ensureDeployments() {
  if (!products.value?.length) return
  if (statusesRunning) return statusesRunning
  if (statusesAt !== 0 && Date.now() - statusesAt <= FRESH_MS) return
  statusIds = idsOf(products.value)
  statusesOnSnapshot = !productsLive
  statusesAt = Date.now()
  const running = loadSummary(products.value, new AbortController().signal).finally(() => {
    if (statusesRunning === running) statusesRunning = null
  })
  statusesRunning = running
  await running
}

/** Forgets the pending changes and pipelines that were loaded: the next ask loads them again (a generation ended, a refresh). */
export function invalidateDeployments() {
  statusesAt = 0
  ciMap.value = {}
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items]
  async function take() {
    const item = queue.shift()
    if (!item) return
    await worker(item)
    await take()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, take))
}

const chunksOf = (items, size) => {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// health, pending changes and the last pipeline of every product: the side bar shows all three on every page, so they travel together
async function loadSummary(prods, signal = statusesAbort.signal) {
  healthLoading.value = true
  const ids = prods.map((product) => String(product._id))
  // a product that is gone leaves no status behind; the others keep theirs while the new answer comes
  for (const map of [healthMap, conflictsMap, generationMap, deploymentsMap]) {
    for (const id of Object.keys(map.value)) if (!ids.includes(id)) delete map.value[id]
  }
  await runWithConcurrency(chunksOf(ids, STATUS_CHUNK), STATUS_PARALLEL, async (group) => {
    if (signal.aborted) return
    let summary = null
    try {
      summary = await productService.getProductsSummary({ ids: group, pipelines: true, signal })
    } catch {
      // the rest of the page does not wait for this: those products stay as they were, or unknown
    }
    if (signal.aborted) return
    applyStatus(group, summary?.status ?? {})
    if (summary?.deployments) Object.assign(deploymentsMap.value, summary.deployments)
    if (summary?.pipelines) {
      for (const id of group) ciMap.value[id] = summary.pipelines[id] ?? { status: null, webUrl: null }
    }
  })
  // a run that was cancelled leaves the flags to whoever cancelled it (and to the run that replaced it)
  if (signal.aborted) return
  healthLoading.value = false
  saveSnapshot()
}

async function fetchHealth(ids, signal = statusesAbort.signal) {
  await runWithConcurrency(chunksOf(ids, STATUS_CHUNK), STATUS_PARALLEL, async (group) => {
    if (signal.aborted) return
    let status = {}
    try {
      status = await productService.getProductsStatus({ ids: group, signal })
    } catch {
      // the rest of the page does not wait for this: those products stay as they were, or unknown
    }
    if (signal.aborted) return
    applyStatus(group, status)
  })
}

function applyStatus(group, status) {
  for (const id of group) {
    const known = status[id]
    if (known) {
      healthMap.value[id] = known.health ?? { valid: null }
      conflictsMap.value[id] = known.conflicts ?? { conflictingMRs: 0 }
      generationMap.value[id] = known.lastGeneration ?? null
    } else {
      healthMap.value[id] ??= { valid: null }
      conflictsMap.value[id] ??= { conflictingMRs: 0 }
    }
  }
}

// Which products have saved changes waiting to be generated: a hint next to each row, the list does not wait for it.
async function loadDeployments(prods, signal = statusesAbort.signal) {
  const ids = prods.map((product) => String(product._id))
  for (const id of Object.keys(deploymentsMap.value)) if (!ids.includes(id)) delete deploymentsMap.value[id]
  await fetchDeployments(ids, signal)
  if (signal.aborted) return
  saveSnapshot()
}

async function fetchDeployments(ids, signal = statusesAbort.signal) {
  await runWithConcurrency(chunksOf(ids, STATUS_CHUNK), STATUS_PARALLEL, async (group) => {
    if (signal.aborted) return
    try {
      const found = await productService.getProductsDeployments({ ids: group, signal })
      if (!signal.aborted) Object.assign(deploymentsMap.value, found)
    } catch {
      // unknown: the product is shown as without changes
    }
  })
}

/** `true` when the product has saved changes that no generation has deployed. */
export function hasPendingChanges(product) {
  return deploymentsMap.value[String(product._id)]?.pending === true
}

// The last pipeline of a product, loaded only for the products a panel shows (it is one more call to the git host each).
export const ciMap = ref({})

export async function loadCi(productIds) {
  // the statuses bring the pipelines: what is on its way is waited for, not asked for twice
  await statusesRunning
  const missing = [...new Set(productIds.map(String))].filter((id) => !(id in ciMap.value))
  await runWithConcurrency(chunksOf(missing, STATUS_CHUNK), STATUS_PARALLEL, async (group) => {
    let pipelines = {}
    try {
      pipelines = await productService.getProductsPipelines({ ids: group })
    } catch {
      // shown as unknown
    }
    for (const id of group) ciMap.value[id] = pipelines[id] ?? { status: null, webUrl: null }
  })
}

/** `{ status, webUrl }` of the last pipeline, or `undefined` while it has not been loaded. */
export function ciOf(productId) {
  return ciMap.value[String(productId)]
}

export function healthOf(product) {
  const id = String(product._id)
  const health = healthMap.value[id] || null
  const conflicts = conflictsMap.value[id] || null
  const lastGeneration = generationMap.value[id] || null
  const generationFailed = lastGeneration?.outcome === 'error'
  const reasons = []
  if (health?.valid === false) reasons.push('invalid')
  if (conflicts?.conflictingMRs > 0) reasons.push('conflicts')
  if (generationFailed) reasons.push('generation_failed')
  const hasIssue = reasons.length > 0
  const isHealthy = health?.valid === true && !hasIssue
  const status = hasIssue ? 'bad' : isHealthy ? 'ok' : 'checking'
  return { health, conflicts, lastGeneration, reasons, isHealthy, hasIssue, status }
}

const lineKeyOf = (product) => (product.lineId ? String(product.lineId) : `name:${product.line}`)

// The products of every line, and what the line lists show about them, computed in one pass over the portfolio (keyed by the line's id: two
// lines may share a name in different groups). A product that came without a line id falls back to the name of its line.
const lineStats = computed(() => {
  const stats = new Map()
  for (const product of products.value || []) {
    const key = lineKeyOf(product)
    let entry = stats.get(key)
    if (!entry) {
      entry = { products: [], health: { ok: 0, bad: 0, checking: 0, total: 0 }, mrCount: 0, lastSync: null }
      stats.set(key, entry)
    }
    const status = healthOf(product)
    entry.products.push(product)
    entry.health[status.status] += 1
    entry.health.total += 1
    entry.mrCount += status.conflicts?.conflictingMRs ?? 0
    const synced = syncTimeOf(product)
    if (synced !== null && (entry.lastSync === null || synced > entry.lastSync)) entry.lastSync = synced
  }
  return stats
})

const EMPTY_STATS = Object.freeze({ products: [], health: { ok: 0, bad: 0, checking: 0, total: 0 }, mrCount: 0, lastSync: null })

/** What the portfolio knows about one line (an object with `_id` and `name`): its products, health summary, open conflicts and last sync. */
export function lineStatsOf(line) {
  if (!line) return EMPTY_STATS
  return lineStats.value.get(String(line._id)) ?? lineStats.value.get(`name:${line.name}`) ?? EMPTY_STATS
}

export const lineHealth = (line) => lineStatsOf(line).health
export const lineProducts = (line) => lineStatsOf(line).products
export const lineMrCount = (line) => lineStatsOf(line).mrCount
export const lineLastSync = (line) => lineStatsOf(line).lastSync

const DAY_MS = 86400000

function syncTimeOf(product) {
  const raw = product.lastSyncAt
  if (!raw) return null
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? null : time
}

export function daysSince(time) {
  return time === null ? null : Math.floor((Date.now() - time) / DAY_MS)
}

// something changed while a load was on its way: that load may not have seen it, so it does not count as fresh
let changedWhileLoading = false

function reload() {
  changedWhileLoading = false
  const settled = Promise.all([loadLines(), loadProducts()]).finally(() => {
    if (inFlight === settled) inFlight = null
    if (changedWhileLoading) {
      reload()
      return
    }
    portfolioFreshness.loaded()
  })
  inFlight = settled
  return settled
}

/** Loads the lines and products again (joining a load that is on its way). */
export function refresh() {
  return inFlight ?? reload()
}

/** What a page that shows the portfolio asks for when it opens: loads it only when it is older than a minute or something changed. */
export function refreshIfStale(maxAgeMs = FRESH_MS) {
  if (inFlight) return inFlight
  if (started && lines.value !== null && portfolioFreshness.isFresh(maxAgeMs)) return Promise.resolve()
  return reload()
}

// a change made through this app (a line created, a product deleted, a generation) reloads it once it settles
portfolioFreshness.listen(() => {
  if (!started) return
  if (inFlight) changedWhileLoading = true
  else refresh()
})

/** `statuses: false` for what only lists names (it does not ask for the health of every product). */
export function usePortfolio({ statuses = true } = {}) {
  if (!started) {
    started = true
    if (lines.value === null) hydrate()
    refresh()
  }
  if (statuses) {
    ensureStatuses()
    // a page (a component) that shows them keeps them wanted while it is open; outside a component they stay wanted
    if (getCurrentInstance()) {
      statusesViewers += 1
      onBeforeUnmount(() => {
        statusesViewers -= 1
        if (statusesViewers <= 0) { statusesViewers = 0; statusesWanted = false }
      })
    }
  }

  return { lines, products, linesLoading, productsLoading, healthLoading }
}

/** One line of the portfolio, its products and how many of them are failing: `idOf` is a getter, so it follows the route. */
export function useLineProducts(idOf) {
  const { lines, products } = usePortfolio()
  const line = computed(() => (lines.value || []).find((l) => String(l._id) === idOf()))
  const own = computed(() => lineProducts(line.value))
  const failing = computed(() => own.value.filter((p) => healthOf(p).status === 'bad').length)
  return { line, own, failing }
}
