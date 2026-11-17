import { describe, it, expect, beforeEach } from 'vitest'
import { healthOf, healthMap, conflictsMap, generationMap } from 'src/composables/usePortfolio'

const product = { _id: 'p1' }

describe('healthOf', () => {
  beforeEach(() => {
    healthMap.value = { p1: { valid: true } }
    conflictsMap.value = { p1: { conflictingMRs: 0 } }
    generationMap.value = {}
  })

  it('is healthy when the selection fits, nothing conflicts and the last generation went through', () => {
    generationMap.value = { p1: { outcome: 'success' } }
    expect(healthOf(product)).toMatchObject({ status: 'ok', isHealthy: true, reasons: [] })
  })

  it('needs attention when the last generation failed, and says why', () => {
    generationMap.value = { p1: { outcome: 'error', version: '0.0.2' } }
    expect(healthOf(product)).toMatchObject({ status: 'bad', hasIssue: true, isHealthy: false, reasons: ['generation_failed'] })
  })

  it('lists every reason together', () => {
    healthMap.value = { p1: { valid: false } }
    conflictsMap.value = { p1: { conflictingMRs: 2 } }
    generationMap.value = { p1: { outcome: 'error' } }
    expect(healthOf(product).reasons).toEqual(['invalid', 'conflicts', 'generation_failed'])
  })

  it('a generation that ended with conflicts is not a failure', () => {
    generationMap.value = { p1: { outcome: 'warning' } }
    expect(healthOf(product).status).toBe('ok')
  })

  it('is still being checked while the health is unknown', () => {
    healthMap.value = {}
    expect(healthOf(product).status).toBe('checking')
  })
})
