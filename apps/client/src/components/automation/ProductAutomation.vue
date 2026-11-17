<script setup>
import { ref, computed, watch } from 'vue'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import SyncFields from './SyncFields.vue'
import InfoHint from 'src/components/common/InfoHint.vue'
import SettingsSection from 'src/components/common/SettingsSection.vue'
import ReadOnlyNote from 'src/components/common/ReadOnlyNote.vue'
import productService from 'src/services/productService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

// The sync of one product: when and how it syncs. It is kept by LINEA (not in the repository); the SPL's values are what a product follows
// until it says otherwise. What a generation raises and does is chosen when someone generates, so it is not a setting here (the product keeps
// the values it had: they are sent back as they came).
const props = defineProps({
  productId: { type: String, required: true },
  /** Whether it has its own save bar; a page that saves several things at once sets it off and asks `dirty` / `save`. */
  standalone: { type: Boolean, default: true },
})
const emit = defineEmits(['saved'])
const t = useT()

const loading = ref(true)
const saving = ref(false)
const error = ref(null)
const loaded = ref(null)
const draft = ref(null)

const adopt = (automation) => {
  loaded.value = automation
  draft.value = JSON.parse(JSON.stringify({ sync: automation.sync, generation: automation.generation }))
}
const load = async () => {
  loading.value = true
  error.value = null
  try {
    adopt(await productService.getAutomation({ id: props.productId }))
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
watch(() => props.productId, load, { immediate: true })

const readOnly = computed(() => loaded.value?.canEdit === false)
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(draft.value) !== JSON.stringify({ sync: loaded.value.sync, generation: loaded.value.generation }))
const cronMissing = computed(() => draft.value?.sync.mode === 'custom' && draft.value.sync.preset === 'cron' && !draft.value.sync.cron?.trim())
const inheritedText = computed(() => {
  const line = loaded.value?.lineSync
  if (!line?.enabled) return t('automation.line_off')
  return t('automation.line_runs', { when: line.preset === 'cron' ? line.cron : t(`automation.preset_${line.preset}`) })
})

const save = async () => {
  saving.value = true
  try {
    adopt(await productService.saveAutomation({ id: props.productId, ...draft.value }))
    notify({ type: 'positive', message: t('automation.saved') })
    emit('saved', loaded.value)
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    saving.value = false
  }
}
const discard = () => adopt(loaded.value)
defineExpose({ dirty, saving, cronMissing, readOnly, save, discard })
</script>

<template>
  <div name="product-automation">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-else-if="loading" height="14rem" />

    <form v-else class="automation" @submit.prevent="save">
      <ReadOnlyNote v-if="standalone && readOnly" />
      <SettingsSection :title="$t('automation.sync')" :description="$t('cicdview.cfg_sync_note')" name="automation-sync">
        <SyncFields v-model="draft.sync" scope="product" :inherited-text="inheritedText" :read-only="readOnly" />
      </SettingsSection>

      <div v-if="standalone && !readOnly" class="ln-actions">
        <small v-if="dirty" class="ln-actions__note">{{ $t('cicd.unsaved') }}</small>
        <Button type="button" text size="small" :label="$t('cicd.discard')" :disabled="!dirty || saving" name="automation-discard" @click="adopt(loaded)" />
        <Button type="submit" size="small" icon="pi pi-save" :label="$t('cicd.save')" :disabled="!dirty || cronMissing" :loading="saving" name="automation-save" />
      </div>
    </form>
  </div>
</template>

<style scoped>
.automation { display: flex; flex-direction: column; }
.automation > .ln-actions { padding-top: 12px; }
</style>
