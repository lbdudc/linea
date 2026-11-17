<script setup>
import { ref, computed, watch } from 'vue'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import InfoHint from 'src/components/common/InfoHint.vue'
import lineService from 'src/services/lineService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

// The CI of the repository of the SPL: what a merge request on the line does to the products that exist. The settings live in the
// repository (.linea/ci.json) and the pipeline file is rendered from them and committed with them.
const props = defineProps({ lineId: { type: String, required: true } })
const emit = defineEmits(['read-only'])
const t = useT()

const SWITCHES = ['metrics', 'pairwise', 'version', 'release', 'security']
const loading = ref(true)
const saving = ref(false)
const error = ref(null)
const ci = ref(null)
const draft = ref(null)

const toForm = (config) => ({ ...config, tagsText: config.tags.join(', ') })
const fromForm = (form) => {
  const { tagsText, ...rest } = form
  return { ...rest, tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean) }
}
const adopt = (answer) => {
  ci.value = answer
  draft.value = toForm(answer.config)
}
const load = async () => {
  loading.value = true
  error.value = null
  try {
    adopt(await lineService.getCi(props.lineId))
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
watch(() => props.lineId, load, { immediate: true })

const readOnly = computed(() => ci.value?.canEdit === false)
watch(readOnly, (value) => emit('read-only', value))
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(fromForm(draft.value)) !== JSON.stringify(fromForm(toForm(ci.value.config))))

const save = async () => {
  saving.value = true
  try {
    adopt(await lineService.saveCi(props.lineId, fromForm(draft.value)))
    notify({ type: 'positive', message: t('automation.spl_saved') })
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="spl-ci">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-else-if="loading" height="14rem" />
    <Message v-else-if="!ci.supported" severity="info" :closable="false">{{ $t('cicd.unsupported') }}</Message>

    <form v-else class="spl-ci__form" name="line-ci-form" @submit.prevent="save">
      <section class="ln-block">
        <header class="ln-block__head">
          <span class="ln-block__title">{{ $t('cicdview.cfg_line_checks') }}</span><span class="ln-block__rule" />
          <span class="ln-row__note"><i :class="ci.fileInRepository ? 'pi pi-check-circle' : 'pi pi-clock'" aria-hidden="true" /> {{ ci.fileInRepository ? $t('cicd.file_in_repo') : $t('automation.spl_file_not_in_repo') }}</span>
        </header>
        <div class="ln-row">
          <label for="line-ci-enabled" class="ln-row__label">{{ $t('automation.spl_enabled') }}<InfoHint :text="$t('automation.spl_enabled_hint')" /></label>
          <div class="ln-row__control"><span name="line-ci-enabled"><ToggleSwitch v-model="draft.enabled" input-id="line-ci-enabled" :disabled="readOnly" /></span></div>
        </div>
        <template v-if="draft.enabled">
          <div class="ln-row">
            <label for="line-ci-max-products" class="ln-row__label">{{ $t('automation.max_products') }}<InfoHint :text="$t('automation.max_products_hint')" /></label>
            <div class="ln-row__control"><InputNumber v-model="draft.maxProducts" :disabled="readOnly" input-id="line-ci-max-products" name="line-ci-max-products" :min="1" :max="200" show-buttons size="small" /></div>
          </div>
          <div class="ln-row">
            <label for="line-ci-tags" class="ln-row__label">{{ $t('cicd.tags') }}<InfoHint :text="$t('cicd.tags_hint')" /></label>
            <div class="ln-row__control"><InputText v-model="draft.tagsText" :readonly="readOnly" id="line-ci-tags" name="line-ci-tags" size="small" spellcheck="false" /></div>
          </div>
          <div class="ln-row">
            <label for="line-ci-package" class="ln-row__label">{{ $t('automation.package') }}<InfoHint :text="$t('automation.package_hint')" /></label>
            <div class="ln-row__control"><InputText v-model="draft.package" :readonly="readOnly" id="line-ci-package" name="line-ci-package" size="small" spellcheck="false" class="spl-ci__package" /></div>
          </div>
          <div v-for="key in SWITCHES" :key="key" class="ln-row">
            <label :for="`line-ci-${key}`" class="ln-row__label">{{ $t(`automation.job_${key}`) }}<InfoHint :text="$t(`automation.job_${key}_hint`)" /></label>
            <div class="ln-row__control">
              <span :name="`line-ci-${key}`"><ToggleSwitch v-model="draft[key]" :disabled="readOnly" :input-id="`line-ci-${key}`" /></span>
              <template v-if="key === 'metrics' && draft.metrics">
                <InputNumber v-model="draft.maxCcn" :disabled="readOnly" input-id="line-ci-max-ccn" name="line-ci-max-ccn" :min="1" :max="200" show-buttons size="small" :aria-label="$t('automation.max_ccn')" />
                <InfoHint :text="$t('automation.max_ccn_hint')" />
              </template>
              <template v-if="key === 'pairwise' && draft.pairwise">
                <InputNumber v-model="draft.maxSamples" :disabled="readOnly" input-id="line-ci-max-samples" name="line-ci-max-samples" :min="1" :max="500" show-buttons size="small" :aria-label="$t('automation.max_samples')" />
                <InfoHint :text="$t('automation.max_samples_hint')" />
              </template>
            </div>
          </div>
        </template>
      </section>

      <details v-if="ci.rendered" class="spl-ci__preview">
        <summary>{{ $t('cicd.preview') }} · {{ ci.pipelineFile }}</summary>
        <pre>{{ ci.rendered }}</pre>
      </details>

      <div v-if="!readOnly" class="ln-actions">
        <small v-if="dirty" class="ln-actions__note">{{ $t('cicd.unsaved') }}</small>
        <Button type="button" text size="small" :label="$t('cicd.discard')" :disabled="!dirty || saving" name="line-ci-discard" @click="adopt(ci)" />
        <Button type="submit" size="small" icon="pi pi-save" :label="$t('cicd.save')" :disabled="!dirty" :loading="saving" name="line-ci-save" />
      </div>
    </form>
  </div>
</template>

<style scoped>
.spl-ci__package { width: min(100%, 28rem); }
.spl-ci__form { display: flex; flex-direction: column; gap: 12px; }
.spl-ci__preview summary { cursor: pointer; font-size: 0.8125rem; color: var(--text-muted); }
.spl-ci__preview pre { margin: 8px 0 0; padding: 12px; max-height: 24rem; overflow: auto; background: var(--p-content-hover-background); border-radius: 8px; font-size: 12px; }
</style>
