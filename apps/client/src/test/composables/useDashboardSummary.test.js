import { describe, it, expect, vi } from 'vitest'

vi.mock('src/boot/ws', () => ({ socket: { on: vi.fn(), off: vi.fn() } }))
vi.mock('src/services/dashboardService', () => ({ default: { get: vi.fn() } }))

import { changeBetween } from 'src/composables/useDashboardSummary'

describe('changeBetween', () => {
  it('has nothing to say without both figures', () => {
    expect(changeBetween(null, 80)).toBeNull()
    expect(changeBetween(80, undefined)).toBeNull()
  })

  it('reports rates in percentage points and judges them by direction', () => {
    expect(changeBetween(84, 80)).toEqual({ text: '+4 pp', direction: 'up', tone: 'ok' })
    expect(changeBetween(70, 80)).toEqual({ text: '−10 pp', direction: 'down', tone: 'bad' })
  })

  it('treats a drop as good when lower is better', () => {
    expect(changeBetween(2, 5, { higherIsBetter: false })).toMatchObject({ direction: 'down', tone: 'ok' })
  })

  it('reports counts as a relative change', () => {
    expect(changeBetween(18, 12, { mode: 'relative' })).toEqual({ text: '+50%', direction: 'up', tone: 'ok' })
    expect(changeBetween(6, 12, { mode: 'relative' })).toEqual({ text: '−50%', direction: 'down', tone: 'bad' })
  })

  it('cannot give a relative change from nothing, and a flat one is neutral', () => {
    expect(changeBetween(5, 0, { mode: 'relative' })).toBeNull()
    expect(changeBetween(0, 0, { mode: 'relative' })).toEqual({ text: '0', direction: 'flat', tone: 'neutral' })
    expect(changeBetween(80, 80)).toEqual({ text: '0', direction: 'flat', tone: 'neutral' })
  })
})
