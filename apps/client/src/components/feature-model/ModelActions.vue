<script setup>
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'

// What can be done with the model, in one place: what plugins add (the quick analysis, say) and saving it. It sits in the toolbar of the editor.
const vTooltip = Tooltip

defineProps({
  loading: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  hasContent: { type: Boolean, default: false },
})
defineEmits(['save'])
</script>

<template>
  <div class="model-actions">
    <span v-if="readOnly" class="model-actions__chip">{{ $t('modules.read_only') }}</span>

    <slot />
    <Button
      size="small"
      icon="pi pi-sitemap"
      class="model-actions__button"
      :label="$t('labels.save')"
      :disabled="!hasContent || readOnly"
      v-tooltip.bottom="{ value: readOnly ? $t('modules.fm_read_only') : $t('labels.save_tooltip'), showDelay: 500 }"
      @click="$emit('save')"
    />
  </div>
</template>

<style scoped>
.model-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.model-actions__button { flex-shrink: 0; white-space: nowrap; }
.model-actions__chip {
  flex-shrink: 0;
  padding: 3px 8px;
  border: 1px solid var(--p-text-faint-color);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--p-text-secondary-color);
}
</style>
