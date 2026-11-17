import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useGenerationsChart } from 'src/composables/useGenerationsChart'

const localDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

describe('useGenerationsChart', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('usa los días que trae el resumen del servidor, como fechas locales', () => {
    const summary = ref({
      deployments: {
        byDay: [
          { date: '2026-09-30', success: 0, warning: 0, error: 0, total: 0 },
          { date: '2026-10-01', success: 1, warning: 1, error: 0, total: 2 },
          { date: '2026-10-02', success: 0, warning: 0, error: 3, total: 3 },
        ],
      },
    })
    const { days, maxTotal } = useGenerationsChart({ summary, period: ref(3) })

    expect(days.value.map((d) => localDate(d.date))).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
    expect(days.value[1]).toMatchObject({ success: 1, warning: 1, error: 0, total: 2 })
    expect(maxTotal.value).toBe(3)
  })

  it('mientras no hay resumen, dibuja los días del periodo vacíos', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'))
    const { days, maxTotal } = useGenerationsChart({ summary: ref(null), period: ref(7) })

    expect(days.value).toHaveLength(7)
    expect(localDate(days.value[days.value.length - 1].date)).toBe('2026-10-02')
    expect(days.value.every((d) => d.total === 0)).toBe(true)
    expect(maxTotal.value).toBe(0)
  })

  it('sigue el periodo pedido', () => {
    const period = ref(7)
    const { days } = useGenerationsChart({ summary: ref(null), period })
    expect(days.value).toHaveLength(7)
    period.value = 14
    expect(days.value).toHaveLength(14)
  })
})
