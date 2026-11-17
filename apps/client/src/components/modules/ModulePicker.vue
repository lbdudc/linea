<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import packageService from 'src/services/packageService'
import { describeError } from './describeError'
import DiagnosticList from './DiagnosticList.vue'
import { missingModules } from './missingModules'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import SelectButton from 'primevue/selectbutton'
import CompositionGraph from './CompositionGraph.vue'
import { readView, writeView } from './viewPreference'
import { useT } from 'src/composables/useT'
import { isChosen as inChoice, toggled, withRange, withMissing, toMap, nameIn, viewOptions as makeViewOptions } from './chosenPackages'

/**
 * Chooses the modules of an SPL: the catalog of the registry on one side, the chosen modules (with the versions they accept) and
 * what they resolve to on the other. The SPL is checked from its modules alone each time the choice changes, so the user sees
 * what the metamodels of those modules say before saving or creating anything.
 *
 * `v-model` is a list of `{ location, range }`. With a `lineId` the check is the one of that line; without it, the SPL does not
 * exist yet and the modules are checked on their own.
 */
const props = defineProps({
  modelValue: { type: Array, required: true },
  lineId: { type: String, default: null },
  name: { type: String, default: 'new-spl' },
  // fills the height of its container (the creation wizard), each side scrolling on its own, instead of growing with its content
  fill: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'result', 'checking'])

const t = useT()
const { proxy } = getCurrentInstance()

const registry = ref([])
const loading = ref(false)
const search = ref('')
const checking = ref(false)
const report = ref(null)
const packages = ref([])
const error = ref(null)

const chosen = computed(() => props.modelValue)
const isChosen = (location) => inChoice(chosen.value, location)
const nameOf = (location) => nameIn(registry.value, location)

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  // a registered module whose repository is gone cannot be used: it is not offered (one already chosen stays, so it can be removed)
  return registry.value
    .filter((p) => !p.unavailable || isChosen(p.location))
    .filter((p) => !needle || `${p.name} ${p.description}`.toLowerCase().includes(needle))
})

const toggle = (pkg) => emit('update:modelValue', toggled(chosen.value, pkg))
const setRange = (location, range) => emit('update:modelValue', withRange(chosen.value, location, range))

const modulePackages = computed(() => packages.value.filter((p) => p.kind === 'module'))
const metamodelPackages = computed(() => packages.value.filter((p) => p.kind === 'metamodel'))
// what the chosen modules need and nobody chose: an error to fix, not something brought in
const missing = computed(() => missingModules({ packages: packages.value, chosen: chosen.value, nameOf }))
const addMissing = (m) => emit('update:modelValue', withMissing(chosen.value, [m], registry.value))
// the metamodels a chosen module brings in (the ones that list it among who needs them)
const metamodelsOf = (location) => metamodelPackages.value.filter((p) => (p.requiredBy ?? []).some((r) => r.replace(/@.*$/, '') === location)).length
// why a chosen module is there: chosen, and also needed by other modules when the answer says so
const requiredByOf = (location) => {
  const p = modulePackages.value.find((x) => x.location === location)
  return [...new Set((p?.requiredBy ?? []).filter((r) => r !== 'spl').map((r) => nameOf(r.replace(/@.*$/, ''))))]
}
const reasonOf = (location) => {
  const by = requiredByOf(location)
  return by.length ? `${t('modules.picker_reason_chosen')} · ${t('modules.picker_reason_required', { by: by.join(', ') })}` : t('modules.picker_reason_chosen')
}
const countMetamodels = (n) => proxy.$tc('modules.count_metamodels', n, { n })
const resultText = computed(() => `${proxy.$tc('modules.count_modules', chosen.value.length, { n: chosen.value.length })}, ${countMetamodels(metamodelPackages.value.length)}`)
const missingText = computed(() => `${proxy.$tc('modules.missing_count', missing.value.length, { n: missing.value.length })}: ${missing.value.map((m) => m.name).join(', ')}`)
const addAllMissing = () => emit('update:modelValue', withMissing(chosen.value, missing.value, registry.value))

// what the chosen modules resolve to, as a graph (default) or as the summary
const view = ref(readView())
watch(view, writeView)
watch(checking, (value) => emit('checking', value), { immediate: true })
const viewOptions = computed(() => makeViewOptions(t))

let sequence = 0
let timer = null
let inFlight = null
// a newer choice of modules makes the answer to the older one useless: stop waiting for it (the server resolves each one in full)
const cancelInFlight = () => {
  inFlight?.abort()
  inFlight = null
}
const check = async () => {
  const mine = ++sequence
  cancelInFlight()
  const controller = (inFlight = new AbortController())
  checking.value = true
  error.value = null
  try {
    const modules = toMap(chosen.value)
    const result = props.lineId
      ? await packageService.checkLineModules({ id: props.lineId, modules, signal: controller.signal })
      : await packageService.previewModules({ name: props.name, modules, signal: controller.signal })
    if (mine !== sequence) return
    report.value = result
    packages.value = result.packages ?? []
    emit('result', missingModules({ packages: result.packages, chosen: chosen.value, nameOf }).length ? { ...result, ok: false } : result)
  } catch (e) {
    if (mine !== sequence) return
    error.value = describeError(e, t).message
    report.value = null
  } finally {
    if (mine === sequence) checking.value = false
  }
}

watch(() => JSON.stringify(toMap(chosen.value)), () => {
  clearTimeout(timer)
  if (!chosen.value.length) {
    sequence++
    cancelInFlight()
    report.value = null
    packages.value = []
    checking.value = false
    emit('result', null)
    return
  }
  checking.value = true
  timer = setTimeout(check, 450)
})

onMounted(async () => {
  loading.value = true
  try {
    registry.value = await packageService.list({ kind: 'module' })
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
  if (chosen.value.length) check()
})
onBeforeUnmount(() => {
  emit('checking', false)
  clearTimeout(timer)
  cancelInFlight()
})
</script>

<template>
  <div class="picker" :class="{ 'picker--fill': fill }">
    <section class="picker__catalog" :aria-label="$t('modules.picker_catalog')">
      <div class="picker__bar">
        <h3>{{ $t('modules.picker_catalog') }}</h3>
        <span class="picker__search">
          <i class="pi pi-search" aria-hidden="true" />
          <InputText v-model="search" size="small" name="module-search" :placeholder="$t('modules.picker_search')" />
        </span>
      </div>

      <div v-if="loading" class="picker__cards"><Skeleton v-for="i in 4" :key="i" height="64px" /></div>
      <p v-else-if="!visible.length" class="picker__empty">{{ registry.length ? $t('modules.picker_nothing_found') : $t('modules.no_modules') }}</p>
      <div v-else class="picker__cards">
        <button
          v-for="pkg in visible"
          :key="pkg.location"
          type="button"
          class="mod-card"
          :class="{ 'mod-card--on': isChosen(pkg.location), 'mod-card--missing': missing.some((m) => m.location === pkg.location) }"
          :name="`module-${pkg.name}`"
          :aria-pressed="isChosen(pkg.location)"
          :title="isChosen(pkg.location) ? $t('modules.picker_click_remove') : $t('modules.picker_click_add')"
          @click="toggle(pkg)"
        >
          <span class="mod-card__head">
            <span class="mod-card__name ident">{{ pkg.name }}</span>
            <span class="chip-version ident" :title="pkg.latest ? undefined : $t('modules.unpublished_hint')">{{ pkg.latest ? `v${pkg.latest}` : $t('modules.unpublished') }}</span>
            <span class="mod-card__action" :class="{ 'mod-card__action--on': isChosen(pkg.location) }">
              <i :class="isChosen(pkg.location) ? 'pi pi-check' : 'pi pi-plus'" aria-hidden="true" />
              {{ isChosen(pkg.location) ? $t('modules.picker_remove') : $t('modules.picker_add') }}
            </span>
          </span>
          <span class="mod-card__desc">{{ pkg.description || pkg.path }}</span>
        </button>
      </div>
    </section>

    <section class="picker__side" :aria-label="$t('modules.picker_selected')">
      <div class="picker__bar">
        <h3>{{ $t('modules.picker_selected') }} <span class="picker__count">{{ chosen.length }}</span></h3>
        <SelectButton
          v-model="view"
          :options="viewOptions"
          option-value="value"
          option-label="label"
          :allow-empty="false"
          size="small"
          name="modules-view"
          :aria-label="$t('modules.resolution')"
        />
      </div>
      <p class="picker__result" name="picker-result" :class="{ 'picker__result--empty': !chosen.length }">
        <template v-if="!chosen.length">{{ $t('modules.picker_result_none') }}</template>
        <template v-else-if="checking && !packages.length">{{ $t('modules.picker_checking') }}</template>
        <template v-else>{{ resultText }}</template>
      </p>
      <div v-if="!chosen.length" class="picker__placeholder" name="picker-placeholder">
        <i class="pi pi-th-large" aria-hidden="true" />
        <p>{{ $t('modules.picker_none_chosen') }}</p>
      </div>
      <ul v-else-if="view !== 'graph'" class="chosen" role="list">
        <li v-for="m in chosen" :key="m.location" class="chosen__row" :name="`chosen-${nameOf(m.location)}`">
          <span class="chosen__name">
            <span class="ident chosen__title">{{ nameOf(m.location) }}</span>
            <small class="chosen__why">
              {{ reasonOf(m.location) }}<template v-if="metamodelsOf(m.location)"> · {{ countMetamodels(metamodelsOf(m.location)) }}</template>
            </small>
          </span>
          <InputText
            :model-value="m.range"
            size="small"
            class="chosen__range ident"
            :aria-label="$t('modules.versions_accepted')"
            @update:model-value="setRange(m.location, $event)"
          />
          <Button text rounded size="small" severity="danger" icon="pi pi-times" :aria-label="$t('labels.delete')" @click="toggle({ location: m.location })" />
        </li>
        <li v-for="m in missing" :key="`req-${m.location}`" class="chosen__row chosen__row--required" :name="`required-${m.name}`">
          <span class="chosen__name">
            <span class="ident chosen__title">{{ m.name }}</span>
            <small class="chosen__why">{{ $t('modules.picker_reason_required', { by: m.by.join(', ') }) }}</small>
          </span>
        </li>
      </ul>

      <p v-if="chosen.length && view !== 'graph'" class="picker__range-help"><i class="pi pi-question-circle" aria-hidden="true" /> {{ $t('modules.range_help') }}</p>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div v-if="chosen.length" class="resolution" :class="{ 'resolution--bad': (report && !report.ok) || missing.length }">
        <div v-if="missing.length && !checking" class="missing" name="missing-modules" role="status">
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
          :registry="registry"
          :name-of="nameOf"
          @add="addMissing({ location: $event })"
          @remove="toggle({ location: $event })"
          @set-range="setRange"
          @add-all="addAllMissing"
        />
        <template v-else-if="packages.length && !checking">
          <p class="resolution__summary">
            {{ $t('modules.summary', { modules: modulePackages.length, metamodels: metamodelPackages.length, offered: modulePackages.reduce((n, p) => n + p.offers.length, 0) }) }}
          </p>
          <div class="resolution__group">
            <span class="resolution__label">{{ $t('modules.metamodels') }}</span>
            <span v-for="p in metamodelPackages" :key="p.location" class="tag ident">{{ p.name }}<small> v{{ p.version }}</small></span>
          </div>
        </template>
        <DiagnosticList v-if="report && !checking" :diagnostics="report.diagnostics ?? []" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.picker { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 1fr); grid-template-rows: minmax(0, 1fr); gap: 12px 20px; align-items: start; }
.picker--fill { height: 100%; }
.picker--fill .picker__catalog, .picker--fill .picker__side { max-height: 100%; min-height: 0; }
@media (max-width: 900px) { .picker { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; } }
.picker h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }
.picker__bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.picker__bar h3 { flex: 1; }
.picker__search { position: relative; display: inline-flex; align-items: center; }
.picker__search i { position: absolute; left: 9px; font-size: 12px; color: var(--p-text-faint-color); }
.picker__search :deep(input) { padding-left: 28px; width: 200px; }
@media (max-width: 760px) { .picker__bar { flex-wrap: wrap; } .picker__search, .picker__search :deep(input) { width: 100%; } }
.picker__count { margin-left: 4px; color: var(--p-text-color); }
.picker__empty { margin: 8px 0 0; font-size: 13px; color: var(--p-text-faint-color); }
.picker__catalog { display: flex; flex-direction: column; }
.picker__cards { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; scrollbar-gutter: stable; }
.mod-card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; text-align: left; font: inherit; color: var(--p-text-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 8px; cursor: pointer; flex-shrink: 0; }
.mod-card:hover { border-color: var(--p-text-faint-color); }
.mod-card:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.mod-card--on { border-color: var(--p-primary-color); background: var(--p-highlight-soft); }
.mod-card--missing { border-style: dashed; border-color: var(--status-warn-border); }
.mod-card__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* the whole name shows: a long one wraps instead of being cut */
.mod-card__name { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.mod-card__action { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 12px; border: 1px solid var(--p-content-border-color); color: var(--p-text-muted-color); white-space: nowrap; }
.mod-card__action--on { border-color: var(--p-primary-color); color: var(--p-primary-color); }
.mod-card__desc { font-size: 12px; color: var(--p-text-muted-color); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.picker__side { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow-y: auto; scrollbar-gutter: stable; }
.picker__result { margin: 0; font-size: 14px; font-weight: 600; color: var(--p-text-color); }
.picker__result--empty { color: var(--p-text-muted-color); font-weight: 400; }
.picker__placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 160px; padding: 16px; text-align: center; border: 1px dashed var(--p-content-border-color); border-radius: 8px; color: var(--p-text-muted-color); }
.picker__placeholder i { font-size: 32px; color: var(--p-text-faint-color); }
.picker__placeholder p { margin: 0; font-size: 13px; }
.picker__range-help { margin: 0; font-size: 12px; color: var(--p-text-muted-color); }
.chosen { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.chosen__row { display: flex; align-items: center; gap: 8px; }
.chosen__name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.chosen__title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.chosen__why { font-size: 11px; color: var(--p-text-muted-color); }
.chosen__range { width: 110px; }
.chosen__row--required { padding: 4px 8px; border: 1px dashed var(--status-warn-border); border-radius: 6px; }
.chosen__row--required .chosen__why { color: var(--status-warn); }
.missing { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; font-size: 13px; background: var(--status-warn-soft); border: 1px solid var(--status-warn-border); border-radius: 6px; }
.missing > i { color: var(--status-warn); }
.missing__text { flex: 1 1 180px; min-width: 0; }
.resolution { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--p-content-border-color); }
.resolution__status { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--status-ok); }
.resolution--bad .resolution__status { color: var(--status-bad); }
.resolution__summary { margin: 0; font-size: 12px; color: var(--p-text-muted-color); }
.resolution__group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.resolution__label { color: var(--p-text-muted-color); }
.tag { border: 1px solid var(--p-content-border-color); border-radius: 4px; padding: 1px 6px; background: var(--p-content-hover-background); }
.tag small { color: var(--p-text-muted-color); }
</style>
