<script setup>
import { computed } from 'vue'
import Skeleton from 'primevue/skeleton'
import { successTone } from 'src/utils/successTone'

// Where the deployments of the period went, line by line: a ring with a colour per line (the categorical palette, not the
// status colours), and each line's success rate next to its name.
const props = defineProps({
  // [{ lineId, name, success, warning, error, total, successRate }], most failing first
  lines: { type: Array, default: () => [] },
  days: { type: Number, default: 14 },
  loading: { type: Boolean, default: false },
})

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const MAX_SLICES = COLORS.length
const R = 15.9155 // a circumference of 100, so a share is its own length
const GAP = 1.2

const total = computed(() => props.lines.reduce((n, l) => n + l.total, 0))

// the biggest lines get a colour each; the rest share one neutral slice
const slices = computed(() => {
  const sorted = [...props.lines].sort((a, b) => b.total - a.total)
  const head = sorted.slice(0, MAX_SLICES).map((l, i) => ({ ...l, color: COLORS[i] }))
  const rest = sorted.slice(MAX_SLICES)
  if (rest.length) {
    const sum = (key) => rest.reduce((n, l) => n + l[key], 0)
    const t = sum('total')
    head.push({ lineId: null, name: null, other: rest.length, total: t, success: sum('success'), color: 'var(--viz-neutral)', successRate: t ? Math.round((sum('success') / t) * 100) : null })
  }
  let offset = 0
  return head.map((s) => {
    const share = total.value ? (s.total / total.value) * 100 : 0
    const out = { ...s, share, dash: Math.max(0, share - GAP), offset: -offset }
    offset += share
    return out
  })
})

</script>

<template>
  <section class="byline" :aria-busy="loading">
    <div class="byline__rule">
      <span class="byline__title">{{ $t('dashboard.by_line_heading', { n: days }) }}</span>
      <span class="byline__line" />
    </div>

    <Skeleton v-if="loading" height="124px" />
    <p v-else-if="!lines.length" class="byline__empty">{{ $t('dashboard.no_deployments_yet') }}</p>
    <div v-else class="byline__body">
      <div class="byline__ring">
        <svg viewBox="0 0 36 36" class="byline__svg" role="img" :aria-label="$t('dashboard.by_line_heading', { n: days })">
          <circle cx="18" cy="18" :r="R" class="byline__base" />
          <circle
            v-for="s in slices"
            :key="s.lineId ?? 'others'"
            cx="18"
            cy="18"
            :r="R"
            class="byline__slice"
            :stroke="s.color"
            :stroke-dasharray="`${s.dash} ${100 - s.dash}`"
            :stroke-dashoffset="s.offset"
          />
        </svg>
        <div class="byline__center">
          <strong>{{ total }}</strong>
          <span>{{ $t('dashboard.deployments_short') }}</span>
        </div>
      </div>

      <ul class="byline__list">
        <li v-for="s in slices" :key="s.lineId ?? 'others'" class="byline__row">
          <span class="byline__swatch" :style="{ background: s.color }" aria-hidden="true" />
          <router-link v-if="s.lineId" :to="`/lines/${s.lineId}?tab=cicd`" class="byline__name">{{ s.name }}</router-link>
          <span v-else class="byline__name byline__name--muted">{{ $t('dashboard.other_lines', { n: s.other }) }}</span>
          <span class="byline__share">{{ Math.round(s.share) }}%</span>
          <span class="byline__rate" :class="`byline__rate--${successTone(s.successRate)}`">
            {{ s.successRate == null ? '—' : `${s.successRate}%` }}
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped lang="scss">
.byline {
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

  &__empty {
    margin: 0;
    font-size: 13px;
    color: var(--p-text-muted-color);
  }

  &__body {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  &__ring {
    position: relative;
    flex-shrink: 0;
    width: 124px;
    height: 124px;
  }

  &__svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  &__base {
    fill: none;
    stroke: var(--viz-track);
    stroke-width: 4.2;
  }

  &__slice {
    fill: none;
    stroke-width: 4.2;
    stroke-linecap: butt;
    transition: stroke-dasharray 0.3s ease;
  }

  &__center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;

    strong {
      font-family: var(--font-sans);
      font-size: 26px;
      font-weight: 300;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--p-text-color);
    }

    span {
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--p-text-dim-color);
    }
  }

  &__list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto 42px;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  &__swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: var(--p-text-color);
    text-decoration: none;

    &:hover { color: var(--p-primary-color); }

    &--muted { font-weight: 400; color: var(--p-text-muted-color); }
  }

  &__share {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--p-text-dim-color);
  }

  &__rate {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--p-text-muted-color);

    &--ok { color: var(--status-ok); }
    &--warn { color: var(--status-warn); }
    &--bad { color: var(--status-bad); }
  }
}

// a narrow card: the ring goes above its list instead of squeezing it
@container (max-width: 350px) {
  .byline__body {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }

  .byline__ring { align-self: center; }
}
</style>
