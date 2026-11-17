<script setup>
import { setHomeView } from 'stores/homeView'

defineProps({
  count: { type: Number, default: 0 },
})
</script>

<template>
  <button
    v-if="count > 0"
    type="button"
    class="need-you"
    name="need-you-pill"
    :aria-label="$t('home.need_you_aria', { n: count })"
    @click="setHomeView('all')"
  >
    <span class="need-you__dot" aria-hidden="true" />
    {{ $t('home.need_you_pill', { n: count }) }}
  </button>
</template>

<style scoped lang="scss">
.need-you {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--status-bad-strong);
  background: var(--status-bad-soft);
  cursor: pointer;

  &:focus-visible { outline: 2px solid var(--status-bad); outline-offset: 2px; }

  &__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--status-bad); }
}
</style>
