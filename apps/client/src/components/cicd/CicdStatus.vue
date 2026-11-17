<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import Skeleton from 'primevue/skeleton'
import StatusStrip from './StatusStrip.vue'
import ActivityList from './ActivityList.vue'
import RunRail from './RunRail.vue'
import RunDetail from './RunDetail.vue'
import SchedulerPanel from 'src/components/scheduler/SchedulerPanel.vue'
import cicdService from 'src/services/cicdService'
import productService from 'src/services/productService'
import generationStore from 'stores/generationStore'
import { usePortfolio } from 'src/composables/usePortfolio'
import { useDeploymentsOverview } from 'src/composables/useDeploymentsOverview'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

// What is happening with the generations and syncs of everything (no id), of one SPL (`lineId`) or of one product (`productId`): the same
// counters, the same list of what needs a person, the same charts and the same list of runs at each level.
const props = defineProps({
  lineId: { type: String, default: null },
  productId: { type: String, default: null },
  /** The merge request of a run, when the page knows it (the product page asks its host). */
  mrOf: { type: Function, default: () => null },
  /** Lets the page add what only it knows to a run (the state of its checks). */
  decorate: { type: Function, default: (run) => run },
  /** Whether a generation is started by the page that hosts this (it has the dialogs); otherwise the product is opened. */
  generateHere: { type: Boolean, default: false },
  /** The days the numbers are of; the frame of the page chooses it. */
  period: { type: Number, default: 14 },
})
const emit = defineEmits(['generate', 'detail'])
const instance = getCurrentInstance()
const t = useT()
const router = instance.proxy.$router

const data = ref(null)
const loading = ref(true)
let timer = null
let sequence = 0

const scoped = computed(() => Boolean(props.lineId || props.productId))
const load = async () => {
  const mine = ++sequence
  try {
    const overview = await cicdService.overview({ lineId: props.lineId, productId: props.productId, days: props.period })
    if (mine !== sequence) return
    data.value = overview
  } catch (error) {
    if (mine === sequence) notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    if (mine === sequence) loading.value = false
  }
}
watch([() => props.lineId, () => props.productId, () => props.period], () => { loading.value = true; load() })
// Esc goes back to the overview, unless the person is typing or has a dialog open
const onKey = (event) => {
  if (event.key !== 'Escape' || !selectedId.value || event.defaultPrevented) return
  if (event.target?.closest?.('input, textarea, select, [role="dialog"]') || document.querySelector('.p-dialog')) return
  closeChecks()
}
onMounted(() => { load(); timer = setInterval(load, 20000); document.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('keydown', onKey) })

// a generation that ends is a run more
const finished = computed(() => generationStore.jobs.filter((j) => ['success', 'warning', 'error', 'cancelled'].includes(j.status)).length)
watch(finished, load)

// what was saved and no generation has put in the code: the products of the portfolio, as the deployments page always asked for
const { products: portfolio } = usePortfolio({ statuses: false })
const overviewOfProducts = useDeploymentsOverview({ source: portfolio })
let asked = false
watch(() => (portfolio.value ?? []).length, (count) => { if (count > 0 && !asked) { asked = true; overviewOfProducts.load() } }, { immediate: true })
const inScope = (p) => (!props.lineId || String(p.lineId) === props.lineId) && (!props.productId || String(p.id) === props.productId)
const orphanIds = computed(() => new Set((portfolio.value ?? []).filter((p) => p.lineDeleted).map((p) => String(p._id))))
const pending = computed(() => overviewOfProducts.pending.value.filter((p) => inScope(p) && !orphanIds.value.has(String(p.id))))

const liveRuns = computed(() => generationStore.jobs
  .filter((job) => ['pending', 'running'].includes(job.status)
    && (!props.lineId || String(job.lineId) === props.lineId) && (!props.productId || String(job.productId) === props.productId))
  .map((job) => ({
    id: `live-${job.id}`, kind: 'generation', live: true, productId: String(job.productId), productName: job.productName, lineId: job.lineId,
    lineName: job.lineName, version: job.toVersion ?? null, stage: 'derive', state: 'run', at: job.startedAt, cancellable: !job.cancelling, cancelling: job.cancelling, queue: job.queue,
  })))
const runs = computed(() => [...liveRuns.value, ...(data.value?.runs ?? [])].map((run) => props.decorate(run)))

// ── the checks of one run, beside the list of runs ──────────────────────────────────────────────────────────────
const selectedId = ref(null)
const railFolded = ref(false)
const selectedRun = computed(() => runs.value.find((run) => run.id === selectedId.value) ?? null)
const select = (run) => { selectedId.value = run.id }
const narrowDay = computed(() => (typeof instance.proxy.$route?.query?.day === 'string' ? instance.proxy.$route.query.day : null))
const narrowOutcome = computed(() => {
  const value = instance.proxy.$route?.query?.outcome
  return ['success', 'warning', 'error', 'cancelled'].includes(value) ? value : null
})
const narrowStatus = computed(() => {
  const value = instance.proxy.$route?.query?.status
  return ['bad', 'stop', 'run', 'wait', 'ok'].includes(value) ? value : null
})
const setStatus = (status) => {
  const { status: _status, ...rest } = instance.proxy.$route.query
  router.replace({ query: status ? { ...rest, status } : rest })
}
const clearNarrowing = () => {
  const { day: _day, outcome: _outcome, ...rest } = instance.proxy.$route.query
  router.replace({ query: rest })
}
const closeChecks = () => { selectedId.value = null }
// the list is read again every few seconds: if the run is gone from it, the detail goes too
watch(selectedRun, (run) => { if (selectedId.value && !run) closeChecks() })
watch(selectedId, (id) => emit('detail', Boolean(id)))

const counts = computed(() => data.value?.counts ?? { runningSyncs: 0, awaitingMerge: 0, outdated: 0, failed: 0, products: 0 })
const waiting = computed(() => runs.value.filter((run) => run.state === 'wait').length)
const running = computed(() => liveRuns.value.length + counts.value.runningSyncs)
const failedNow = computed(() => counts.value.failed)

const cells = computed(() => [
  { key: 'generate', label: t('cicdview.cell_generate'), value: pending.value.length, tone: pending.value.length ? 'warn' : null, sub: t('cicdview.cell_generate_sub'), hint: t('cicdview.cell_generate_hint') },
  { key: 'running', label: t('cicdview.cell_running'), value: running.value, sub: t('cicdview.cell_running_sub', { g: liveRuns.value.length, s: counts.value.runningSyncs }) },
  { key: 'waiting', label: t('cicdview.cell_waiting'), value: Math.max(waiting.value, counts.value.awaitingMerge), tone: waiting.value || counts.value.awaitingMerge ? 'warn' : null, sub: t('cicdview.cell_waiting_sub') },
  { key: 'outdated', label: t('cicdview.cell_outdated'), value: counts.value.outdated, tone: counts.value.outdated ? 'sync' : null, sub: t('cicdview.cell_outdated_sub', { n: counts.value.products }), hint: t('cicdview.cell_outdated_hint'), action: counts.value.outdated ? t('cicdview.sync_now') : null },
  { key: 'failed', label: t('cicdview.cell_failed', { n: props.period }), value: failedNow.value, tone: failedNow.value ? 'bad' : null, sub: rate.value == null ? '' : t('cicdview.rate', { n: rate.value }) },
])

// ── what needs a person ─────────────────────────────────────────────────────────────────────────────────────────
const busy = ref(null)
const syncOne = async (id) => {
  busy.value = id
  try {
    const run = await productService.syncProduct({ id })
    notify({ type: run.status === 'failed' ? 'negative' : 'positive', message: t(`automation.done_${run.status}`, { n: run.files }) })
    await load()
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    busy.value = null
  }
}
const openProduct = (id) => router.push(`/products/${id}?tab=cicd`)
const openMr = (run) => {
  const mr = props.mrOf(run) ?? run.mr
  if (run.kind === 'sync' && mr?.number) router.push({ path: `/products/${run.productId}`, query: { tab: 'mrs', mr: String(mr.number) } })
  else if (mr?.url) window.open(mr.url, '_blank', 'noopener')
  else openProduct(run.productId)
}
const retryRun = async (run) => {
  if (run.kind === 'sync') return syncOne(run.productId)
  generationStore.enqueue([{ _id: run.productId, name: run.productName, lineId: run.lineId, lineName: run.lineName, deployable: true }])
  notify({ type: 'positive', message: t('cicdview.retrying', { n: 1 }) })
}
const cancelRun = (run) => {
  const cancelled = generationStore.cancel(run.id.replace(/^live-/, ''))
  if (!cancelled) notify({ type: 'warning', message: t('cicdview.cant_cancel') })
}
const retryFailed = async (failed) => {
  const generations = failed.filter((run) => run.kind !== 'sync')
  if (generations.length) {
    generationStore.enqueue(generations.map((run) => ({ _id: run.productId, name: run.productName, lineId: run.lineId, lineName: run.lineName, deployable: true })))
  }
  notify({ type: 'positive', message: t('cicdview.retrying', { n: failed.length }) })
  for (const run of failed.filter((item) => item.kind === 'sync')) await syncOne(run.productId)
}
const attention = computed(() => {
  const items = []
  const seen = new Set()
  for (const run of runs.value) {
    // only the latest run of a product says how it stands
    if (seen.has(run.productId) || run.live) continue
    seen.add(run.productId)
    const kind = t(`cicdview.kind_${run.kind}`)
    if (run.state === 'bad') items.push({ key: `bad-${run.id}`, tone: 'bad', product: run.productName, line: run.lineName, why: t('cicdview.why_failed', { kind, version: run.version ? `v${run.version}` : '' }), tag: t('cicdview.tag_failed'), action: t('cicdview.act_view'), run: () => openProduct(run.productId) })
    else if (run.state === 'wait') items.push({ key: `wait-${run.id}`, tone: 'warn', product: run.productName, line: run.lineName, why: t('cicdview.why_waiting', { kind }), tag: t('cicdview.tag_waiting'), action: props.mrOf(run) ?? run.mr ? t('cicdview.act_open_mr') : t('cicdview.act_view'), run: () => openMr(run) })
  }
  for (const p of data.value?.outdated ?? []) {
    items.push({ key: `old-${p.productId}`, tone: 'sync', product: p.name, line: null, why: t('cicdview.why_outdated'), tag: t('cicdview.tag_outdated'), action: t('cicdview.sync_now'), busy: busy.value === p.productId, run: () => syncOne(p.productId) })
  }
  for (const p of pending.value) {
    items.push({ key: `gen-${p.id}`, tone: 'warn', product: p.name, line: p.line, why: t('cicdview.why_pending'), tag: t('cicdview.tag_pending'), action: t('cicdview.act_generate'), run: () => (props.generateHere ? emit('generate', p) : openProduct(p.id)) })
  }
  return items.slice(0, 8)
})
const onCell = async (key) => {
  if (key === 'outdated') for (const p of data.value?.outdated ?? []) await syncOne(p.productId)
}

// ── charts ──────────────────────────────────────────────────────────────────────────────────────────────────────
const series = computed(() => data.value?.series ?? [])
const maxDay = computed(() => Math.max(1, ...series.value.map((d) => d.total)))
const rate = computed(() => {
  const total = series.value.reduce((n, d) => n + d.total, 0)
  return total ? Math.round(((total - series.value.reduce((n, d) => n + d.error, 0)) / total) * 100) : null
})
const FRESH = ['recent', 'stale7', 'stale30', 'stale90', 'never']
const FRESH_TONE = { recent: 'ok', stale7: 'ok', stale30: 'warn', stale90: 'bad', never: 'bad' }
const fresh = computed(() => FRESH.map((key) => ({ key, n: data.value?.freshness?.[key] ?? 0, tone: FRESH_TONE[key] })))
const freshMax = computed(() => Math.max(1, ...fresh.value.map((f) => f.n)))
const failing = computed(() => data.value?.topFailing ?? [])
const failingMax = computed(() => Math.max(1, ...failing.value.map((f) => f.error + f.warning)))
</script>

<template>
  <div v-if="selectedId" class="cicd-detail" name="cicd-split">
    <nav class="cicd-crumb" :aria-label="$t('cicdview.back_to_overview')">
      <button type="button" class="cicd-crumb__back" name="cicd-back" @click="closeChecks">
        <i class="pi pi-arrow-left" aria-hidden="true" /> {{ $t('cicdview.back_to_overview') }}
      </button>
      <i class="pi pi-angle-right cicd-crumb__sep" aria-hidden="true" />
      <span v-if="selectedRun" class="cicd-crumb__here" aria-current="page">
        {{ selectedRun.productName }}<template v-if="selectedRun.version"> · v{{ selectedRun.version }}</template>
      </span>
      <kbd class="cicd-crumb__key" :title="$t('cicdview.esc_hint')">Esc</kbd>
    </nav>
    <div class="cicd-split" :class="{ 'cicd-split--folded': railFolded }">
      <RunRail :runs="runs" :selected="selectedId" :collapsed="railFolded" :show-product="!productId" @select="select" @toggle="railFolded = !railFolded" />
      <div class="cicd-split__main">
        <RunDetail v-if="selectedRun" :run="selectedRun" :mr="mrOf(selectedRun)" :show-product="!productId">
          <template v-if="$slots['run-steps']" #steps="{ run }"><slot name="run-steps" :run="run" /></template>
        </RunDetail>
      </div>
    </div>
  </div>
  <div v-else class="cicd-status" name="cicd-status">
    <StatusStrip :cells="cells" @action="onCell" />

    <section class="ln-block" name="cicd-attention">
      <header class="ln-block__head">
        <span class="ln-block__title">{{ $t('cicdview.attention') }}</span><span class="ln-block__rule" />
        <span v-if="attention.length" class="ln-row__note">{{ $t('cicdview.attention_n', { n: attention.length }) }}</span>
      </header>
      <p v-if="!attention.length" class="ln-block__empty">{{ $t('cicdview.attention_none') }}</p>
      <ul v-else class="attention">
        <li v-for="item in attention" :key="item.key" class="attention__row" :name="`attention-${item.key}`">
          <span class="attention__dot" :class="`attention__dot--${item.tone}`" />
          <span class="attention__text"><span><strong>{{ item.product }}</strong><span v-if="item.line" class="attention__muted"> · {{ item.line }}</span></span><small>{{ item.why }}</small></span>
          <span class="attention__tag" :class="`attention__tag--${item.tone}`">{{ item.tag }}</span>
          <button type="button" class="ln-link" :class="{ 'ln-link--sync': item.tone === 'sync' }" :disabled="item.busy" @click="item.run()">{{ item.action }}</button>
        </li>
      </ul>
    </section>

    <section class="ln-block" name="cicd-trend">
      <header class="ln-block__head"><span class="ln-block__title">{{ $t('cicdview.trend') }}</span><span class="ln-block__rule" /><span class="ln-row__note">{{ $t('cicdview.last_days', { n: props.period }) }}</span></header>
      <Skeleton v-if="loading && !data" height="9rem" />
      <div v-else class="trend">
        <div class="trend__card trend__card--wide" :class="{ 'trend__card--full': productId }" name="chart-runs">
          <div class="trend__head"><strong>{{ $t('cicdview.chart_title') }}</strong><span>{{ $t('cicdview.chart_unit') }}</span><span v-if="rate !== null" class="trend__rate">{{ $t('cicdview.rate', { n: rate }) }}</span></div>
          <p class="trend__sub">{{ $t('cicdview.chart_sub') }}</p>
          <div class="bars" role="img" :aria-label="$t('cicdview.chart_title')">
            <div v-for="d in series" :key="d.date" class="bars__col" :title="`${d.date}: ${d.success} · ${d.warning} · ${d.error}`">
              <span class="bars__seg bars__seg--ok" :style="{ height: `${d.success / maxDay * 100}%` }" />
              <span class="bars__seg bars__seg--warn" :style="{ height: `${d.warning / maxDay * 100}%` }" />
              <span class="bars__seg bars__seg--bad" :style="{ height: `${d.error / maxDay * 100}%` }" />
            </div>
          </div>
          <div class="trend__legend">
            <span><i class="bars__seg--ok" />{{ $t('cicdview.legend_ok') }}</span><span><i class="bars__seg--warn" />{{ $t('cicdview.legend_warn') }}</span><span><i class="bars__seg--bad" />{{ $t('cicdview.legend_bad') }}</span>
          </div>
        </div>

        <div v-if="!productId" class="trend__card" name="chart-fresh">
          <div class="trend__head"><strong>{{ $t('cicdview.fresh_title') }}</strong><span>{{ $t('cicdview.fresh_unit') }}</span></div>
          <p class="trend__sub">{{ $t('cicdview.fresh_sub') }}</p>
          <div v-for="f in fresh" :key="f.key" class="hbar">
            <span>{{ $t(`cicdview.fresh_${f.key}`) }}</span><span class="hbar__track"><i :class="`hbar__fill--${f.tone}`" :style="{ width: `${f.n / freshMax * 100}%` }" /></span><span class="hbar__num">{{ f.n }}</span>
          </div>
        </div>

        <div v-if="!productId" class="trend__card" name="chart-failing">
          <div class="trend__head"><strong>{{ $t('cicdview.fail_title') }}</strong><span>{{ $t('cicdview.last_days', { n: props.period }) }}</span></div>
          <p class="trend__sub">{{ $t('cicdview.fail_sub') }}</p>
          <p v-if="!failing.length" class="ln-block__empty">{{ $t('cicdview.fail_none') }}</p>
          <div v-for="f in failing" :key="f.productId" class="hbar">
            <span class="hbar__name">{{ f.name }}</span><span class="hbar__track"><i class="hbar__fill--bad" :style="{ width: `${(f.error + f.warning) / failingMax * 100}%` }" /></span><span class="hbar__num">{{ f.error + f.warning }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="ln-block" name="cicd-planner">
      <header class="ln-block__head"><span class="ln-block__title">{{ $t('cicdview.cfg_scheduler') }}</span><span class="ln-block__rule" /></header>
      <SchedulerPanel :line-id="lineId" :product-id="productId" :show-recent="false" compact />
    </section>

    <section class="ln-block" name="cicd-runs">
      <header class="ln-block__head"><span class="ln-block__title">{{ $t('cicdview.activity') }}</span><span class="ln-block__rule" /><span class="ln-row__note">{{ $t('cicdview.activity_hint') }}</span></header>
      <Skeleton v-if="loading && !data" height="8rem" />
      <ActivityList
        v-else :runs="runs" :show-line="!lineId && !productId" :show-product="!productId"
        :day="narrowDay" :outcome="narrowOutcome" :status="narrowStatus"
        @select="select" @clear-narrowing="clearNarrowing" @update:status="setStatus"
        @retry="retryRun" @cancel="cancelRun" @open-mr="openMr" @retry-failed="retryFailed"
      />
    </section>
  </div>
</template>

<style scoped>
.cicd-status { display: flex; flex-direction: column; gap: 14px; }
.attention { list-style: none; margin: 0; padding: 0; }
.attention__row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--card-border); }
.attention__row:first-child { border-top: 0; }
.attention__text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 0.8125rem; }
.attention__text small { color: var(--text-muted); font-size: 0.75rem; }
.attention__muted { color: var(--text-muted); font-weight: 400; }
.attention__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--text-muted); }
.attention__dot--bad { background: var(--status-bad); } .attention__dot--warn { background: var(--status-warn); } .attention__dot--sync { background: var(--sync); }
.attention__tag { padding: 1px 9px; border-radius: 99px; font-size: 0.75rem; font-weight: 500; background: var(--p-content-hover-background); white-space: nowrap; }
.attention__tag--bad { color: var(--status-bad); background: color-mix(in srgb, var(--status-bad) 14%, transparent); }
.attention__tag--warn { color: var(--status-warn); background: color-mix(in srgb, var(--status-warn) 16%, transparent); }
.attention__tag--sync { color: var(--sync); background: color-mix(in srgb, var(--sync) 15%, transparent); }
.trend { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 20px 32px; margin-top: 4px; }
.trend__card { grid-column: span 6; min-width: 0; }
.trend__card--wide { grid-column: span 12; }
/* the chart is the tall one on the left; the two rankings are stacked beside it */
@media (min-width: 1000px) { .trend__card { grid-column: 8 / span 5; } .trend__card--wide { grid-column: 1 / span 7; grid-row: span 2; } .trend__card--full { grid-column: 1 / -1; grid-row: auto; } }
@media (max-width: 700px) { .trend__card, .trend__card--wide { grid-column: span 12; } }
.trend__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 0.8125rem; }
.trend__head span { color: var(--text-muted); font-size: 0.75rem; }
.trend__rate { margin-left: auto; color: var(--status-ok) !important; font-weight: 600; }
.trend__sub { margin: 2px 0 10px; font-size: 0.75rem; color: var(--text-muted); }
.bars { display: flex; align-items: flex-end; gap: 4px; height: 150px; border-bottom: 1px solid var(--card-border); }
.bars__col { flex: 1; height: 100%; display: flex; flex-direction: column-reverse; gap: 1px; min-width: 0; }
.bars__seg { display: block; border-radius: 2px 2px 0 0; }
.bars__seg--ok { background: var(--status-ok); } .bars__seg--warn { background: var(--status-warn); } .bars__seg--bad { background: var(--status-bad); }
.trend__legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; font-size: 0.75rem; color: var(--text-muted); }
.trend__legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
.hbar { display: grid; grid-template-columns: 8.5rem 1fr 2rem; gap: 8px; align-items: center; margin: 6px 0; font-size: 0.75rem; }
.hbar__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hbar__track { height: 8px; border-radius: 4px; background: var(--p-content-hover-background); overflow: hidden; }
.hbar__track i { display: block; height: 100%; border-radius: 4px; }
.hbar__fill--ok { background: var(--status-ok); } .hbar__fill--warn { background: var(--status-warn); } .hbar__fill--bad { background: var(--status-bad); }
.hbar__num { text-align: right; color: var(--text-muted); }
.cicd-split { display: flex; gap: 20px; align-items: flex-start; }
.cicd-split__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.cicd-detail { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.cicd-crumb { display: flex; align-items: center; gap: 10px; font-size: 0.875rem; }
.cicd-crumb__back {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 99px; font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--p-primary-color); color: var(--p-primary-color); background: var(--p-highlight-soft);
}
.cicd-crumb__back:hover { background: color-mix(in srgb, var(--p-primary-color) 22%, transparent); }
.cicd-crumb__back:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.cicd-crumb__sep { color: var(--text-muted); font-size: 0.75rem; }
.cicd-crumb__here { font-weight: 600; color: var(--text-heading); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cicd-crumb__key { margin-left: auto; padding: 1px 7px; border: 1px solid var(--card-border); border-radius: 6px; font: inherit; font-size: 0.6875rem; color: var(--text-muted); }
@media (max-width: 900px) { .cicd-split { flex-direction: column; align-items: stretch; } }
</style>
