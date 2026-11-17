<script setup>
import { computed } from 'vue'

// Bars stacked by outcome, with gridlines and a tooltip with the breakdown. The generations chart (days) and the monthly
// trend (months) draw the same thing, so they share this.
const STACK_ORDER = ['error', 'warning', 'success']
const MIN_BAR = 5
const GAP = 2

const props = defineProps({
  // [{ key, label (axis text or null), title, success, warning, error }], oldest first
  items: { type: Array, required: true },
  // a bar this tall is the biggest one; 0 takes it from the items
  maxTotal: { type: Number, default: 0 },
  height: { type: Number, default: 120 },
  maxBarWidth: { type: Number, default: 28 },
  // [{ outcome, label }]: the rows of the tooltip
  legend: { type: Array, default: () => [] },
  // one percentage (0-100) or null per item: drawn as a line over the bars
  rate: { type: Array, default: () => [] },
  rateLabel: { type: String, default: '' },
})

const rateSegments = computed(() => {
  const segments = []
  let current = []
  props.rate.forEach((value, index) => {
    if (value == null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push(`${index * 100 + 50},${(100 - value) * 0.9 + 5}`)
  })
  if (current.length) segments.push(current)
  return segments.map((points) => points.join(' '))
})

const max = computed(() => {
  if (props.maxTotal > 0) return props.maxTotal
  return props.items.reduce((n, i) => Math.max(n, i.success + i.warning + i.error), 0)
})

// nice grid values: 0, half, max (halves are dropped when the max is 1)
const ticks = computed(() => {
  const top = max.value
  if (top <= 1) return [top, 0]
  return [top, Math.round(top / 2), 0]
})

const columns = computed(() => props.items.map((item, index) => {
  const total = item.success + item.warning + item.error
  const barHeight = total === 0 || max.value === 0 ? 0 : Math.max(MIN_BAR, (total / max.value) * props.height)
  const present = STACK_ORDER.filter((o) => item[o] > 0)
  const fill = Math.max(0, barHeight - (present.length - 1) * GAP)
  return {
    ...item,
    total,
    barHeight,
    segments: present.map((outcome) => ({ outcome, height: (item[outcome] / total) * fill })),
    // the first and last tooltips open inwards so the edge of the card does not cut them
    anchor: index < 3 ? 'start' : index > props.items.length - 4 ? 'end' : 'center',
  }
}))
</script>

<template>
  <div class="bars">
    <div class="bars__axis" :style="{ height: `${height}px` }" aria-hidden="true">
      <span v-for="tick in ticks" :key="tick" class="bars__tick">{{ tick }}</span>
    </div>

    <div class="bars__plot" :class="{ 'bars__plot--dense': items.length > 30 }">
      <div class="bars__grid" :style="{ height: `${height}px` }" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick" class="bars__gridline" />
      </div>

      <svg
        v-if="rateSegments.length"
        class="bars__rate"
        :viewBox="`0 0 ${items.length * 100} 100`"
        preserveAspectRatio="none"
        :style="{ height: `${height}px` }"
        role="img"
        :aria-label="rateLabel"
      >
        <polyline v-for="points in rateSegments" :key="points" :points="points" fill="none" vector-effect="non-scaling-stroke" />
      </svg>

      <div class="bars__cols">
        <div
          v-for="col in columns"
          :key="col.key"
          class="bars__col"
          :class="{ 'bars__col--empty': col.total === 0 }"
          tabindex="0"
          :aria-label="`${col.title}: ${col.total}`"
        >
          <div class="bars__area" :style="{ height: `${height}px` }">
            <span v-if="col.total === 0" class="bars__dot" />
            <div v-else class="bars__stack" :style="{ height: `${col.barHeight}px`, maxWidth: `${maxBarWidth}px` }">
              <component
                :is="col.links?.[segment.outcome] ? 'router-link' : 'span'"
                v-for="segment in col.segments"
                :key="segment.outcome"
                :to="col.links?.[segment.outcome]"
                class="bars__segment"
                :class="[`bars__segment--${segment.outcome}`, { 'bars__segment--link': col.links?.[segment.outcome] }]"
                :style="{ height: `${segment.height}px` }"
                :aria-label="col.links?.[segment.outcome] ? `${col.title}: ${col[segment.outcome]}` : undefined"
              />
            </div>
          </div>
          <span class="bars__label">{{ col.label }}</span>

          <div class="bars__tip" :class="`bars__tip--${col.anchor}`" role="tooltip">
            <div class="bars__tip-title">{{ col.title }}</div>
            <div v-for="row in legend" :key="row.outcome" class="bars__tip-row">
              <span class="bars__tip-dot" :class="`bars__segment--${row.outcome}`" />
              <span class="bars__tip-label">{{ row.label }}</span>
              <strong>{{ col[row.outcome] }}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.bars {
  display: flex;
  gap: 10px;

  &__axis {
    flex-shrink: 0;
    width: 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-align: right;
  }

  &__tick {
    font-size: 10px;
    line-height: 1;
    color: var(--p-text-dim-color);
    font-variant-numeric: tabular-nums;
    // the number sits on its gridline
    transform: translateY(-1px);
  }

  &__plot {
    position: relative;
    flex-grow: 1;
    min-width: 0;
  }

  &__grid {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
  }

  &__gridline {
    height: 0;
    border-top: 1px dashed var(--viz-grid);

    &:last-child { border-top-style: solid; }
  }

  &__rate {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 2;
    pointer-events: none;

    polyline { stroke: var(--p-text-color); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  }

  &__cols {
    position: relative;
    display: flex;
    gap: 6px;
  }

  &__plot--dense &__cols { gap: 2px; }

  &__col {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    outline: none;
    overflow: visible;

    // the hovered column keeps its colour, the others step back
    .bars__cols:hover &:not(:hover) .bars__stack,
    .bars__cols:focus-within &:not(:focus) .bars__stack { opacity: 0.45; }

    &:hover .bars__tip,
    &:focus .bars__tip { display: block; }

    &:focus-visible .bars__area { outline: 2px solid var(--p-primary-color); outline-offset: 2px; border-radius: 4px; }
  }

  &__area {
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  &__stack {
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 2px;
    transition: opacity 0.15s;
  }

  &__segment {
    display: block;
    width: 100%;
    border-radius: 2px;

    &:first-child { border-top-left-radius: 5px; border-top-right-radius: 5px; }
    &:last-child { border-bottom-left-radius: 3px; border-bottom-right-radius: 3px; }

    &--success { background: var(--viz-ok); }
    &--warning { background: var(--viz-warn); }
    &--error { background: var(--viz-bad); }
    &--link { cursor: pointer; }
    &--link:hover,
    &--link:focus-visible { filter: brightness(1.15); outline: none; }
  }

  &__dot {
    width: 6px;
    height: 6px;
    margin-bottom: -3px;
    border-radius: 50%;
    background: var(--viz-track);
    background: color-mix(in srgb, var(--viz-neutral) 55%, transparent);
  }

  &__label {
    // a label wider than its column (90 days) is centred on it and does not push the others
    max-width: 100%;
    overflow: visible;
    height: 12px;
    font-size: 10px;
    line-height: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--p-text-dim-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  &__tip {
    position: absolute;
    bottom: calc(100% - 4px);
    z-index: 5;
    min-width: 150px;
    padding: 8px 10px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    background: var(--p-content-background);
    box-shadow: 0 8px 24px var(--overlay-shadow);
    font-size: 12px;
    pointer-events: none;
    display: none;
    animation: tip-in 0.12s ease;

    &--center { left: 50%; margin-left: -75px; }
    &--start { left: 0; }
    &--end { right: 0; }
  }

  &__tip-title {
    margin-bottom: 6px;
    font-weight: 600;
    color: var(--p-text-color);
    white-space: nowrap;
  }

  &__tip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 0;
    color: var(--p-text-muted-color);

    strong { margin-left: auto; padding-left: 12px; color: var(--p-text-color); font-variant-numeric: tabular-nums; }
  }

  &__tip-label { white-space: nowrap; }

  &__tip-dot {
    width: 8px;
    height: 8px;
    border-radius: 3px;
    flex-shrink: 0;
  }
}

@keyframes tip-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
