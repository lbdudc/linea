<script setup>
import { computed, watch } from 'vue'
import { ciOf, loadCi } from 'src/composables/usePortfolio'
import Skeleton from 'primevue/skeleton'

// How long ago the products were synced: a bar over the buckets and the products that have gone longest without a sync, each
// with the state of its last pipeline.
const DAY_MS = 86_400_000

const props = defineProps({
  // { recent, stale7, stale30, stale90, never }
  staleness: { type: Object, default: () => ({ recent: 0, stale7: 0, stale30: 0, stale90: 0, never: 0 }) },
  // [{ _id, name, lineName, lastSyncAt }]
  stalest: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const BUCKETS = [
  { key: 'recent', label: 'analytics.recent', tone: 'ok' },
  { key: 'stale7', label: 'analytics.stale_7_30', tone: 'warn' },
  { key: 'stale30', label: 'analytics.stale_30_90', tone: 'serious' },
  { key: 'stale90', label: 'analytics.stale_90_plus', tone: 'bad' },
  { key: 'never', label: 'analytics.never_synced', tone: 'neutral' },
]

const buckets = computed(() => {
  const total = BUCKETS.reduce((n, b) => n + (props.staleness?.[b.key] ?? 0), 0)
  return BUCKETS.map((b) => {
    const value = props.staleness?.[b.key] ?? 0
    return { ...b, value, share: total > 0 ? (value / total) * 100 : 0 }
  })
})
const total = computed(() => buckets.value.reduce((n, b) => n + b.value, 0))

const ageOf = (lastSyncAt) => (lastSyncAt ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / DAY_MS) : null)
const toneOf = (lastSyncAt) => {
  const age = ageOf(lastSyncAt)
  if (age === null || age > 90) return 'bad'
  return age > 30 ? 'serious' : 'warn'
}

// the pipeline of the products the list shows, one call to the git host each
watch(
  () => props.stalest.map((p) => p._id).join(','),
  () => loadCi(props.stalest.map((p) => p._id)),
  { immediate: true },
)

const CI_TONE = { success: 'ok', passed: 'ok', failed: 'bad', canceled: 'neutral', running: 'warn', pending: 'warn' }
const ciState = (id) => {
  const ci = ciOf(id)
  if (ci === undefined) return { loading: true }
  return { loading: false, status: ci.status, tone: CI_TONE[ci.status] ?? 'neutral', webUrl: ci.webUrl }
}
</script>

<template>
  <section class="fresh" :aria-busy="loading">
    <div class="fresh__rule">
      <span class="fresh__title">{{ $t('dashboard.freshness_heading') }}</span>
      <span class="fresh__line" />
    </div>

    <Skeleton v-if="loading" height="96px" />
    <p v-else-if="total === 0" class="fresh__empty">{{ $t('analytics.no_data') }}</p>
    <template v-else>
      <div class="fresh__bar" role="img" :aria-label="buckets.map((b) => `${$t(b.label)} ${b.value}`).join(', ')">
        <span
          v-for="b in buckets.filter((x) => x.value > 0)"
          :key="b.key"
          class="fresh__segment"
          :class="`fresh__segment--${b.tone}`"
          :style="{ width: `${b.share}%` }"
          :title="`${$t(b.label)}: ${b.value}`"
        />
      </div>
      <ul class="fresh__legend">
        <li v-for="b in buckets" :key="b.key" class="fresh__legend-item">
          <span class="fresh__dot" :class="`fresh__dot--${b.tone}`" aria-hidden="true" />
          {{ $t(b.label) }}
          <strong>{{ b.value }}</strong>
        </li>
      </ul>

      <p v-if="!stalest.length" class="fresh__ok">
        <i class="pi pi-check-circle" aria-hidden="true" /> {{ $t('dashboard.freshness_all_recent') }}
      </p>
      <ul v-else class="fresh__list">
        <li v-for="p in stalest" :key="p._id" class="fresh__item">
          <router-link :to="`/products/${p._id}`" class="fresh__name">{{ p.name }}</router-link>
          <span class="fresh__line-name">{{ p.lineName }}</span>
          <span class="fresh__age" :class="`fresh__age--${toneOf(p.lastSyncAt)}`">
            {{ p.lastSyncAt ? $t('labels.sync_days_ago', { n: ageOf(p.lastSyncAt) }) : $t('analytics.never_synced') }}
          </span>
          <span class="fresh__ci" :title="$t('dashboard.ci_label')">
            <Skeleton v-if="ciState(p._id).loading" width="8px" height="8px" border-radius="50%" />
            <a
              v-else-if="ciState(p._id).webUrl"
              :href="ciState(p._id).webUrl"
              target="_blank"
              rel="noopener"
              class="fresh__dot"
              :class="`fresh__dot--${ciState(p._id).tone}`"
              :aria-label="`${$t('dashboard.ci_label')}: ${ciState(p._id).status}`"
            />
            <span
              v-else
              class="fresh__dot"
              :class="`fresh__dot--${ciState(p._id).tone}`"
              :aria-label="`${$t('dashboard.ci_label')}: ${ciState(p._id).status ?? $t('dashboard.ci_unknown')}`"
            />
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped lang="scss">
.fresh {
  min-width: 0;

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

  &__empty {
    margin: 0;
    font-size: 13px;
    color: var(--p-text-muted-color);
  }

  &__bar {
    display: flex;
    gap: 3px;
    height: 22px;
    margin-bottom: 14px;
  }

  &__segment {
    min-width: 8px;
    border-radius: 4px;

    &--ok { background: var(--seq-1); }
    &--warn { background: var(--seq-2); }
    &--serious { background: var(--seq-3); }
    &--bad { background: var(--seq-4); }
    &--neutral {
      background: repeating-linear-gradient(135deg, var(--viz-neutral) 0 3px, transparent 3px 6px);
      border: 1px solid var(--viz-neutral);
    }
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
  }

  &__legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--p-text-muted-color);

    strong { color: var(--p-text-color); font-variant-numeric: tabular-nums; }
  }

  &__dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;

    &--ok { background: var(--seq-1); }
    &--warn { background: var(--seq-2); }
    &--serious { background: var(--seq-3); }
    &--bad { background: var(--seq-4); }
    &--neutral { background: transparent; border: 1.5px solid var(--viz-neutral); }
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
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__item {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto 16px;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--p-content-hover-background);
    font-size: 13px;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: var(--p-text-color);
    text-decoration: none;

    &:hover { color: var(--p-primary-color); text-decoration: underline; }
  }

  &__line-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--p-text-muted-color);
  }

  &__age {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;

    &--warn { color: var(--status-warn); background: var(--status-warn-soft); }
    &--serious { color: var(--status-serious); background: color-mix(in srgb, var(--status-serious) 12%, transparent); }
    &--bad { color: var(--status-bad); background: var(--status-bad-soft); }
  }

  &__ci {
    display: flex;
    justify-content: center;
  }
}
</style>
