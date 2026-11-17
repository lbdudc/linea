<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: null },
  compact: { type: Boolean, default: false },
  // the heading level, for a header that sits under another page title
  as: { type: String, default: 'h1' },
})
</script>

<template>
  <header class="header" :class="{ 'header--compact': compact }">
    <div class="header__text">
      <component :is="as" class="header__title">{{ title }}</component>
      <p v-if="subtitle" class="header__subtitle">{{ subtitle }}</p>
    </div>

    <div v-if="$slots.actions" class="header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped lang="scss">
.header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 24px;

  &__text {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  &__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 34px;
    font-weight: 300;
    line-height: 1.1;
  }

  &__subtitle {
    margin: 0;
    font-size: 14px;
    color: var(--p-text-muted-color);
  }

  &__actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &--compact &__title {
    font-size: 20px;
    font-weight: 400;
  }

  // a title with no actions and one with a button must sit at the same height: the button (taller than the title) takes no room of
  // its own, it overflows the row evenly above and below
  &--compact {
    align-items: center;
  }

  &--compact &__actions {
    margin-block: -9px;
  }

  @media (max-width: 600px) {
    gap: 12px;

    &__title { font-size: 26px; }
  }
}
</style>
