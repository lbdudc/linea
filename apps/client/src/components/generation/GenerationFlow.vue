<script setup>
import { computed } from 'vue'
import { flowNodeOf, flowOf } from 'src/utils/generationFlow'
import { useT } from 'src/composables/useT'

/**
 * The generation of the code, drawn from its log: the modules and metamodels as they are downloaded and what ties them, and then the
 * phases they go through. It only shows what the log has said.
 */
const props = defineProps({
  messages: { type: Array, required: true },
  status: { type: String, required: true },
  selected: { type: String, default: null },
})
const emit = defineEmits(['locate'])
const t = useT()

const ROW = 32
const NODE_HEIGHT = 26
const TOP = 26
const MIN_ROWS = 7
const MODULE_X = 0
const MODULE_WIDTH = 186
const METAMODEL_WIDTH = 150
const METAMODEL_ALONE_WIDTH = 300
const STAGE_X = 446
const STAGE_WIDTH = 118
const STAGE_GAP = 26
const STAGE_HEIGHT = 76
const STAGE_ICONS = { check: 'pi-check-circle', platform: 'pi-box', derive: 'pi-cog' }
const ICON_SIZE = 18
const LABEL_PADDING = 30
const CHAR_WIDTH = 6.3

const flow = computed(() => flowOf(props.messages, props.status))
const hasModules = computed(() => flow.value.modules.length > 0)
const metamodelX = computed(() => (hasModules.value ? 240 : MODULE_X))

const rowY = (index) => TOP + index * ROW
const fit = (name, width) => {
  const limit = Math.floor((width - LABEL_PADDING) / CHAR_WIDTH)
  return name.length > limit ? `${name.slice(0, limit - 1)}…` : name
}
const place = (nodes, x, width) => nodes.map((node, index) => ({ ...node, x, y: rowY(index), width, label: fit(node.name, width) }))
const modules = computed(() => place(flow.value.modules, MODULE_X, MODULE_WIDTH))
const metamodels = computed(() => place(flow.value.metamodels, metamodelX.value, hasModules.value ? METAMODEL_WIDTH : METAMODEL_ALONE_WIDTH))

const rows = computed(() => Math.max(MIN_ROWS, modules.value.length, metamodels.value.length))
const height = computed(() => rowY(rows.value))
const stageTop = rowY(MIN_ROWS) / 2 - STAGE_HEIGHT / 2 + TOP / 2
const stages = computed(() => flow.value.stages.map((stage, index) => ({
  ...stage, x: STAGE_X + index * (STAGE_WIDTH + STAGE_GAP), label: t(`generation.flow_stage_${stage.key}`), word: t(`generation.flow_state_${stage.state}`),
})))
const width = STAGE_X + 3 * STAGE_WIDTH + 2 * STAGE_GAP

const curve = (x1, y1, x2, y2) => {
  const bend = (x2 - x1) / 2
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`
}
const middle = (node) => node.y + NODE_HEIGHT / 2
const stageMiddle = stageTop + STAGE_HEIGHT / 2

const moduleLinks = computed(() => flow.value.links.flatMap((link) => {
  const from = modules.value.find(({ id }) => id === link.from)
  const to = metamodels.value.find(({ id }) => id === link.to)
  return from && to ? [{
    key: `${link.from}>${link.to}`, active: link.active, done: !link.active,
    d: curve(from.x + from.width, middle(from), to.x, middle(to)),
  }] : []
}))
const intoChecks = computed(() => metamodels.value.map((node) => ({
  key: node.id, active: flow.value.stages[0].state === 'active', done: flow.value.stages[0].state === 'done',
  d: curve(node.x + node.width, middle(node), STAGE_X, stageMiddle),
})))
const betweenStages = computed(() => stages.value.slice(1).map((stage, index) => ({
  key: stage.key, active: stage.state === 'active', done: stage.state === 'done',
  d: `M${stages.value[index].x + STAGE_WIDTH} ${stageMiddle} H${stage.x}`,
})))
const links = computed(() => [...moduleLinks.value, ...intoChecks.value, ...betweenStages.value])

const told = computed(() => new Set(props.messages.map(flowNodeOf)))
const canLocate = (key, state) => told.value.has(key) || state === 'failed'
const locate = (key, state) => {
  if (canLocate(key, state)) emit('locate', key)
}
const locatable = (key, state, name) => (canLocate(key, state)
  ? { role: 'button', tabindex: 0, 'aria-pressed': props.selected === key, 'aria-label': t('generation.flow_locate', { name }) }
  : {})

const titleOf = (node) => `${node.id} · ${node.version}`
const summary = computed(() => {
  const downloaded = [...flow.value.modules, ...flow.value.metamodels].filter(({ state }) => state === 'done').length
  const current = stages.value.find(({ state }) => state === 'active' || state === 'failed')
  return t('generation.flow_summary', { n: downloaded, stage: current?.label ?? '—' })
})
</script>

<template>
  <div class="gflow" name="generation-flow">
    <svg
      class="gflow__svg" :viewBox="`0 0 ${width} ${Math.max(height, stageTop + STAGE_HEIGHT)}`"
      role="group" :aria-label="summary"
    >
      <text v-if="hasModules" class="gflow__title" :x="MODULE_X" y="12">{{ t('generation.flow_modules') }}</text>
      <text class="gflow__title" :x="metamodelX" y="12">{{ t('generation.flow_metamodels') }}</text>
      <text class="gflow__title" :x="STAGE_X" y="12">{{ t('generation.flow_stages') }}</text>

      <g v-for="link in links" :key="link.key">
        <path class="gflow__link" :class="{ 'gflow__link--done': link.done }" :d="link.d" pathLength="1" />
        <path v-if="link.active" class="gflow__pulse" :d="link.d" />
      </g>

      <g
        v-for="node in [...modules, ...metamodels]" :key="node.id"
        class="gflow__node" :class="[`gflow__node--${node.state}`, { 'gflow__pick': canLocate(node.id, node.state), 'gflow__pick--on': selected === node.id }]"
        :name="`gflow-node-${node.name}`"
        :transform="`translate(${node.x} ${node.y})`"
        v-bind="locatable(node.id, node.state, node.name)"
        @click="locate(node.id, node.state)"
        @keydown.enter.prevent="locate(node.id, node.state)"
        @keydown.space.prevent="locate(node.id, node.state)"
      >
        <title>{{ titleOf(node) }}</title>
        <g class="gflow__enter">
          <rect class="gflow__box" :width="node.width" :height="NODE_HEIGHT" rx="6" />
          <circle class="gflow__dot" cx="12" :cy="NODE_HEIGHT / 2" r="3.5" />
          <text class="gflow__label" x="23" :y="NODE_HEIGHT / 2">{{ node.label }}</text>
        </g>
      </g>

      <g
        v-for="stage in stages" :key="stage.key"
        class="gflow__stage" :class="[`gflow__stage--${stage.state}`, { 'gflow__pick': canLocate(stage.key, stage.state), 'gflow__pick--on': selected === stage.key }]"
        :name="`gflow-stage-${stage.key}`"
        :transform="`translate(${stage.x} ${stageTop})`"
        v-bind="locatable(stage.key, stage.state, stage.label)"
        @click="locate(stage.key, stage.state)"
        @keydown.enter.prevent="locate(stage.key, stage.state)"
        @keydown.space.prevent="locate(stage.key, stage.state)"
      >
        <rect class="gflow__box" :width="STAGE_WIDTH" :height="STAGE_HEIGHT" rx="8" />
        <foreignObject :x="(STAGE_WIDTH - ICON_SIZE) / 2" y="10" :width="ICON_SIZE" :height="ICON_SIZE">
          <i class="pi gflow__stage-icon" :class="STAGE_ICONS[stage.key]" aria-hidden="true" />
        </foreignObject>
        <text class="gflow__stage-label" :x="STAGE_WIDTH / 2" y="46">{{ stage.label }}</text>
        <text class="gflow__stage-word" :x="STAGE_WIDTH / 2" y="63">{{ stage.word }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped lang="scss">
.gflow {
  overflow-x: auto;
  padding: 12px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;

  &__svg { display: block; width: 100%; min-width: 620px; max-width: 852px; height: auto; margin-inline: auto; }

  &__title { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; fill: var(--text-muted); }

  &__link {
    fill: none;
    stroke: var(--p-content-border-color);
    stroke-width: 1.25;
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
    transition: stroke 0.4s ease;
    animation: gflow-draw 0.5s ease-out;

    &--done { stroke: color-mix(in srgb, var(--status-ok) 45%, var(--p-content-border-color)); }
  }

  &__pulse {
    fill: none;
    stroke: var(--p-primary-color);
    stroke-width: 1.5;
    stroke-dasharray: 4 8;
    animation: gflow-flow 0.9s linear infinite;
  }

  &__enter { animation: gflow-enter 0.3s ease-out; }

  &__box {
    fill: var(--p-content-background);
    stroke: var(--p-content-border-color);
    transition: fill 0.4s ease, stroke 0.4s ease;
  }

  &__dot { fill: var(--text-muted); transition: fill 0.4s ease; }

  &__label { font-size: 0.8125rem; dominant-baseline: central; fill: var(--text-heading); }

  &__node--downloading {
    .gflow__box { fill: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-content-background)); stroke: var(--p-primary-color); }
    .gflow__dot { fill: var(--p-primary-color); animation: gflow-beat 1s ease-in-out infinite; }
  }

  &__node--done {
    .gflow__box { fill: var(--status-ok-soft); stroke: color-mix(in srgb, var(--status-ok) 55%, var(--p-content-border-color)); }
    .gflow__dot { fill: var(--status-ok); }
  }

  &__node--failed {
    .gflow__box { fill: var(--status-bad-soft); stroke: var(--status-bad-border); }
    .gflow__dot { fill: var(--status-bad); }
  }

  &__stage-icon { display: block; font-size: 18px; line-height: 18px; text-align: center; color: var(--text-muted); transition: color 0.4s ease; }
  &__stage--active &__stage-icon { color: var(--p-primary-color); }
  &__stage--done &__stage-icon { color: var(--status-ok); }
  &__stage--failed &__stage-icon { color: var(--status-bad); }

  &__stage-label { font-size: 0.8125rem; font-weight: 600; text-anchor: middle; fill: var(--text-heading); }
  &__stage-word { font-size: 0.75rem; text-anchor: middle; fill: var(--text-muted); transition: fill 0.4s ease; }

  &__stage--pending { opacity: 0.65; }

  &__stage--active {
    .gflow__box { fill: color-mix(in srgb, var(--p-primary-color) 10%, var(--p-content-background)); stroke: var(--p-primary-color); animation: gflow-breathe 1.6s ease-in-out infinite; }
    .gflow__stage-word { fill: var(--p-primary-color); }
  }

  &__stage--done {
    .gflow__box { fill: var(--status-ok-soft); stroke: color-mix(in srgb, var(--status-ok) 55%, var(--p-content-border-color)); }
    .gflow__stage-word { fill: var(--status-ok); }
  }

  &__stage--failed {
    .gflow__box { fill: var(--status-bad-soft); stroke: var(--status-bad-border); }
    .gflow__stage-word { fill: var(--status-bad); }
  }

  &__pick {
    cursor: pointer;
    outline: none;

    &:hover .gflow__box, &:focus-visible .gflow__box { stroke: var(--p-primary-color); }
    &:focus-visible .gflow__box, &--on .gflow__box { stroke-width: 2.5; }
    &--on .gflow__box { stroke: var(--p-primary-color); animation: none; }
  }
}

@keyframes gflow-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes gflow-flow { to { stroke-dashoffset: -12; } }
@keyframes gflow-enter { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
@keyframes gflow-beat { 50% { opacity: 0.35; } }
@keyframes gflow-breathe { 50% { stroke-opacity: 0.45; } }

@media (prefers-reduced-motion: reduce) {
  .gflow__link, .gflow__pulse, .gflow__enter, .gflow__box, .gflow__dot { animation: none !important; transition: none !important; }
}
</style>
