import { ref, shallowRef, watch, onMounted, onBeforeUnmount, unref } from 'vue'
import dashboardService from 'src/services/dashboardService'
import { socket } from 'src/boot/ws'
import { rememberLastDeployment } from 'stores/lastDeployment'

// a generation sends one event per step: wait for the burst to end before asking again
const GENERATION_REFRESH_DELAY = 1500

/**
 * The change of a figure against the same figure in the period before it, as `{ text, direction, tone }`.
 * `mode: 'points'` is for rates (a success rate going 80 to 84 is `+4 pp`); `mode: 'relative'` is for counts (12 to 18 is `+50%`).
 * `higherIsBetter` says whether going up is good (a success rate) or bad (failures). Returns `null` when there is nothing to compare.
 */
export function changeBetween(current, previous, { higherIsBetter = true, mode = 'points' } = {}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  if (mode === 'relative' && previous === 0 && current !== 0) return null
  const diff = mode === 'relative' ? Math.round(((current - previous) / (previous || 1)) * 100) : current - previous
  if (diff === 0) return { text: '0', direction: 'flat', tone: 'neutral' }
  const good = higherIsBetter ? diff > 0 : diff < 0
  const unit = mode === 'relative' ? '%' : ' pp'
  return {
    text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${unit}`,
    direction: diff > 0 ? 'up' : 'down',
    tone: good ? 'ok' : 'bad',
  }
}

/**
 * The summary of the home page (`GET /api/dashboard`): deployments of the period against the one before it, daily and monthly
 * buckets, sync staleness and the latest deployments. It is fetched again when the period changes and when a generation ends.
 */
export function useDashboardSummary(period, { lineId = null } = {}) {
  const summary = ref(null)
  const loading = shallowRef(true)
  const failed = shallowRef(false)
  let sequence = 0
  let timer = null

  async function load() {
    const mine = ++sequence
    loading.value = true
    try {
      const data = await dashboardService.get({ days: unref(period), lineId: unref(lineId) })
      if (mine !== sequence) return
      summary.value = data
      if (!unref(lineId)) rememberLastDeployment(data?.recent?.[0])
      failed.value = false
    } catch {
      if (mine !== sequence) return
      failed.value = true
    } finally {
      if (mine === sequence) loading.value = false
    }
  }

  const onGeneration = () => {
    clearTimeout(timer)
    timer = setTimeout(load, GENERATION_REFRESH_DELAY)
  }

  watch(() => [unref(period), unref(lineId)], load)
  onMounted(() => {
    load()
    socket?.on('generation', onGeneration)
  })
  onBeforeUnmount(() => {
    clearTimeout(timer)
    socket?.off('generation', onGeneration)
    sequence++
  })

  return { summary, loading, failed, refresh: load }
}
