import { describe, it, expect, beforeEach } from 'vitest'
import { buildInbox, countByFilter, STALE_DAYS } from 'src/composables/useAttentionInbox'
import { healthMap, conflictsMap, generationMap } from 'src/composables/usePortfolio'

const NOW = new Date('2026-11-10T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString()

const product = (id, extra = {}) => ({ _id: id, name: `product-${id}`, line: 'line-a', lineId: 'l1', ...extra })

const healthy = (id) => {
  healthMap.value[id] = { valid: true }
  conflictsMap.value[id] = { conflictingMRs: 0 }
  generationMap.value[id] = null
}

describe('the attention inbox', () => {
  beforeEach(() => {
    for (const map of [healthMap, conflictsMap, generationMap]) map.value = {}
  })

  it('has nothing for products that are healthy and in line', () => {
    healthy('a')
    expect(buildInbox({ products: [product('a', { lastSyncAt: daysAgo(1) })], now: NOW })).toEqual([])
  })

  it('merges every reason of a product into one row, the most severe first', () => {
    healthy('a')
    generationMap.value.a = { outcome: 'error', at: daysAgo(1) }
    conflictsMap.value.a = { conflictingMRs: 1, firstConflictNumber: 42 }

    const items = buildInbox({
      products: [product('a')],
      pending: [{ id: 'a', version: '1.9.3' }],
      failing: [{ id: 'a', pipeline: { status: 'failed', webUrl: 'https://git/p' } }],
      now: NOW,
    })

    expect(items).toHaveLength(1)
    expect(items[0].reasons.map((r) => r.key)).toEqual(['generation', 'pipeline', 'conflict', 'deploy'])
    expect(items[0].reasons.find((r) => r.key === 'conflict').iid).toBe(42)
    expect(items[0].reasons.find((r) => r.key === 'deploy').version).toBe('1.9.3')
    expect(items[0].kinds).toEqual(['fail', 'conflict', 'deploy'])
    expect(items[0].severity).toBe(3)
    expect(items[0].action).toMatchObject({ key: 'view_error', reason: 'generation', tab: 'cicd' })
  })

  it('picks the action by the most severe reason', () => {
    healthy('a')
    conflictsMap.value.a = { conflictingMRs: 2 }
    healthy('b')
    healthy('c')

    const items = buildInbox({
      products: [product('a'), product('b', { lastSyncAt: daysAgo(12) }), product('c')],
      pending: [{ id: 'b', version: '2.1.0' }, { id: 'c', version: '3.0.0' }],
      now: NOW,
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))

    expect(byId.a.action.key).toBe('resolve')
    expect(byId.a.action.tab).toBe('mrs')
    expect(byId.b.action.key).toBe('sync')
    expect(byId.c.action.key).toBe('deploy')
  })

  it('sends each reason to the place where it is dealt with', () => {
    const cases = [
      ['generation', 'view_error', 'cicd'],
      ['pipeline', 'view_error', 'cicd'],
      ['invalid', 'resolve', 'models'],
      ['conflict', 'resolve', 'mrs'],
      ['stale', 'sync', null],
      ['deploy', 'deploy', 'cicd'],
    ]
    for (const [reason, action, tab] of cases) {
      for (const map of [healthMap, conflictsMap, generationMap]) map.value = {}
      healthy('a')
      if (reason === 'generation') generationMap.value.a = { outcome: 'error', at: daysAgo(1) }
      if (reason === 'invalid') healthMap.value.a = { valid: false }
      if (reason === 'conflict') conflictsMap.value.a = { conflictingMRs: 1 }
      const [item] = buildInbox({
        products: [product('a', reason === 'stale' ? { lastSyncAt: daysAgo(20) } : {})],
        pending: reason === 'deploy' ? [{ id: 'a', version: '1.0.1' }] : [],
        failing: reason === 'pipeline' ? [{ id: 'a', pipeline: { status: 'failed' } }] : [],
        now: NOW,
      })
      expect(item.action, reason).toMatchObject({ key: action, tab })
    }
  })

  it('counts a product as stale only after the threshold', () => {
    healthy('a')
    healthy('b')
    const items = buildInbox({
      products: [product('a', { lastSyncAt: daysAgo(STALE_DAYS) }), product('b', { lastSyncAt: daysAgo(STALE_DAYS + 2) })],
      now: NOW,
    })
    expect(items.map((item) => item.id)).toEqual(['b'])
    expect(items[0].reasons[0]).toMatchObject({ key: 'stale', days: STALE_DAYS + 2 })
  })

  it('sorts by severity, then by how recent the problem is', () => {
    for (const id of ['a', 'b', 'c']) healthy(id)
    generationMap.value.a = { outcome: 'error', at: daysAgo(5) }
    generationMap.value.b = { outcome: 'error', at: daysAgo(1) }
    const items = buildInbox({
      products: [product('c', { lastSyncAt: daysAgo(30) }), product('a'), product('b')],
      now: NOW,
    })
    expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('flags an invalid model for the migration panel when it says what is wrong', () => {
    healthMap.value.a = { valid: false, errorType: 'drift' }
    conflictsMap.value.a = { conflictingMRs: 0 }
    const [item] = buildInbox({ products: [product('a')], now: NOW })
    expect(item.action).toMatchObject({ key: 'resolve', needsMigration: true })
  })

  it('leaves out the products of a deleted line', () => {
    healthy('a')
    generationMap.value.a = { outcome: 'error', at: daysAgo(1) }
    expect(buildInbox({ products: [product('a', { lineDeleted: true })], now: NOW })).toEqual([])
  })

  it('counts the rows of each filter', () => {
    for (const id of ['a', 'b']) healthy(id)
    generationMap.value.a = { outcome: 'error', at: daysAgo(1) }
    const items = buildInbox({ products: [product('a'), product('b')], pending: [{ id: 'b', version: '1.0.1' }], now: NOW })
    expect(countByFilter(items)).toEqual({ all: 2, fail: 1, conflict: 0, deploy: 1, stale: 0 })
  })
})
