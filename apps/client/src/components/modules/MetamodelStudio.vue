<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import packageService from 'src/services/packageService'
import { useTheme } from 'src/composables/useTheme'
import { describeError } from './describeError'
import { loadBangoLibraries, startEngine } from './bangoLibraries'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import { useT } from 'src/composables/useT'

/**
 * The workbench of a metamodel package: bango's metamodel studio (editors for the grammar and its scripts, tests, the composed grammar,
 * the AST and a live preview), fed with the files of the package as they are on `main`. The studio keeps nothing: this component
 * reads the files from the server, and saves what changed in one commit.
 *
 * It owns an engine of its own (a worker): composing a metamodel here must not disturb the models of a product edited elsewhere.
 */
const props = defineProps({
  kind: { type: String, default: 'metamodel' },
  id: { type: String, required: true },
})
const emit = defineEmits(['saved', 'dirty', 'failed'])

const t = useT()

const host = ref(null)
const status = ref('loading')
const failure = ref(null)
const saveError = ref(null)
const diagnostics = ref([])
const dirty = ref(false)
const saving = ref(false)

const { isDark } = useTheme()

let studio = null
let bango = null
let monaco = null
let paths = {}
let saved = null
let disposed = false

const theme = () => (isDark.value ? 'vs-dark' : 'vs')

const start = async () => {
  status.value = 'loading'
  try {
    const [payload, libraries] = await Promise.all([
      packageService.getStudio({ kind: props.kind, id: props.id }),
      loadBangoLibraries(),
    ])
    if (disposed) return
    const { connectBango, rendererLibrary, studioLibrary } = libraries
    monaco = libraries.monaco
    paths = payload.paths
    saved = { ...payload.files }
    diagnostics.value = payload.diagnostics ?? []
    rendererLibrary.registerTextRenderer(monaco, { theme: theme(), fontSize: 13 })

    bango = startEngine(connectBango)
    studio = new studioLibrary.MetamodelStudio({
      bango,
      monaco,
      renderer: rendererLibrary,
      // Monaco's own TypeScript service gives the script editors completion on the AST types of the grammar
      typescript: async () => monaco.languages.typescript,
      metamodel: payload.metamodel,
      files: payload.files,
      dependencies: payload.dependencies,
      theme: theme(),
      fontSize: 13,
    })
    studio.on('change', () => {
      dirty.value = studio.dirty().length > 0
      emit('dirty', dirty.value)
    })
    await studio.mount(host.value)
    status.value = 'ready'
  } catch (error) {
    failure.value = describeError(error, t).message
    status.value = 'failed'
    emit('failed', failure.value)
  }
}

/** The files that changed, by their path in the package; a file that was emptied is deleted. */
const changes = () =>
  Object.fromEntries(studio.dirty().map((key) => [paths[key], (studio.files[key] ?? '') === '' ? null : studio.files[key]]))

const save = async () => {
  if (!studio || !dirty.value || saving.value) return
  saving.value = true
  saveError.value = null
  try {
    const result = await packageService.saveFiles({ kind: props.kind, id: props.id, files: changes(), message: t('modules.studio_commit') })
    saved = { ...studio.files }
    studio.markSaved()
    dirty.value = false
    emit('dirty', false)
    emit('saved', result)
  } catch (error) {
    saveError.value = describeError(error, t).message
  } finally {
    saving.value = false
  }
}

/** Back to what is on `main`. */
const discard = async () => {
  if (!studio || !dirty.value) return
  await studio.reset(saved)
  dirty.value = false
  emit('dirty', false)
}

watch(isDark, () => monaco?.editor.setTheme(theme()))

onMounted(start)
onBeforeUnmount(() => {
  disposed = true
  studio?.dispose()
})

// the buttons live in the page's tab bar, so the editor starts at the same level as the other tabs
defineExpose({ save, discard, dirty, saving })
</script>

<template>
  <div class="studio">
    <Message v-for="(d, i) in diagnostics" :key="i" severity="warn" :closable="false">{{ d.message }}</Message>
    <Message v-if="saveError" severity="error" :closable="false">{{ saveError }}</Message>
    <Message v-if="status === 'failed'" severity="error" :closable="false">{{ failure }}</Message>
    <Skeleton v-if="status === 'loading'" height="480px" />
    <div v-show="status !== 'failed'" ref="host" class="studio__host" />
  </div>
</template>

<style scoped>
.studio { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.studio__host { height: 70vh; min-height: 480px; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; }
</style>
