<script setup>
import { ref } from 'vue'
import ModeSwitch from './ModeSwitch.vue'

// The frame every CI/CD view has: the choice between status and configuration on the left and, on the status side, the period the numbers
// are of; a page may add filters after the choice and, at the end, whatever else it needs (a refresh). The content is the page's.
defineProps({ modelValue: { type: String, required: true } })
defineEmits(['update:modelValue'])
const PERIODS = [7, 14, 90]
const period = ref(14)
</script>

<template>
  <div class="cframe">
    <div class="cframe__bar">
      <ModeSwitch :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" />
      <!-- what the page lets the person narrow the numbers to (only the status has them) -->
      <slot v-if="modelValue === 'status'" name="filters" />
      <span class="cframe__spacer" />
      <div v-if="modelValue === 'status'" class="cframe__period" role="group">
        <button v-for="p in PERIODS" :key="p" type="button" class="cframe__pill" :class="{ 'cframe__pill--on': period === p }" :name="`period-${p}`" @click="period = p">
          {{ $t('cicdview.period_days', { n: p }) }}
        </button>
      </div>
      <slot name="actions" />
    </div>
    <slot :period="period" />
  </div>
</template>

<style scoped>
.cframe { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.cframe__bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cframe__spacer { flex: 1; }
.cframe__period { display: inline-flex; gap: 4px; }
.cframe__pill { padding: 2px 10px; border: 1px solid var(--card-border); border-radius: 14px; background: none; font: inherit; font-size: 0.75rem; color: var(--text-muted); cursor: pointer; }
.cframe__pill:hover { color: var(--text-heading); }
.cframe__pill--on { background: var(--p-highlight-soft); border-color: var(--p-primary-color); color: var(--p-primary-color); }
</style>
