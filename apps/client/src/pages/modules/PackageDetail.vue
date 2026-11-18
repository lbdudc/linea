<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import packageService from 'src/services/packageService'
import { notify } from 'src/composables/useNotify'
import { describeError } from 'components/modules/describeError'
import DiagnosticList from 'components/modules/DiagnosticList.vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tabs from 'primevue/tabs'
import Panel from 'primevue/panel'
import Tag from 'primevue/tag'
import Badge from 'primevue/badge'
import Textarea from 'primevue/textarea'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import ModulePage from 'components/modules/ModulePage.vue'
import PackageUsage from 'components/modules/PackageUsage.vue'
import { listPathOf } from 'components/modules/packageRoutes'
import ManifestEditor from 'components/modules/ManifestEditor.vue'
import FileTree from 'components/modules/FileTree.vue'
import { useT } from 'src/composables/useT'
import { slotItems, localized } from 'src/plugins/registry'
import { pluginTabKey } from 'src/plugins/lineTabs'
// Monaco and bango's studio are only loaded when a metamodel is opened
const MetamodelStudio = defineAsyncComponent(() => import('components/modules/MetamodelStudio.vue'))

const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
})

const t = useT()
const confirm = useConfirm()

const pkg = ref(null)
// the packages of the registry, to choose what this one needs from
const registry = ref({ module: [], metamodel: [] })
const loading = ref(false)
const error = ref(null)

const path = ref(null)
const content = ref('')
const original = ref('')
const loadingFile = ref(false)
const saving = ref(false)

const report = ref(null)
const checking = ref(false)
const publishing = ref(false)
const bump = ref(null)
const actionError = ref(null)
const failures = ref([])

const newFile = ref('')

// a metamodel is written in the studio (editors that know the language, tests, preview); its files can still be edited one by one
// the page is cut in tabs so each job has its own room: reading what the package is, editing it, releasing it
const defaultTab = () => (props.kind === 'metamodel' ? 'studio' : 'summary')
const tab = ref(defaultTab())
const mode = computed(() => (tab.value === 'studio' ? 'studio' : 'files'))
const studio = ref(null)
const studioDirty = ref(false)

const pluginTabs = computed(() => slotItems('package.tabs', { kind: props.kind, id: props.id, pkg: pkg.value }).map((item) => ({ ...item, key: pluginTabKey(item) })))
const visitedPluginTabs = ref(new Set())
const checklist = computed(() => report.value?.checklist ?? [])
const blocking = computed(() => checklist.value.filter((entry) => entry.status === 'fail' && !(entry.id === 'version' && bump.value)))
const ICONS = { pass: 'pi-check-circle', warn: 'pi-exclamation-triangle', fail: 'pi-times-circle' }
const itemText = (entry) => t(`modules.cl_${entry.id}_${entry.status}`, {
  version: entry.version, latest: entry.latest, count: entry.count, detail: entry.detail, suggested: entry.suggested ? t(`modules.bumplevel_${entry.suggested}`) : '', rule: entry.rule ? t(`modules.publish_rule_${entry.rule}`) : '',
})
watch(tab, (now) => {
  if (now === 'release' && !report.value && !checking.value && pkg.value && !pkg.value.manifestError) check()
  if (pluginTabs.value.some((item) => item.key === now)) visitedPluginTabs.value = new Set([...visitedPluginTabs.value, now])
})

const manifestPath = computed(() => (props.kind === 'module' ? '.linea/module.json' : 'metamodel.json'))
const fileDirty = computed(() => path.value !== null && content.value !== original.value)
const dirty = computed(() => (mode.value === 'studio' ? studioDirty.value : fileDirty.value))
// the bump options say what the version would become, from the one the manifest declares now
const bumped = (version, level) => {
  const [major, minor, patch] = String(version ?? '0.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0)
  return level === 'major' ? `${major + 1}.0.0` : level === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}
const bumpOptions = computed(() => {
  const from = pkg.value?.manifest?.version ?? pkg.value?.latest ?? '0.0.0'
  return [
    { value: null, label: t('modules.bump_none') },
    ...['patch', 'minor', 'major'].map((level) => ({ value: level, label: t(`modules.bump_${level}`, { from, to: bumped(from, level) }) })),
  ]
})
// what configures the package, apart from its code: the manifest, the feature model, the configuration, the models it offers
const featured = computed(() => {
  const files = pkg.value?.files ?? []
  const list = props.kind === 'module'
    ? [
        { path: '.linea/module.json', label: t('modules.key_manifest'), icon: 'pi-box' },
        { path: '.linea/model.uvl', label: t('modules.key_feature_model'), icon: 'pi-sitemap' },
        { path: '.linea/config/config.json', label: t('modules.key_config'), icon: 'pi-sliders-h' },
        ...files.filter((f) => f.startsWith('models/')).map((path) => ({ path, label: t('modules.key_offered_model'), icon: 'pi-share-alt' })),
      ]
    : [{ path: 'metamodel.json', label: t('modules.key_manifest'), icon: 'pi-box' }]
  list.push({ path: 'README.md', label: t('modules.key_readme'), icon: 'pi-book' })
  return list
})
const diagnostics = computed(() => [...(report.value?.diagnostics ?? []), ...failures.value])

// questions are PrimeVue dialogs, not the browser's: they match the page and never block it
const ask = (message, { danger = false, accept } = {}) => new Promise((resolve) => {
  confirm.require({
    header: accept,
    message,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: accept,
    rejectLabel: t('labels.cancel'),
    acceptProps: { severity: danger ? 'danger' : 'primary', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => resolve(true),
    reject: () => resolve(false),
    onHide: () => resolve(false),
  })
})
const confirmDiscard = async () => !dirty.value || ask(t('modules.discard_changes'), { danger: true, accept: t('modules.discard') })

const loadFile = async (target) => {
  loadingFile.value = true
  try {
    const file = await packageService.readFile({ kind: props.kind, id: props.id, path: target })
    path.value = target
    content.value = file.content
    original.value = file.content
  } catch (e) {
    actionError.value = describeError(e, t).message
  } finally {
    loadingFile.value = false
  }
}

const load = async ({ keepFile = false } = {}) => {
  loading.value = pkg.value === null
  error.value = null
  try {
    pkg.value = await packageService.get({ kind: props.kind, id: props.id })
    if (!keepFile) {
      path.value = null
      await loadFile(pkg.value.files.includes(manifestPath.value) ? manifestPath.value : pkg.value.files[0])
    }
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
}

const setTab = async (next) => {
  if (next === tab.value) return
  // the studio keeps its edits in itself: leaving it throws them away, so ask first
  if (tab.value === 'studio' && studioDirty.value && !(await ask(t('modules.discard_changes'), { danger: true, accept: t('modules.discard') }))) return
  const from = tab.value
  studioDirty.value = false
  tab.value = next
  if (from === 'studio' && next === 'files') await load({ keepFile: true })
}

const onStudioSaved = async () => {
  report.value = null
  notify({ type: 'positive', message: t('modules.studio_saved'), timeout: 2500 })
  await load({ keepFile: true })
}

const selectFile = async (target) => {
  if (target === path.value || !(await confirmDiscard())) return
  actionError.value = null
  await loadFile(target)
}

const save = async () => {
  if (mode.value === 'studio') return studio.value?.save()
  if (!fileDirty.value || saving.value) return
  saving.value = true
  actionError.value = null
  try {
    await packageService.saveFile({ kind: props.kind, id: props.id, path: path.value, content: content.value })
    original.value = content.value
    report.value = null
    notify({ type: 'positive', message: t('modules.saved', { path: path.value }), timeout: 2500 })
    await load({ keepFile: true })
  } catch (e) {
    actionError.value = describeError(e, t).message
  } finally {
    saving.value = false
  }
}

const addFile = async () => {
  const target = newFile.value.trim()
  if (!target || !(await confirmDiscard())) return
  actionError.value = null
  try {
    await packageService.saveFile({ kind: props.kind, id: props.id, path: target, content: '' })
    newFile.value = ''
    await load({ keepFile: true })
    await loadFile(target)
  } catch (e) {
    actionError.value = describeError(e, t).message
  }
}

const removeFile = async (target) => {
  if (target === manifestPath.value || !(await ask(t('modules.confirm_delete_file', { path: target }), { danger: true, accept: t('labels.delete') }))) return
  actionError.value = null
  try {
    await packageService.deleteFile({ kind: props.kind, id: props.id, path: target })
    await load()
  } catch (e) {
    actionError.value = describeError(e, t).message
  }
}

const check = async () => {
  checking.value = true
  actionError.value = null
  failures.value = []
  try {
    report.value = await packageService.check({ kind: props.kind, id: props.id })
  } catch (e) {
    actionError.value = describeError(e, t).message
  } finally {
    checking.value = false
  }
}

const publish = async () => {
  if (dirty.value && !(await ask(t('modules.publish_unsaved'), { accept: t('modules.publish') }))) return
  publishing.value = true
  actionError.value = null
  failures.value = []
  try {
    const result = await packageService.publish({ kind: props.kind, id: props.id, bump: bump.value })
    report.value = result.report
    notify({ type: 'positive', message: t('modules.published', { name: pkg.value.name, version: result.version }) })
    bump.value = null
    await load({ keepFile: true })
    if (path.value === manifestPath.value) await loadFile(path.value)
  } catch (e) {
    const described = describeError(e, t)
    actionError.value = described.message
    failures.value = described.diagnostics
  } finally {
    publishing.value = false
  }
}

const onKeydown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    save()
  }
}

const onBeforeUnload = (event) => {
  if (dirty.value) event.preventDefault()
}

watch(() => [props.kind, props.id], () => { report.value = null; tab.value = defaultTab(); load() })
const loadRegistry = async () => {
  try {
    const [modules, metamodels] = await Promise.all([packageService.list({ kind: 'module' }), packageService.list({ kind: 'metamodel' })])
    registry.value = { module: modules, metamodel: metamodels }
  } catch {
    // the form still works with what is written: the names are just the last part of the location
  }
}

onMounted(() => {
  load()
  loadRegistry()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <ModulePage
    class="package"
    :crumbs="[
      { label: $t('labels.dashboard'), to: '/' },
      { label: $t(kind === 'module' ? 'modules.modules' : 'modules.metamodels'), to: listPathOf(kind) },
      { label: pkg?.name ?? '…' },
    ]"
    :back="listPathOf(kind)"
  >
    <template v-if="pkg" #head>
      <div class="package__title-row">
        <span class="package__icon" aria-hidden="true"><i :class="kind === 'module' ? 'pi pi-box' : 'pi pi-sitemap'" /></span>
        <h1 class="package__h1">{{ pkg.name }}</h1>
        <Tag severity="info" :value="$t(kind === 'module' ? 'modules.module' : 'modules.metamodel')" />
        <Tag v-if="pkg.latest" severity="secondary" :value="`v${pkg.latest}`" class="package__version" />
        <Tag v-else severity="warn" :value="$t('modules.unpublished')" />
        <Tag v-if="dirty" severity="warn" icon="pi pi-pencil" :value="$t('modules.unsaved')" />
      </div>
      <span v-if="pkg.description || pkg.manifest?.description" class="package__desc">{{ pkg.description || pkg.manifest?.description }}</span>
      <span class="package__meta ident">{{ pkg.location }}</span>
    </template>
    <template v-if="pkg" #actions>
      <Button v-if="pkg.webUrl" as="a" :href="pkg.webUrl" target="_blank" rel="noopener" text size="small" icon="pi pi-external-link" :label="$t('modules.open_on_host')" />
      <Button size="small" icon="pi pi-cloud-upload" :label="$t('modules.go_release')" @click="setTab('release')" />
    </template>

    <ConfirmDialog />
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading" height="240px" />

    <template v-if="pkg">
      <Message v-if="pkg.manifestError" severity="warn" :closable="false">
        {{ manifestPath }}: {{ pkg.manifestError }}
      </Message>

      <div class="package__tabbar">
        <Tabs :value="tab" class="package__tabs" @update:value="setTab">
          <TabList>
            <Tab value="summary">{{ $t('modules.tab_summary') }}</Tab>
            <Tab v-if="kind === 'metamodel'" value="studio">{{ $t('modules.studio') }}</Tab>
            <Tab value="files">{{ $t('modules.files') }} <Badge :value="pkg.files.length" severity="secondary" class="package__tabcount" /></Tab>
            <Tab value="release">{{ $t('modules.tab_release') }}</Tab>
            <Tab v-for="item in pluginTabs" :key="item.key" :value="item.key" :name="`package-tab-${item.id}`">{{ item.label ? localized(item.label, $i18n.locale) : item.plugin }}</Tab>
          </TabList>
        </Tabs>
        <div v-if="tab === 'studio'" class="package__tabactions">
          <Button text size="small" icon="pi pi-undo" :label="$t('modules.studio_discard')" :disabled="!studioDirty || studio?.saving" @click="studio?.discard()" />
          <Button size="small" icon="pi pi-save" :label="$t('labels.save')" :disabled="!studioDirty" :loading="studio?.saving" @click="studio?.save()" />
        </div>
      </div>

      <div v-show="tab === 'summary'" class="package__panel">
        <Panel v-if="pkg.manifest" class="card package__declaration" :header="$t('modules.declaration')">
          <ManifestEditor :kind="kind" :id="id" :pkg="{ location: pkg.location, manifest: pkg.manifest, files: pkg.files }" :registry="registry" @saved="load({ keepFile: true }).then(() => path === manifestPath && loadFile(manifestPath))" />
        </Panel>

        <Panel class="card package__usage" :header="$t('modules.used_by')">
          <PackageUsage :kind="kind" :id="id" :location="pkg.location" :versions="pkg.versions ?? []" :latest="pkg.latest" />
        </Panel>
      </div>

      <div v-if="tab === 'studio'" class="package__panel">
        <MetamodelStudio
          :key="`${kind}/${id}`"
          ref="studio"
          :kind="kind"
          :id="id"
          @dirty="studioDirty = $event"
          @saved="onStudioSaved"
        />
      </div>

      <div v-show="tab === 'files'" class="package__panel package__body">
        <Panel class="card package__files" :header="$t('modules.files')" :aria-label="$t('modules.files')">
          <FileTree :files="pkg.files" :active="path" :pinned="manifestPath" :featured="featured" @select="selectFile" @remove="removeFile" />
          <form class="package__new" @submit.prevent="addFile">
            <InputText v-model="newFile" size="small" :placeholder="$t('modules.new_file_placeholder')" :aria-label="$t('modules.new_file')" />
            <Button type="submit" size="small" icon="pi pi-plus" :aria-label="$t('modules.new_file')" :disabled="!newFile.trim()" />
          </form>
        </Panel>

        <Panel class="card package__editor">
          <template #header>
            <div class="package__editor-bar">
              <i class="pi pi-file" aria-hidden="true" />
              <span class="ident">{{ path }}</span>
              <Tag v-if="fileDirty" severity="warn" :value="$t('modules.unsaved')" />
              <Button
                size="small"
                :label="$t('labels.save')"
                icon="pi pi-save"
                :disabled="!fileDirty"
                :loading="saving"
                @click="save"
              />
            </div>
          </template>
          <Skeleton v-if="loadingFile" height="320px" />
          <Textarea
            v-else
            v-model="content"
            class="package__textarea ident"
            spellcheck="false"
            :aria-label="path ?? ''"
            :disabled="path === null"
            fluid
          />
        </Panel>
      </div>

      <template v-for="item in pluginTabs" :key="item.key">
        <div v-if="visitedPluginTabs.has(item.key)" v-show="tab === item.key" class="package__panel">
          <component :is="item.component" :kind="kind" :package-id="id" :pkg="pkg" />
        </div>
      </template>

      <section v-show="tab === 'release'" class="package__panel package__release">
        <Panel class="card package__versions-block" :header="$t('modules.versions')">
          <ul v-if="pkg.versions.length" role="list" class="package__versions">
            <li v-for="version in pkg.versions" :key="version"><Tag severity="secondary" :value="`v${version}`" class="package__version" /></li>
          </ul>
          <p v-else class="package__unpublished">{{ $t('modules.versions_none') }}</p>
        </Panel>

        <Panel class="card package__release-bar" :header="$t('modules.release')">
          <p class="package__release-hint">{{ $t('modules.publish_hint') }}</p>
          <div class="package__release-actions">
            <Button
              outlined
              :label="$t('modules.check')"
              icon="pi pi-check-square"
              :loading="checking"
              @click="check"
            />
            <Select
              v-model="bump"
              :options="bumpOptions"
              option-value="value"
              option-label="label"
              :placeholder="$t('modules.bump_none')"
              :aria-label="$t('modules.bump_none')"
              class="package__bump"
            />
            <Button
              :label="$t('modules.publish')"
              icon="pi pi-cloud-upload"
              :loading="publishing"
              :disabled="!!pkg.manifestError || blocking.length > 0"
              :title="blocking.length ? $t('modules.publish_blocked') : undefined"
              name="package-publish"
              @click="publish"
            />
          </div>
        </Panel>

        <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>

        <Panel v-if="checklist.length" class="card package__checklist" :header="$t('modules.checklist')">
          <ul role="list" class="package__checks" name="package-checklist">
            <li v-for="entry in checklist" :key="entry.id" class="package__check" :class="`package__check--${entry.status}`" :data-check="entry.id" :data-status="entry.status">
              <i class="pi" :class="ICONS[entry.status]" aria-hidden="true" />
              <span>{{ itemText(entry) }}</span>
            </li>
          </ul>
        </Panel>

        <template v-if="report">
          <Message :severity="report.ok ? 'success' : 'error'" :closable="false">
            {{ report.ok ? $t('modules.check_ok') : $t('modules.check_failed') }}
          </Message>
          <Panel v-if="report.resolved?.length" class="card package__resolved" :header="$t('modules.resolved')">
            <ul role="list">
              <li v-for="r in report.resolved" :key="r.location">
                <span class="ident package__resolved-name">{{ r.name }}</span>
                <Tag severity="secondary" :value="`v${r.version}`" class="package__version" />
                <Tag severity="info" :value="$t(r.kind === 'module' ? 'modules.module' : 'modules.metamodel')" />
              </li>
            </ul>
          </Panel>
        </template>
        <DiagnosticList :diagnostics="diagnostics" />
      </section>
    </template>
  </ModulePage>
</template>

<style scoped>
/* every block of the page is a PrimeVue Panel lifted off the page, its header a tinted band */
.card {
  --p-panel-border-color: var(--p-content-border-color); --p-panel-border-radius: 10px;
  --p-panel-header-padding: 8px 14px; --p-panel-content-padding: 12px 14px 14px; --p-panel-header-background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-content-hover-background));
  --p-panel-header-border-color: var(--p-content-border-color); --p-panel-header-border-width: 0 0 1px 0;
  --p-panel-background: var(--p-content-background); --p-panel-toggleable-header-padding: 8px 14px;
  box-shadow: var(--card-shadow); min-width: 0; overflow: hidden;
}
.card :deep(.p-panel-title) { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--p-text-muted-color); }

.package__title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.package__icon { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 9px; background: color-mix(in srgb, var(--p-primary-color) 16%, var(--p-content-background)); border: 1px solid color-mix(in srgb, var(--p-primary-color) 35%, var(--p-content-border-color)); color: var(--p-primary-color); font-size: 16px; }
.package__h1 { margin: 0 4px 0 0; font-family: var(--font-sans); font-weight: 400; font-size: 24px; overflow-wrap: anywhere; }
.package__version { font-family: var(--font-mono, monospace); }
.package__meta { font-size: 12px; color: var(--p-text-faint-color); }
.package__desc { font-size: 13px; color: var(--p-text-secondary-color); max-width: 80ch; }
.package__unpublished { font-size: 12px; color: var(--p-text-muted-color); margin: 0; }
.package__tabcount { margin-left: 6px; }
.package__tabbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-right: 12px; background: var(--p-content-background); border-bottom: 1px solid var(--p-content-border-color); }
/* the bar, not the tab list, carries the surface: the buttons on its right sit on the same background */
.package__tabs { --p-tabs-tablist-background: transparent; --p-tabs-tablist-border-color: transparent; --p-tabs-tablist-border-width: 0 0 1px 0; margin-bottom: -1px; flex: 1 1 320px; min-width: 0; }
.package__tabactions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.package__panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.package__body { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 12px; align-items: start; }
.package__files { position: sticky; top: 8px; --p-panel-content-padding: 10px; }
.package__new { display: flex; gap: 6px; margin: 10px 0 0; }
.package__new :deep(input) { flex: 1; min-width: 0; }
.package__versions { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.package__editor { --p-panel-content-padding: 0; --p-panel-header-padding: 6px 10px 6px 14px; }
.package__editor :deep(.p-panel-header) { width: 100%; }
.package__editor-bar { display: flex; align-items: center; gap: 8px; width: 100%; font-size: 12px; min-width: 0; }
.package__editor-bar .ident { flex: 1; min-width: 0; color: var(--p-text-secondary-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.package__textarea { min-height: 520px; border: 0; border-radius: 0; background: var(--p-surface-ground); font-size: 13px; line-height: 1.5; tab-size: 2; white-space: pre; resize: vertical; display: block; }
.package__release-bar { border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--p-content-border-color)); }
.package__release-bar :deep(.p-panel-content) { display: flex; align-items: center; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; }
.package__release-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.package__bump { width: 290px; }
.package__checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.package__check { display: flex; align-items: flex-start; gap: 8px; font-size: 0.875rem; overflow-wrap: anywhere; }
.package__check .pi { margin-top: 3px; }
.package__check--pass .pi { color: var(--status-good, #2a9d6f); }
.package__check--warn .pi { color: var(--status-warn, #d99a1b); }
.package__check--fail .pi { color: var(--status-bad, #d33); }
.package__release-hint { flex: 1 1 360px; margin: 0; font-size: 12px; color: var(--p-text-muted-color); max-width: 80ch; }
.package__resolved ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(180px, max-content) max-content max-content; justify-content: start; align-items: center; gap: 6px 16px; font-size: 13px; }
.package__resolved li { display: contents; }
@media (max-width: 900px) { .package__body { grid-template-columns: 1fr; } .package__files { position: static; } }
</style>
