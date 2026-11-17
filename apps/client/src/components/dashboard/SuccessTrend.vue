<script setup>
import { computed, getCurrentInstance } from 'vue'
import Skeleton from 'primevue/skeleton'
import { useT } from 'src/composables/useT'
import { successTone } from 'src/utils/successTone'

// The success rate over time, drawn as a line (blue, so it does not read as one more status chart): the faint line is each day,
// the strong one the rate of the 7 days up to it. Days without deployments have no rate and are skipped.
const W = 320
const H = 104
const PAD = { top: 10, right: 4, bottom: 6, left: 4 }
const TARGET = 90
const WINDOW = 7

const props = defineProps({
  // [{ date: Date, success, warning, error, total }]
  days: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const instance = getCurrentInstance()
const t = useT()
const formatter = computed(() => new Intl.DateTimeFormat(instance?.proxy?.$i18n?.locale ?? 'en', { day: '2-digit', month: 'short' }))

const xOf = (i, n) => PAD.left + (n > 1 ? (i / (n - 1)) * (W - PAD.left - PAD.right) : (W - PAD.left - PAD.right) / 2)
const yOf = (rate) => PAD.top + (1 - rate / 100) * (H - PAD.top - PAD.bottom)

const series = computed(() => {
  const n = props.days.length
  return props.days.map((d, i) => {
    const from = Math.max(0, i - WINDOW + 1)
    let s = 0
    let total = 0
    for (let j = from; j <= i; j++) { s += props.days[j].success; total += props.days[j].total }
    return {
      d,
      x: xOf(i, n),
      rate: d.total > 0 ? Math.round((d.success / d.total) * 100) : null,
      rolling: total > 0 ? Math.round((s / total) * 100) : null,
    }
  })
})

const path = (key) => series.value
  .filter((p) => p[key] !== null)
  .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${yOf(p[key]).toFixed(1)}`)
  .join(' ')

const dailyPath = computed(() => path('rate'))
const rollingPath = computed(() => path('rolling'))
const areaPath = computed(() => {
  const pts = series.value.filter((p) => p.rolling !== null)
  if (pts.length < 2) return ''
  return `${rollingPath.value} L${pts.at(-1).x.toFixed(1)},${H - PAD.bottom} L${pts[0].x.toFixed(1)},${H - PAD.bottom} Z`
})
const targetY = yOf(TARGET)
// only the days that had enough deployments to mean something
const lows = computed(() => series.value.filter((p) => p.d.total >= 3 && p.rate < 70))
const latest = computed(() => series.value.filter((p) => p.rolling !== null).at(-1) ?? null)
const hasData = computed(() => series.value.some((p) => p.rate !== null))
</script>

<template>
  <section class="trend" :aria-busy="loading">
    <div class="trend__rule">
      <span class="trend__title">{{ t('dashboard.success_trend_heading', { n: days.length }) }}</span>
      <span class="trend__line" />
      <span v-if="!loading && latest" class="trend__now" :class="`trend__now--${successTone(latest.rolling)}`" :title="t('dashboard.success_trend_rolling')">
        {{ latest.rolling }}%<small>7d</small>
      </span>
    </div>

    <Skeleton v-if="loading" height="104px" />
    <p v-else-if="!hasData" class="trend__empty">{{ t('dashboard.no_deployments_yet') }}</p>
    <template v-else>
      <div class="trend__plot">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="trend__svg" role="img" :aria-label="t('dashboard.success_trend_heading', { n: days.length })">
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--chart-1)" stop-opacity="0.26" />
              <stop offset="100%" stop-color="var(--chart-1)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <rect :x="PAD.left" :y="PAD.top" :width="W - PAD.left - PAD.right" :height="targetY - PAD.top" class="trend__band" />
          <line :x1="PAD.left" :x2="W - PAD.right" :y1="targetY" :y2="targetY" class="trend__target" />
          <path v-if="areaPath" :d="areaPath" fill="url(#trend-fill)" />
          <path :d="dailyPath" class="trend__daily" vector-effect="non-scaling-stroke" />
          <path :d="rollingPath" class="trend__rolling" vector-effect="non-scaling-stroke" />
        </svg>
        <span
          v-for="p in lows"
          :key="p.d.date.toISOString()"
          class="trend__low"
          :style="{ left: `${(p.x / W) * 100}%`, top: `${(yOf(p.rate) / H) * 100}%` }"
          :title="`${formatter.format(p.d.date)}: ${p.rate}% (${p.d.success}/${p.d.total})`"
        />
        <span class="trend__target-label" :style="{ top: `${(targetY / H) * 100}%` }">{{ TARGET }}%</span>
      </div>
      <div class="trend__foot">
        <span>{{ formatter.format(days[0].date) }}</span>
        <span class="trend__key"><i class="trend__swatch trend__swatch--daily" />{{ t('dashboard.success_trend_daily') }}</span>
        <span class="trend__key"><i class="trend__swatch trend__swatch--rolling" />{{ t('dashboard.success_trend_rolling') }}</span>
        <span>{{ formatter.format(days.at(-1).date) }}</span>
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.trend {
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

  &__now {
    font-family: var(--font-sans);
    font-size: 18px;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    color: var(--p-text-color);

    small {
      margin-left: 3px;
      font-family: inherit;
      font-size: 10px;
      letter-spacing: 0.04em;
      color: var(--p-text-dim-color);
    }

    &--ok { color: var(--status-ok); }
    &--warn { color: var(--status-warn); }
    &--bad { color: var(--status-bad); }
  }

  &__empty {
    margin: 0;
    font-size: 13px;
    color: var(--p-text-muted-color);
  }

  &__plot {
    position: relative;
    height: 104px;
  }

  &__svg {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  // the zone above the target: where the rate is as it should be
  &__band { fill: var(--chart-1-soft); opacity: 0.55; }

  &__target {
    stroke: var(--chart-1);
    stroke-opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 3 4;
    vector-effect: non-scaling-stroke;
  }

  &__target-label {
    position: absolute;
    right: 2px;
    transform: translateY(-125%);
    font-size: 10px;
    color: var(--p-text-dim-color);
  }

  &__daily {
    fill: none;
    stroke: var(--chart-1);
    stroke-opacity: 0.35;
    stroke-width: 1.25;
    stroke-linejoin: round;
  }

  &__rolling {
    fill: none;
    stroke: var(--chart-1);
    stroke-width: 2.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  // the days that were really bad stand out from the line
  &__low {
    position: absolute;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    box-sizing: content-box;
    border: 2px solid var(--p-content-background);
    border-radius: 50%;
    background: var(--viz-bad);
  }

  &__foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--p-text-dim-color);
  }

  &__key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  &__swatch {
    display: inline-block;
    width: 14px;
    height: 0;
    border-top: 2px solid var(--chart-1);

    &--daily { border-top-width: 1px; opacity: 0.5; }
  }
}
</style>
