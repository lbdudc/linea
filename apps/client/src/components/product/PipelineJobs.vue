<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PrimeButton from 'primevue/button'
import productService from 'src/services/productService'
import { pipelineColorVar, pipelineWord } from 'src/utils/pipelineStatus'
import { useT } from 'src/composables/useT'
import { notify, errorMessage } from 'src/composables/useNotify'

/**
 * The jobs of a pipeline, each one opening to what it printed. The output of a job that is running is read again every few seconds
 * while it is open, and follows the end of it unless the person scrolls up. A failed job opens by itself: it is what is wanted first.
 */
const props = defineProps({
  productId: { type: String, required: true },
  jobs: { type: Array, required: true },
  // open the output of the failed jobs without being asked
  openFailed: { type: Boolean, default: true },
  // the pipeline they belong to: with it, the whole pipeline can be stopped from here
  pipelineId: { type: [Number, String], default: null },
  // whether these jobs are still being followed: if not, a running job is no longer known to be running
  live: { type: Boolean, default: true },
})
const emit = defineEmits(['changed'])
const t = useT()

const POLL_MS = 4000
const LINES = 400

const open = ref({}) // job id -> true | false, what the person chose
const outputs = ref({}) // job id -> { text, loading, error }
const panes = new Map() // job id -> the <pre>, to follow the end of it
let timer = null

const ACTIVE = ['running', 'pending', 'created', 'waiting_for_resource', 'preparing']
const isActive = (job) => ACTIVE.includes(job.status)
const isRunning = (job) => job.status === 'running'
const isOpen = (job) => (job.id in open.value ? open.value[job.id] : props.openFailed && job.status === 'failed')
const QUEUED = ['pending', 'created', 'waiting_for_resource', 'preparing']
const wordOf = (status) => (QUEUED.includes(status) ? t('cicd.status_queued') : t(`generation.gr_pipeline_${pipelineWord(status)}`))
const duration = (seconds) => (seconds == null ? '' : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`)

// the host tells how long a running job has been going only when it is asked: the seconds in between are counted here
const now = ref(Date.now())
const anchors = new Map()
let clock = null
const elapsedSince = (anchor, at) => anchor.duration + Math.floor((at - anchor.at) / 1000)
const elapsed = (job) => {
  const anchor = anchors.get(job.id)
  return props.live && anchor ? elapsedSince(anchor, now.value) : job.duration
}
watch(() => props.jobs, (jobs) => {
  const at = Date.now()
  for (const job of jobs) {
    const anchor = anchors.get(job.id)
    if (job.status !== 'running') anchors.delete(job.id)
    else if (!anchor || (job.duration ?? 0) >= elapsedSince(anchor, at)) anchors.set(job.id, { duration: job.duration ?? 0, at })
  }
  now.value = at
}, { immediate: true })
watch(() => props.live && props.jobs.some((job) => job.status === 'running'), (ticking) => {
  clearInterval(clock)
  clock = ticking ? setInterval(() => { now.value = Date.now() }, 1000) : null
}, { immediate: true })

const ICONS = {
  success: 'pi pi-check-circle', failed: 'pi pi-times-circle', running: 'pi pi-spin pi-spinner', canceled: 'pi pi-ban',
  skipped: 'pi pi-minus-circle', manual: 'pi pi-play-circle',
}
const iconOf = (job) => ICONS[job.status] ?? (QUEUED.includes(job.status) ? 'pi pi-clock' : 'pi pi-circle')
// jobs grouped by stage, in the order the pipeline runs them
const stages = computed(() => {
  const groups = new Map()
  for (const job of props.jobs) {
    const key = job.stage || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(job)
  }
  return [...groups].map(([stage, jobs]) => ({ stage, jobs }))
})
const counts = computed(() => {
  const n = { success: 0, failed: 0, active: 0, other: 0 }
  for (const job of props.jobs) {
    if (job.status === 'success') n.success += 1
    else if (job.status === 'failed') n.failed += 1
    else if (isActive(job)) n.active += 1
    else n.other += 1
  }
  return n
})
const share = (n) => `${(n / Math.max(props.jobs.length, 1)) * 100}%`

const canceling = ref(false)
// stops one job, or the whole pipeline when no job is given; whoever shows the jobs reads them again
const cancel = async (job = null) => {
  canceling.value = true
  try {
    if (job) await productService.cancelJob({ id: props.productId, jobId: job.id })
    else await productService.cancelPipeline({ id: props.productId, pipelineId: props.pipelineId })
    emit('changed')
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    canceling.value = false
  }
}
const anyActive = () => props.jobs.some(isActive)

const follow = async (id) => {
  await nextTick()
  const pane = panes.get(id)
  if (pane && pane.dataset.pinned !== 'no') pane.scrollTop = pane.scrollHeight
}

const load = async (job) => {
  const current = outputs.value[job.id]
  if (!current) outputs.value = { ...outputs.value, [job.id]: { text: '', loading: true, error: false } }
  try {
    const { trace } = await productService.getJobTrace({ id: props.productId, jobId: job.id, lines: LINES })
    outputs.value = { ...outputs.value, [job.id]: { text: trace, loading: false, error: false } }
    follow(job.id)
  } catch {
    outputs.value = { ...outputs.value, [job.id]: { text: outputs.value[job.id]?.text ?? '', loading: false, error: true } }
  }
}

const toggle = (job) => {
  const next = !isOpen(job)
  open.value = { ...open.value, [job.id]: next }
  if (next) load(job)
}

const onScroll = (event) => {
  const pane = event.target
  // pinned to the end unless the person went up to read
  pane.dataset.pinned = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24 ? 'yes' : 'no'
}

const tick = () => {
  for (const job of props.jobs) if (isOpen(job) && isActive(job)) load(job)
}

// what is open and was not read yet is read when the jobs arrive (a failed job opens by itself); a job that has just
// finished is read once more, so its output is complete
watch(() => props.jobs.map((job) => `${job.id}:${job.status}`).join(','), (now, before) => {
  const was = new Map((before ?? '').split(',').filter(Boolean).map((entry) => entry.split(':')))
  for (const job of props.jobs) {
    if (!isOpen(job)) continue
    if (!outputs.value[job.id] || (was.has(String(job.id)) && was.get(String(job.id)) !== job.status)) load(job)
  }
}, { immediate: true })

watch(() => props.jobs.some((job) => isOpen(job) && isActive(job)), (live) => {
  clearInterval(timer)
  timer = live ? setInterval(tick, POLL_MS) : null
}, { immediate: true })

onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(clock)
})

const setPane = (id) => (element) => { if (element) panes.set(id, element); else panes.delete(id) }
</script>

<template>
  <div class="pjobs" name="pipeline-jobs">
    <div class="pjobs__summary">
      <div class="pjobs__meter" role="img" :aria-label="`${counts.success}/${jobs.length}`">
        <i class="pjobs__seg pjobs__seg--ok" :style="{ width: share(counts.success) }" />
        <i class="pjobs__seg pjobs__seg--run" :style="{ width: share(counts.active) }" />
        <i class="pjobs__seg pjobs__seg--bad" :style="{ width: share(counts.failed) }" />
        <i class="pjobs__seg pjobs__seg--off" :style="{ width: share(counts.other) }" />
      </div>
      <span class="pjobs__tally">
        <strong>{{ counts.success }}/{{ jobs.length }}</strong> {{ $t('cicdview.jobs_ok') }}<template v-if="counts.failed"> · <span class="pjobs__bad">{{ counts.failed }} {{ $t('cicdview.jobs_failed') }}</span></template>
      </span>
      <PrimeButton
        v-if="pipelineId !== null && anyActive()"
        text size="small" severity="danger" icon="pi pi-stop-circle" type="button" name="pipeline-cancel"
        :label="$t('cicd.cancel_pipeline')" :loading="canceling" @click="cancel()"
      />
    </div>

    <section v-for="group in stages" :key="group.stage" class="pjobs__stage">
      <h5 v-if="group.stage" class="pjobs__stage-name">{{ group.stage }}<span>{{ group.jobs.length }}</span></h5>
      <ul class="pjobs__list">
        <li v-for="job in group.jobs" :key="job.id" class="pjobs__job" :class="[`pjobs__job--${pipelineWord(job.status)}`, { 'pjobs__job--open': isOpen(job) }]" :name="`pjob-${job.name}`">
          <button type="button" class="pjobs__row" :aria-expanded="isOpen(job)" :name="`pjob-toggle-${job.name}`" @click="toggle(job)">
            <i class="pjobs__icon" :class="iconOf(job)" :style="{ color: pipelineColorVar(job.status) }" aria-hidden="true" />
            <span class="pjobs__name">{{ job.name }}</span>
            <span class="pjobs__status" :style="{ color: pipelineColorVar(job.status) }">{{ wordOf(job.status) }}</span>
            <span class="pjobs__time">{{ duration(elapsed(job)) }}</span>
            <span
              v-if="isActive(job)" class="pjobs__cancel" role="button" tabindex="0" :name="`pjob-cancel-${job.name}`"
              :title="$t('cicd.cancel_job')" :aria-label="$t('cicd.cancel_job')"
              @click.stop="cancel(job)" @keydown.enter.stop.prevent="cancel(job)"
            ><i class="pi pi-stop-circle" aria-hidden="true" /></span>
            <i :class="isOpen(job) ? 'pi pi-angle-up' : 'pi pi-angle-down'" class="pjobs__chevron" aria-hidden="true" />
          </button>

          <div v-if="isOpen(job)" class="pjobs__body">
            <div class="pjobs__bar">
              <span class="pjobs__muted">{{ $t('cicd.output') }}</span>
              <PrimeButton
                text size="small" icon="pi pi-refresh" type="button"
                :aria-label="$t('cicd.refresh')" :loading="outputs[job.id]?.loading" @click="load(job)"
              />
              <a v-if="job.webUrl" class="pjobs__link" :href="job.webUrl" target="_blank" rel="noopener noreferrer">
                {{ $t('cicd.open_job') }} <i class="pi pi-external-link" aria-hidden="true" />
              </a>
            </div>
            <pre
              :ref="setPane(job.id)" class="pjobs__trace" :name="`pjob-trace-${job.name}`"
              tabindex="0" @scroll="onScroll"
            >{{ outputs[job.id]?.text || (outputs[job.id]?.loading ? $t('cicd.loading') : outputs[job.id]?.error ? $t('cicd.output_error') : $t('cicd.output_empty')) }}</pre>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
.pjobs {
  display: flex; flex-direction: column; gap: 14px;

  &__summary { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 0.8125rem; }
  &__meter { flex: 1 1 160px; min-width: 120px; max-width: 320px; height: 8px; display: flex; gap: 2px; border-radius: 99px; overflow: hidden; background: var(--p-content-hover-background); }
  &__seg { display: block; height: 100%; &--ok { background: var(--status-ok); } &--run { background: var(--p-primary-color); } &--bad { background: var(--status-bad); } &--off { background: var(--card-border); } }
  &__tally { color: var(--text-muted); strong { color: var(--text-heading); font-variant-numeric: tabular-nums; } }
  &__bad { color: var(--status-bad); font-weight: 600; }

  &__stage { display: flex; flex-direction: column; gap: 6px; }
  &__stage-name {
    margin: 0; display: flex; align-items: center; gap: 8px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted);
    span { padding: 0 6px; border-radius: 99px; background: var(--p-content-hover-background); letter-spacing: 0; }
  }
  &__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  &__job {
    --tone: var(--card-border);
    border: 1px solid var(--card-border); border-left: 3px solid var(--tone); border-radius: 9px; background: var(--card-bg); overflow: hidden;
    &--failed { --tone: var(--status-bad); }
    &--success { --tone: var(--status-ok); }
    &--running { --tone: var(--p-primary-color); }
    &--open { box-shadow: var(--card-shadow); }
  }
  &__row {
    display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; background: none; border: none; cursor: pointer;
    color: inherit; font: inherit; font-size: 0.8125rem; text-align: left;
    &:hover { background: var(--p-content-hover-background); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
  }
  &__icon { font-size: 1rem; }
  &__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-heading); }
  &__muted { color: var(--text-muted); font-size: 0.8125rem; }
  &__status { font-size: 0.75rem; font-weight: 500; min-width: 64px; text-align: right; }
  &__time { min-width: 52px; text-align: right; color: var(--text-muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
  &__cancel { display: inline-flex; padding: 2px 4px; border-radius: 6px; color: var(--status-bad); &:hover { background: var(--p-content-hover-background); } }
  &__chevron { color: var(--text-muted); font-size: 0.75rem; }
  &__body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 6px; }
  &__bar { display: flex; align-items: center; gap: 8px; }
  &__link { margin-left: auto; font-size: 0.8125rem; color: var(--p-primary-color); text-decoration: none; &:hover { text-decoration: underline; } }
  &__trace {
    margin: 0; padding: 12px 14px; max-height: 360px; overflow: auto; border-radius: 8px; font-size: 0.75rem; line-height: 1.55;
    background: #0f172a; color: #e2e8f0; border: 1px solid #1e293b; font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word;
  }
}
</style>
