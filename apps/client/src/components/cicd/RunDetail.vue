<script setup>
import { ref, computed, watch, getCurrentInstance, useSlots } from 'vue'
import Skeleton from 'primevue/skeleton'
import RunStepper from './RunStepper.vue'
import RunChecks from './RunChecks.vue'
import LogItem from 'src/components/common/LogItem.vue'
import logService from 'src/services/logService'
import productService from 'src/services/productService'
import { relativeShort } from 'src/utils/relativeTime'
import { downloadBlob } from 'src/utils/download'
import { logToText } from 'src/utils/generationLog'

// Everything about one run in one place, top to bottom: what it is and how far it got, what it did, and the checks of its merge request.
// Nothing here needs a click to find out that it exists; the only buttons are the ones that go somewhere else.
const props = defineProps({
  run: { type: Object, required: true },
  /** The merge request of the run when the page already knows it, as `{ number }`. */
  mr: { type: Object, default: null },
  showProduct: { type: Boolean, default: true },
})
const slots = useSlots()
// the page can tell a generation that already ran by its steps, in the place of what is known of it here
const hasSteps = computed(() => Boolean(slots.steps) && props.run.kind === 'generation' && !props.run.live && Boolean(props.run.version))
const instance = getCurrentInstance()
const when = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')

const target = ref(null) // the merge request whose checks are shown, null when the run has none
const resolving = ref(true)
const logs = ref([])
const logsOpen = ref(false)
const bundling = ref(false)

const resolve = async () => {
  const run = props.run
  resolving.value = true
  target.value = null
  let number = props.mr?.number ?? run.mr?.number ?? null
  try {
    // a generation does not know its request: the one that brought its version
    if (!number && run.kind === 'generation' && !run.live && run.version) {
      const requests = await productService.listMergeRequests({ id: run.productId })
      number = requests.find((request) => request.kind === 'generation' && request.version === run.version)?.number ?? null
    }
  } catch { /* no checks to show */ }
  if (props.run.id === run.id) { target.value = number ? { productId: run.productId, number } : null; resolving.value = false }
}

const loadLogs = async () => {
  const run = props.run
  logs.value = []
  logsOpen.value = false
  if (run.kind !== 'generation' || run.live || !run.version) return
  try {
    const found = await logService.find({ id: run.productId, version: run.version })
    if (props.run.id === run.id) logs.value = found
  } catch { /* the summary stands without them */ }
}

const failed = computed(() => props.run.kind === 'generation' && ['error', 'cancelled'].includes(props.run.outcome))
const downloadLog = () => {
  const run = props.run
  const text = logToText({ logs: logs.value, translate: (key, params) => instance.proxy.$t(key, params), title: `${run.productName} v${run.version}` })
  downloadBlob(new Blob([text], { type: 'text/plain' }), `${run.productName}-v${run.version}-log.txt`)
}
const downloadBundle = async () => {
  const run = props.run
  bundling.value = true
  try {
    downloadBlob(await productService.downloadGenerationBundle({ id: run.productId, version: run.version }), `${run.productName}-v${run.version}-bundle.zip`)
  } catch { /* the log can still be downloaded on its own */ } finally {
    bundling.value = false
  }
}

watch(() => props.run.id, () => {
  if (hasSteps.value) return
  resolve()
  loadLogs()
}, { immediate: true })

const ICON = { ok: 'pi pi-check', run: 'pi pi-spin pi-spinner', wait: 'pi pi-clock', bad: 'pi pi-times', stop: 'pi pi-ban' }
const outcome = computed(() => (props.run.kind === 'sync'
  ? (props.run.status === 'unchanged' ? 'automation.status_unchanged' : null)
  : `deployments.outcome_${props.run.outcome ?? 'success'}`))
</script>

<template>
  <article class="rdetail" :class="`rdetail--${run.state}`" name="cicd-run-detail">
    <header class="rdetail__head">
      <span class="rdetail__badge"><i :class="ICON[run.state] ?? 'pi pi-circle'" aria-hidden="true" /></span>
      <div class="rdetail__who">
        <h3 class="rdetail__title">
          {{ showProduct ? run.productName : $t(`cicdview.kind_${run.kind}`) }}
          <span v-if="run.version" class="rdetail__ver">{{ run.kind === 'sync' ? '=' : '' }}v{{ run.version }}</span>
        </h3>
        <div class="rdetail__meta">
          <span class="rdetail__kind" :class="`rdetail__kind--${run.kind}`">{{ $t(`cicdview.kind_${run.kind}`) }}</span>
          <span v-if="run.lineName && showProduct">{{ run.lineName }}</span>
          <span>{{ when(run.at) }}</span>
        </div>
      </div>
      <span class="rdetail__state">{{ $t(`cicdview.state_${run.state}`) }}</span>
    </header>
    <RunStepper class="rdetail__steps" :stage="run.stage" :state="run.state" />

    <slot v-if="hasSteps" name="steps" :run="run" />
    <template v-else>
    <section class="rdetail__sec" name="cicd-run-summary">
      <h4><i class="pi pi-list" aria-hidden="true" /> {{ $t('cicdview.detail_changes') }}</h4>
      <template v-if="run.kind === 'sync'">
        <p>{{ run.status === 'unchanged' ? $t('automation.status_unchanged') : $t('automation.status_drift', { n: run.files ?? 0 }) }}</p>
        <p class="rdetail__muted">{{ $t('cicdview.sync_keeps_version') }}</p>
        <p v-if="run.reason" class="rdetail__muted">{{ $te(`automation.reason_${run.reason}`) ? $t(`automation.reason_${run.reason}`) : run.reason }}</p>
        <p v-if="run.featuresAdded?.length || run.featuresRemoved?.length" class="rdetail__muted" name="cicd-sync-features">
          {{ $t('cicdview.sync_features', { added: run.featuresAdded?.length ?? 0, removed: run.featuresRemoved?.length ?? 0 }) }}
          <span v-if="run.featuresAdded?.length">(+ {{ run.featuresAdded.join(', ') }})</span>
          <span v-if="run.featuresRemoved?.length">(− {{ run.featuresRemoved.join(', ') }})</span>
        </p>
        <router-link v-if="run.mr?.number" class="ln-link" name="cicd-open-mr" :to="{ path: `/products/${run.productId}`, query: { tab: 'mrs', mr: String(run.mr.number) } }">
          {{ $t('cicdview.sync_open_mr', { n: run.mr.number }) }}
        </router-link>
      </template>
      <template v-else>
        <p v-if="outcome">{{ $t(outcome) }}</p>
        <p v-if="run.live" class="rdetail__muted">{{ $t('cicdview.live_note') }}</p>
        <button v-if="logs.length" type="button" class="ln-link rdetail__toggle" name="run-log-toggle" :aria-expanded="logsOpen" @click="logsOpen = !logsOpen">
          {{ $t('generation.log_steps', { n: logs.length }) }} <i :class="logsOpen ? 'pi pi-angle-up' : 'pi pi-angle-down'" aria-hidden="true" />
        </button>
        <div v-if="logs.length" class="rdetail__downloads">
          <button type="button" class="ln-link" name="run-log-download" @click="downloadLog"><i class="pi pi-download" aria-hidden="true" /> {{ $t('generation.log_download') }}</button>
          <button v-if="failed" type="button" class="ln-link" name="run-bundle-download" :disabled="bundling" @click="downloadBundle"><i class="pi pi-box" aria-hidden="true" /> {{ $t('generation.bundle_download') }}</button>
        </div>
        <div v-if="logsOpen" class="rdetail__log" name="run-log"><LogItem v-for="(log, index) in logs" :key="index" :log="log" /></div>
      </template>
    </section>

    <section class="rdetail__sec" name="cicd-run-checks">
      <h4><i class="pi pi-verified" aria-hidden="true" /> {{ $t('cicdview.detail_checks') }}</h4>
      <Skeleton v-if="resolving" height="6rem" />
      <RunChecks v-else-if="target" :key="`${target.productId}:${target.number}`" :product-id="target.productId" :number="target.number" />
      <p v-else class="rdetail__empty" name="cicd-no-checks"><i class="pi pi-info-circle" aria-hidden="true" /> {{ $t('cicdview.no_checks_run') }}</p>
    </section>
    </template>
  </article>
</template>

<style scoped>
.rdetail { --tone: var(--text-muted); display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.rdetail--ok { --tone: var(--status-ok); } .rdetail--run { --tone: var(--p-primary-color); }
.rdetail--stop { --tone: var(--text-muted); } .rdetail--wait { --tone: var(--status-warn); } .rdetail--bad { --tone: var(--status-bad); }
.rdetail__head { display: flex; align-items: center; gap: 14px; }
.rdetail__badge { flex: none; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px; font-size: 1.125rem; color: var(--tone); background: color-mix(in srgb, var(--tone) 14%, transparent); }
.rdetail__who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rdetail__title { margin: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 1.125rem; font-weight: 600; color: var(--text-heading); }
.rdetail__ver { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.875rem; font-weight: 400; color: var(--text-muted); }
.rdetail__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.75rem; color: var(--text-muted); }
.rdetail__kind { padding: 1px 8px; border-radius: 99px; font-weight: 500; background: var(--p-highlight-soft); color: var(--p-primary-color); }
.rdetail__kind--sync { background: var(--sync-soft); color: var(--sync); }
.rdetail__state { flex: none; padding: 4px 12px; border-radius: 99px; font-size: 0.8125rem; font-weight: 600; color: var(--tone); background: color-mix(in srgb, var(--tone) 14%, transparent); }
.rdetail__steps { align-self: flex-start; }
.rdetail__sec { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px 16px; border-radius: 12px; background: var(--tile-bg); border: 1px solid var(--tile-border); font-size: 0.8125rem; }
.rdetail__sec h4 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 0.6875rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); }
.rdetail__sec p { margin: 0; }
.rdetail__muted { color: var(--text-muted); }
.rdetail__empty { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.rdetail__toggle { align-self: flex-start; }
.rdetail__downloads { display: flex; gap: 16px; flex-wrap: wrap; }
.rdetail__log { max-height: 280px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--card-bg); border: 1px solid var(--card-border); }
</style>
