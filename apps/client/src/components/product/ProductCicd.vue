<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PrimeButton from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import Skeleton from 'primevue/skeleton'
import productService from 'src/services/productService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import CicdFrame from 'src/components/cicd/CicdFrame.vue'
import CicdStatus from 'src/components/cicd/CicdStatus.vue'
import MergeRequestChecks from 'src/components/product/MergeRequestChecks.vue'
import ProductRunSteps from 'src/components/product/ProductRunSteps.vue'
import ProductAutomation from 'src/components/automation/ProductAutomation.vue'
import SettingsSection from 'src/components/common/SettingsSection.vue'
import ReadOnlyNote from 'src/components/common/ReadOnlyNote.vue'
import ChecksFailedChoice from 'src/components/generation/ChecksFailedChoice.vue'

// The CI/CD of a product: what its generations and syncs are doing (each with its merge request and its checks), and how they are set up.
const props = defineProps({
  productId: { type: String, required: true },
  initialMode: { type: String, default: 'status' },
})
const emit = defineEmits(['automation-saved', 'update-decided', 'rollback'])
const t = useT()

const mode = ref(props.initialMode === 'config' ? 'config' : 'status')

const STAGES = computed(() => [
  { value: 'check', label: t('cicd.stage_check') },
  { value: 'build', label: t('cicd.stage_build') },
  { value: 'test', label: t('cicd.stage_test') },
])
const MODES = computed(() => [
  { value: 'jobs', label: t('cicd.mode_jobs') },
  { value: 'yaml', label: t('cicd.mode_yaml') },
])

const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })

// ── merge requests ────────────────────────────────────────────────────────
const requests = ref([])
const requestsLoading = ref(true)
let poll = null
const running = (pipeline) => Boolean(pipeline) && !['success', 'failed', 'canceled', 'skipped', 'manual'].includes(pipeline.status)

const loadRequests = async ({ quiet = false } = {}) => {
  if (!quiet) requestsLoading.value = true
  try {
    requests.value = await productService.listMergeRequests({ id: props.productId })
  } catch (error) {
    if (!quiet) fail(error)
  } finally {
    requestsLoading.value = false
  }
}

// the checks of the requests change while their pipelines run: look again every few seconds, only then
const SLOW_AFTER_MS = 3 * 60 * 1000
const STOP_FOLLOWING_MS = 60 * 60 * 1000
let pollStartedAt = null
const schedulePoll = () => {
  clearTimeout(poll)
  if (!requests.value.some((request) => running(request.pipeline)) || mode.value !== 'status') {
    pollStartedAt = null
    return
  }
  pollStartedAt ??= Date.now()
  const waited = Date.now() - pollStartedAt
  if (waited >= STOP_FOLLOWING_MS) {
    pollStartedAt = null
    return
  }
  poll = setTimeout(async () => {
    await loadRequests({ quiet: true })
    schedulePoll()
  }, waited < SLOW_AFTER_MS ? 8000 : 30000)
}
watch([requests, mode], schedulePoll)

// an update whose checks did not pass waits for a person here too, also after reading the page again; once shown it stays until it is decided
const awaitingDecision = ref(false)
watch(requests, (list) => {
  if (list.some((request) => request.kind === 'generation' && request.state === 'opened' && (request.awaitingDecision || ['failed', 'canceled'].includes(request.pipeline?.status)))) awaitingDecision.value = true
})
const onDecided = (answer) => {
  if (!answer.conflicts) awaitingDecision.value = false
  loadRequests({ quiet: true })
  emit('update-decided', answer)
}
onBeforeUnmount(() => clearTimeout(poll))


// ── the merge request and the checks of a run ───────────────────────────────────────────────────────────────────
// a sync knows its request; a generation's is the one that brought its version
const requestOf = (run) => (run.kind === 'sync'
  ? requests.value.find((request) => request.number === run.mr?.number)
  : requests.value.find((request) => request.kind === 'generation' && request.version && request.version === run.version))
const mrOf = (run) => {
  const request = requestOf(run)
  return request ? { number: request.number, url: request.webUrl } : null
}
// the host knows how far the request got: its checks and whether it was merged
const decorate = (run) => {
  const request = run.live ? null : requestOf(run)
  if (!request || run.state === 'bad') return run
  const status = request.pipeline?.status
  if (request.state === 'merged') return { ...run, stage: 'deployed', state: 'ok' }
  if (['failed', 'canceled'].includes(status)) return { ...run, stage: 'checks', state: 'bad' }
  if (request.awaitingDecision) return { ...run, stage: 'merge', state: 'wait' }
  if (request.pipeline && running(request.pipeline)) return { ...run, stage: 'checks', state: 'run' }
  if (request.state === 'opened') return { ...run, stage: 'merge', state: 'wait' }
  return run
}

// the detail of a generation holds its own decision, so the one of the page gives way to it
const detailOpen = ref(false)

// ── configuration ─────────────────────────────────────────────────────────
const ci = ref(null)
const ciLoading = ref(true)
const draft = ref(null)
const saving = ref(false)
const openJobs = ref({})

// the form edits plain text for what is a list or a map in the file
let keys = 0
const toForm = (config) => ({
  ...config,
  tagsText: config.tags.join(', '),
  jobs: config.jobs.map((job) => ({
    ...job,
    _key: `k${++keys}`,
    variablesText: Object.entries(job.variables).map(([key, value]) => `${key}=${value}`).join('\n'),
    servicesText: job.services.map((service) => (service.alias ? `${service.name} ${service.alias}` : service.name)).join('\n'),
    cacheText: job.cache.join('\n'),
  })),
})

const fromForm = (form) => ({
  enabled: form.enabled,
  tags: form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
  waitForChecks: form.waitForChecks,
  waitMinutes: form.waitMinutes,
  onChecksFailed: form.onChecksFailed,
  mode: form.mode,
  yaml: form.yaml,
  jobs: form.jobs.map((job) => ({
    id: job.id,
    stage: job.stage,
    enabled: job.enabled,
    image: job.image,
    script: job.script,
    junit: job.junit,
    variables: Object.fromEntries(job.variablesText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const at = line.indexOf('=')
      return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1)]
    })),
    services: job.servicesText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, alias = ''] = line.split(/\s+/)
      return { name, alias }
    }),
    cache: job.cacheText.split('\n').map((line) => line.trim()).filter(Boolean),
  })),
})

const adopt = (answer) => {
  ci.value = answer
  draft.value = toForm(answer.config)
}

const loadCi = async () => {
  ciLoading.value = true
  try {
    adopt(await productService.getCi({ id: props.productId }))
  } catch (error) {
    fail(error)
  } finally {
    ciLoading.value = false
  }
}

// both sides go through the form, so the order of the keys of the server's answer does not make a change out of nothing
const readOnly = computed(() => ci.value?.canEdit === false)
const dirty = computed(() => Boolean(draft.value && ci.value) && JSON.stringify(fromForm(draft.value)) !== JSON.stringify(fromForm(toForm(ci.value.config))))

const save = async () => {
  saving.value = true
  try {
    adopt(await productService.saveCi({ id: props.productId, config: fromForm(draft.value) }))
    notify({ type: 'positive', message: t('cicd.saved') })
  } catch (error) {
    fail(error)
  } finally {
    saving.value = false
  }
}

const discard = () => { draft.value = toForm(ci.value.config) }

// the automation and the checks are two things on one page with one bar to save them
const automation = ref(null)
const savingAll = ref(false)
const anyDirty = computed(() => dirty.value || Boolean(automation.value?.dirty))
const saveBlocked = computed(() => (dirty.value && !ci.value?.supported) || Boolean(automation.value?.cronMissing))
const saveAll = async () => {
  if (saveBlocked.value) return
  savingAll.value = true
  try {
    if (automation.value?.dirty) await automation.value.save()
    if (dirty.value) await save()
  } finally {
    savingAll.value = false
  }
}
const discardAll = () => {
  automation.value?.discard()
  if (dirty.value) discard()
}

let newJobs = 0
const addJob = () => {
  newJobs += 1
  let id = `job_${newJobs}`
  while (draft.value.jobs.some((job) => job.id === id)) id = `job_${++newJobs}`
  const key = `k${++keys}`
  draft.value.jobs.push({
    _key: key, id, stage: 'test', enabled: true, image: 'alpine:3', script: 'echo "hello"', junit: '',
    variables: {}, services: [], cache: [], variablesText: '', servicesText: '', cacheText: '',
  })
  openJobs.value = { ...openJobs.value, [key]: true }
}
const removeJob = (index) => draft.value.jobs.splice(index, 1)
const toggleJob = (key) => { openJobs.value = { ...openJobs.value, [key]: !openJobs.value[key] } }

// ── runners ───────────────────────────────────────────────────────────────
const runnersBusy = ref(false)
const setInstanceRunners = async (enabled) => {
  runnersBusy.value = true
  try {
    const runners = await productService.setCiRunners({ id: props.productId, instanceRunners: enabled })
    ci.value = { ...ci.value, runners }
    notify({ type: 'positive', message: t('cicd.runners_updated') })
  } catch (error) {
    fail(error)
  } finally {
    runnersBusy.value = false
  }
}

const savedTags = computed(() => ci.value?.config.tags ?? [])
// a job only runs where a runner has every tag it asks for (and is online, not paused)
const tagsCovered = computed(() => {
  const usable = (ci.value?.runners.runners ?? []).filter((runner) => runner.online && !runner.paused)
  if (!savedTags.value.length) return usable.some((runner) => runner.runsUntagged)
  return usable.some((runner) => savedTags.value.every((tag) => runner.tags.includes(tag)))
})

onMounted(() => {
  loadRequests()
  loadCi()
})
</script>

<template>
  <div class="cicd" name="product-cicd">
    <CicdFrame v-model="mode">
      <template #actions>
        <PrimeButton
          text size="small" icon="pi pi-refresh"
          :label="$t('cicd.refresh')"
          name="cicd-refresh"
          :loading="requestsLoading || ciLoading"
          @click="() => { loadRequests(); loadCi() }"
        />
      </template>
      <template #default="{ period }">
    <!-- what the generations and syncs are doing; one of them opens to its merge request and its checks -->
    <template v-if="mode === 'status'">
      <MergeRequestChecks v-if="awaitingDecision && !detailOpen" :product-id="productId" decidable @decided="onDecided" />
      <CicdStatus :product-id="productId" :period="period" :mr-of="mrOf" :decorate="decorate" @detail="detailOpen = $event">
        <template #run-steps="{ run }">
          <ProductRunSteps :key="run.id" :run="run" :requests="requests" :host="ci?.host ?? null" @rollback="emit('rollback', $event)" @decided="onDecided" />
        </template>
      </CicdStatus>
    </template>

    <!-- how they are set up: what a generation and a sync do, the checks and who runs them -->
    <div v-else class="cfg" name="cicd-config-sections">
    <ReadOnlyNote v-if="readOnly || automation?.readOnly" />
    <ProductAutomation ref="automation" :product-id="productId" :standalone="false" @saved="emit('automation-saved', $event)" />

    <SettingsSection :title="$t('cicdview.cfg_checks')" :description="$t('cicdview.cfg_checks_note')">
      <p v-if="ci && !ci.supported" class="cicd__note" name="cicd-unsupported"><i class="pi pi-info-circle" aria-hidden="true" /> {{ $t('cicd.unsupported') }}</p>
      <div v-if="ciLoading || !draft" class="cicd__loading"><Skeleton v-for="i in 4" :key="i" height="40px" /></div>
      <form v-else class="cicd__form" name="cicd-config" @submit.prevent="saveAll">
        <label class="cicd__switch" name="cicd-enabled">
          <ToggleSwitch v-model="draft.enabled" :disabled="!ci.supported || readOnly" />
          <span>
            <strong>{{ draft.enabled ? $t('cicd.enabled') : $t('cicd.enabled_off') }}</strong>
            <small>{{ $t('cicd.enabled_hint') }}</small>
          </span>
        </label>

        <template v-if="draft.enabled">
          <div class="cicd__field">
            <label for="cicd-tags">{{ $t('cicd.tags') }}</label>
            <InputText id="cicd-tags" v-model="draft.tagsText" name="cicd-tags" :readonly="readOnly" />
            <small>{{ $t('cicd.tags_hint') }}</small>
          </div>

          <label class="cicd__switch" name="cicd-wait">
            <ToggleSwitch v-model="draft.waitForChecks" :disabled="readOnly" />
            <span>
              <strong>{{ $t('cicd.wait') }}</strong>
              <small>{{ $t('cicd.wait_hint') }}</small>
            </span>
          </label>
          <div v-if="draft.waitForChecks" class="cicd__field cicd__field--narrow">
            <label for="cicd-wait-minutes">{{ $t('cicd.wait_minutes') }}</label>
            <InputNumber v-model="draft.waitMinutes" input-id="cicd-wait-minutes" name="cicd-wait-minutes" :min="1" :max="240" show-buttons :disabled="readOnly" />
          </div>
          <div v-if="draft.waitForChecks" class="cicd__field" name="cicd-on-failed">
            <label>{{ $t('cicd.on_failed') }}</label>
            <ChecksFailedChoice v-model="draft.onChecksFailed" :disabled="readOnly" name="cicd-on-failed-choice" />
            <small>{{ $t('cicd.on_failed_hint') }}</small>
          </div>

          <div class="cicd__field">
            <label>{{ $t('cicd.mode') }}</label>
            <SelectButton v-model="draft.mode" :options="MODES" option-label="label" option-value="value" :allow-empty="false" name="cicd-mode" :disabled="readOnly" />
          </div>

          <div v-if="draft.mode === 'yaml'" class="cicd__field">
            <label for="cicd-yaml">{{ $t('cicd.yaml_label') }}</label>
            <Textarea id="cicd-yaml" v-model="draft.yaml" name="cicd-yaml" rows="22" class="cicd__code" spellcheck="false" auto-resize :readonly="readOnly" />
          </div>

          <div v-else class="cicd__jobs-editor" name="cicd-jobs-editor">
            <div v-for="(job, index) in draft.jobs" :key="job._key" class="cicd__card" :class="{ 'cicd__card--off': !job.enabled }" :name="`cicd-jobcard-${job.id}`">
              <div class="cicd__card-head">
                <span :name="`cicd-job-enabled-${job.id}`"><ToggleSwitch v-model="job.enabled" :aria-label="$t('cicd.job_enabled')" :disabled="readOnly" /></span>
                <button type="button" class="cicd__card-title" :aria-expanded="Boolean(openJobs[job._key])" @click="toggleJob(job._key)">
                  <span class="cicd__mono">{{ job.id }}</span>
                  <span class="cicd__muted">{{ job.stage }} · {{ job.image }}</span>
                  <i :class="openJobs[job._key] ? 'pi pi-angle-up' : 'pi pi-angle-down'" aria-hidden="true" />
                </button>
                <PrimeButton
                  v-if="!readOnly"
                  text rounded size="small" severity="danger" icon="pi pi-trash" type="button"
                  :aria-label="$t('cicd.remove_job')" :name="`cicd-job-remove-${job.id}`" @click="removeJob(index)"
                />
              </div>
              <div v-if="openJobs[job._key]" class="cicd__card-body">
                <div class="cicd__grid">
                  <div class="cicd__field">
                    <label :for="`job-name-${index}`">{{ $t('cicd.job_name') }}</label>
                    <InputText :id="`job-name-${index}`" v-model="job.id" :name="`cicd-job-name-${index}`" :readonly="readOnly" />
                  </div>
                  <div class="cicd__field">
                    <label>{{ $t('cicd.job_stage') }}</label>
                    <Select v-model="job.stage" :options="STAGES" option-label="label" option-value="value" :name="`cicd-job-stage-${job.id}`" :disabled="readOnly" />
                  </div>
                  <div class="cicd__field">
                    <label :for="`job-image-${index}`">{{ $t('cicd.job_image') }}</label>
                    <InputText :id="`job-image-${index}`" v-model="job.image" :name="`cicd-job-image-${job.id}`" :readonly="readOnly" />
                  </div>
                </div>
                <div class="cicd__field">
                  <label :for="`job-script-${index}`">{{ $t('cicd.job_script') }}</label>
                  <Textarea :id="`job-script-${index}`" v-model="job.script" :name="`cicd-job-script-${job.id}`" rows="4" class="cicd__code" spellcheck="false" auto-resize :readonly="readOnly" />
                </div>
                <div class="cicd__grid">
                  <div class="cicd__field">
                    <label :for="`job-vars-${index}`">{{ $t('cicd.job_vars') }}</label>
                    <Textarea :id="`job-vars-${index}`" v-model="job.variablesText" rows="3" class="cicd__code" spellcheck="false" auto-resize :readonly="readOnly" />
                  </div>
                  <div class="cicd__field">
                    <label :for="`job-services-${index}`">{{ $t('cicd.job_services') }}</label>
                    <Textarea :id="`job-services-${index}`" v-model="job.servicesText" rows="3" class="cicd__code" spellcheck="false" auto-resize :readonly="readOnly" />
                  </div>
                  <div class="cicd__field">
                    <label :for="`job-cache-${index}`">{{ $t('cicd.job_cache') }}</label>
                    <Textarea :id="`job-cache-${index}`" v-model="job.cacheText" rows="3" class="cicd__code" spellcheck="false" auto-resize :readonly="readOnly" />
                  </div>
                </div>
                <div class="cicd__field">
                  <label :for="`job-junit-${index}`">{{ $t('cicd.job_junit') }}</label>
                  <InputText :id="`job-junit-${index}`" v-model="job.junit" class="cicd__code" :readonly="readOnly" />
                </div>
              </div>
            </div>
            <div v-if="!readOnly" class="cicd__actions-row">
              <PrimeButton type="button" text size="small" icon="pi pi-plus" :label="$t('cicd.add_job')" name="cicd-add-job" @click="addJob" />
            </div>
          </div>
        </template>

        <p v-if="ci.supported" class="cicd__muted" name="cicd-file-state">
          <i :class="ci.fileInRepository ? 'pi pi-check-circle' : 'pi pi-clock'" aria-hidden="true" />
          {{ ci.fileInRepository ? $t('cicd.file_in_repo') : $t('cicd.file_not_in_repo') }}
        </p>

        <details v-if="ci.supported && ci.rendered && draft.enabled" class="cicd__preview">
          <summary>{{ $t('cicd.preview') }}</summary>
          <pre name="cicd-rendered">{{ ci.rendered }}</pre>
        </details>

      </form>
    </SettingsSection>

    <SettingsSection :title="$t('cicdview.cfg_runners')" :description="$t('cicdview.cfg_runners_note')">
      <div v-if="ciLoading || !ci" class="cicd__loading"><Skeleton v-for="i in 3" :key="i" height="40px" /></div>
      <div v-else class="cicd__form" name="cicd-runners">
        <p v-if="!ci.runners.supported" class="cicd__muted">{{ $t('cicd.unsupported_runners') }}</p>
        <template v-else>
          <label class="cicd__switch" name="cicd-instance-runners">
            <ToggleSwitch
              :model-value="ci.runners.instanceRunners === true"
              :disabled="runnersBusy || readOnly"
              @update:model-value="setInstanceRunners"
            />
            <span>
              <strong>{{ $t('cicd.instance_runners') }}</strong>
              <small>{{ $t('cicd.instance_runners_hint') }}</small>
            </span>
          </label>

          <p v-if="ci.runners.listed === false" class="cicd__muted" name="cicd-runners-hidden">{{ $t('cicd.runners_hidden') }}</p>
          <template v-else>
          <p class="cicd__runners-state" :class="tagsCovered ? 'cicd__runners-state--ok' : 'cicd__runners-state--bad'" name="cicd-runners-state">
            <i :class="tagsCovered ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" aria-hidden="true" />
            {{ tagsCovered ? $t('cicd.runners_ok', { tags: savedTags.join(', ') || '—' }) : $t('cicd.runners_missing', { tags: savedTags.join(', ') || '—' }) }}
          </p>

          <p v-if="!ci.runners.runners.length" class="cicd__muted">{{ $t('cicd.runners_none') }}</p>
          <ul v-else class="cicd__jobs">
            <li v-for="runner in ci.runners.runners" :key="runner.id" class="cicd__job" :name="`cicd-runner-${runner.id}`">
              <span class="cicd__dot" :style="{ background: runner.online && !runner.paused ? 'var(--status-ok)' : 'var(--status-bad)' }" aria-hidden="true" />
              <span class="cicd__mono cicd__job-name">{{ runner.description }}</span>
              <span class="cicd__muted">{{ runner.paused ? $t('cicd.runner_paused') : runner.online ? $t('cicd.runner_online') : $t('cicd.runner_offline') }}</span>
              <span v-if="runner.shared" class="cicd__chip">{{ $t('cicd.runner_shared') }}</span>
              <span v-for="tag in runner.tags" :key="tag" class="cicd__chip cicd__chip--tag">{{ tag }}</span>
              <span v-if="runner.runsUntagged" class="cicd__muted">{{ $t('cicd.runner_untagged') }}</span>
            </li>
          </ul>
          </template>
        </template>
      </div>
    </SettingsSection>

    <!-- one save for everything on this page that is edited -->
    <div v-if="anyDirty" class="cfg__bar" name="cicd-save-bar">
      <span class="cicd__muted" name="cicd-unsaved">{{ $t('cicd.unsaved') }}</span>
      <PrimeButton type="button" text size="small" :label="$t('cicd.discard')" :disabled="savingAll" name="cicd-discard" @click="discardAll" />
      <PrimeButton type="button" size="small" icon="pi pi-save" :label="$t('cicd.save')" :disabled="saveBlocked" :loading="savingAll" name="cicd-save" @click="saveAll" />
    </div>
    </div>
      </template>
    </CicdFrame>
  </div>
</template>

<style scoped lang="scss">
.cicd {
  display: flex;
  flex-direction: column;
  padding: 18px 20px 28px;

  &__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

  &__note { margin: 0; padding: 8px 12px; border-radius: 6px; background: var(--surface-alt); color: var(--text-muted); font-size: 0.8125rem; }
  &__loading { display: flex; flex-direction: column; gap: 8px; }
  &__empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 0; color: var(--text-muted); }
  &__muted { margin: 0; color: var(--text-muted); font-size: 0.8125rem; }
  &__mono { font-family: var(--font-mono); }
  &__link { font-size: 0.8125rem; color: var(--p-primary-color); text-decoration: none; &:hover { text-decoration: underline; } }

  &__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;

    th { text-align: left; padding: 6px 10px; font-weight: 600; font-size: 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--card-border); }
    td { padding: 10px; border-bottom: 1px solid var(--card-border); }
  }
  &__row { cursor: pointer; &:hover, &:focus-visible { background: var(--surface-alt); outline: none; } }

  &__chip {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
    background: var(--surface-alt);
    color: var(--text-muted);
    border: 1px solid var(--card-border);

    &--opened { color: var(--p-primary-color); }
    &--merged { color: var(--status-ok); }
    &--closed { color: var(--status-bad); }
    &--tag { font-family: var(--font-mono); }
  }
  &__checks { font-size: 0.8125rem; white-space: nowrap; }

  &__detail { display: flex; flex-direction: column; gap: 12px; }
  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  &__title { margin: 0; font-size: 1rem; color: var(--text-heading); }
  &__meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 0.8125rem; color: var(--text-muted); margin-top: 6px; }
  &__sub { margin: 8px 0 0; font-size: 0.875rem; color: var(--text-heading); display: flex; align-items: center; gap: 12px; }

  &__pipelines { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  &__pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 14px; font-size: 0.8125rem; cursor: pointer;
    background: var(--surface-alt); border: 1px solid var(--card-border); color: inherit;
    &--on { border-color: var(--p-primary-color); }
  }

  &__jobs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--card-border); border-radius: 8px; }
  &__job {
    display: flex; align-items: center; gap: 12px; padding: 9px 12px; font-size: 0.875rem; flex-wrap: wrap;
    & + & { border-top: 1px solid var(--card-border); }
  }
  &__job-name { min-width: 150px; }
  &__job-status { font-size: 0.8125rem; min-width: 70px; }
  &__dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  &__trace {
    margin: 0; padding: 12px; max-height: 320px; overflow: auto; border-radius: 8px; font-size: 0.75rem; line-height: 1.5;
    background: var(--surface-alt); border: 1px solid var(--card-border); font-family: var(--font-mono); white-space: pre-wrap;
  }

  &__form { display: flex; flex-direction: column; gap: 16px; }
  &__switch {
    display: flex; align-items: flex-start; gap: 12px; cursor: pointer;
    :deep(.p-toggleswitch) { flex-shrink: 0; }
    > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    small { color: var(--text-muted); font-size: 0.8125rem; }
  }
  &__field {
    display: flex; flex-direction: column; gap: 6px;
    label { font-size: 0.8125rem; font-weight: 600; color: var(--text-heading); }
    small { color: var(--text-muted); font-size: 0.75rem; }
    &--narrow { max-width: 220px; }
  }
  &__code { font-family: var(--font-mono); font-size: 0.8125rem; width: 100%; }
  &__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }

  &__jobs-editor { display: flex; flex-direction: column; gap: 8px; }
  &__card { border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); &--off { opacity: 0.6; } }
  &__card-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
  &__card-title {
    flex: 1; display: flex; align-items: center; gap: 12px; background: none; border: none; cursor: pointer; text-align: left; color: inherit; padding: 4px;
    &:focus-visible { outline: 2px solid var(--p-primary-color); border-radius: 4px; }
    i { margin-left: auto; color: var(--text-muted); }
  }
  &__card-body { display: flex; flex-direction: column; gap: 12px; padding: 4px 14px 14px; border-top: 1px solid var(--card-border); padding-top: 12px; }
  &__actions-row { display: flex; }
  &__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; position: sticky; bottom: 0; padding: 10px 0; background: var(--surface-bg); }

  &__preview {
    summary { cursor: pointer; font-size: 0.8125rem; color: var(--text-muted); }
    pre { margin: 8px 0 0; padding: 12px; overflow: auto; max-height: 360px; font-size: 0.75rem; background: var(--surface-alt); border: 1px solid var(--card-border); border-radius: 8px; font-family: var(--font-mono); }
  }

  &__runners-state {
    margin: 0; padding: 8px 12px; border-radius: 6px; font-size: 0.8125rem;
    &--ok { color: var(--status-ok); }
    &--bad { color: var(--status-bad); background: var(--error-bg); border: 1px solid var(--error-border); }
  }
}

.cfg { display: flex; flex-direction: column; gap: 14px; }
.cfg__bar {
  position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  margin-top: 8px; padding: 12px 0; border-top: 1px solid var(--card-border); background: var(--surface-bg);
}
.cfg__bar > :first-child { margin-right: auto; }
</style>
