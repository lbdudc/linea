<script setup>
// The one choice every CI/CD view has: what is happening (status) or how it is set up (configuration).
defineProps({ modelValue: { type: String, required: true } })
defineEmits(['update:modelValue'])
const MODES = ['status', 'config']
</script>

<template>
  <div class="ln-modes" role="tablist" name="cicd-mode">
    <button
      v-for="mode in MODES" :key="mode" type="button" role="tab" class="ln-modes__btn"
      :class="{ 'ln-modes__btn--on': modelValue === mode }" :aria-selected="modelValue === mode" :name="`cicd-mode-${mode}`"
      @click="$emit('update:modelValue', mode)"
    >
      <i :class="mode === 'status' ? 'pi pi-circle-fill' : 'pi pi-cog'" aria-hidden="true" /> {{ $t(`cicdview.mode_${mode}`) }}
    </button>
  </div>
</template>

<style scoped>
.ln-modes { display: inline-flex; border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; background: var(--card-bg); }
.ln-modes__btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border: 0; background: none; font: inherit; font-size: 0.8125rem; color: var(--text-muted); cursor: pointer; }
.ln-modes__btn i { font-size: 0.6875rem; }
.ln-modes__btn--on { background: var(--p-highlight-soft); color: var(--p-primary-color); font-weight: 600; }
</style>
