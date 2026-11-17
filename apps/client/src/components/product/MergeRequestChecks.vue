<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import PrimeButton from 'primevue/button'
import PipelineJobs from 'src/components/product/PipelineJobs.vue'
import productService from 'src/services/productService'
import { pipelineColorVar, pipelineWord } from 'src/utils/pipelineStatus'
import { useT } from 'src/composables/useT'
import { notify, errorMessage } from 'src/composables/useNotify'

/**
 * The checks of a merge request (`number`, else the one of the latest generation), followed live: what a generation shows while LINEA waits for them
 * before merging. It asks again every few seconds until the pipeline is over. With `decidable`, a request whose checks are over and that
 * is still open can be merged, rejected, or have its checks run again from here.
 */
const props = defineProps({
  productId: { type: String, required: true },
  number: { type: Number, default: null },
  decidable: { type: Boolean, default: false },
})
const emit = defineEmits(['decided'])
const t = useT()

const FINAL = ['success', 'failed', 'canceled', 'skipped', 'manual']
const NOT_PASSED = ['failed', 'canceled']
const GIVE_UP_MS = 3 * 60 * 1000
const STOP_FOLLOWING_MS = 60 * 60 * 1000
const POLL_MS = 5000
const SLOW_POLL_MS = 15000
const RETRY_GRACE_MS = 30 * 1000
const request = ref(null)
const loaded = ref(false)
const gaveUp = ref(false)
const busy = ref(null)
const confirming = ref(false)
const startedAt = Date.now()
let retriedAt = 0
let timer = null

const load = async () => {
  clearTimeout(timer)
  try {
    request.value = await (props.number === null
      ? productService.getLatestMergeRequest({ id: props.productId })
      : productService.getMergeRequest({ id: props.productId, number: props.number }))
  } catch {
    // the next look tries again
  }
  loaded.value = true
  // a pipeline that has not started yet is not "over": there may be one still to come
  const status = request.value?.pipeline?.status
  const waited = Date.now() - startedAt
  if (status && FINAL.includes(status)) {
    if (Date.now() - retriedAt < RETRY_GRACE_MS) timer = setTimeout(load, POLL_MS)
    // a request that is still open can receive a new generation, with checks of its own
    else if (request.value.state === 'opened' && waited < STOP_FOLLOWING_MS) timer = setTimeout(load, SLOW_POLL_MS)
    return
  }
  if (waited < (status ? STOP_FOLLOWING_MS : GIVE_UP_MS)) timer = setTimeout(load, waited < GIVE_UP_MS ? POLL_MS : SLOW_POLL_MS)
  else gaveUp.value = true
}

const status = computed(() => request.value?.pipeline?.status)
const notPassed = computed(() => NOT_PASSED.includes(status.value))
const unfinished = computed(() => Boolean(request.value?.awaitingDecision) && !FINAL.includes(status.value))
const risky = computed(() => notPassed.value || unfinished.value)
const canDecide = computed(() => props.decidable && request.value?.state === 'opened' && (risky.value || status.value === 'success'))

const decide = async (decision) => {
  busy.value = decision
  confirming.value = false
  try {
    const answer = await productService.decideUpdate({ id: props.productId, number: request.value.number, decision })
    if (answer.conflicts) notify({ type: 'warning', message: t('cicd.decision_conflicts') })
    else notify({ type: decision === 'merge' ? 'positive' : 'info', message: t(`cicd.decision_${decision}_done`, { version: answer.version }) })
    emit('decided', answer)
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    busy.value = null
  }
}

const merge = () => {
  if (risky.value && !confirming.value) confirming.value = true
  else decide('merge')
}

const retry = async () => {
  busy.value = 'retry'
  confirming.value = false
  try {
    await productService.retryPipeline({ id: props.productId })
    retriedAt = Date.now()
    gaveUp.value = false
    request.value = { ...request.value, failed: null, pipeline: { ...request.value.pipeline, status: 'running' } }
    timer = setTimeout(load, POLL_MS)
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    busy.value = null
  }
}

onMounted(load)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="mrchecks" name="mr-checks">
    <p v-if="!loaded" class="mrchecks__muted"><i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t('cicd.loading') }}</p>
    <p v-else-if="!request" class="mrchecks__muted">{{ t('cicd.no_mrs') }}</p>
    <template v-else>
      <div class="mrchecks__head">
        <span class="mrchecks__title">{{ t('cicd.mr_checks') }} · <span class="mrchecks__mono">!{{ request.number }}</span></span>
        <span
          v-if="request.pipeline" class="mrchecks__status" name="mr-checks-status"
          :style="{ color: pipelineColorVar(request.pipeline.status) }"
        >● {{ t(`generation.gr_pipeline_${pipelineWord(request.pipeline.status)}`) }}</span>
        <span v-else class="mrchecks__muted" name="mr-checks-status">{{ t('generation.gr_pipeline_waiting') }}</span>
        <a v-if="request.webUrl" class="mrchecks__link" :href="request.webUrl" target="_blank" rel="noopener noreferrer">
          {{ t('cicd.open_in_git') }} <i class="pi pi-external-link" aria-hidden="true" />
        </a>
      </div>

      <section v-if="canDecide" class="mrchecks__decision" :class="{ 'mrchecks__decision--bad': risky }" name="update-decision">
        <p class="mrchecks__decision-title">
          <i class="pi" :class="risky ? 'pi-exclamation-triangle' : 'pi-check-circle'" aria-hidden="true" />
          <template v-if="unfinished">{{ t('cicd.decision_unfinished') }}</template>
          <template v-else-if="!notPassed">{{ t('cicd.decision_passed') }}</template>
          <template v-else-if="request.failed">{{ t('cicd.decision_failed_job', { job: request.failed.name }) }}</template>
          <template v-else>{{ t('cicd.decision_failed') }}</template>
        </p>
        <p class="mrchecks__decision-hint">{{ confirming ? t('cicd.decision_merge_confirm') : t('cicd.decision_hint') }}</p>
        <div class="mrchecks__decision-actions">
          <PrimeButton
            size="small" name="decision-merge"
            :severity="risky ? 'danger' : undefined" :outlined="risky && !confirming"
            :label="confirming ? t('cicd.decision_merge_yes') : (risky ? t('cicd.decision_merge_anyway') : t('cicd.decision_merge'))"
            icon="pi pi-check" :loading="busy === 'merge'" :disabled="Boolean(busy)" @click="merge"
          />
          <PrimeButton v-if="confirming" size="small" text name="decision-merge-cancel" :label="t('labels.cancel')" @click="confirming = false" />
          <template v-else>
            <PrimeButton
              size="small" severity="secondary" outlined name="decision-reject" :label="t('cicd.decision_reject')"
              icon="pi pi-times" :loading="busy === 'reject'" :disabled="Boolean(busy)" @click="decide('reject')"
            />
            <PrimeButton
              v-if="notPassed" size="small" text name="decision-retry" :label="t('cicd.decision_retry')"
              icon="pi pi-refresh" :loading="busy === 'retry'" :disabled="Boolean(busy)" @click="retry"
            />
          </template>
        </div>
      </section>

      <p v-if="notPassed && !canDecide" class="mrchecks__reason" name="mr-checks-reason">
        <i class="pi pi-times-circle" aria-hidden="true" />
        {{ request.failed ? t('cicd.decision_failed_job', { job: request.failed.name }) : t('cicd.decision_failed') }}
      </p>

      <p v-if="gaveUp" class="mrchecks__muted" name="mr-checks-gave-up">{{ t('cicd.checks_gave_up') }}</p>
      <PipelineJobs v-if="request.jobs.length" :product-id="productId" :jobs="request.jobs" :pipeline-id="request.pipeline?.id ?? null" :live="!gaveUp" @changed="load" />
    </template>
  </div>
</template>

<style scoped lang="scss">
.mrchecks {
  display: flex; flex-direction: column; gap: 8px; margin-top: 8px;

  &__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  &__title { font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  &__mono { font-family: var(--font-mono); }
  &__status { font-size: 0.875rem; font-weight: 600; }
  &__muted { margin: 0; color: var(--text-muted); font-size: 0.8125rem; }
  &__link { margin-left: auto; font-size: 0.8125rem; color: var(--p-primary-color); text-decoration: none; &:hover { text-decoration: underline; } }

  &__reason { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; font-weight: 600; color: var(--status-bad); }

  &__decision {
    display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 8px;
    border: 1px solid var(--p-content-border-color);
    background: var(--status-ok-soft);
    &--bad { border-color: var(--status-bad-border); background: var(--status-bad-soft); }
  }
  &__decision-title { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-heading); }
  &__decision--bad &__decision-title i { color: var(--status-bad); }
  &__decision-hint { margin: 0; font-size: 0.8125rem; color: var(--text-muted); }
  &__decision-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
}
</style>
