<script setup>
import { computed } from 'vue'

// What is wrong (or worth knowing) about a set of packages or models: each problem names the package and file at fault.
const props = defineProps({
  diagnostics: { type: Array, default: () => [] },
  // only the problems about this file
  file: { type: String, default: null },
  emptyLabel: { type: String, default: null },
})

const shown = computed(() => props.diagnostics.filter((d) => props.file === null || d.file === props.file))
const shortPackage = (name) => (name ?? '').replace(/^[a-z]+:/, '')
</script>

<template>
  <ul v-if="shown.length" class="diagnostics" role="list">
    <li
      v-for="(d, index) in shown"
      :key="index"
      class="diagnostics__item"
      :class="`diagnostics__item--${d.severity}`"
    >
      <i
        class="pi diagnostics__icon"
        :class="d.severity === 'error' ? 'pi-times-circle' : 'pi-exclamation-triangle'"
        aria-hidden="true"
      />
      <div class="diagnostics__body">
        <span class="diagnostics__where ident">
          {{ shortPackage(d.package) }}<template v-if="d.file && file === null"> · {{ d.file }}</template>
        </span>
        <span class="diagnostics__message">{{ d.message }}</span>
      </div>
    </li>
  </ul>
  <p v-else-if="emptyLabel" class="diagnostics__empty">
    <i class="pi pi-check-circle" aria-hidden="true" /> {{ emptyLabel }}
  </p>
</template>

<style scoped>
.diagnostics {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diagnostics__item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  font-size: 13px;
}
.diagnostics__item--error { border-color: var(--status-bad-border, var(--status-bad)); background: var(--status-bad-soft, transparent); }
.diagnostics__item--error .diagnostics__icon { color: var(--status-bad); }
.diagnostics__item--warning .diagnostics__icon { color: var(--status-warn); }
.diagnostics__icon { margin-top: 2px; }
.diagnostics__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.diagnostics__where { color: var(--p-text-muted-color); font-size: 12px; overflow-wrap: anywhere; }
.diagnostics__message { color: var(--p-text-color); overflow-wrap: anywhere; white-space: pre-wrap; }
.diagnostics__empty { margin: 0; font-size: 13px; color: var(--status-ok); display: flex; gap: 6px; align-items: center; }
</style>
