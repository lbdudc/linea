<script setup>
import { ref, computed, getCurrentInstance } from 'vue'
import InputText from 'primevue/inputtext'
import PrimeButton from 'primevue/button'
import { toCsv, downloadText } from 'src/utils/csv'
import RunStepper from './RunStepper.vue'
import { relativeShort } from 'src/utils/relativeTime'
import { formatDuration } from 'src/utils/generationLog'

// The generations and the syncs, one list. A row opens to what it did, its merge request and its checks; the merge request and the pipeline
// are part of the run, not a kind of thing of their own.
const props = defineProps({
  runs: { type: Array, required: true },
  /** Whether the SPL / the product are columns: they are not on a page that is already of one. */
  showLine: { type: Boolean, default: true },
  showProduct: { type: Boolean, default: true },
  day: { type: String, default: null },
  outcome: { type: String, default: null },
  status: { type: String, default: null },
})
const emit = defineEmits(['select', 'clear-narrowing', 'update:status', 'retry', 'cancel', 'open-mr', 'retry-failed'])
const instance = getCurrentInstance()

const kind = ref('all')
const search = ref('')
const KINDS = ['all', 'generation', 'sync']
const STATE_OF_OUTCOME = { success: 'ok', warning: 'wait', error: 'bad', cancelled: 'stop' }
const pad = (n) => String(n).padStart(2, '0')
const dayOfRun = (at) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const narrowed = computed(() => Boolean(props.day || props.outcome))
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return props.runs.filter((run) => (kind.value === 'all' || run.kind === kind.value)
    && (!props.day || dayOfRun(run.at) === props.day)
    && (!props.outcome || run.state === STATE_OF_OUTCOME[props.outcome])
    && (!props.status || run.state === props.status)
    && (!q || `${run.productName ?? ''} ${run.lineName ?? ''}`.toLowerCase().includes(q)))
})
const STATUSES = ['bad', 'stop', 'run', 'wait', 'ok']
const failedToRetry = computed(() => {
  const seen = new Set()
  const latest = []
  for (const run of props.runs) {
    if (seen.has(run.productId) || run.live) continue
    seen.add(run.productId)
    if (run.state === 'bad') latest.push(run)
  }
  return latest
})
const canRetry = (run) => ['bad', 'stop'].includes(run.state) && !run.live
const canCancel = (run) => run.live && run.cancellable
const hasMr = (run) => Boolean(run.mr?.number || run.mr?.url)
const exportCsv = () => {
  downloadText('runs.csv', toCsv(rows.value.map((run) => ({
    kind: run.kind,
    product: run.productName,
    line: run.lineName,
    version: run.version ?? '',
    state: run.state,
    at: run.at ? new Date(run.at).toISOString() : '',
  }))), 'text/csv')
}
const when = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')
const versionText = (run) => (run.version ? (run.kind === 'sync' ? `= v${run.version}` : `v${run.version}`) : '')
</script>

<template>
  <div class="activity" name="cicd-activity">
    <div class="activity__bar">
      <div class="activity__chips" role="group">
        <button
          v-for="k in KINDS" :key="k" type="button" class="activity__chip" :class="{ 'activity__chip--on': kind === k }" :name="`activity-${k}`"
          @click="kind = k"
        >{{ $t(`cicdview.filter_${k}`) }}</button>
      </div>
      <div class="activity__chips" role="group" :aria-label="$t('cicdview.status_label')">
        <button
          v-for="s in STATUSES" :key="s" type="button" class="activity__chip" :class="{ 'activity__chip--on': status === s }" :aria-pressed="status === s" :name="`activity-status-${s}`"
          @click="emit('update:status', status === s ? null : s)"
        >{{ $t(`cicdview.status_${s}`) }}</button>
      </div>
      <div class="activity__tools">
        <PrimeButton
          v-if="failedToRetry.length" size="small" severity="danger" outlined icon="pi pi-replay" name="activity-retry-failed"
          :label="$t('cicdview.retry_failed', { n: failedToRetry.length })" @click="emit('retry-failed', failedToRetry)"
        />
        <PrimeButton size="small" text icon="pi pi-download" name="activity-export" :label="$t('products_bulk.export')" :disabled="!rows.length" @click="exportCsv" />
        <InputText v-model="search" size="small" class="activity__search" :placeholder="$t('deployments.search_placeholder')" name="activity-search" />
      </div>
    </div>

    <p v-if="narrowed" class="activity__narrow" name="activity-narrow">
      <span>{{ [day, outcome && $t(`dashboard.generations_legend_${outcome}`)].filter(Boolean).join(' · ') }}</span>
      <button type="button" class="activity__clear" name="activity-narrow-clear" @click="emit('clear-narrowing')">{{ $t('cicdview.clear_narrowing') }}</button>
    </p>

    <p v-if="!rows.length" class="activity__empty" name="activity-empty">{{ $t('cicdview.empty') }}</p>
    <table v-else class="activity__table">
      <thead>
        <tr>
          <th>{{ $t('cicdview.col_what') }}</th>
          <th v-if="showProduct">{{ $t('cicdview.col_product') }}</th>
          <th v-if="showLine">{{ $t('cicdview.col_line') }}</th>
          <th>{{ $t('cicdview.col_version') }}</th>
          <th>{{ $t('cicdview.col_progress') }}</th>
          <th>{{ $t('cicdview.col_when') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <template v-for="run in rows" :key="run.id">
          <tr class="activity__row" tabindex="0" :name="`run-${run.id}`" @click="emit('select', run)" @keydown.enter="emit('select', run)">
            <td><span class="activity__kind" :class="`activity__kind--${run.kind}`">{{ $t(`cicdview.kind_${run.kind}`) }}</span></td>
            <td v-if="showProduct">{{ run.productName }}</td>
            <td v-if="showLine" class="activity__muted">{{ run.lineName }}</td>
            <td class="activity__mono">{{ versionText(run) }}</td>
            <td>
              <RunStepper :stage="run.stage" :state="run.state" />
              <span v-if="run.queue" class="activity__queue" :name="`run-queue-${run.id}`">{{ $t('cicdview.queue_position', { n: run.queue.position, total: run.queue.waiting, time: formatDuration(run.queue.estimateMs) }) }}</span>
              <span v-else-if="run.cancelling" class="activity__queue" :name="`run-cancelling-${run.id}`">{{ $t('generation.gr_cancelling') }}</span>
            </td>
            <td class="activity__muted">{{ when(run.at) }}</td>
            <td class="activity__go">
              <span class="activity__actions">
                <PrimeButton v-if="canRetry(run)" text rounded size="small" icon="pi pi-replay" :name="`run-retry-${run.id}`" :aria-label="$t('cicdview.retry')" :title="$t('cicdview.retry')" @click.stop="emit('retry', run)" />
                <PrimeButton v-if="canCancel(run)" text rounded size="small" severity="secondary" icon="pi pi-times" :name="`run-cancel-${run.id}`" :aria-label="$t('cicdview.cancel')" :title="$t('cicdview.cancel')" @click.stop="emit('cancel', run)" />
                <PrimeButton v-if="hasMr(run)" text rounded size="small" severity="secondary" icon="pi pi-share-alt" :name="`run-mr-${run.id}`" :aria-label="$t('cicdview.open_mr')" :title="$t('cicdview.open_mr')" @click.stop="emit('open-mr', run)" />
                <i class="pi pi-angle-right" aria-hidden="true" />
              </span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.activity__bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.activity__chips { display: flex; gap: 6px; flex-wrap: wrap; }
.activity__chip { padding: 2px 12px; border: 1px solid var(--card-border); border-radius: 99px; background: var(--card-bg); font: inherit; font-size: 0.75rem; color: var(--text-muted); cursor: pointer; }
.activity__chip--on { background: var(--p-highlight-soft); border-color: var(--p-primary-color); color: var(--p-primary-color); }
.activity__search { width: 180px; }
.activity__tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.activity__actions { display: inline-flex; align-items: center; gap: 2px; justify-content: flex-end; }
.activity__narrow { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: 0.75rem; color: var(--text-muted); }
.activity__clear { border: 0; background: none; padding: 0; font: inherit; color: var(--p-primary-color); cursor: pointer; text-decoration: underline; }
.activity__table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
.activity__table th { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--card-border); font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); text-align: left; font-weight: 600; }
.activity__table td { padding: 9px 12px 9px 0; border-top: 1px solid var(--card-border); vertical-align: middle; }
.activity__row { cursor: pointer; }
.activity__queue { display: block; margin-top: 3px; font-size: 0.6875rem; color: var(--text-muted); }
.activity__go { width: 1.5rem; white-space: nowrap; color: var(--text-muted); text-align: right; }
.activity__row:hover .activity__go { color: var(--p-primary-color); }
.activity__row:hover td, .activity__row:focus-visible td { background: var(--p-content-hover-background); outline: none; }
.activity__row td:first-child { padding-left: 8px; }
.activity__table th:first-child { padding-left: 8px; }
.activity__kind { padding: 2px 9px; border-radius: 99px; font-size: 0.75rem; font-weight: 500; background: var(--p-highlight-soft); color: var(--p-primary-color); }
.activity__kind--sync { background: color-mix(in srgb, var(--sync) 15%, transparent); color: var(--sync); }
.activity__muted { color: var(--text-muted); }
.activity__mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; }
.activity__empty { margin: 0; padding: 18px 0; font-size: 0.8125rem; color: var(--text-muted); }
</style>
