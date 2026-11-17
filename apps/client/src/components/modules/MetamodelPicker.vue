<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import packageService from 'src/services/packageService'
import { describeError } from './describeError'
import DiagnosticList from './DiagnosticList.vue'
import CompositionGraph from './CompositionGraph.vue'
import { readView, writeView } from './viewPreference'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import SelectButton from 'primevue/selectbutton'
import { useT } from 'src/composables/useT'
import { isChosen as inChoice, toggled, withRange, withMissing, toMap, nameIn, viewOptions as makeViewOptions } from './chosenPackages'

/**
 * Chooses the metamodels of a project: the catalog of the registry as cards (what each is for, the level its models are at, what it
 * needs), with the feature metamodel in and locked (every SPL has it). Each time the choice changes the project is checked by bango, on
 * the server, from its metamodels alone: what a chosen metamodel needs and nobody chose is reported, with a button to add it.
 *
 * `v-model` is a list of `{ location, range }` (the feature metamodel is not in it: the server adds it).
 */
const props = defineProps({
  modelValue: { type: Array, required: true },
  name: { type: String, default: 'new-spl' },
  // fills the height of its container (the creation wizard), each side scrolling on its own, instead of growing with its content
  fill: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'result'])

const t = useT()
const { proxy } = getCurrentInstance()

const FEATURE_NAME = 'featuremodel'

const catalog = ref([])
const loading = ref(false)
const search = ref('')
const checking = ref(false)
const report = ref(null)
const packages = ref([])
const error = ref(null)

const chosen = computed(() => props.modelValue)
const isChosen = (location) => inChoice(chosen.value, location)
const nameOf = (location) => nameIn(catalog.value, location)
const isFeature = (pkg) => pkg.name === FEATURE_NAME
const feature = computed(() => catalog.value.find(isFeature))

// what bango says each metamodel is, from the last check (its level, and what it needs)
const infoOf = computed(() => Object.fromEntries((report.value?.metamodels ?? []).map((m) => [m.name, m])))
const needsOf = (pkg) => packages.value.find((p) => p.location === pkg.location)?.needs?.metamodels ?? []

// the library the feature metamodel imports is a metamodel with no models of its own: it comes with what needs it
const entryNames = computed(() => new Set((report.value?.metamodels ?? []).map((m) => m.name)))
const offered = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return catalog.value
    .filter((p) => !isFeature(p) && (p.name !== 'common' || isChosen(p.location)))
    .filter((p) => !needle || `${p.name} ${p.description}`.toLowerCase().includes(needle))
})

const toggle = (pkg) => emit('update:modelValue', toggled(chosen.value, pkg))
const setRange = (location, range) => emit('update:modelValue', withRange(chosen.value, location, range))

// what the chosen metamodels need and nobody chose: reported, and added from here
const missing = computed(() => packages.value
  .filter((p) => p.kind === 'metamodel' && !isChosen(p.location) && !isFeature(p) && entryNames.value.has(p.name))
  .map((p) => ({ location: p.location, name: p.name, by: [...new Set((p.requiredBy ?? []).filter((r) => r !== 'spl').map((r) => nameOf(r.replace(/@.*$/, ''))))] }))
  .filter((m) => m.by.length))
const addMissing = (m) => emit('update:modelValue', withMissing(chosen.value, [m], catalog.value))
const missingText = computed(() => `${proxy.$tc('modules.missing_count', missing.value.length, { n: missing.value.length })}: ${missing.value.map((m) => m.name).join(', ')}`)
const addAllMissing = () => emit('update:modelValue', withMissing(chosen.value, missing.value, catalog.value))

const view = ref(readView())
watch(view, writeView)
const viewOptions = computed(() => makeViewOptions(t))

let sequence = 0
let timer = null
let inFlight = null
const check = async () => {
  const mine = ++sequence
  inFlight?.abort()
  const controller = (inFlight = new AbortController())
  checking.value = true
  error.value = null
  try {
    const result = await packageService.previewMetamodels({ name: props.name, kind: 'project', metamodels: toMap(chosen.value), signal: controller.signal })
    if (mine !== sequence) return
    report.value = result
    packages.value = result.packages ?? []
    emit('result', missing.value.length ? { ...result, ok: false } : result)
  } catch (e) {
    if (mine !== sequence) return
    error.value = describeError(e, t).message
    report.value = null
    emit('result', null)
  } finally {
    if (mine === sequence) checking.value = false
  }
}

watch(() => JSON.stringify(toMap(chosen.value)), () => {
  clearTimeout(timer)
  checking.value = true
  timer = setTimeout(check, 450)
})

onMounted(async () => {
  loading.value = true
  try {
    catalog.value = await packageService.list({ kind: 'metamodel' })
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
  check()
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  inFlight?.abort()
})
</script>

<template>
  <div class="picker" :class="{ 'picker--fill': fill }">
    <section class="picker__catalog" :aria-label="$t('modules.picker_catalog_metamodels')">
      <div class="picker__bar">
        <h3>{{ $t('modules.picker_catalog_metamodels') }}</h3>
        <span class="picker__search">
          <i class="pi pi-search" aria-hidden="true" />
          <InputText v-model="search" size="small" name="search-metamodels" :placeholder="$t('modules.search_metamodels')" />
        </span>
      </div>

      <div class="mod-card mod-card--locked" name="feature-metamodel">
        <span class="mod-card__head">
          <i class="pi pi-lock" aria-hidden="true" />
          <span class="mod-card__name ident">{{ feature?.name ?? 'featuremodel' }}</span>
          <span v-if="feature?.latest" class="chip-version ident">v{{ feature.latest }}</span>
        </span>
        <span class="mod-card__desc">{{ $t('modules.feature_metamodel_always') }}</span>
      </div>

      <div v-if="loading" class="picker__cards"><Skeleton v-for="i in 4" :key="i" height="84px" /></div>
      <p v-else-if="!offered.length" class="picker__empty">{{ $t('modules.no_metamodels') }}</p>
      <div v-else class="picker__cards">
        <button
          v-for="pkg in offered"
          :key="pkg.location"
          type="button"
          class="mod-card"
          :class="{ 'mod-card--on': isChosen(pkg.location), 'mod-card--missing': missing.some((m) => m.location === pkg.location) }"
          :name="`metamodel-${pkg.name}`"
          :aria-pressed="isChosen(pkg.location)"
          :title="isChosen(pkg.location) ? $t('modules.picker_click_remove') : $t('modules.picker_click_add')"
          @click="toggle(pkg)"
        >
          <span class="mod-card__head">
            <span class="mod-card__name ident">{{ pkg.name }}</span>
            <span v-if="infoOf[pkg.name]?.level > 0" class="chip-level" :title="$t('modules.level_hint', { n: infoOf[pkg.name].level })">{{ $t('modules.level_n', { n: infoOf[pkg.name].level }) }}</span>
            <span class="chip-version ident">{{ pkg.latest ? `v${pkg.latest}` : $t('modules.unpublished') }}</span>
            <span class="mod-card__action" :class="{ 'mod-card__action--on': isChosen(pkg.location) }">
              <i :class="isChosen(pkg.location) ? 'pi pi-check' : 'pi pi-plus'" aria-hidden="true" />
              {{ isChosen(pkg.location) ? $t('modules.picker_remove') : $t('modules.picker_add') }}
            </span>
          </span>
          <span class="mod-card__desc">{{ pkg.description || pkg.path }}</span>
          <span v-if="needsOf(pkg).filter((n) => n.name !== 'common' && n.name !== 'featuremodel').length" class="mod-card__needs">
            {{ $t('modules.also_needs') }}
            <span v-for="n in needsOf(pkg).filter((n) => n.name !== 'common' && n.name !== 'featuremodel')" :key="n.location" class="tag ident">{{ n.name }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="picker__side" :aria-label="$t('modules.picker_selected_metamodels')">
      <div class="picker__bar">
        <h3>{{ $t('modules.picker_selected_metamodels') }} <span class="picker__count">{{ chosen.length }}</span></h3>
        <SelectButton
          v-model="view"
          :options="viewOptions"
          option-value="value"
          option-label="label"
          :allow-empty="false"
          size="small"
          name="metamodels-view"
          :aria-label="$t('modules.resolution')"
        />
      </div>
      <p v-if="!chosen.length" class="picker__empty">{{ $t('modules.picker_none_chosen_metamodels') }}</p>
      <ul v-else-if="view !== 'graph'" class="chosen" role="list">
        <li v-for="m in chosen" :key="m.location" class="chosen__row" :name="`chosen-${nameOf(m.location)}`">
          <span class="chosen__name ident">{{ nameOf(m.location) }}</span>
          <InputText
            :model-value="m.range"
            size="small"
            class="chosen__range ident"
            :aria-label="$t('modules.versions_accepted')"
            @update:model-value="setRange(m.location, $event)"
          />
          <Button text rounded size="small" severity="danger" icon="pi pi-times" :aria-label="$t('labels.delete')" @click="toggle({ location: m.location })" />
        </li>
      </ul>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div class="resolution" :class="{ 'resolution--bad': (report && !report.ok) || missing.length }">
        <div v-if="missing.length && !checking" class="missing" name="missing-metamodels" role="status">
          <i class="pi pi-info-circle" aria-hidden="true" />
          <span class="missing__text">{{ missingText }}</span>
          <Button
            size="small"
            outlined
            icon="pi pi-plus"
            :label="missing.length > 1 ? $t('modules.add_all') : $t('modules.add')"
            :name="missing.length > 1 ? 'add-all-missing' : `add-missing-${missing[0].name}`"
            @click="addAllMissing"
          />
        </div>
        <p v-if="!(missing.length && !checking)" class="resolution__status" name="picker-status">
          <i v-if="checking" class="pi pi-spin pi-spinner" aria-hidden="true" />
          <i v-else-if="report" :class="report.ok && !missing.length ? 'pi pi-check-circle' : 'pi pi-times-circle'" aria-hidden="true" />
          <template v-if="checking">{{ $t('modules.picker_checking') }}</template>
          <template v-else-if="report">{{ report.ok && !missing.length ? $t('modules.check_ok') : $t('modules.check_failed') }}</template>
        </p>
        <CompositionGraph
          v-if="view === 'graph'"
          :packages="packages"
          :chosen="chosen"
          :diagnostics="report?.diagnostics ?? []"
          :errors="error ? [error] : []"
          :spl-name="name"
          :checking="checking"
          :show-add-all="false"
          :registry="catalog"
          :name-of="nameOf"
          @add="addMissing({ location: $event })"
          @remove="toggle({ location: $event })"
          @set-range="setRange"
          @add-all="addAllMissing"
        />
        <template v-else-if="report && !checking">
          <div class="resolution__group">
            <span class="resolution__label">{{ $t('modules.metamodels') }}</span>
            <span v-for="m in report.metamodels" :key="m.name" class="tag ident">{{ m.name }}<small v-if="m.level > 0"> · {{ $t('modules.level_n', { n: m.level }) }}</small></span>
          </div>
        </template>
        <DiagnosticList v-if="report && !checking" :diagnostics="report.diagnostics ?? []" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.picker { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr); gap: 20px; align-items: start; }
.picker--fill { height: 100%; grid-template-rows: minmax(0, 1fr); }
.picker--fill .picker__catalog, .picker--fill .picker__side { max-height: 100%; min-height: 0; }
@media (max-width: 900px) { .picker { grid-template-columns: minmax(0, 1fr); } .picker--fill { grid-template-rows: none; } }
.picker h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }
.picker__bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.picker__bar h3 { flex: 1; }
.picker__search { position: relative; display: inline-flex; align-items: center; }
.picker__search i { position: absolute; left: 9px; font-size: 12px; color: var(--p-text-faint-color); }
.picker__search :deep(input) { padding-left: 28px; width: 220px; }
@media (max-width: 760px) { .picker__bar { flex-wrap: wrap; } .picker__search, .picker__search :deep(input) { width: 100%; } }
.picker__count { margin-left: 4px; color: var(--p-text-color); }
.picker__empty { margin: 8px 0 0; font-size: 13px; color: var(--p-text-faint-color); }
.picker__catalog { display: flex; flex-direction: column; }
.picker__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; overflow-y: auto; min-height: 0; scrollbar-gutter: stable; }
.mod-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; text-align: left; font: inherit; color: var(--p-text-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 8px; cursor: pointer; min-height: 112px; }
.mod-card--locked { flex-shrink: 0; cursor: default; min-height: 0; background: var(--p-content-hover-background); }
.mod-card:not(.mod-card--locked):hover { border-color: var(--p-text-faint-color); }
.mod-card:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.mod-card--on { border-color: var(--p-primary-color); background: var(--p-highlight-soft); }
.mod-card--missing { border-style: dashed; border-color: var(--status-warn-border); }
.mod-card__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mod-card--locked .mod-card__head > i { color: var(--p-text-faint-color); }
.mod-card__name { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.mod-card__action { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--p-content-border-color); color: var(--p-text-muted-color); white-space: nowrap; }
.mod-card__action--on { border-color: var(--p-primary-color); color: var(--p-primary-color); }
.mod-card__desc { font-size: 12px; color: var(--p-text-muted-color); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mod-card__needs { font-size: 11px; color: var(--p-text-muted-color); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chip-level { font-size: 11px; border: 1px solid var(--p-primary-color); color: var(--p-primary-color); border-radius: 4px; padding: 0 5px; }
.picker__side { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow-y: auto; scrollbar-gutter: stable; }
.chosen { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.chosen__row { display: flex; align-items: center; gap: 8px; }
.chosen__name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.chosen__range { width: 110px; }
.missing { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; background: var(--status-warn-soft); border: 1px solid var(--status-warn-border); border-radius: 6px; }
.missing > i { color: var(--status-warn); }
.missing__text { flex: 1 1 180px; min-width: 0; }
.resolution { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--p-content-border-color); }
.resolution__status { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--status-ok); }
.resolution--bad .resolution__status { color: var(--status-bad); }
.resolution__group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.resolution__label { color: var(--p-text-muted-color); }
.tag { border: 1px solid var(--p-content-border-color); border-radius: 4px; padding: 1px 6px; background: var(--p-content-hover-background); }
.tag small { color: var(--p-text-muted-color); }
</style>
