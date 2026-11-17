import { computed, unref } from 'vue'
import { healthOf, deploymentsMap, ciMap } from 'src/composables/usePortfolio'

export const STALE_DAYS = 7
const DAY_MS = 86_400_000

export const INBOX_FILTERS = ['all', 'fail', 'conflict', 'deploy', 'stale']

const REASONS = {
  generation: { tone: 'bad', filter: 'fail', rank: 6, action: 'view_error', tab: 'cicd' },
  pipeline: { tone: 'bad', filter: 'fail', rank: 5, action: 'view_error', tab: 'cicd' },
  invalid: { tone: 'bad', filter: 'fail', rank: 4, action: 'resolve', tab: 'models' },
  conflict: { tone: 'warn', filter: 'conflict', rank: 3, action: 'resolve', tab: 'mrs' },
  stale: { tone: 'warn', filter: 'stale', rank: 2, action: 'sync', tab: null },
  deploy: { tone: 'info', filter: 'deploy', rank: 1, action: 'deploy', tab: 'cicd' },
}

const TONE_WEIGHT = { bad: 3, warn: 2, info: 1 }

const timeOf = (value) => {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

export function buildInbox({ products = [], pending = [], failing = [], now = Date.now() }) {
  const pendingById = new Map(pending.map((item) => [String(item.id), item]))
  const failingById = new Map(failing.map((item) => [String(item.id), item]))
  const items = []

  for (const product of products) {
    if (product.lineDeleted) continue
    const id = String(product._id)
    const { health, conflicts, lastGeneration, reasons: issues } = healthOf(product)
    const reasons = []

    if (issues.includes('generation_failed')) reasons.push({ key: 'generation', at: timeOf(lastGeneration?.at) })
    if (failingById.has(id)) reasons.push({ key: 'pipeline', url: failingById.get(id).pipeline?.webUrl ?? null })
    if (issues.includes('invalid')) reasons.push({ key: 'invalid', errorType: health?.errorType ?? null })
    if (conflicts?.conflictingMRs > 0) reasons.push({ key: 'conflict', count: conflicts.conflictingMRs, iid: conflicts.firstConflictNumber ?? null })
    const syncedAt = timeOf(product.lastSyncAt)
    if (syncedAt !== null && now - syncedAt > STALE_DAYS * DAY_MS) {
      reasons.push({ key: 'stale', days: Math.floor((now - syncedAt) / DAY_MS), at: syncedAt })
    }
    if (pendingById.has(id)) reasons.push({ key: 'deploy', version: pendingById.get(id).version })

    if (!reasons.length) continue

    const ordered = [...reasons].sort((a, b) => REASONS[b.key].rank - REASONS[a.key].rank)
    const lead = ordered[0]
    const dated = reasons.map((reason) => reason.at).filter((at) => at !== null && at !== undefined)
    items.push({
      id,
      product,
      name: product.name,
      line: product.line,
      lineId: product.lineId ?? null,
      reasons: ordered.map((reason) => ({ ...reason, tone: REASONS[reason.key].tone })),
      kinds: [...new Set(ordered.map((reason) => REASONS[reason.key].filter))],
      severity: Math.max(...ordered.map((reason) => TONE_WEIGHT[REASONS[reason.key].tone])),
      since: dated.length ? Math.max(...dated) : null,
      action: { key: REASONS[lead.key].action, reason: lead.key, tab: REASONS[lead.key].tab, url: lead.url ?? null, needsMigration: lead.key === 'invalid' && Boolean(lead.errorType) },
    })
  }

  return items.sort((a, b) => b.severity - a.severity || (b.since ?? 0) - (a.since ?? 0) || a.name.localeCompare(b.name))
}

export function countByFilter(items) {
  const counts = Object.fromEntries(INBOX_FILTERS.map((filter) => [filter, 0]))
  counts.all = items.length
  for (const item of items) for (const kind of item.kinds) counts[kind] += 1
  return counts
}

export function useAttentionInbox({ products, pending, failing, filter }) {
  const all = computed(() => buildInbox({
    products: unref(products) ?? [],
    pending: unref(pending) ?? [],
    failing: unref(failing) ?? [],
  }))
  const counts = computed(() => countByFilter(all.value))
  const visible = computed(() => {
    const active = unref(filter) ?? 'all'
    return active === 'all' ? all.value : all.value.filter((item) => item.kinds.includes(active))
  })
  return { all, visible, counts }
}

export function usePortfolioInbox(products) {
  const pending = computed(() => (unref(products) ?? [])
    .filter((product) => deploymentsMap.value[String(product._id)]?.pending === true)
    .map((product) => ({ id: String(product._id), version: product.version })))
  const failing = computed(() => (unref(products) ?? [])
    .filter((product) => ['failed', 'canceled'].includes(ciMap.value[String(product._id)]?.status))
    .map((product) => ({ id: String(product._id), pipeline: ciMap.value[String(product._id)] })))
  return useAttentionInbox({ products, pending, failing })
}
