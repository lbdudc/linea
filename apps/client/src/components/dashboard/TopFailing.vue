<script setup>
import { computed } from 'vue'
import Skeleton from 'primevue/skeleton'

// The products with most failed generations in the period, one square per deployment: a unit chart, where each product
// shows what became of its deployments (red failed, amber conflicted, the rest went through).
const MAX_SQUARES = 14

const props = defineProps({
  // [{ productId, name, lineName, error, warning, total }]
  products: { type: Array, default: () => [] },
  days: { type: Number, default: 14 },
  loading: { type: Boolean, default: false },
})

const rows = computed(() => props.products.map((p, index) => {
  const squares = Math.min(p.total, MAX_SQUARES)
  const scale = p.total > MAX_SQUARES ? MAX_SQUARES / p.total : 1
  const errors = p.error > 0 ? Math.max(1, Math.round(p.error * scale)) : 0
  const warnings = p.warning > 0 ? Math.max(1, Math.round(p.warning * scale)) : 0
  const cells = Array.from({ length: squares }, (_, i) => (i < errors ? 'error' : i < errors + warnings ? 'warning' : 'ok'))
  return { ...p, rank: index + 1, cells, failed: p.error + p.warning }
}))
</script>

<template>
  <section class="top" :aria-busy="loading">
    <div class="top__rule">
      <span class="top__title">{{ $t('dashboard.top_failing_heading', { n: days }) }}</span>
      <span class="top__line" />
    </div>

    <Skeleton v-if="loading" height="124px" />
    <p v-else-if="!rows.length" class="top__ok">
      <i class="pi pi-check-circle" aria-hidden="true" /> {{ $t('dashboard.no_failures') }}
    </p>
    <ol v-else class="top__list">
      <li v-for="p in rows" :key="p.productId" class="top__row">
        <span class="top__rank">{{ p.rank }}</span>
        <div class="top__who">
          <router-link :to="`/products/${p.productId}`" class="top__name">{{ p.name }}</router-link>
          <span class="top__line-name">{{ p.lineName }}</span>
        </div>
        <div class="top__cells" :title="`${p.error} / ${p.warning} / ${p.total}`">
          <span v-for="(cell, i) in p.cells" :key="i" class="top__cell" :class="`top__cell--${cell}`" />
        </div>
        <router-link :to="{ path: '/cicd', query: { productId: p.productId, outcome: 'error' } }" class="top__count" :title="$t('dashboard.view_failed_runs')">
          <strong>{{ p.failed }}</strong><span class="top__of">/{{ p.total }}</span>
        </router-link>
      </li>
    </ol>
  </section>
</template>

<style scoped lang="scss">
.top {
  min-width: 0;
  container-type: inline-size;

  &__rule {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }

  &__title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--p-text-dim-color);
    white-space: nowrap;
  }

  &__line {
    flex-grow: 1;
    height: 1px;
    background: var(--p-content-hover-background);
  }

  &__ok {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 13px;
    color: var(--status-ok);
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: grid;
    grid-template-columns: 18px minmax(0, 220px) minmax(0, 1fr) 44px;
    align-items: center;
    gap: 12px;
  }

  &__rank {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--viz-track);
    font-size: 10px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    color: var(--p-text-muted-color);
  }

  &__who {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    color: var(--p-text-color);
    text-decoration: none;

    &:hover { color: var(--p-primary-color); }
  }

  &__line-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--p-text-muted-color);
  }

  &__cells {
    display: flex;
    gap: 3px;
  }

  &__cell {
    width: 9px;
    height: 9px;
    border-radius: 2px;

    &--error { background: var(--viz-bad); }
    &--warning { background: var(--viz-warn); }
    &--ok { background: var(--viz-track); }
  }

  &__count {
    text-align: right;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: inherit;
    text-decoration: none;

    &:hover strong { text-decoration: underline; }

    strong { font-weight: 600; color: var(--p-text-color); }
  }

  &__of { color: var(--p-text-dim-color); }
}

// a narrow card: the squares go under the name instead of taking its room
@container (max-width: 400px) {
  .top__row {
    grid-template-columns: 18px minmax(0, 1fr) auto;
    row-gap: 6px;
  }

  .top__cells {
    grid-column: 2 / 3;
    grid-row: 2;
  }

  .top__count { grid-row: 1; grid-column: 3; }
}
</style>
