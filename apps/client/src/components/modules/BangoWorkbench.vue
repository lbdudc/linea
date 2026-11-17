<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useTheme } from 'src/composables/useTheme'

/**
 * The models of a product, edited with bango: an engine (in a worker) is given the grammars of the metamodels of the SPL, the models
 * the modules offer (read-only) and the product's own, and bango's own views (text, form, diagram, AST, JSON) show them.
 *
 * It owns the engine. The page chooses which metamodel and which view are shown, and reads back what the models say (`states`) and
 * their texts (`texts()`) to save them.
 */
const props = defineProps({
  // { grammars, constraints, specs, imports, scopes, visualizations }: name -> text, as the server read them from GitLab
  bundle: { type: Object, required: true },
  // where the nodes of the diagrams that metamodels bring were left: { metamodel: { view: { node: { x, y } } } }
  layouts: { type: Object, default: () => ({}) },
  // the metamodels to give a model of: [{ name, model }]
  metamodels: { type: Array, required: true },
  // the metamodels whose models are offered (read-only) instead of given: the grammars of the SPL's own models, which the models refer to
  offeredMetamodels: { type: Array, default: () => [] },
  // the models the modules offer: [{ origin, metamodel, text }]
  offered: { type: Array, default: () => [] },
  metamodel: { type: String, default: null },
  view: { type: String, default: 'text' },
})
const emit = defineEmits(['states', 'ready', 'failed', 'layouts'])

const host = ref(null)
const status = ref('starting')
const failure = ref(null)

const { isDark } = useTheme()

let bango = null
let renderer = null
let monaco = null
let layoutStore = null
let stopLayouts = null
let unsubscribe = null
let timer = null
let disposed = false
let configured = ''

// The bundler must not touch these: it would rewrite an import of a file of /public (and the dev server refuses to serve it as a
// module). A native dynamic import loads the file as the browser finds it.
const nativeImport = new Function('url', 'return import(url)')
const BANGO_CLIENT = '/bango/client.js'
const BANGO_RENDERER = '/bango/renderer.js'
const SCRIPT_SETTERS = { constraints: 'setConstraints', specs: 'setSpec', imports: 'setImport', scopes: 'setScope' }

const publishStates = async () => {
  if (!bango || disposed) return
  const states = await bango.getInstances()
  if (!disposed) emit('states', states)
}

const scheduleStates = () => {
  clearTimeout(timer)
  timer = setTimeout(publishStates, 150)
}

// gives the engine the metamodels, what is offered to them (read-only) and the models: again when the page changes any of them (another
// level of the same SPL is looked at)
const configure = async () => {
  await bango.compose([...new Set([...props.metamodels.map((m) => m.name), ...props.offeredMetamodels])])
  await bango.setContributed(props.offered.map(({ origin, metamodel, text }) => ({ origin, metamodel, text })))
  await bango.setInstances(Object.fromEntries(props.metamodels.filter((m) => typeof m.model === 'string').map((m) => [m.name, m.model])))
}
const shape = () => JSON.stringify([props.metamodels.map((m) => m.name), props.offeredMetamodels, props.offered.map((o) => [o.origin, o.metamodel])])

const start = async () => {
  try {
    const [{ connectBango }, rendererLibrary, monacoModule] = await Promise.all([
      // bango's own bundles, served as static files (see scripts/copy-bango-worker.js): a URL, not a module the bundler knows
      nativeImport(BANGO_CLIENT),
      nativeImport(BANGO_RENDERER),
      import('monaco-editor'),
    ])
    if (disposed) return
    monaco = monacoModule
    const scrollbarSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-size')) || 6
    rendererLibrary.registerTextRenderer(monaco, {
      theme: isDark.value ? 'vs-dark' : 'vs',
      fontSize: 13,
      editorOptions: {
        scrollBeyondLastLine: false,
        scrollbar: { verticalScrollbarSize: scrollbarSize, horizontalScrollbarSize: scrollbarSize },
      },
    })

    // a function that makes the worker: bango then restarts it, with the offending script switched off, if a script never returns
    bango = connectBango(() => new Worker('/bango/bango.worker.js', { type: 'module' }))

    const { bundle } = props
    for (const [name, text] of Object.entries(bundle.grammars)) await bango.setGrammar(name, text)
    for (const [kind, setter] of Object.entries(SCRIPT_SETTERS)) {
      for (const [name, code] of Object.entries(bundle[kind] ?? {})) await bango[setter](name, code)
    }
    configured = shape()
    await configure()
    if (disposed) return

    unsubscribe = await bango.subscribe(scheduleStates)
    // the views the metamodels bring (page code, from their packages) and where their nodes were left
    const visualizations = new rendererLibrary.VisualizationStore()
    visualizations.load(bundle.visualizations ?? {})
    layoutStore = new rendererLibrary.MemoryLayoutStore()
    layoutStore.load(props.layouts ?? {})
    stopLayouts = layoutStore.subscribe(() => emit('layouts', layoutStore.toJSON()))
    renderer = new rendererLibrary.ModelRenderer(bango, { visualizations, layouts: layoutStore })
    const first = props.metamodel ?? props.metamodels[0]?.name
    if (first) await renderer.mount(host.value, first, props.view)
    status.value = 'ready'
    await publishStates()
    emit('ready')
  } catch (error) {
    failure.value = error?.message ?? String(error)
    status.value = 'failed'
    emit('failed', failure.value)
  }
}

watch(() => props.metamodel, async (name) => {
  // another level: the engine is given the models of that level, and what is above them offered
  if (bango && shape() !== configured) {
    configured = shape()
    await configure()
  }
  if (renderer && name) await renderer.setMetamodel(name)
})
watch(() => props.view, async (view) => {
  if (renderer && view) await renderer.setView(view)
})
watch(isDark, (dark) => monaco?.editor.setTheme(dark ? 'vs-dark' : 'vs'))

/** The text of each model, as it is now in the engine. */
const texts = async () => Object.fromEntries((await bango.getInstances()).map((state) => [state.metamodel, state.text]))

/** Put a text in the engine as if it had been typed (after saving, or discarding what was changed). */
const setText = (name, text) => bango.setText(name, text)

/** The views a metamodel brings (not the built-in ones), to offer next to them. */
const views = (name) => (renderer && (name ?? props.metamodel) ? renderer.views(name ?? props.metamodel).filter((v) => v.kind === 'visualization') : [])

/** Where the nodes of the diagrams are now, as plain data to save. */
const currentLayouts = () => layoutStore?.toJSON() ?? props.layouts ?? {}

defineExpose({ texts, setText, views, currentLayouts })

onMounted(start)
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  stopLayouts?.()
  renderer?.dispose()
  if (typeof unsubscribe === 'function') unsubscribe()
  bango?.disconnect()
})
</script>

<template>
  <div class="workbench">
    <div v-if="status !== 'ready'" class="workbench__status" role="status">
      <template v-if="status === 'starting'"><i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('modules.engine_starting') }}</template>
      <template v-else>
        <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('modules.engine_failed') }}: {{ failure }}
      </template>
    </div>
    <div ref="host" class="workbench__host bango-theme" />
  </div>
</template>

<style scoped>
.workbench { position: relative; }
/* bango's views fill their container: it needs a height of its own */
.workbench__host { height: clamp(360px, calc(100vh - 360px), 1200px); border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; }
.workbench__status { position: absolute; z-index: 1; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--p-text-muted-color); pointer-events: none; }

/* bango's views read their colours from these variables: they take the app's */
.bango-theme {
  --bango-bg: var(--p-content-background);
  --bango-panel: var(--p-content-hover-background);
  --bango-fg: var(--p-text-color);
  --bango-line: var(--p-content-border-color);
  --bango-input: var(--p-content-hover-background);
  --bango-accent: var(--p-primary-color);
  --bango-err: var(--status-bad);
  --bango-warn: var(--status-warn);
  --bango-ok: var(--status-ok);
}
</style>
