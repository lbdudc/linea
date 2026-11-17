<script setup>
import { computed, getCurrentInstance } from 'vue'
import StackedBars from 'src/components/dashboard/StackedBars.vue'
import { useT } from 'src/composables/useT'

const OUTCOMES = ['success', 'warning', 'error']

const props = defineProps({
  days: { type: Array, required: true },
  maxTotal: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  // change of the total against the period before it: { text, tone }
  delta: { type: Object, default: null },
  height: { type: Number, default: 112 },
  period: { type: Number, default: 30 },
  periods: { type: Array, default: () => [] },
  // success rate of the period and its change against the one before: { text, tone }
  successRate: { type: Number, default: null },
  rateDelta: { type: Object, default: null },
})

const emit = defineEmits(['update:period'])

const instance = getCurrentInstance()
const t = useT()

const dayFormatter = computed(() => {
  const locale = instance?.proxy?.$i18n?.locale ?? 'en'
  return new Intl.DateTimeFormat(locale, { day: '2-digit' })
})

const tooltipFormatter = computed(() => {
  const locale = instance?.proxy?.$i18n?.locale ?? 'en'
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short' })
})

const labelInterval = computed(() => {
  const n = props.days.length
  if (n <= 14) return 1
  if (n <= 31) return 3
  return 7
})

function showLabel(index) {
  const last = props.days.length - 1
  return index === last || index % labelInterval.value === 0
}

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const items = computed(() => props.days.map((day, index) => ({
  key: day.date.toISOString(),
  links: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, { path: '/cicd', query: { day: dayKey(day.date), outcome } }])),
  label: showLabel(index) ? dayFormatter.value.format(day.date) : null,
  title: tooltipFormatter.value.format(day.date),
  success: day.success ?? 0,
  warning: day.warning ?? 0,
  error: day.error ?? 0,
})))

const rates = computed(() => props.days.map((day) => {
  const total = (day.success ?? 0) + (day.warning ?? 0) + (day.error ?? 0)
  return total === 0 ? null : Math.round(((day.success ?? 0) / total) * 100)
}))

const legend = computed(() => [
  { outcome: 'success', label: t('dashboard.generations_legend_success') },
  { outcome: 'warning', label: t('dashboard.generations_legend_warning') },
  { outcome: 'error', label: t('dashboard.generations_legend_error') },
])

// the totals of what is drawn, so the legend counts and the bars always agree
const totals = computed(() => {
  const sums = { success: 0, warning: 0, error: 0 }
  for (const day of props.days) for (const outcome of OUTCOMES) sums[outcome] += day[outcome] ?? 0
  return { ...sums, all: sums.success + sums.warning + sums.error }
})
</script>

<template>
  <section class="gen-chart" :class="{ 'gen-chart--loading': loading }" :aria-busy="loading">
    <div class="gen-chart__rule">
      <span class="gen-chart__title">{{ t('dashboard.generations_heading', { n: days.length }) }}</span>
      <span v-if="!loading" class="gen-chart__total">
        {{ totals.all }}
        <span v-if="delta" class="gen-chart__delta" :class="`gen-chart__delta--${delta.tone}`">{{ delta.text }}</span>
      </span>
      <span v-if="!loading && successRate != null" class="gen-chart__total">
        {{ t('home.generations_success', { n: `${successRate} %` }) }}
        <span v-if="rateDelta" class="gen-chart__delta" :class="`gen-chart__delta--${rateDelta.tone}`">{{ rateDelta.text }}</span>
      </span>
      <div class="gen-chart__line" />
      <div v-if="periods.length" class="gen-chart__period" role="group" :aria-label="t('home.period_label')">
        <button
          v-for="option in periods"
          :key="option"
          type="button"
          class="gen-chart__period-option"
          :class="{ 'gen-chart__period-option--on': period === option }"
          :aria-pressed="period === option"
          :name="`period-${option}`"
          @click="emit('update:period', option)"
        >
          {{ t('dashboard.generations_period_days', { n: option }) }}
        </button>
      </div>
      <ul class="gen-chart__legend">
        <li v-for="item in legend" :key="item.outcome" class="gen-chart__legend-item">
          <span class="gen-chart__dot" :class="`gen-chart__dot--${item.outcome}`" aria-hidden="true" />
          {{ item.label }}
          <strong v-if="!loading" class="gen-chart__count">{{ totals[item.outcome] }}</strong>
        </li>
      </ul>
    </div>

    <StackedBars :items="items" :max-total="maxTotal" :legend="legend" :height="height" :max-bar-width="30" :rate="rates" :rate-label="t('home.chart_success_line')" />
  </section>
</template>

<style scoped lang="scss">
.gen-chart {
  flex-shrink: 0;
  margin: 0;
  transition: opacity 0.15s;

  &--loading { opacity: 0.6; }
}

.gen-chart__rule {
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}

.gen-chart__title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  white-space: nowrap;
}

.gen-chart__total {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 300;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.gen-chart__delta {
  margin-left: 4px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--p-text-muted-color);

  &--ok { color: var(--status-ok); }
  &--bad { color: var(--status-bad); }
}

.gen-chart__period {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--p-content-hover-background);
}

.gen-chart__period-option {
  min-height: 24px;
  padding: 0 9px;
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

.gen-chart__count {
  font-weight: 600;
  color: var(--p-text-color);
  font-variant-numeric: tabular-nums;
}

.gen-chart__line {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.gen-chart__legend {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gen-chart__legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.gen-chart__dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  flex-shrink: 0;

  &--success { background: var(--viz-ok); }
  &--warning { background: var(--viz-warn); }
  &--error   { background: var(--viz-bad); }
}
</style>
