import { computed, unref } from 'vue'

export const GENERATIONS_CHART_OUTCOMES = ['success', 'warning', 'error']

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, amount) {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  return d
}

// 'YYYY-MM-DD' (the day on the wall of this browser, as the server counted it) as a local Date
const dayOf = (key) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * The days of the generations chart. They come with the summary of the home page (`deployments.byDay`, counted on the server for
 * the period asked), so the chart no longer downloads every deployment of the period to count them here. Until the summary is there
 * the days are empty.
 */
export function useGenerationsChart({ summary, period }) {
  const days = computed(() => {
    const buckets = unref(summary)?.deployments?.byDay
    if (Array.isArray(buckets) && buckets.length) {
      return buckets.map((b) => ({ date: dayOf(b.date), success: b.success, warning: b.warning, error: b.error, total: b.total }))
    }
    const length = Number(unref(period)) || 14
    const from = startOfDay(addDays(new Date(), -(length - 1)))
    return Array.from({ length }, (_, i) => ({ date: addDays(from, i), success: 0, warning: 0, error: 0, total: 0 }))
  })

  const maxTotal = computed(() => days.value.reduce((max, day) => Math.max(max, day.total), 0))

  return { days, maxTotal }
}
