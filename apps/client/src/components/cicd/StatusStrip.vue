<script setup>
import InfoHint from 'src/components/common/InfoHint.vue'

// The counters of a CI/CD view: each cell says what it counts. `tone`: ok | warn | bad | sync; `hint` is the ⓘ; `action` a link under it.
defineProps({ cells: { type: Array, required: true } })
defineEmits(['action'])
</script>

<template>
  <div class="ln-strip cicd-strip" name="cicd-strip" :style="{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }">
    <div v-for="cell in cells" :key="cell.key" class="ln-strip__cell" :name="`cicd-cell-${cell.key}`">
      <span class="ln-strip__label">{{ cell.label }}<InfoHint v-if="cell.hint" :text="cell.hint" /></span>
      <strong class="ln-strip__value cicd-strip__value" :class="cell.tone && `ln-strip__value--${cell.tone === 'sync' ? 'sync' : cell.tone}`">{{ cell.value }}</strong>
      <span class="ln-strip__sub">{{ cell.sub }}</span>
      <span v-if="cell.action" class="ln-strip__links">
        <button type="button" class="ln-link" :class="{ 'ln-link--sync': cell.tone === 'sync' }" :name="`cicd-cell-${cell.key}-action`" @click="$emit('action', cell.key)">{{ cell.action }}</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.cicd-strip__value { font-size: 1.5rem; line-height: 1.15; }
@media (max-width: 900px) { .cicd-strip { grid-template-columns: 1fr !important; } }
</style>
