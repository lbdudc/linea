<script setup>
import { HOME_VIEWS, homeView, setHomeView } from 'stores/homeView'

const LABELS = { all: 'home.view_all', inbox: 'home.view_inbox', panel: 'home.view_panel' }
</script>

<template>
  <div class="switch" role="group" :aria-label="$t('home.view_label')" name="home-view-switch">
    <button
      v-for="view in HOME_VIEWS"
      :key="view"
      type="button"
      class="switch__option"
      :class="{ 'switch__option--on': homeView.view === view }"
      :aria-pressed="homeView.view === view"
      :name="`home-view-${view}`"
      @click="setHomeView(view)"
    >
      {{ $t(LABELS[view]) }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--p-content-hover-background);

  &__option {
    min-height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    color: var(--p-text-muted-color);
    background: transparent;
    cursor: pointer;

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
    &--on { font-weight: 600; color: var(--p-text-color); background: var(--p-content-background); box-shadow: 0 1px 2px var(--overlay-shadow); }
  }
}
</style>
