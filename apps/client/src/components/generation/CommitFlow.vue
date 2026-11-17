<script setup>
import { computed } from 'vue'
import { commitFlowOf, stepsOfLog } from 'src/utils/commitFlow'
import { useT } from 'src/composables/useT'

/**
 * The way of a generation to the repository, drawn from its log as a graph of its branches: from the branch of the generation to the base
 * branch, and from there to the default one through the checks. It only shows what the log has said.
 */
const props = defineProps({
  messages: { type: Array, required: true },
  status: { type: String, required: true },
  selected: { type: String, default: null },
})
const emit = defineEmits(['locate'])
const t = useT()

const WIDTH = 830
const LANE_START = 112
const LANE_END = 818
const RADIUS = 9
const LABEL_BELOW = { label: 24, word: 37 }
const LABEL_ABOVE = { label: -31, word: -18 }

const curve = (x1, y1, x2, y2) => {
  const bend = (x2 - x1) / 2
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`
}
const straight = (x1, y, x2) => `M${x1} ${y} H${x2}`

const LANES = { generation: 42, base: 104, main: 176 }
const X = [160, 262, 364, 466, 568, 670, 772]
const HEIGHT = 226
const AT = {
  branch: [X[0], 'generation'], commit: [X[1], 'generation'], request: [X[2], 'generation'], merge: [X[3], 'base'],
  update: [X[4], 'base'], checks: [X[5], 'base'], release: [X[6], 'main'],
}
const RAILS = [straight(LANE_START, LANES.base, LANE_END), straight(LANE_START, LANES.main, LANE_END)]
const LINKS = [
  { to: 'branch', d: curve(LANE_START, LANES.base, X[0], LANES.generation) },
  { to: 'commit', d: straight(X[0], LANES.generation, X[1]) },
  { to: 'request', d: straight(X[1], LANES.generation, X[2]) },
  { to: 'merge', d: curve(X[2], LANES.generation, X[3], LANES.base) },
  { to: 'update', d: straight(X[3], LANES.base, X[4]) },
  { to: 'checks', d: straight(X[4], LANES.base, X[5]) },
  { to: 'release', d: curve(X[5], LANES.base, X[6], LANES.main) },
]

const flow = computed(() => commitFlowOf(props.messages, props.status))
const stateOf = (key) => flow.value.steps.find((step) => step.key === key)?.state

const FALLBACK = { generation: 'generation', base: 'bigbang', main: 'main' }
const laneNames = computed(() => Object.entries(LANES).map(([key, y]) => ({ key, y, name: flow.value.branches[key] ?? FALLBACK[key] })))

const told = computed(() => new Set(stepsOfLog(props.messages)))
const nodes = computed(() => flow.value.steps.map((step) => {
  const [x, lane] = AT[step.key]
  return {
    ...step, x, y: LANES[lane],
    text: lane === 'generation' ? LABEL_ABOVE : LABEL_BELOW,
    above: lane === 'generation',
    canLocate: told.value.has(step.key) || step.state === 'failed' || step.note === 'awaiting_decision',
    label: t(`generation.commit_step_${step.key}`),
    word: step.note ? t(`generation.commit_note_${step.note}`) : t(`generation.flow_state_${step.state}`),
  }
}))
const locate = (node) => {
  if (node.canLocate) emit('locate', node.key)
}
const locatable = (node) => (node.canLocate
  ? { role: 'button', tabindex: 0, 'aria-pressed': props.selected === node.key, 'aria-label': t('generation.flow_locate', { name: node.label }) }
  : {})
const links = computed(() => LINKS.map((link) => ({ ...link, state: stateOf(link.to) })))

const summary = computed(() => {
  const current = nodes.value.find(({ state }) => state === 'active' || state === 'failed')
  const done = nodes.value.filter(({ state }) => state === 'done').length
  return t('generation.commit_summary', { n: done, total: nodes.value.length, stage: current?.label ?? '—' })
})
</script>

<template>
  <div class="cflow" name="commit-flow">
    <svg class="cflow__svg" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="group" :aria-label="summary">
      <text v-for="lane in laneNames" :key="lane.key" class="cflow__branch" x="0" :y="lane.y">{{ lane.name }}</text>

      <path v-for="(rail, index) in RAILS" :key="index" class="cflow__lane" :d="rail" />

      <g v-for="link in links" :key="link.to">
        <path class="cflow__link" :class="`cflow__link--${link.state}`" :d="link.d" />
        <path v-if="link.state === 'active'" class="cflow__pulse" :d="link.d" />
      </g>

      <g
        v-for="node in nodes" :key="node.key"
        class="cflow__node" :class="[`cflow__node--${node.state}`, { 'cflow__pick': node.canLocate, 'cflow__pick--on': selected === node.key }]"
        :name="`cflow-step-${node.key}`"
        :transform="`translate(${node.x} ${node.y})`"
        v-bind="locatable(node)"
        @click="locate(node)"
        @keydown.enter.prevent="locate(node)"
        @keydown.space.prevent="locate(node)"
      >
        <rect v-if="node.canLocate" class="cflow__hit" x="-50" :y="node.above ? -44 : -14" width="100" :height="node.above ? 58 : 70" rx="6" />
        <circle v-if="node.state === 'active'" class="cflow__ring" :r="RADIUS" />
        <circle class="cflow__dot" :r="RADIUS" />
        <path v-if="node.state === 'done'" class="cflow__glyph" d="M-4 0 L-1 3 L4 -3" />
        <path v-else-if="node.state === 'failed'" class="cflow__glyph" d="M-3 -3 L3 3 M3 -3 L-3 3" />
        <path v-else-if="node.state === 'warning'" class="cflow__glyph" d="M0 -4 V1 M0 4 V4.2" />
        <path v-else-if="node.state === 'skipped'" class="cflow__glyph" d="M-3.5 0 H3.5" />
        <text class="cflow__label" :y="node.text.label">{{ node.label }}</text>
        <text class="cflow__word" :y="node.text.word">{{ node.word }}</text>
        <text v-if="node.job" class="cflow__job" :y="node.text.word + 13" :name="`cflow-job-${node.job}`">{{ node.job }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped lang="scss">
.cflow {
  overflow-x: auto;
  padding: 12px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;

  &__svg { display: block; width: 100%; min-width: 620px; max-width: 830px; height: auto; margin-inline: auto; overflow: visible; }

  &__branch { font-family: var(--font-mono); font-size: 0.75rem; dominant-baseline: central; fill: var(--text-muted); }

  &__lane { fill: none; stroke: var(--p-content-border-color); stroke-width: 2; }

  &__link {
    fill: none;
    stroke: var(--p-content-border-color);
    stroke-width: 2;
    transition: stroke 0.4s ease;

    &--done { stroke: color-mix(in srgb, var(--status-ok) 60%, var(--p-content-border-color)); }
    &--skipped { stroke: color-mix(in srgb, var(--text-muted) 45%, var(--p-content-border-color)); }
    &--warning { stroke: color-mix(in srgb, var(--status-warn) 60%, var(--p-content-border-color)); }
    &--failed { stroke: color-mix(in srgb, var(--status-bad) 60%, var(--p-content-border-color)); }
  }

  &__pulse {
    fill: none;
    stroke: var(--p-primary-color);
    stroke-width: 2;
    stroke-dasharray: 4 8;
    animation: cflow-flow 0.9s linear infinite;
  }

  &__dot {
    fill: var(--p-content-background);
    stroke: var(--p-content-border-color);
    stroke-width: 2;
    transition: fill 0.4s ease, stroke 0.4s ease;
  }

  &__ring {
    fill: none;
    stroke: var(--p-primary-color);
    transform-box: fill-box;
    transform-origin: center;
    animation: cflow-ring 1.6s ease-out infinite;
  }

  &__glyph { fill: none; stroke: var(--p-content-background); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  &__label { font-size: 0.8125rem; font-weight: 600; text-anchor: middle; fill: var(--text-heading); }
  &__word { font-size: 0.75rem; text-anchor: middle; fill: var(--text-muted); transition: fill 0.4s ease; }

  &__job { font-family: var(--font-mono); font-size: 0.75rem; text-anchor: middle; fill: var(--status-bad); }

  &__node--pending { .cflow__label { fill: var(--text-muted); font-weight: 400; } }

  &__node--active {
    .cflow__dot { fill: color-mix(in srgb, var(--p-primary-color) 15%, var(--p-content-background)); stroke: var(--p-primary-color); }
    .cflow__word { fill: var(--p-primary-color); }
  }

  &__node--done {
    .cflow__dot { fill: var(--status-ok); stroke: var(--status-ok); }
    .cflow__word { fill: var(--status-ok); }
  }

  &__node--skipped {
    .cflow__dot { fill: var(--text-muted); stroke: var(--text-muted); }
  }

  &__node--warning {
    .cflow__dot { fill: var(--status-warn); stroke: var(--status-warn); }
    .cflow__word { fill: var(--status-warn); }
  }

  &__node--failed {
    .cflow__dot { fill: var(--status-bad); stroke: var(--status-bad); }
    .cflow__word { fill: var(--status-bad); }
  }

  &__hit { fill: transparent; stroke: transparent; stroke-width: 1.5; transition: fill 0.15s ease, stroke 0.15s ease; }

  &__pick {
    cursor: pointer;
    outline: none;

    &:hover .cflow__hit { fill: color-mix(in srgb, var(--p-primary-color) 6%, transparent); }
    &:focus-visible .cflow__hit, &--on .cflow__hit { stroke: var(--p-primary-color); }
    &--on .cflow__hit { fill: color-mix(in srgb, var(--p-primary-color) 10%, transparent); }
  }
}

@keyframes cflow-flow { to { stroke-dashoffset: -12; } }
@keyframes cflow-ring { from { transform: scale(1); opacity: 0.7; } to { transform: scale(2); opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .cflow__pulse, .cflow__ring, .cflow__link, .cflow__dot { animation: none !important; transition: none !important; }
}
</style>
