<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import productService from 'src/services/productService'
import ChangelogView from 'components/changelog/ChangelogView.vue'

// Before a product is synced: what its SPL changed since the last sync (its own commits and what its dependencies, modules or metamodels, bring);
// the same text goes in the merge request.
const props = defineProps({
  visible: { type: Boolean, default: false },
  productId: { type: String, required: true },
  productName: { type: String, default: '' },
})
const emit = defineEmits(['update:visible', 'confirm'])

const changelog = ref(null)
const loading = ref(false)
const failed = ref(false)
let sequence = 0

watch(() => props.visible, async (open) => {
  if (!open) return
  const mine = ++sequence
  loading.value = true
  failed.value = false
  changelog.value = null
  try {
    const result = await productService.getChangelog({ id: props.productId })
    if (mine === sequence) changelog.value = result
  } catch {
    // the preview is a convenience: a sync can go on without it
    if (mine === sequence) failed.value = true
  } finally {
    if (mine === sequence) loading.value = false
  }
}, { immediate: true })

const lineSections = computed(() => changelog.value?.lineChangelog?.sections ?? [])
const lineBreaking = computed(() => Boolean(changelog.value?.lineChangelog?.breaking) || (changelog.value?.dependencies ?? []).some((d) => d.changelog?.breaking))
const hasChanges = computed(() => lineSections.value.length > 0 || (changelog.value?.dependencies ?? []).length > 0)

// the SPL moved on from the version the product was derived against, although what moved has no changelog to show
const updateAvailable = computed(() => Boolean(changelog.value?.lineFrom && changelog.value?.lineTo && changelog.value.lineFrom !== changelog.value.lineTo))

const confirm = () => {
  emit('update:visible', false)
  emit('confirm')
}
</script>

<template>
  <Dialog :visible="visible" modal :style="{ width: 'min(64rem, 94vw)' }" :content-style="{ padding: 0 }" class="sync-preview" @update:visible="emit('update:visible', $event)">
    <template #header>
      <div class="sync-preview__head">
        <span class="sync-preview__title">{{ $t('changelog.sync_title', { name: productName }) }}</span>
        <span v-if="changelog?.lineFrom && changelog?.lineTo" class="sync-preview__range" data-test="sync-preview-range">
          <i class="pi pi-sync" />v{{ changelog.lineFrom }}<i class="pi pi-arrow-right" />v{{ changelog.lineTo }}
        </span>
      </div>
    </template>
    <div class="sync-preview__body">
      <Skeleton v-if="loading" height="140px" />
      <p v-else-if="failed" data-test="sync-preview-failed">{{ $t('changelog.failed') }}</p>
      <template v-else-if="changelog">
        <ChangelogView v-if="hasChanges" :changelog="{ sections: lineSections, dependencies: changelog.dependencies ?? [], breaking: lineBreaking }" />
        <p v-else-if="updateAvailable" class="sync-preview__nothing" data-test="sync-preview-update">{{ $t('changelog.sync_update_available', { from: changelog.lineFrom, to: changelog.lineTo }) }}</p>
        <p v-else class="sync-preview__nothing" data-test="sync-preview-nothing">{{ $t('changelog.sync_nothing') }}</p>
      </template>
    </div>
    <template #footer>
      <Button text :label="$t('labels.cancel')" @click="emit('update:visible', false)" />
      <Button name="confirm-sync" icon="pi pi-sync" :label="$t('changelog.sync_confirm')" :disabled="loading" @click="confirm" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.sync-preview__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; }
.sync-preview__title { font-size: 18px; font-weight: 700; }
.sync-preview__range { display: inline-flex; align-items: center; gap: 8px; padding: 3px 12px; border-radius: 999px; font-size: 12.5px; font-family: var(--font-mono, ui-monospace, monospace); color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); i { font-size: 11px; } }
.sync-preview__body { max-height: min(68vh, 44rem); overflow-y: auto; padding: 20px 24px 24px; border-top: 1px solid var(--p-content-border-color); border-bottom: 1px solid var(--p-content-border-color); }
.sync-preview__nothing { margin: 8px 0; color: var(--p-text-muted-color); }
</style>
