<script setup>
import Tooltip from 'primevue/tooltip'

// An explanation that is not on the screen until it is asked for: an icon that shows `text` on hover and on focus. The place for what a
// setting does, so the form does not carry a paragraph under every field.
defineProps({ text: { type: String, required: true } })
const vTooltip = Tooltip
</script>

<template>
  <i
    v-tooltip.bottom="{ value: text, class: 'info-hint__tip' }"
    class="pi pi-info-circle info-hint"
    tabindex="0"
    role="img"
    :aria-label="text"
  />
</template>

<style scoped>
.info-hint { font-size: 13px; color: var(--p-text-faint-color); cursor: help; margin-inline-start: 6px; vertical-align: middle; }
.info-hint:hover, .info-hint:focus-visible { color: var(--p-text-color); outline: none; }
</style>
