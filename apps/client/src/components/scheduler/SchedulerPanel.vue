<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import schedulerService from 'src/services/schedulerService'
import { errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import InfoHint from 'src/components/common/InfoHint.vue'
import SyncRunRow from 'src/components/generation/SyncRunRow.vue'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'

// What the scheduler of syncs is doing: what runs, what waits for a free place, what is coming in the next day. Of everything the person may
// see, of one SPL (`lineId`) or of one product (`productId`). A product is never synced twice at once, nor while it is being generated.
const props = defineProps({
  lineId: { type: String, default: null },
  productId: { type: String, default: null },
  /** Whether it lists the last syncs: the views that list every run already do. */
  showRecent: { type: Boolean, default: true },
  /** Inside a view that titles it already: no titles of its own, and nothing about what is not happening. */
  compact: { type: Boolean, default: false },
})
const t = useT()
const status = ref(null)
const error = ref(null)
const loading = ref(true)
let timer = null

const load = async () => {
  try {
    status.value = await schedulerService.status({ lineId: props.lineId, productId: props.productId })
    error.value = null
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
onMounted(() => { load(); timer = setInterval(load, 15000) })
onBeforeUnmount(() => clearInterval(timer))
watch(() => [props.lineId, props.productId], () => { loading.value = true; load() })

const HOURS = [...Array(24).keys()]
// one row per SPL (per product in the view of an SPL), one cell per hour from now holding the syncs that fall in it
const rows = computed(() => {
  const now = Date.now()
  const byRow = new Map()
  for (const entry of status.value?.upcoming ?? []) {
    const name = props.lineId || props.productId ? entry.product : entry.line
    const cells = byRow.get(name) ?? HOURS.map(() => [])
    const hour = Math.min(23, Math.max(0, Math.floor((new Date(entry.at).getTime() - now) / 3600_000)))
    cells[hour].push(entry.product)
    byRow.set(name, cells)
  }
  return [...byRow].map(([name, cells]) => ({ name, cells }))
})
const hourLabel = (offset) => new Date(Date.now() + offset * 3600_000).getHours()
const since = (at) => (at ? new Date(at).toLocaleTimeString() : '')
const summary = computed(() => (status.value
  ? [
      t('scheduler.n_running', { n: status.value.running.length }),
      t('scheduler.n_queued', { n: status.value.queued.length }),
      t('scheduler.n_skipped', { n: status.value.skippedToday }),
      ...(status.value.paused ? [t('scheduler.paused')] : []),
    ].join(' · ')
  : ''))
</script>

<template>
  <div class="scheduler" name="scheduler-panel">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading" height="10rem" />

    <template v-else-if="status">
      <section class="ln-block">
        <header class="ln-block__head" :class="{ 'scheduler__head--compact': compact }">
          <span v-if="!compact" class="ln-block__title">{{ t('scheduler.next_24h') }}</span><span v-if="!compact" class="ln-block__rule" />
          <span class="ln-row__note" name="scheduler-summary">{{ compact ? `${t('scheduler.next_24h')} · ` : '' }}{{ summary }}<InfoHint :text="t('scheduler.skipped_hint')" /></span>
        </header>
        <p v-if="!rows.length" class="ln-block__empty">{{ t('scheduler.nothing_planned') }}</p>
        <div v-else class="scheduler__cal" name="scheduler-calendar">
          <span />
          <span v-for="h in HOURS" :key="h" class="scheduler__hour">{{ h % 3 ? '' : hourLabel(h) }}</span>
          <template v-for="row in rows" :key="row.name">
            <span class="scheduler__line">{{ row.name }}</span>
            <span v-for="(products, h) in row.cells" :key="h" class="scheduler__cell" :class="{ 'scheduler__cell--on': products.length }" :title="products.join(', ')" />
          </template>
        </div>
      </section>

      <section v-if="!compact || status.running.length || status.queued.length" class="ln-block">
        <header class="ln-block__head"><span class="ln-block__title">{{ t('scheduler.locks') }}<InfoHint :text="t('scheduler.locks_hint')" /></span><span class="ln-block__rule" /></header>
        <p v-if="!status.running.length && !status.queued.length" class="ln-block__empty">{{ t('scheduler.idle') }}</p>
        <table v-else class="scheduler__table" name="scheduler-table">
          <tbody>
            <tr v-for="entry in status.running" :key="`r-${entry.productId}`">
              <td>{{ entry.product ?? entry.productId }}</td><td class="scheduler__faint">{{ entry.line }}</td>
              <td class="scheduler__run">{{ t(`automation.busy_${entry.kind}`) }}</td>
              <td class="scheduler__faint">{{ since(entry.since) }}</td>
            </tr>
            <tr v-for="(entry, i) in status.queued" :key="`q-${entry.productId}`">
              <td>{{ entry.product }}</td><td class="scheduler__faint">{{ entry.line }}</td>
              <td class="scheduler__faint">{{ t('scheduler.in_queue', { n: i + 1 }) }}</td><td />
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="showRecent && status.recent?.length" class="ln-block" name="scheduler-recent">
        <header class="ln-block__head"><span class="ln-block__title">{{ t('scheduler.recent') }}</span><span class="ln-block__rule" /></header>
        <SyncRunRow v-for="run in status.recent" :key="run._id" :run="run" :product="lineId || productId ? (lineId ? run.product : '') : run.product" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.scheduler { display: flex; flex-direction: column; gap: 20px; }
.scheduler__head--compact { padding-bottom: 4px; }
.scheduler__cal { display: grid; grid-template-columns: 9rem repeat(24, minmax(0, 1fr)); gap: 2px; align-items: center; font-size: 10px; padding-bottom: 6px; }
.scheduler__hour { color: var(--text-muted); }
.scheduler__line { font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scheduler__cell { height: 14px; border-radius: 3px; background: var(--p-content-hover-background); }
.scheduler__cell--on { background: var(--sync); }
.scheduler__table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.scheduler__table td { padding: 7px 10px 7px 0; border-top: 1px solid var(--card-border); }
.scheduler__table tr:first-child td { border-top: 0; }
.scheduler__faint { color: var(--text-muted); }
.scheduler__run { color: var(--sync); font-weight: 600; }
</style>
