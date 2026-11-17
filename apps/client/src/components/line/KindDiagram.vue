<script setup>
import { computed } from 'vue'
/**
 * What a kind of SPL is made of and what it produces, drawn: the pieces on the left (one colour per role), the SPL in the middle,
 * the products on the right. Pure drawing, coloured with the theme's variables, so it follows light and dark.
 */
const props = defineProps({
  kind: { type: String, default: 'plain' },
  // what was chosen ({ name, location }): when given, the drawing shows those pieces by name instead of the generic ones
  items: { type: Array, default: () => [] },
  // the name of the SPL, written under it
  splName: { type: String, default: '' },
})

const MAX_ITEMS = 7
const short = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const nameOf = (item) => item.name ?? String(item.location ?? '').split('/').pop()

const custom = computed(() => props.kind !== 'plain' && props.items.length > 0)

// one row per piece on the left: a project is a plain SPL plus its metamodels, a modular one is made of its modules only
const rows = computed(() => {
  if (!custom.value) return []
  const shown = props.items.slice(0, MAX_ITEMS).map((item) => ({ type: props.kind === 'modular' ? 'mod' : 'model', label: short(nameOf(item), 16), full: nameOf(item), range: item.range }))
  const extra = props.items.length - shown.length
  if (extra > 0) shown.push({ type: 'more', label: `+${extra}` })
  const base = props.kind === 'project'
    ? [{ type: 'feat', label: 'dg_features' }, { type: 'code', label: 'dg_code' }]
    : []
  return [...base, ...shown]
})
const pitch = computed(() => (props.kind === 'modular' ? 30 : 26))
const rowHeight = computed(() => pitch.value - 4)
const height = computed(() => Math.max(124, rows.value.length * pitch.value + 24))
const mid = computed(() => height.value / 2)
const rowTop = (i) => mid.value - (rows.value.length * pitch.value) / 2 + i * pitch.value + 2
const flow = computed(() => rows.value.map((_, i) => `M112 ${rowTop(i) + rowHeight.value / 2} C120 ${rowTop(i) + rowHeight.value / 2} 120 ${mid.value} 128 ${mid.value}`).join(' '))
</script>

<template>
  <svg class="kd" :viewBox="`0 0 280 ${custom ? height : 124}`" role="img" :aria-label="$t(`creation.dg_alt_${kind}`)" :name="`kind-diagram-${kind}`">
    <!-- the products every kind ends in: three little windows -->
    <text x="247" :y="custom ? mid - 54 : 15" class="kd__label">{{ $t('creation.dg_products') }}</text>
    <g v-for="y in (custom ? [mid - 45, mid - 15, mid + 15] : [24, 54, 84])" :key="y" class="kd__win">
      <rect x="222" :y="y" width="50" height="28" rx="5" class="kd__win-body" />
      <path :d="`M222 ${y + 8} H272`" class="kd__win-bar" />
      <circle cx="228" :cy="y + 4" r="1.4" class="kd__dot kd__dot--a" />
      <circle cx="233" :cy="y + 4" r="1.4" class="kd__dot kd__dot--b" />
      <circle cx="238" :cy="y + 4" r="1.4" class="kd__dot kd__dot--c" />
      <rect x="228" :y="y + 13" width="22" height="3" rx="1.5" class="kd__line-ph" />
      <rect x="228" :y="y + 19" width="32" height="3" rx="1.5" class="kd__line-ph" />
    </g>

    <!-- what was chosen, by name -->
    <g v-if="custom">
      <path :d="flow" class="kd__flow" />
      <g v-for="(row, i) in rows" :key="i" :class="['kd__node kd__item', `kd__node--${row.type}`, { kd__group: row.type === 'mod' }]" :name="`kd-item-${i}`">
        <title v-if="row.full">{{ row.full }}</title>
        <rect x="8" :y="rowTop(i)" width="104" :height="rowHeight" rx="7" />
        <circle v-if="row.type !== 'more'" cx="19" :cy="rowTop(i) + rowHeight / 2" r="3.5" />
        <text :x="row.type === 'more' ? 60 : 28" :y="rowTop(i) + rowHeight / 2 + 3.2" :text-anchor="row.type === 'more' ? 'middle' : 'start'">{{ row.type === 'feat' || row.type === 'code' ? $t(`creation.${row.label}`) : row.label }}</text>
      </g>
      <g class="kd__hub">
        <rect x="128" :y="mid - 22" width="62" height="44" rx="10" />
        <text x="159" :y="mid + 4" class="kd__hub-text">LPS</text>
      </g>
      <text v-if="splName" x="159" :y="mid + 38" class="kd__caption">{{ short(splName, 18) }}</text>
    </g>

    <!-- plain: a feature model and its own platform code -->
    <g v-else-if="kind === 'plain'">
      <path d="M106 40 C115 40 115 60 124 60 M106 84 C115 84 115 78 124 78" class="kd__flow" />
      <g class="kd__node kd__node--feat">
        <rect x="8" y="26" width="98" height="28" rx="7" />
        <circle cx="19" cy="40" r="3.5" />
        <text x="28" y="43.5">{{ $t('creation.dg_features') }}</text>
      </g>
      <g class="kd__node kd__node--code">
        <rect x="8" y="70" width="98" height="28" rx="7" />
        <circle cx="19" cy="84" r="3.5" />
        <text x="28" y="87.5">{{ $t('creation.dg_code') }}</text>
      </g>
      <g class="kd__hub">
        <rect x="124" y="47" width="62" height="44" rx="10" />
        <text x="155" y="73" class="kd__hub-text">LPS</text>
      </g>
    </g>

    <!-- project: what a plain SPL has, and models on top of it (the metamodels it chose and what is written over them) -->
    <g v-else-if="kind === 'project'">
      <path d="M112 20 C120 20 120 58 128 58 M112 48 C120 48 120 67 128 67 M112 91 C120 91 120 77 128 77" class="kd__flow" />
      <g class="kd__node kd__node--feat">
        <rect x="8" y="8" width="104" height="24" rx="7" />
        <circle cx="19" cy="20" r="3.5" />
        <text x="28" y="23.2">{{ $t('creation.dg_features') }}</text>
      </g>
      <g class="kd__node kd__node--code">
        <rect x="8" y="36" width="104" height="24" rx="7" />
        <circle cx="19" cy="48" r="3.5" />
        <text x="28" y="51.2">{{ $t('creation.dg_code') }}</text>
      </g>
      <!-- the models are what a project adds: optional, so dashed -->
      <g class="kd__node kd__node--model kd__group">
        <rect x="8" y="64" width="104" height="54" rx="7" />
        <circle cx="19" cy="76" r="3.5" />
        <text x="28" y="79.2">+ {{ $t('creation.dg_models') }}</text>
        <rect x="16" y="86" width="42" height="12" rx="6" class="kd__chip" />
        <text x="37" y="94.6" class="kd__chip-text">datamodel</text>
        <rect x="62" y="86" width="42" height="12" rx="6" class="kd__chip" />
        <text x="83" y="94.6" class="kd__chip-text">forms</text>
        <rect x="16" y="102" width="42" height="12" rx="6" class="kd__chip" />
        <text x="37" y="110.6" class="kd__chip-text">menus</text>
      </g>
      <g class="kd__hub">
        <rect x="128" y="47" width="62" height="44" rx="10" />
        <text x="159" y="73" class="kd__hub-text">LPS</text>
      </g>
    </g>

    <!-- modular: modules of the registry, each with its own code and its own models -->
    <g v-else>
      <path d="M112 25 C120 25 120 58 128 58 M112 63 H128 C128 63 128 67 128 67 M112 101 C120 101 120 77 128 77" class="kd__flow" />
      <g v-for="(letter, i) in ['A', 'B', 'C']" :key="letter" class="kd__node kd__node--mod">
        <rect x="8" :y="8 + i * 38" width="104" height="34" rx="7" />
        <circle cx="19" :cy="19 + i * 38" r="3.5" />
        <text x="28" :y="22.2 + i * 38">{{ $t('creation.dg_module') }} {{ letter }}</text>
        <rect x="16" :y="28 + i * 38" width="38" height="10" rx="5" class="kd__chip kd__chip--code" />
        <text x="35" :y="35.4 + i * 38" class="kd__chip-text">{{ $t('creation.dg_code').toLowerCase() }}</text>
        <rect x="58" :y="28 + i * 38" width="46" height="10" rx="5" class="kd__chip kd__chip--model" />
        <text x="81" :y="35.4 + i * 38" class="kd__chip-text">{{ $t('creation.dg_models').toLowerCase() }}</text>
      </g>
      <g class="kd__hub">
        <rect x="128" y="47" width="62" height="44" rx="10" />
        <text x="159" y="73" class="kd__hub-text">LPS</text>
      </g>
    </g>

    <!-- hub to products -->
    <path :d="`M${kind === 'plain' ? 186 : 190} ${custom ? mid : 69} H212`" class="kd__flow kd__flow--out" />
    <path :d="`M210 ${(custom ? mid : 69) - 4.5} L218 ${custom ? mid : 69} L210 ${(custom ? mid : 69) + 4.5} z`" class="kd__arrow-head" />
  </svg>
</template>

<style scoped>
.kd {
  --kd-feat: #5b9cf5;
  --kd-code: #34c9a0;
  --kd-meta: #a78bfa;
  --kd-model: #f5a35b;
  --kd-mod: #f472b6;
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.kd__label { font-size: 7.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; text-anchor: middle; fill: var(--p-text-muted-color); }

/* the pieces: a tinted card of the colour of its role, with a dot of the same colour */
.kd__node rect { fill: color-mix(in srgb, var(--c) 16%, var(--p-content-background)); stroke: color-mix(in srgb, var(--c) 70%, transparent); stroke-width: 1.2; }
.kd__node circle { fill: var(--c); }
.kd__node text { font-size: 9px; font-weight: 600; fill: var(--p-text-color); }
.kd__caption { font-size: 8px; font-weight: 600; text-anchor: middle; fill: var(--p-text-muted-color); }
.kd__node--more { --c: var(--p-text-muted-color); }
.kd__item text { font-size: 7.8px; }
.kd__node--pill text { font-size: 8.5px; font-weight: 500; }
.kd__node--feat { --c: var(--kd-feat); }
.kd__node--code { --c: var(--kd-code); }
.kd__node--meta { --c: var(--kd-meta); }
.kd__node--mod { --c: var(--kd-mod); }
.kd__node--mod rect:first-child { stroke-dasharray: 4 2.5; }
.kd__node--model { --c: var(--kd-model); }
.kd__group rect:first-child { stroke-dasharray: 4 2.5; }
.kd__node rect.kd__chip { fill: color-mix(in srgb, var(--kd-meta) 22%, var(--p-content-background)); stroke: color-mix(in srgb, var(--kd-meta) 60%, transparent); stroke-width: 0.8; stroke-dasharray: none; }
.kd__node rect.kd__chip--code { fill: color-mix(in srgb, var(--kd-code) 22%, var(--p-content-background)); stroke: color-mix(in srgb, var(--kd-code) 60%, transparent); }
.kd__node rect.kd__chip--model { fill: color-mix(in srgb, var(--kd-model) 22%, var(--p-content-background)); stroke: color-mix(in srgb, var(--kd-model) 60%, transparent); }
.kd__node text.kd__chip-text { font-size: 6.5px; font-weight: 500; text-anchor: middle; }
.kd__notch { fill: color-mix(in srgb, var(--kd-mod) 16%, var(--p-content-background)); stroke: color-mix(in srgb, var(--kd-mod) 70%, transparent); stroke-width: 1.2; }

/* the SPL: what everything flows into */
.kd__hub rect { fill: color-mix(in srgb, var(--p-primary-color) 22%, var(--p-content-background)); stroke: var(--p-primary-color); stroke-width: 1.6; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--p-primary-color) 45%, transparent)); }
.kd__hub-text { font-size: 11px; font-weight: 700; text-anchor: middle; fill: var(--p-text-color); }

/* what flows: a dashed line that moves towards the products */
.kd__flow { fill: none; stroke: var(--p-text-faint-color); stroke-width: 1.4; stroke-dasharray: 3 3.5; stroke-linecap: round; animation: kd-flow 1.4s linear infinite; }
.kd__arrow-head { fill: var(--p-text-faint-color); }
@keyframes kd-flow { to { stroke-dashoffset: -13; } }
@media (prefers-reduced-motion: reduce) { .kd__flow { animation: none; } }

.kd__win-body { fill: var(--p-content-background); stroke: var(--p-content-border-color); stroke-width: 1.1; }
.kd__win-bar { stroke: var(--p-content-border-color); stroke-width: 1; }
.kd__dot--a { fill: #f47c7c; }
.kd__dot--b { fill: #f5c15b; }
.kd__dot--c { fill: #5bd08a; }
.kd__line-ph { fill: var(--p-content-border-color); }
</style>
