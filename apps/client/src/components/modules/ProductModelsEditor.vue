<script setup>
import { ref, computed } from 'vue'
import productModelService from 'src/services/productModelService'
import { notify } from 'src/composables/useNotify'
import { describeError } from './describeError'
import DiagnosticList from './DiagnosticList.vue'
import BangoWorkbench from 'components/modules/BangoWorkbench.vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useT } from 'src/composables/useT'
import { MODEL_VIEWS } from './modelViews'

/**
 * The model of one metamodel of a product, edited with bango's views. It sits in the "models" tab of the product, next to the other
 * models, and is given the overview the server made (metamodels, grammars, what the modules offer). One engine serves every metamodel
 * of the product, so the models can refer to each other and to what the modules offer.
 */
const props = defineProps({
  productId: { type: String, required: true },
  overview: { type: Object, required: true },
  // the metamodel being edited
  metamodel: { type: String, default: null },
})
const emit = defineEmits(['states', 'saved'])

const t = useT()

const states = ref({})
// bumped when the workbench has an engine to ask which views the metamodels bring
const engineTick = ref(0)
// where the nodes of the diagrams were left, and what was saved
const layouts = ref(props.overview.layouts ?? {})
const savedLayouts = ref(JSON.stringify(props.overview.layouts ?? {}))
const savedTexts = ref(Object.fromEntries(props.overview.metamodels.map((m) => [m.name, m.model ?? ''])))
const saving = ref(false)
const actionError = ref(null)
const serverReport = ref(null)
const showOffered = ref(false)
const workbench = ref(null)

const metamodels = computed(() => props.overview.metamodels)
const brought = computed(() => (engineTick.value >= 0 ? (workbench.value?.views?.(props.metamodel) ?? []) : []))
// what the person chose for each metamodel; until then, the feature selection is looked at as a tree of features and the rest as text
const chosen = ref({})
const preferred = (name) => (name === 'featureselection' && brought.value.some((v) => v.id === 'viz:feature-tree') ? 'viz:feature-tree' : 'text')
const view = computed(() => chosen.value[props.metamodel] ?? preferred(props.metamodel))
// the views of the metamodel first, then the text and the form; the rest (diagram, AST, JSON...) are in a menu of their own
const MAIN = ['text', 'form']
const allViews = computed(() => [
  ...brought.value.map((v) => ({ id: v.id, text: v.label, icon: 'pi-objects-column', title: v.error ?? v.description })),
  ...MODEL_VIEWS.filter((v) => MAIN.includes(v.id)).map((v) => ({ id: v.id, text: t(`modules.${v.label}`), icon: v.icon })),
])
const moreViews = computed(() => MODEL_VIEWS.filter((v) => !MAIN.includes(v.id)).map((v) => ({ id: v.id, text: t(`modules.${v.label}`) })))
const everyView = computed(() => [...allViews.value, ...moreViews.value])
// a view the metamodel in front does not have (it was another metamodel's) is left for the text
const shownView = computed(() => (everyView.value.some((v) => v.id === view.value) ? view.value : 'text'))
const viewName = (id) => `view-${id.replace(/[^\w-]/g, '-')}`
const layoutsDirty = computed(() => JSON.stringify(layouts.value) !== savedLayouts.value)
const current = computed(() => metamodels.value.find((m) => m.name === props.metamodel) ?? null)
const isDirty = (m) => states.value[m.name] !== undefined && states.value[m.name].text !== (savedTexts.value[m.name] ?? '')
const dirtyModels = computed(() => metamodels.value.filter(isDirty))
const problemsOf = (m) => (states.value[m.name]?.problems ?? []).filter((p) => p.severity === 'error' || p.severity === 'warning')
// what the product's models are made from and cannot change: what the modules offer and the models of the SPL (its feature model, ...)
const offered = computed(() => [
  ...props.overview.offered,
  ...(props.overview.configuration ?? []).map(({ level, metamodel, text }) => ({ origin: `level-${level}`, metamodel, text })),
])
const offeredFor = computed(() => offered.value.filter((o) => o.metamodel === props.metamodel))

const currentProblems = computed(() =>
  current.value
    ? problemsOf(current.value).map((p) => ({ severity: p.severity, package: '', message: `${p.startLine + 1}:${p.startColumn + 1} ${p.message}` }))
    : [],
)
const serverProblems = computed(() => serverReport.value?.diagnostics ?? [])

const dirtyNames = () => [...dirtyModels.value.map((m) => m.name), ...(layoutsDirty.value ? ['layout'] : [])]

const onStates = (list) => {
  states.value = Object.fromEntries(list.map((s) => [s.metamodel, s]))
  engineTick.value++
  emit('states', { states: states.value, dirty: dirtyNames() })
}

const onLayouts = (value) => {
  layouts.value = value
  emit('states', { states: states.value, dirty: dirtyNames() })
}

const save = async () => {
  if ((!dirtyModels.value.length && !layoutsDirty.value) || saving.value) return
  saving.value = true
  actionError.value = null
  try {
    const texts = workbench.value ? await workbench.value.texts() : {}
    // the nodes of the diagrams go in the same commit as the last model, or alone when only they were moved
    const sent = layoutsDirty.value ? JSON.parse(JSON.stringify(workbench.value?.currentLayouts?.() ?? layouts.value)) : undefined
    let report = null
    let features
    const models = dirtyModels.value
    for (const [i, m] of models.entries()) {
      const withLayouts = sent !== undefined && i === models.length - 1 ? { layouts: sent } : {}
      report = await productModelService.saveProductModel({ id: props.productId, metamodel: m.name, content: texts[m.name], ...withLayouts })
      // the features a feature selection comes to are what the product keeps of it
      if (Array.isArray(report?.features)) features = report.features
      savedTexts.value = { ...savedTexts.value, [m.name]: texts[m.name] }
    }
    if (sent !== undefined && !models.length) await productModelService.saveProductLayouts({ id: props.productId, layouts: sent })
    if (sent !== undefined) savedLayouts.value = JSON.stringify(sent)
    if (report) serverReport.value = report
    emit('states', { states: states.value, dirty: dirtyNames() })
    emit('saved', { features })
    notify({ type: 'positive', message: t('modules.models_saved'), timeout: 2500 })
  } catch (e) {
    actionError.value = describeError(e, t).message
  } finally {
    saving.value = false
  }
}

defineExpose({ save, dirty: () => dirtyNames() })
</script>

<template>
  <div class="pme">
    <div class="pme__bar">
      <div class="views" role="tablist" :aria-label="$t('modules.views')">
        <button
          v-for="v in allViews"
          :key="v.id"
          type="button"
          role="tab"
          class="views__tab"
          :class="{ 'views__tab--active': shownView === v.id }"
          :aria-selected="shownView === v.id"
          :name="viewName(v.id)"
          :title="v.title"
          @click="chosen = { ...chosen, [metamodel]: v.id }"
        >
          <i class="pi" :class="v.icon" aria-hidden="true" /> {{ v.text }}
        </button>
      </div>
      <select
        class="views__more"
        :class="{ 'views__more--active': moreViews.some((v) => v.id === shownView) }"
        :aria-label="$t('modules.views_more')"
        name="views-more"
        :value="moreViews.some((v) => v.id === shownView) ? shownView : ''"
        @change="$event.target.value && (chosen = { ...chosen, [metamodel]: $event.target.value })"
      >
        <option value="" disabled>{{ $t('modules.views_more') }}</option>
        <option v-for="v in moreViews" :key="v.id" :value="v.id">{{ v.text }}</option>
      </select>
      <span v-if="current" class="pme__file ident">.linea/models/{{ current.name }}.{{ current.extension }}</span>
      <Button
        v-if="offeredFor.length"
        text
        size="small"
        icon="pi pi-lock"
        :label="$t('modules.offered_n', { n: offeredFor.length })"
        :class="{ 'pme__toggle--on': showOffered }"
        name="show-offered"
        @click="showOffered = !showOffered"
      />
      <Button
        size="small"
        icon="pi pi-save"
        :label="dirtyModels.length ? $t('modules.save_n', { n: dirtyModels.length }) : $t('labels.save')"
        :disabled="!dirtyModels.length && !layoutsDirty"
        :loading="saving"
        name="save-models"
        @click="save"
      />
    </div>

    <p v-if="current && current.requires.length" class="pme__needs">{{ $t('modules.also_needs') }} {{ current.requires.join(', ') }}</p>

    <div class="pme__main">
      <BangoWorkbench
        ref="workbench"
        class="pme__workbench"
        :bundle="overview.bundle"
        :layouts="overview.layouts"
        :metamodels="metamodels"
        :offered="offered"
        :offered-metamodels="(overview.configuration ?? []).map((c) => c.metamodel)"
        :metamodel="metamodel"
        :view="shownView"
        @states="onStates"
        @layouts="onLayouts"
      />
      <aside v-if="showOffered" class="pme__offered" :aria-label="$t('modules.offered')">
        <p class="pme__hint">{{ $t('modules.offered_hint') }}</p>
        <details v-for="o in offeredFor" :key="`${o.origin}:${o.metamodel}`" class="offer" open>
          <summary>
            <span class="ident">{{ o.origin }}</span>
            <span class="offer__tag">{{ $t('modules.read_only') }}</span>
          </summary>
          <pre class="ident offer__text">{{ o.text }}</pre>
        </details>
      </aside>
    </div>

    <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
    <DiagnosticList :diagnostics="currentProblems" :empty-label="current && states[current.name] ? $t('modules.model_ok') : null" />
    <template v-if="serverProblems.length">
      <h3 class="pme__sub">{{ $t('modules.server_check') }}</h3>
      <DiagnosticList :diagnostics="serverProblems" />
    </template>
  </div>
</template>

<style scoped>
.pme { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pme__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pme__file { margin-left: auto; font-size: 12px; color: var(--p-text-muted-color); }
.pme__needs { margin: 0; font-size: 12px; color: var(--p-text-muted-color); }
.pme__sub { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }
.pme__main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
.pme__main:has(.pme__offered) { grid-template-columns: minmax(0, 1fr) 280px; }
.pme__toggle--on { background: var(--p-content-hover-background); }
.pme__hint { margin: 0 0 10px; font-size: 12px; color: var(--p-text-muted-color); }
.views { display: flex; gap: 2px; border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: 2px; }
.views__more { background: none; border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: 5px 8px; font: inherit; font-size: 13px; color: var(--p-text-muted-color); cursor: pointer; }
.views__more--active { background: var(--p-content-hover-background); color: var(--p-text-color); }
.views__tab { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 13px; color: var(--p-text-muted-color); cursor: pointer; }
.views__tab:hover { color: var(--p-text-color); }
.views__tab--active { background: var(--p-content-hover-background); color: var(--p-text-color); }
.offer { border: 1px solid var(--p-content-border-color); border-radius: 8px; margin-bottom: 8px; background: var(--p-content-hover-background); }
.offer summary { cursor: pointer; padding: 8px 10px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
.offer__tag { font-size: 11px; color: var(--p-text-muted-color); border: 1px solid var(--p-content-border-color); border-radius: 4px; padding: 0 5px; }
.offer__text { margin: 0; padding: 8px 10px 10px; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 380px; white-space: pre; border-top: 1px solid var(--p-content-border-color); }
</style>
