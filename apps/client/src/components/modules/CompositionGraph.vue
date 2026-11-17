<script setup>
import { pathOf } from 'components/modules/packageRoutes'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow, Handle, Position } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tooltip from 'primevue/tooltip'
import { buildCompositionGraph, pathsThrough, SPL_ID } from './compositionGraph'
import '@vue-flow/core/dist/style.css'

/**
 * What an SPL's modules resolve to, drawn: the SPL, the modules it chose, the ones those need and nobody chose (to add from here),
 * and the metamodels. The page owns the choice; this only says what the user did through `add`, `remove`, `set-range` and `add-all`.
 */
const props = defineProps({
  // resolved packages as the server answers them
  packages: { type: Array, default: () => [] },
  // [{ location, range }]
  chosen: { type: Array, default: () => [] },
  diagnostics: { type: Array, default: () => [] },
  // extra messages that may name a circular requirement (the error of a failed check)
  errors: { type: Array, default: () => [] },
  splName: { type: String, default: '' },
  checking: { type: Boolean, default: false },
  // catalog of the registry, to link a module to its page
  registry: { type: Array, default: () => [] },
  nameOf: { type: Function, default: (location) => location },
  // the button that adds every missing module (a parent that says it elsewhere hides it)
  showAddAll: { type: Boolean, default: true },
})
const emit = defineEmits(['add', 'remove', 'set-range', 'add-all'])

const messages = computed(() => [...props.diagnostics.map((d) => d.message), ...props.errors])
const direction = ref('LR')
// the metamodels clutter a big composition: out by default from then on, one click to bring them back
const AUTO_HIDE_ABOVE = 6
const metamodelsChoice = ref(null)
const withMetamodels = computed(() => metamodelsChoice.value ?? props.packages.length <= AUTO_HIDE_ABOVE)
const expanded = ref(false)
const onKey = (e) => {
  if (e.key === 'Escape' && expanded.value) expanded.value = false
}
watch(expanded, (on) => {
  if (on) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})
const graph = computed(() => buildCompositionGraph({
  direction: direction.value,
  packages: props.packages,
  chosen: props.chosen,
  nameOf: props.nameOf,
  splName: props.splName,
  messages: messages.value,
  metamodels: withMetamodels.value,
}))

// where the user dragged a node to; the layout (or the reset button) takes it back
const moved = ref({})
watch(direction, () => { moved.value = {} })
const resetLayout = async () => {
  moved.value = {}
  await nextTick()
  fitView({ padding: 0.1, maxZoom: 1 })
}
const vertical = computed(() => direction.value === 'TB')
const sourcePosition = computed(() => (vertical.value ? Position.Bottom : Position.Right))
const targetPosition = computed(() => (vertical.value ? Position.Top : Position.Left))

const hoveredId = ref(null)
const selectedId = ref(null)
// a clicked node keeps its dependencies lit (what it needs and what needs it); hovering another one lights its own while over it
const litId = computed(() => hoveredId.value ?? selectedId.value)
const lit = computed(() => (litId.value ? pathsThrough(litId.value, graph.value.edges) : null))

const flowNodes = computed(() => graph.value.nodes.map((n) => ({
  id: n.id,
  type: n.type,
  position: moved.value[n.id] ?? n.position,
  data: n,
  draggable: true,
  selectable: true,
  class: [
    `cg-node--${n.status}`,
    n.id === selectedId.value ? 'cg-node--selected' : '',
    lit.value && !lit.value.has(n.id) ? 'cg-node--dim' : '',
  ],
})))
const flowEdges = computed(() => graph.value.edges.filter((e) => !e.redundant).map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  type: 'default',
  animated: e.cycle,
  class: [
    `cg-edge--${e.kind}`,
    e.cycle ? 'cg-edge--cycle' : '',
    lit.value && !(lit.value.has(e.source) && lit.value.has(e.target)) ? 'cg-edge--dim' : '',
  ],
})))

const missing = computed(() => graph.value.nodes.filter((n) => n.status === 'missing'))
const selected = computed(() => graph.value.nodes.find((n) => n.id === selectedId.value) ?? null)
// the selection goes when its node does (the choice changed)
watch(selected, (node) => {
  if (!node) selectedId.value = null
})

const nameOfId = (id) => graph.value.nodes.find((n) => n.id === id)?.label ?? props.nameOf(id)
const requiredByNames = computed(() => (selected.value?.requiredBy ?? []).map((id) => (id === SPL_ID ? props.splName || '·' : nameOfId(id))))
const needsOf = computed(() => graph.value.edges.filter((e) => e.source === selectedId.value).map((e) => nameOfId(e.target)))
const registryEntry = computed(() => (selected.value ? props.registry.find((p) => p.location === selected.value.id) : null))

const vTooltip = Tooltip
const { fitView, onNodesInitialized } = useVueFlow()
const refit = async () => {
  await nextTick()
  fitView({ padding: 0.1, maxZoom: 1 })
}
// new nodes are measured after they are drawn: fit once they have a size, or the graph is fitted to nothing and stays clipped
onNodesInitialized(refit)
watch(() => graph.value.nodes.map((n) => n.id).join('|') + direction.value, refit, { flush: 'post' })

// the container changes size after the graph is first fitted (the panel settles, the window resizes): fit it again, once things stop moving
const root = ref(null)
let observer = null
let refitTimer = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  observer = new ResizeObserver(() => {
    clearTimeout(refitTimer)
    refitTimer = setTimeout(refit, 120)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  observer?.disconnect()
  clearTimeout(refitTimer)
})

const summaryText = computed(() => ({
  modules: props.packages.filter((p) => p.kind === 'module').length,
  metamodels: props.packages.filter((p) => p.kind === 'metamodel').length,
}))
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
  <div ref="root" class="cg" :class="{ 'cg--expanded': expanded }" :aria-busy="checking">
    <p v-if="!graph.nodes.length" class="cg__empty">{{ $t('modules.graph_empty') }}</p>

    <template v-else>
      <VueFlow
        class="cg__flow"
        :nodes="flowNodes"
        :edges="flowEdges"
        :nodes-draggable="true"
        :nodes-connectable="false"
        :elements-selectable="true"
        :min-zoom="0.25"
        :max-zoom="1.5"
        fit-view-on-init
        :zoom-on-double-click="false"
        @node-click="({ node }) => (selectedId = node.id)"
        @pane-click="selectedId = null"
        @node-drag-stop="({ node }) => (moved = { ...moved, [node.id]: { ...node.position } })"
        @node-mouse-enter="({ node }) => (hoveredId = node.id)"
        @node-mouse-leave="hoveredId = null"
      >
        <Background pattern-color="var(--p-content-border-color)" :gap="22" />

        <template #node-spl="{ data }">
          <div class="cg-node cg-node--spl">
            <Handle type="source" :position="sourcePosition" class="cg-handle" />
            <i class="pi pi-sitemap" aria-hidden="true" />
            <span class="cg-node__name">{{ data.label || $t('modules.the_spl') }}</span>
          </div>
        </template>

        <template #node-module="{ data }">
          <div class="cg-node cg-node--module" :name="`graph-module-${data.label}`">
            <Handle type="target" :position="targetPosition" class="cg-handle" />
            <div class="cg-node__head">
              <i
                class="pi"
                :class="{
                  'pi-check-circle': data.status === 'chosen',
                  'pi-exclamation-triangle': data.status === 'missing',
                  'pi-question-circle': data.status === 'unresolved',
                  'pi-sync': data.status === 'cycle',
                }"
                aria-hidden="true"
              />
              <span class="cg-node__name ident">{{ data.label }}</span>
              <span v-if="data.version" class="cg-node__chip ident">v{{ data.version }}</span>
            </div>
            <div v-if="data.status === 'missing'" class="cg-node__action nodrag">
              <Button
                size="small"
                outlined
                icon="pi pi-plus"
                :label="$t('modules.add')"
                :name="`graph-add-${data.label}`"
                @click.stop="emit('add', data.id)"
              />
            </div>
            <div v-if="data.offers.length" class="cg-node__offers">
              <span v-for="o in data.offers" :key="o" class="cg-node__offer ident">{{ o }}</span>
            </div>
            <Handle type="source" :position="sourcePosition" class="cg-handle" />
          </div>
        </template>

        <template #node-metamodel="{ data }">
          <div class="cg-node cg-node--metamodel">
            <Handle type="target" :position="targetPosition" class="cg-handle" />
            <i class="pi pi-share-alt cg-node__shape" aria-hidden="true" />
            <span class="cg-node__name ident">{{ data.label }}</span>
            <span v-if="data.version" class="cg-node__chip ident">v{{ data.version }}</span>
            <Handle type="source" :position="sourcePosition" class="cg-handle" />
          </div>
        </template>
      </VueFlow>

      <div class="cg__toolbar">
        <Button v-tooltip.bottom="$t('modules.graph_fit')" text rounded size="small" icon="pi pi-expand" :aria-label="$t('modules.graph_fit')" name="graph-fit" @click="refit" />
        <Button v-tooltip.bottom="$t('modules.graph_reset')" text rounded size="small" icon="pi pi-objects-column" :aria-label="$t('modules.graph_reset')" name="graph-reset" @click="resetLayout" />
        <Button
          v-tooltip.bottom="vertical ? $t('modules.graph_horizontal') : $t('modules.graph_vertical')"
          text
          rounded
          size="small"
          :icon="vertical ? 'pi pi-arrows-h' : 'pi pi-arrows-v'"
          :aria-label="vertical ? $t('modules.graph_horizontal') : $t('modules.graph_vertical')"
          name="graph-direction"
          @click="direction = vertical ? 'LR' : 'TB'"
        />
        <Button
          v-tooltip.bottom="$t('modules.graph_metamodels')"
          text
          rounded
          size="small"
          icon="pi pi-share-alt"
          :class="{ 'cg__toggle--on': withMetamodels }"
          :aria-label="$t('modules.graph_metamodels')"
          :aria-pressed="withMetamodels"
          name="graph-metamodels"
          @click="metamodelsChoice = !withMetamodels"
        />
        <Button
          v-tooltip.bottom="expanded ? $t('modules.graph_collapse') : $t('modules.graph_expand')"
          text
          rounded
          size="small"
          :icon="expanded ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
          :aria-label="expanded ? $t('modules.graph_collapse') : $t('modules.graph_expand')"
          name="graph-expand"
          @click="expanded = !expanded"
        />
        <Button
          v-if="showAddAll && missing.length > 1"
          size="small"
          icon="pi pi-plus"
          :label="$t('modules.add_all_missing')"
          name="graph-add-all"
          @click="emit('add-all')"
        />
        <span class="cg__counts">{{ $t('modules.graph_counts', summaryText) }}</span>
      </div>

      <ul v-if="expanded" class="cg__legend" aria-label="legend">
        <li><span class="cg__swatch cg__swatch--chosen" />{{ $t('modules.graph_legend_chosen') }}</li>
        <li><span class="cg__swatch cg__swatch--required" />{{ $t('modules.graph_legend_required') }}</li>
        <li><span class="cg__swatch cg__swatch--missing" />{{ $t('modules.graph_legend_missing') }}</li>
        <li><span class="cg__swatch cg__swatch--metamodel" />{{ $t('modules.metamodels') }} <small>({{ $t('modules.graph_legend_round') }})</small></li>
      </ul>

      <aside v-if="selected && selected.type !== 'spl'" class="cg__panel" :aria-label="selected.label">
        <header class="cg__panel-head">
          <span class="ident cg__panel-name">{{ selected.label }}</span>
          <span v-if="selected.version" class="cg-node__chip ident">v{{ selected.version }}</span>
          <Button text rounded size="small" icon="pi pi-times" :aria-label="$t('labels.close')" @click="selectedId = null" />
        </header>
        <p class="cg__panel-location ident">{{ selected.id.replace(/^gitlab:/, '') }}</p>

        <template v-if="selected.type === 'module'">
          <label v-if="selected.status === 'chosen'" class="cg__field">
            <span>{{ $t('modules.versions_accepted') }}</span>
            <InputText
              :model-value="selected.range"
              size="small"
              class="ident"
              @update:model-value="emit('set-range', selected.id, $event)"
            />
          </label>
          <p v-else-if="selected.status === 'missing'" class="cg__note cg__note--bad">
            {{ $t('modules.missing_module', { name: selected.label, by: requiredByNames.join(', ') }) }}
          </p>
        </template>

        <dl class="cg__facts">
          <template v-if="requiredByNames.length">
            <dt>{{ $t('modules.required_by') }}</dt>
            <dd>{{ requiredByNames.join(', ') }}</dd>
          </template>
          <template v-if="needsOf.length">
            <dt>{{ $t('modules.graph_needs') }}</dt>
            <dd>{{ needsOf.join(', ') }}</dd>
          </template>
          <template v-if="selected.offers.length">
            <dt>{{ $t('modules.its_offers') }}</dt>
            <dd>{{ selected.offers.join(', ') }}</dd>
          </template>
        </dl>

        <div class="cg__panel-actions">
          <Button
            v-if="selected.type === 'module' && selected.status === 'missing'"
            size="small"
            icon="pi pi-plus"
            :label="$t('modules.add')"
            @click="emit('add', selected.id)"
          />
          <Button
            v-if="selected.type === 'module' && selected.status !== 'missing'"
            size="small"
            outlined
            severity="danger"
            icon="pi pi-times"
            :label="$t('labels.delete')"
            :disabled="!chosen.some((m) => m.location === selected.id)"
            @click="emit('remove', selected.id)"
          />
          <router-link v-if="registryEntry" :to="pathOf(selected.type, registryEntry.id)" class="cg__open">
            {{ $t('modules.graph_open_package') }}
          </router-link>
        </div>
      </aside>
    </template>

    <div v-if="checking" class="cg__busy" aria-live="polite">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('modules.picker_checking') }}
    </div>
  </div>
  </Teleport>
</template>

<style scoped lang="scss">
.cg {
  position: relative;
  height: clamp(260px, calc(100dvh - 490px), 520px);
  min-height: 260px;
  flex-shrink: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  overflow: hidden;

  &__flow { width: 100%; height: 100%; }

  /* the graph on its own, over the page, for a composition too big for its panel (Esc or the button goes back) */
  &--expanded {
    position: fixed;
    inset: 3vh 3vw;
    height: auto;
    z-index: 1100;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.6);
  }

  &__empty {
    margin: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    font-size: 13px;
    color: var(--p-text-faint-color);
  }

  &__toolbar {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    max-width: calc(100% - 16px);
    gap: 4px 8px;
    padding: 4px 6px;
    background: var(--p-content-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    z-index: 5;
  }

  &__toggle--on { color: var(--p-primary-color); background: var(--p-highlight-soft); }

  &__counts { font-size: 12px; color: var(--p-text-muted-color); padding: 0 6px; }

  &__legend {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0;
    padding: 6px 10px;
    list-style: none;
    font-size: 11px;
    color: var(--p-text-muted-color);
    background: var(--p-content-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    z-index: 5;

    li { display: flex; align-items: center; gap: 6px; }
  }

  &__swatch {
    width: 18px;
    height: 12px;
    border-radius: 3px;
    border: 1.5px solid var(--p-content-border-color);

    &--chosen { border-color: var(--p-primary-color); background: var(--p-highlight-soft); }
    &--required { border-color: var(--p-text-faint-color); }
    &--missing { border: 1.5px dashed var(--status-warn); }
    &--metamodel { border-radius: 8px; width: 22px; background: var(--p-content-hover-background); }
  }

  &__panel {
    position: absolute;
    top: 8px;
    right: 8px;
    bottom: 8px;
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
    background: var(--p-content-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    z-index: 6;
  }

  &__panel-head { display: flex; align-items: center; gap: 8px; }
  &__panel-name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  &__panel-location { margin: -6px 0 0; font-size: 11px; color: var(--p-text-muted-color); word-break: break-all; }
  &__field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--p-text-muted-color); }
  &__note { margin: 0; font-size: 13px; &--bad { color: var(--status-warn); } }

  &__facts {
    margin: 0;
    font-size: 12px;

    dt { margin-top: 8px; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
    dd { margin: 2px 0 0; color: var(--p-text-color); }
  }

  &__panel-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: auto; }
  &__open { font-size: 12px; }

  &__busy {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    color: var(--p-text-muted-color);
    background: var(--p-content-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    z-index: 7;
  }
}

.cg-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--p-text-color);
  background: var(--p-content-background);
  border: 1.5px solid var(--p-text-faint-color);
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.12s;

  &__head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  &__name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__chip {
    font-size: 12px;
    padding: 0 6px;
    color: var(--p-text-muted-color);
    background: var(--p-content-hover-background);
    border-radius: 4px;
  }
  &__offers { display: flex; flex-wrap: wrap; gap: 4px; }
  &__offer {
    font-size: 11px;
    padding: 0 5px;
    border: 1px dashed var(--p-content-border-color);
    border-radius: 4px;
    color: var(--p-text-muted-color);
  }

  &--spl {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: var(--p-text-color);
    background: var(--p-content-hover-background);
    border: 2px solid var(--p-primary-color);
  }

  &--metamodel {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    border-radius: 26px;
    border-style: solid;
    border-width: 1px;
    border-color: var(--p-content-border-color);
    background: var(--p-content-hover-background);
  }
}

.cg-handle {
  width: 6px;
  height: 6px;
  min-width: 0;
  min-height: 0;
  opacity: 0;
}

:deep(.vue-flow__node.cg-node--chosen .cg-node) {
  border-color: var(--p-primary-color);
  background: var(--p-highlight-soft);
}

:deep(.vue-flow__node.cg-node--missing .cg-node) {
  border-style: dashed;
  border-color: var(--status-warn);
}

:deep(.vue-flow__node.cg-node--unresolved .cg-node) {
  border-style: dashed;
  border-color: var(--status-bad);
}

:deep(.vue-flow__node.cg-node--cycle .cg-node) {
  border-color: var(--status-bad);
  box-shadow: 0 0 0 2px var(--status-bad);
}

:deep(.vue-flow__node.cg-node--selected .cg-node) {
  box-shadow: 0 0 0 2px var(--p-primary-color);
}

:deep(.vue-flow__node.cg-node--dim),
:deep(.vue-flow__edge.cg-edge--dim) {
  opacity: 0.25;
}

:deep(.vue-flow__edge-path) {
  stroke: var(--p-text-faint-color);
  stroke-width: 1.5;
}

:deep(.vue-flow__edge.cg-edge--metamodel .vue-flow__edge-path) {
  stroke-dasharray: 4 3;
}

:deep(.vue-flow__edge.cg-edge--cycle .vue-flow__edge-path) {
  stroke: var(--status-bad);
  stroke-width: 2;
}

:deep(.vue-flow__background) {
  background: var(--p-content-background);
}
</style>
