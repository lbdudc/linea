<script setup>
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import productModelService from 'src/services/productModelService'
import { selectionDiff } from 'src/utils/selectionDiff'
import { errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

const props = defineProps({
  from: { type: String, required: true },
  features: { type: Array, required: true },
  siblings: { type: Array, required: true },
})
const emit = defineEmits(['close', 'applied'])
const t = useT()

const visible = ref(true)
const chosen = ref([])
const results = ref({})
const running = ref(false)

const rows = computed(() => props.siblings.map((sibling) => ({
  id: String(sibling._id),
  name: sibling.name,
  known: Array.isArray(sibling.features),
  ...selectionDiff(sibling.features ?? [], props.features),
})))
const changing = computed(() => rows.value.filter((row) => chosen.value.includes(row.id) && row.known && !row.same))
const finished = computed(() => Object.keys(results.value).length > 0 && !running.value)

const apply = async () => {
  running.value = true
  results.value = {}
  for (const row of changing.value) {
    try {
      await productModelService.saveProductSelection({ id: row.id, features: props.features })
      results.value = { ...results.value, [row.id]: { ok: true } }
    } catch (e) {
      results.value = { ...results.value, [row.id]: { ok: false, message: errorMessage(e, t) } }
    }
  }
  running.value = false
  emit('applied', Object.entries(results.value).filter(([, r]) => r.ok).map(([id]) => id))
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t('apply_config.title', { name: from })" :style="{ width: '44rem' }" name="apply-configuration" @after-hide="emit('close')">
    <p class="apply__about">{{ t('apply_config.about', { count: features.length }) }}</p>
    <ul class="apply__list">
      <li v-for="row in rows" :key="row.id" class="apply__row" :data-sibling="row.id">
        <label class="apply__what">
          <Checkbox v-model="chosen" :value="row.id" :disabled="running || !row.known || row.same" :name="`apply-pick-${row.id}`" />
          <strong>{{ row.name }}</strong>
        </label>
        <span class="apply__diff">
          <Tag v-if="!row.known" severity="secondary" :value="t('apply_config.unknown')" />
          <Tag v-else-if="row.same" severity="success" :value="t('apply_config.same')" />
          <template v-else>
            <Tag severity="success" :value="`+${row.added.length}`" :title="row.added.join(', ')" />
            <Tag severity="danger" :value="`−${row.removed.length}`" :title="row.removed.join(', ')" />
          </template>
          <Tag v-if="results[row.id]?.ok" severity="success" icon="pi pi-check" :value="t('apply_config.done')" />
        </span>
        <Message v-if="results[row.id] && !results[row.id].ok" severity="error" :closable="false" class="apply__error">{{ results[row.id].message }}</Message>
      </li>
    </ul>
    <template #footer>
      <Button :label="finished ? t('apply_config.close') : t('apply_config.cancel')" severity="secondary" text @click="visible = false" />
      <Button :label="t('apply_config.apply', { count: changing.length })" :disabled="!changing.length || running" :loading="running" name="apply-configuration-run" @click="apply" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.apply {
  &__about { margin: 0 0 12px; color: var(--text-muted); font-size: 0.875rem; }
  &__list { list-style: none; margin: 0; padding: 0; max-height: 22rem; overflow-y: auto; }
  &__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 8px 0; border-bottom: 1px solid var(--p-content-border-color); }
  &__what { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  &__diff { display: inline-flex; gap: 6px; }
  &__error { flex-basis: 100%; }
}
</style>
