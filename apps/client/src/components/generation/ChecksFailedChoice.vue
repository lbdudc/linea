<script setup>
import { useT } from 'src/composables/useT'

const props = defineProps({
  modelValue: { type: String, default: 'ask' },
  disabled: { type: Boolean, default: false },
  name: { type: String, default: 'checks-failed-choice' },
})
const emit = defineEmits(['update:modelValue'])
const t = useT()
const OPTIONS = ['ask', 'merge', 'reject']
const choose = (option) => {
  if (!props.disabled) emit('update:modelValue', option)
}
</script>

<template>
  <ul class="cfc" role="radiogroup" :aria-label="t('cicd.on_failed')" :name="name">
    <li v-for="option in OPTIONS" :key="option">
      <button
        type="button"
        role="radio"
        class="cfc__option"
        :class="{ 'cfc__option--on': (modelValue ?? 'ask') === option }"
        :aria-checked="(modelValue ?? 'ask') === option"
        :disabled="disabled"
        :name="`${name}-${option}`"
        @click="choose(option)"
      >
        <span class="cfc__radio" aria-hidden="true" />
        <span class="cfc__text">
          <span class="cfc__label">{{ t(`cicd.on_failed_${option}`) }}</span>
          <span class="cfc__desc">{{ t(`cicd.on_failed_${option}_desc`) }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>

<style scoped lang="scss">
.cfc {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 8px;

  > li { display: flex; min-width: 0; }

  &__option {
    width: 100%;
    min-height: 60px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    box-sizing: border-box;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--text-heading);
    background: transparent;
    border: 1px solid var(--p-content-border-color);
    border-radius: var(--p-content-border-radius, 8px);
    transition: border-color 0.12s, background 0.12s;

    &:hover:not(:disabled) { border-color: var(--p-primary-color); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
    &:disabled { cursor: default; opacity: 0.7; }

    &--on {
      border-color: var(--p-primary-color);
      background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
    }
  }

  &__radio {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    box-sizing: border-box;
  }

  &__option--on &__radio {
    border-color: var(--p-primary-color);
    background: radial-gradient(circle, var(--p-primary-color) 45%, transparent 50%);
  }

  &__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  &__label { font-size: 0.875rem; font-weight: 500; line-height: 1.25; }
  &__desc { font-size: 0.75rem; line-height: 1.3; color: var(--text-muted); }
}

@media (max-width: 760px) {
  .cfc { grid-template-columns: minmax(0, 1fr); }
}
</style>
