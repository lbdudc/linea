<script setup>
defineOptions({ inheritAttrs: false })
defineProps({ name: { type: String, default: null } })
</script>

<template>
  <div class="embedded" :name="name">
    <slot />
    <div v-if="$slots.footer" class="embedded__footer"><slot name="footer" /></div>
  </div>
</template>

<style scoped>
.embedded { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.embedded__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.embedded__footer:empty { display: none; }
.embedded :deep(.log-item__message),
.embedded :deep(.p-button-label),
.embedded :deep(.mrchecks__status),
.embedded :deep(.mrchecks__decision-title),
.embedded :deep(.gr__pipeline-status) { font-size: 0.8125rem; }
.embedded :deep(.gr__versions) { font-size: 0.875rem; }
</style>
