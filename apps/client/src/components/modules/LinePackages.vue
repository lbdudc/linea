<script setup>
import { ref, computed, onMounted } from 'vue'
import packageService from 'src/services/packageService'
import lineService from 'src/services/lineService'
import { notify } from 'src/composables/useNotify'
import { describeError } from 'components/modules/describeError'
import DiagnosticList from 'components/modules/DiagnosticList.vue'
import ModulePicker from 'components/modules/ModulePicker.vue'
import SaveConfirmationDialog from 'components/feature-model/SaveConfirmationDialog.vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import { useT } from 'src/composables/useT'
import { toMap } from 'components/modules/chosenPackages'
import PackagePinDialog from 'components/modules/PackagePinDialog.vue'
import { fieldOf } from 'components/modules/pinning'
import { rememberLineModules } from 'components/modules/modulesTab'

const props = defineProps({ id: { type: String, required: true }, only: { type: String, default: null } })
const emit = defineEmits(['loaded'])

const t = useT()

const line = ref(null)
const info = ref(null)
const isProject = computed(() => info.value?.kind === 'project')
const loading = ref(false)
const error = ref(null)

// what the user is editing: the modules the line uses directly, each with the versions it accepts. The picker is the same one the
// creation of a line uses: it checks the choice as it changes and says what is missing.
const selection = ref([])
const saved = ref({})
const report = ref(null)
const actionError = ref(null)
const diagnostics = ref([])

const current = computed(() => toMap(selection.value))
const sorted = (o) => JSON.stringify(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)))
const dirty = computed(() => sorted(current.value) !== sorted(saved.value))

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const [lineData, modules] = await Promise.all([
      lineService.findLineById({ id: props.id }),
      packageService.getLineModules({ id: props.id }),
    ])
    line.value = lineData
    info.value = modules
    saved.value = modules.spl?.modules ?? {}
    selection.value = Object.entries(saved.value).map(([location, range]) => ({ location, range }))
    if (modules.error) actionError.value = modules.error
    rememberLineModules(props.id, modules)
    emit('loaded', { line: lineData, info: modules })
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
}

// saving goes through a dialog first: which products the change would break, and which version it raises
const showSave = ref(false)
// the modules the dialog was opened with: what is checked is what is saved, even if the picker changes behind it
const proposed = ref({})
const save = () => {
  actionError.value = null
  diagnostics.value = []
  proposed.value = { ...current.value }
  showSave.value = true
}

const onSaved = async () => {
  notify({ type: 'positive', message: t(isProject.value ? 'modules.metamodels_saved' : 'modules.line_saved') })
  await load()
}

// the packages the line has, each with the way to move it to another version (the same dialog the package's own page uses)
const pinning = ref(null)
const showPin = computed({ get: () => pinning.value !== null, set: (v) => { if (!v) pinning.value = null } })
const versionsOf = ref({})
const asked = new Set()
const rows = computed(() => (info.value?.packages ?? []).filter((p) => !props.only || p.kind === props.only).map((p) => ({
  ...p,
  range: info.value?.spl?.[fieldOf(p.kind)]?.[p.location] ?? null,
})))
const pin = async (row) => {
  if (!asked.has(row.kind)) {
    asked.add(row.kind)
    try {
      for (const entry of await packageService.list({ kind: row.kind })) versionsOf.value[entry.location] = entry.versions ?? []
    } catch { asked.delete(row.kind) /* the dialog opens with no versions to choose from */ }
  }
  pinning.value = row
}
const pinned = async () => { await load() }

onMounted(load)
</script>

<template>
   <div class="ln-block">
   <div class="modules-body">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading && !info" height="200px" />

    <Message v-else-if="info && info.kind === 'plain'" severity="info" :closable="false">
      {{ $t('modules.line_not_modular') }}
    </Message>

    <template v-else-if="info">
      <ModulePicker v-if="info.modular" v-model="selection" :line-id="id" :name="line?.name ?? ''" @result="report = $event" />

      <div v-if="info.modular" class="bar">
        <span v-if="dirty" class="bar__dirty">{{ $t(isProject ? 'modules.unsaved_metamodels' : 'modules.unsaved_modules') }}</span>
        <Button
          name="save-modules"
          icon="pi pi-save"
          :label="$t('labels.save')"
          :disabled="!dirty || report?.ok === false"
          @click="save"
        />
      </div>

      <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
      <DiagnosticList :diagnostics="diagnostics" />

      <SaveConfirmationDialog
        v-if="info.modular"
        v-model:dialog="showSave"
        :line-id="id"
        :modules="proposed"
        :save-modules="({ modules, bump }) => packageService.saveLineModules({ id, modules, bump })"
        model-path="spl.json"
        @saved="onSaved"
      />

      <section class="block" data-test="line-packages">
        <h2>{{ $t(only === 'metamodel' ? 'modules.modelling_metamodels' : only === 'module' ? 'modules.tab_modules' : 'modules.line_packages') }}</h2>
        <p v-if="!rows.length" class="muted">{{ $t('modules.line_packages_none') }}</p>
        <table v-else class="pkgs">
          <thead>
            <tr><th>{{ $t('modules.use_package') }}</th><th>{{ $t('modules.use_range') }}</th><th>{{ $t('modules.use_version') }}</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.location">
              <td>
                <span class="pkgs__name">{{ row.name }}</span>
                <span class="pkgs__kind">{{ $t(row.kind === 'module' ? 'modules.module' : 'modules.metamodel') }}</span>
              </td>
              <td class="ident">{{ row.range ?? $t('modules.use_indirect') }}</td>
              <td class="ident">v{{ row.version }}</td>
              <td class="pkgs__actions">
                <Button size="small" outlined icon="pi pi-sort-alt" :label="$t('modules.pin_action')" :disabled="row.range === null" @click="pin(row)" />
              </td>
            </tr>
          </tbody>
        </table>
        <PackagePinDialog
          v-if="pinning"
          v-model:visible="showPin"
          :line-id="id"
          :line-name="line?.name ?? ''"
          :kind="pinning.kind"
          :location="pinning.location"
          :versions="versionsOf[pinning.location] ?? []"
          @saved="pinned"
        />
      </section>

      <section v-if="info.featureModel && !only" class="block">
        <h2>{{ $t('modules.composed_fm') }}</h2>
        <pre class="fm ident">{{ info.featureModel }}</pre>
      </section>
    </template>
   </div>
   </div>
</template>

<style scoped>
.modules-body { display: flex; flex-direction: column; gap: 16px; }
.bar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
.bar__dirty { font-size: 12px; color: var(--status-warn); }
.block { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
.muted { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }
.pkgs { width: 100%; border-collapse: collapse; font-size: 13px; }
.pkgs th { text-align: left; font-weight: 500; color: var(--p-text-muted-color); padding: 6px 10px; border-bottom: 1px solid var(--p-content-border-color); }
.pkgs td { padding: 8px 10px; border-bottom: 1px solid var(--p-content-border-color); }
.pkgs__name { font-weight: 600; margin-right: 8px; }
.pkgs__kind { font-size: 11px; color: var(--p-text-muted-color); }
.pkgs__actions { text-align: right; }
.block h2 { margin: 0; font-size: 13px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }
.fm { margin: 0; padding: 12px; border: 1px solid var(--p-content-border-color); border-radius: 8px; font-size: 12px; line-height: 1.5; overflow: auto; max-height: 420px; tab-size: 2; }
</style>
