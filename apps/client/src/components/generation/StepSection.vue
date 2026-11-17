<script setup>
defineProps({
  label: { type: String, required: true },
  open: { type: Boolean, required: true },
  name: { type: String, required: true },
})
defineEmits(['update:open'])
</script>

<template>
  <section class="stepsec">
    <button
      type="button" class="stepsec__toggle" :name="`${name}-toggle`" :aria-expanded="open"
      @click="$emit('update:open', !open)"
    >
      <i class="pi pi-chevron-right stepsec__chevron" :class="{ 'stepsec__chevron--open': open }" aria-hidden="true" />
      <span :name="`${name}-count`">{{ label }}</span>
    </button>
    <div v-show="open" class="stepsec__body" :name="`${name}-body`"><slot /></div>
  </section>
</template>

<style scoped lang="scss">
.stepsec {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  &__toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 2px;
    font: inherit;
    font-size: 0.75rem;
    color: var(--text-muted);
    background: none;
    border: 0;
    border-radius: 6px;
    cursor: pointer;

    &:hover { color: var(--text-heading); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__chevron {
    font-size: 0.6875rem;
    transition: transform 0.15s ease;
    &--open { transform: rotate(90deg); }
  }

  &__body { min-width: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .stepsec__chevron { transition: none; }
}
</style>
