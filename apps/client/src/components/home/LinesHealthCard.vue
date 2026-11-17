<script setup>
import { successTone } from 'src/utils/successTone'

defineProps({
  // [{ id, name, ok, warn, bad, total, rate }]
  lines: { type: Array, default: () => [] },
})

const share = (value, total) => (total > 0 ? `${(value / total) * 100}%` : '0%')
</script>

<template>
  <section class="lines-card" name="lines-health-card">
    <div class="lines-card__head">
      <h2 class="lines-card__title">{{ $t('home.lines_title') }}</h2>
      <router-link to="/cicd" class="lines-card__link">{{ $t('home.lines_cicd') }} →</router-link>
    </div>

    <router-link
      v-for="line in lines"
      :key="line.id"
      :to="`/lines/${line.id}`"
      class="lines-card__row"
      :name="`lines-row-${line.id}`"
    >
      <strong class="lines-card__name">{{ line.name }}</strong>
      <span
        class="lines-card__bar"
        role="img"
        :aria-label="$t('home.line_health_aria', { ok: line.ok, warn: line.warn, bad: line.bad })"
      >
        <span class="lines-card__seg lines-card__seg--ok" :style="{ width: share(line.ok, line.total) }" />
        <span class="lines-card__seg lines-card__seg--warn" :style="{ width: share(line.warn, line.total) }" />
        <span class="lines-card__seg lines-card__seg--bad" :style="{ width: share(line.bad, line.total) }" />
      </span>
      <span class="lines-card__rate" :class="`lines-card__rate--${successTone(line.rate)}`">
        {{ line.rate == null ? '—' : `${line.rate} %` }}
      </span>
    </router-link>
  </section>
</template>

<style scoped lang="scss">
.lines-card {
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  background: var(--p-content-background);

  &__head { display: flex; align-items: center; min-height: 28px; margin-bottom: 4px; }
  &__title { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
  &__link { font-size: 12px; color: var(--p-primary-color); text-decoration: none; &:hover { text-decoration: underline; } }

  &__row {
    display: grid;
    grid-template-columns: minmax(80px, 130px) 1fr 52px;
    gap: 10px;
    align-items: center;
    min-height: 32px;
    color: var(--p-text-color);
    text-decoration: none;
    font-size: 13px;

    &:hover .lines-card__name { text-decoration: underline; }
  }

  &__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--p-content-hover-background); }
  &__seg { height: 100%;
    &--ok { background: var(--viz-ok); }
    &--warn { background: var(--viz-warn); }
    &--bad { background: var(--viz-bad); }
  }
  &__rate { text-align: right; font-variant-numeric: tabular-nums; color: var(--p-text-muted-color);
    &--ok { color: var(--status-ok); }
    &--bad { color: var(--status-bad); }
  }
}
</style>
