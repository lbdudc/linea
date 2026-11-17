<script setup>
import { ref, computed, watch } from 'vue'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import SyncFields from 'src/components/automation/SyncFields.vue'
import lineService from 'src/services/lineService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

// What the products of a line inherit for syncing: when, and what a sync does with an SPL that has moved on.
const props = defineProps({ lineId: { type: String, required: true } })
const emit = defineEmits(['read-only'])
const t = useT()

const loading = ref(true)
const saving = ref(false)
const error = ref(null)
const loaded = ref(null)
const draft = ref(null)

const adopt = (answer) => {
  loaded.value = answer
  draft.value = JSON.parse(JSON.stringify(answer.sync))
}
const load = async () => {
  loading.value = true
  error.value = null
  try {
    adopt(await lineService.getSync(props.lineId))
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
watch(() => props.lineId, load, { immediate: true })

const readOnly = computed(() => loaded.value?.canEdit === false)
watch(readOnly, (value) => emit('read-only', value))
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(draft.value) !== JSON.stringify(loaded.value.sync))
const cronMissing = computed(() => draft.value?.enabled && draft.value.preset === 'cron' && !draft.value.cron?.trim())
const counts = computed(() => (loaded.value ? t('automation.summary_products', loaded.value.products) : ''))

const save = async () => {
  saving.value = true
  try {
    adopt(await lineService.saveSync(props.lineId, draft.value))
    notify({ type: 'positive', message: t('automation.saved') })
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="line-sync">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-else-if="loading" height="12rem" />

    <template v-else>
      <form class="line-sync__form" name="line-sync-form" @submit.prevent="save">
        <section class="ln-block">
          <header class="ln-block__head"><span class="ln-block__title">{{ $t('cicdview.cfg_line_sync') }}</span><span class="ln-block__rule" /><span class="ln-row__note">{{ counts }}</span></header>
          <SyncFields v-model="draft" scope="line" :read-only="readOnly" />
        </section>
        <div v-if="!readOnly" class="ln-actions">
          <small v-if="dirty" class="ln-actions__note">{{ $t('cicd.unsaved') }}</small>
          <Button type="button" text size="small" :label="$t('cicd.discard')" :disabled="!dirty || saving" name="line-sync-discard" @click="adopt(loaded)" />
          <Button type="submit" size="small" icon="pi pi-save" :label="$t('cicd.save')" :disabled="!dirty || cronMissing" :loading="saving" name="line-sync-save" />
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.line-sync { display: flex; flex-direction: column; gap: 20px; }
.line-sync__form { display: flex; flex-direction: column; gap: 12px; }
</style>
