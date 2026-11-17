<script setup>
import { computed } from 'vue'

// Every generation and every sync goes through the same steps: derive, checks, merge, deployed. `stage` is the step it is at and `state`
// how that step stands: ok (over), run, wait (for a person) or bad. The steps before it are over; the ones after have not come.
const props = defineProps({
  stage: { type: String, required: true },
  state: { type: String, required: true },
})
const STEPS = ['derive', 'checks', 'merge', 'deployed']
const steps = computed(() => {
  const at = STEPS.indexOf(props.stage)
  return STEPS.map((step, i) => ({ step, state: i < at ? 'ok' : i === at ? props.state : 'todo' }))
})
</script>

<template>
  <span class="stepper" name="run-steps">
    <template v-for="(s, i) in steps" :key="s.step">
      <i v-if="i" class="stepper__sep" aria-hidden="true">›</i>
      <span class="stepper__step" :class="`stepper__step--${s.state}`" :name="`step-${s.step}`">{{ $t(`cicdview.step_${s.step}`) }}</span>
    </template>
  </span>
</template>

<style scoped>
.stepper { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.stepper__step { font-size: 0.6875rem; padding: 1px 7px; border-radius: 99px; background: var(--p-content-hover-background); color: var(--text-muted); }
.stepper__step--ok { background: color-mix(in srgb, var(--status-ok) 16%, transparent); color: var(--status-ok); }
.stepper__step--run { background: var(--p-highlight-soft); color: var(--p-primary-color); font-weight: 600; }
.stepper__step--wait { background: color-mix(in srgb, var(--status-warn) 18%, transparent); color: var(--status-warn); font-weight: 600; }
.stepper__step--stop { background: var(--card-bg); color: var(--text-muted); font-weight: 600; }
.stepper__step--bad { background: color-mix(in srgb, var(--status-bad) 16%, transparent); color: var(--status-bad); font-weight: 600; }
.stepper__sep { font-style: normal; color: var(--card-border); }
</style>
