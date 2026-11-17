<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Skeleton from 'primevue/skeleton'
import PipelineJobs from 'src/components/product/PipelineJobs.vue'
import productService from 'src/services/productService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { pipelineColorVar, pipelineWord } from 'src/utils/pipelineStatus'

// The merge request of a run with its pipelines and the jobs of the one that is open: the latest, or an older one the person picks.
// While the pipeline runs it is read again every few seconds.
const props = defineProps({
  productId: { type: String, required: true },
  number: { type: Number, required: true },
})
const t = useT()

const detail = ref(null)
const loading = ref(false)
const picked = ref(null)
const pickedJobs = ref(null)
let poll = null

const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const running = (pipeline) => Boolean(pipeline) && !['success', 'failed', 'canceled', 'skipped', 'manual'].includes(pipeline.status)

const load = async ({ quiet = false } = {}) => {
  const mine = `${props.productId}:${props.number}`
  if (!quiet) loading.value = true
  try {
    const answer = await productService.getMergeRequest({ id: props.productId, number: props.number })
    if (mine === `${props.productId}:${props.number}`) detail.value = answer
  } catch (error) {
    if (!quiet) fail(error)
  } finally {
    loading.value = false
  }
}

const pick = async (pipeline) => {
  if (pipeline.id === detail.value?.pipeline?.id) { picked.value = null; pickedJobs.value = null; return }
  picked.value = pipeline.id
  pickedJobs.value = null
  try {
    pickedJobs.value = (await productService.getPipelineById({ id: props.productId, pipelineId: pipeline.id })).jobs
  } catch (error) {
    fail(error)
  }
}
const shownJobs = computed(() => (picked.value !== null ? pickedJobs.value ?? [] : detail.value?.jobs ?? []))
const shownPipeline = computed(() => (picked.value !== null ? detail.value?.pipelines.find((p) => p.id === picked.value) : detail.value?.pipeline) ?? null)

const schedule = () => {
  clearTimeout(poll)
  if (!running(detail.value?.pipeline)) return
  poll = setTimeout(async () => { await load({ quiet: true }); schedule() }, 8000)
}
watch(detail, schedule)
watch(() => [props.productId, props.number], () => {
  picked.value = null
  pickedJobs.value = null
  detail.value = null
  load()
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(poll))

const dateOf = (value) => (value ? new Date(value).toLocaleString() : '')
const checksLabel = (pipeline) => (pipeline ? t(`generation.gr_pipeline_${pipelineWord(pipeline.status)}`) : t('cicd.checks_none'))
</script>

<template>
  <div class="rchecks" name="cicd-mr-detail">
    <div v-if="loading || !detail" class="rchecks__loading"><Skeleton v-for="i in 3" :key="i" height="40px" /></div>
    <template v-else>
      <div class="rchecks__mr">
        <i class="pi pi-code-branch rchecks__mr-icon" aria-hidden="true" />
        <div class="rchecks__mr-text">
          <span class="rchecks__title"><span class="rchecks__mono">!{{ detail.number }}</span> {{ detail.title }}</span>
          <span class="rchecks__meta">
            <span class="rchecks__chip" :class="`rchecks__chip--${detail.state}`">{{ $t(`cicd.state_${detail.state ?? 'opened'}`) }}</span>
            <span class="rchecks__mono">{{ detail.sourceBranch }} → {{ detail.targetBranch }}</span>
            <span v-if="detail.author">{{ detail.author }}</span>
            <span>{{ dateOf(detail.mergedAt ?? detail.createdAt) }}</span>
          </span>
        </div>
        <a v-if="detail.webUrl" class="rchecks__link" :href="detail.webUrl" target="_blank" rel="noopener noreferrer">
          {{ $t('cicd.open_in_git') }} <i class="pi pi-external-link" aria-hidden="true" />
        </a>
      </div>

      <div class="rchecks__pipe">
        <div v-if="detail.pipelines.length > 1" class="rchecks__seg" role="group" name="cicd-pipelines">
          <button
            v-for="pipeline in detail.pipelines" :key="pipeline.id" type="button"
            class="rchecks__tab" :class="{ 'rchecks__tab--on': (shownPipeline?.id ?? null) === pipeline.id }"
            :name="`cicd-pipeline-${pipeline.id}`" :title="dateOf(pipeline.createdAt)" @click="pick(pipeline)"
          >
            <i class="rchecks__dot" :style="{ background: pipelineColorVar(pipeline.status) }" aria-hidden="true" />#{{ pipeline.id }}
          </button>
        </div>
        <span v-else-if="shownPipeline" class="rchecks__single">Pipeline #{{ shownPipeline.id }}</span>
        <span v-if="shownPipeline" class="rchecks__checks" name="cicd-detail-checks" :style="{ color: pipelineColorVar(shownPipeline.status) }">{{ checksLabel(shownPipeline) }}</span>
        <a v-if="shownPipeline?.webUrl" class="rchecks__link" :href="shownPipeline.webUrl" target="_blank" rel="noopener noreferrer" :title="$t('cicd.open_in_git')" :aria-label="$t('cicd.open_in_git')">
          <i class="pi pi-external-link" aria-hidden="true" />
        </a>
      </div>

      <p v-if="!shownJobs.length" class="rchecks__muted" name="cicd-no-jobs">{{ shownPipeline ? $t('cicd.no_jobs') : $t('cicd.checks_none') }}</p>
      <PipelineJobs
        v-else :key="shownPipeline?.id" :product-id="productId" :jobs="shownJobs" :pipeline-id="shownPipeline?.id ?? null" name="cicd-jobs"
        @changed="load({ quiet: true })"
      />
    </template>
  </div>
</template>

<style scoped>
.rchecks { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.rchecks__loading { display: flex; flex-direction: column; gap: 8px; }
.rchecks__mr { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; background: var(--card-bg); border: 1px solid var(--card-border); }
.rchecks__mr-icon { flex: none; color: var(--text-muted); }
.rchecks__mr-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rchecks__title { font-size: 0.875rem; font-weight: 600; color: var(--text-heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rchecks__meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 0.75rem; color: var(--text-muted); }
.rchecks__muted { margin: 0; color: var(--text-muted); font-size: 0.8125rem; }
.rchecks__mono { font-family: var(--font-mono); }
.rchecks__link { font-size: 0.8125rem; color: var(--p-primary-color); text-decoration: none; white-space: nowrap; }
.rchecks__link:hover { text-decoration: underline; }
.rchecks__chip { padding: 0 8px; border-radius: 99px; font-size: 0.6875rem; font-weight: 600; background: var(--p-content-hover-background); color: var(--text-muted); }
.rchecks__chip--opened { color: var(--p-primary-color); background: var(--p-highlight-soft); }
.rchecks__chip--merged { color: var(--sync); background: var(--sync-soft); }
.rchecks__chip--closed { color: var(--status-bad); background: color-mix(in srgb, var(--status-bad) 14%, transparent); }
.rchecks__pipe { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rchecks__seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--p-content-hover-background); max-width: 100%; overflow-x: auto; }
.rchecks__tab { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 0; border-radius: 7px; background: none; font: inherit; font-size: 0.75rem; color: var(--text-muted); cursor: pointer; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rchecks__tab:hover { color: var(--text-heading); }
.rchecks__tab:focus-visible { outline: 2px solid var(--p-primary-color); }
.rchecks__tab--on { background: var(--card-bg); color: var(--text-heading); font-weight: 600; box-shadow: var(--card-shadow); }
.rchecks__dot { width: 7px; height: 7px; border-radius: 50%; }
.rchecks__single { font-size: 0.8125rem; font-weight: 600; color: var(--text-heading); }
.rchecks__checks { font-size: 0.8125rem; font-weight: 600; }
.rchecks__pipe .rchecks__link { margin-left: auto; }
</style>
