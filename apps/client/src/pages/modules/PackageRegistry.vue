<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { pathOf } from 'components/modules/packageRoutes'
import { useRoute, useRouter } from 'vue-router'
import packageService from 'src/services/packageService'
import lineService from 'src/services/lineService'
import { notify } from 'src/composables/useNotify'
import { readSnapshot, writeSnapshot } from 'src/utils/localSnapshot'
import PageHeader from 'components/layout/PageHeader.vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ConfirmPopup from 'primevue/confirmpopup'
import { useConfirm } from 'primevue/useconfirm'
import Checkbox from 'primevue/checkbox'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import { useT } from 'src/composables/useT'

const t = useT()
const router = useRouter()
const route = useRoute()
const confirm = useConfirm()

// one registry page per kind: modules and metamodels are different things, with their own list, columns and way to be made
const props = defineProps({ kind: { type: String, required: true, validator: (v) => ['module', 'metamodel'].includes(v) } })
const kind = computed(() => props.kind)
const items = ref([])
const loading = ref(false)
const error = ref(null)
const search = ref('')


const showCreate = ref(false)
const creating = ref(false)
const createError = ref(null)
const form = ref({ name: '', description: '', namespaceId: null, register: true })
const namespaces = ref([])

// the registry: with one, only registered packages are listed and a package is added by registering it
const registry = ref({ configured: false, location: null })
const showRegister = ref(false)
const registering = ref(false)
const registerError = ref(null)
const registerLocation = ref('')
const suggestions = ref([])

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? items.value.filter((p) => `${p.name} ${p.path} ${p.description}`.toLowerCase().includes(q)) : items.value
})

// the last list of each kind is drawn at once while the real one is asked for: the registry reads many repositories, which takes seconds
const load = async () => {
  const asked = kind.value
  const kept = readSnapshot(`packages.${asked}`)
  if (kept && !items.value.length) items.value = kept
  loading.value = !items.value.length
  error.value = null
  try {
    const found = await packageService.list({ kind: asked })
    if (asked !== kind.value) return
    items.value = found
    writeSnapshot(`packages.${asked}`, found)
  } catch (e) {
    if (asked !== kind.value) return
    items.value = []
    error.value = e.response?.data?.error ?? e.message
  } finally {
    if (asked === kind.value) loading.value = false
  }
}

// a package of GitHub is read-only here: it is edited and published on GitHub; one that cannot be reached cannot be opened
const open = (pkg) => {
  if (pkg.unavailable) return
  return pkg.readOnly ? window.open(pkg.webUrl, '_blank', 'noopener') : router.push(pathOf(pkg.kind, pkg.id))
}

const loadStatus = async () => {
  const kept = readSnapshot('registry.status')
  if (kept) registry.value = kept
  try {
    registry.value = await packageService.registryStatus()
    writeSnapshot('registry.status', registry.value)
  } catch { /* without it, packages are listed as they always were */ }
}

const openRegister = async () => {
  registerLocation.value = ''
  registerError.value = null
  suggestions.value = []
  showRegister.value = true
  try { suggestions.value = await packageService.registrySuggestions({ kind: kind.value }) } catch { /* the location can still be typed */ }
}

const register = async (location) => {
  registering.value = true
  registerError.value = null
  try {
    const entry = await packageService.register({ location })
    showRegister.value = false
    notify({ type: 'positive', message: t('modules.registered', { name: entry.name }) })
    await load()
  } catch (e) {
    registerError.value = e.response?.data?.detail ?? e.response?.data?.error ?? e.message
  } finally {
    registering.value = false
  }
}

// removing from the registry asks first: one stray click on a card should not drop a package from the list
const askUnregister = (event, pkg) => confirm.require({
  target: event.currentTarget,
  message: t('modules.confirm_unregister', { name: pkg.name }),
  icon: 'pi pi-exclamation-triangle',
  acceptLabel: t('modules.unregister_short'),
  rejectLabel: t('labels.cancel'),
  acceptProps: { severity: 'danger', size: 'small' },
  rejectProps: { severity: 'secondary', text: true, size: 'small' },
  accept: () => unregister(pkg),
})

const unregister = async (pkg) => {
  try {
    await packageService.unregister({ location: pkg.location })
    notify({ type: 'positive', message: t('modules.unregistered', { name: pkg.name }) })
    await load()
  } catch (e) {
    error.value = e.response?.data?.error ?? e.message
  }
}

const openCreate = async () => {
  form.value = { name: '', description: '', namespaceId: null, register: true }
  createError.value = null
  showCreate.value = true
  if (!namespaces.value.length) {
    try { namespaces.value = await lineService.findAvailableNamespaces() } catch { /* the package can still go to the user's own namespace */ }
  }
}

watch(() => route.query.new, (wanted) => {
  if (!wanted) return
  openCreate()
  const { new: _new, ...rest } = route.query
  router.replace({ query: rest })
}, { immediate: true })

const create = async () => {
  creating.value = true
  createError.value = null
  try {
    const pkg = await packageService.create({ kind: kind.value, ...form.value, register: registry.value.configured && form.value.register })
    showCreate.value = false
    notify({ type: 'positive', message: t('modules.created', { name: pkg.name }) })
    open(pkg)
  } catch (e) {
    createError.value = e.response?.data?.error ?? e.message
  } finally {
    creating.value = false
  }
}

watch(kind, () => { items.value = []; load() })
onMounted(() => Promise.all([loadStatus(), load()]))
</script>

<template>
  <div class="registry">
    <PageHeader compact :title="$t(kind === 'module' ? 'modules.modules' : 'modules.metamodels')">
      <template #actions>
        <Button
          v-if="registry.configured"
          outlined
          icon="pi pi-bookmark"
          :label="$t('modules.register')"
          @click="openRegister"
        />
        <Button
          :label="kind === 'module' ? $t('modules.new_module') : $t('modules.new_metamodel')"
          icon="pi pi-plus"
          @click="openCreate"
        />
      </template>
    </PageHeader>

    <div v-if="items.length > 1" class="registry__bar">
      <IconField class="registry__search">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" :placeholder="$t('modules.filter')" :aria-label="$t('modules.filter')" fluid />
      </IconField>
      <span class="registry__count" aria-live="polite">{{ $t('modules.results', { shown: filtered.length, total: items.length }) }}</span>
    </div>

    <Message v-if="error" severity="error" :closable="false">{{ $t(error) }}</Message>

    <div v-if="loading" class="registry__list">
      <Skeleton v-for="n in 8" :key="n" height="112px" />
    </div>

    <ul v-else-if="filtered.length" class="registry__list" role="list">
      <li v-for="pkg in filtered" :key="pkg.location ?? pkg.id" class="pkg-row">
        <Card
          class="pkg"
          :class="{ 'pkg--unavailable': pkg.unavailable }"
          :role="pkg.unavailable ? undefined : 'link'"
          :tabindex="pkg.unavailable ? -1 : 0"
          @click="open(pkg)"
          @keydown.enter="open(pkg)"
        >
          <template #header>
            <div class="pkg__top">
              <span class="pkg__icon" aria-hidden="true"><i :class="kind === 'module' ? 'pi pi-box' : 'pi pi-sitemap'" /></span>
              <span class="pkg__name">{{ pkg.name }}</span>
              <Tag v-if="pkg.unavailable" severity="danger" :value="$t('modules.unavailable')" />
              <Tag v-else-if="pkg.latest" severity="secondary" :value="`v${pkg.latest}`" class="pkg__version ident" />
              <Tag v-else severity="warn" :value="$t('modules.unpublished')" />
            </div>
          </template>
          <template #content>
            <p class="pkg__desc" :class="{ 'pkg__desc--none': !pkg.description }">{{ pkg.description || '—' }}</p>
          </template>
          <template #footer>
            <div class="pkg__foot">
              <span class="pkg__path ident">{{ pkg.path }}</span>
              <Tag v-if="pkg.host === 'github'" severity="contrast" icon="pi pi-github" value="GitHub" />
              <span v-if="pkg.versions.length > 1" class="pkg__count">{{ $t('modules.n_versions', { n: pkg.versions.length }) }}</span>
              <i :class="pkg.readOnly ? 'pi pi-external-link pkg__go' : 'pi pi-arrow-right pkg__go'" aria-hidden="true" />
            </div>
          </template>
        </Card>
        <Button
          v-if="registry.configured"
          text
          rounded
          size="small"
          severity="secondary"
          icon="pi pi-times"
          :aria-label="$t('modules.unregister')"
          :title="$t('modules.unregister')"
          class="pkg-row__remove"
          @click="askUnregister($event, pkg)"
        />
      </li>
    </ul>

    <div v-else-if="!error && items.length" class="registry__empty">
      <i class="pi pi-search" aria-hidden="true" />
      <p>{{ $t('modules.no_match', { q: search }) }}</p>
      <Button text size="small" :label="$t('modules.clear_search')" @click="search = ''" />
    </div>

    <div v-else-if="!error" class="registry__empty">
      <i :class="kind === 'module' ? 'pi pi-box' : 'pi pi-sitemap'" aria-hidden="true" />
      <p>{{ registry.configured ? $t('modules.nothing_registered') : $t(kind === 'module' ? 'modules.no_modules' : 'modules.no_metamodels') }}</p>
      <Button :label="kind === 'module' ? $t('modules.new_module') : $t('modules.new_metamodel')" icon="pi pi-plus" size="small" @click="openCreate" />
    </div>

    <ConfirmPopup />

    <Dialog
      v-model:visible="showCreate"
      modal
      :header="kind === 'module' ? $t('modules.new_module') : $t('modules.new_metamodel')"
      :style="{ width: '32rem' }"
    >
      <form class="create" @submit.prevent="create">
        <Message v-if="createError" severity="error" :closable="false">{{ $t(createError) }}</Message>
        <label class="create__field">
          <span>{{ $t('labels.name') }}</span>
          <InputText v-model="form.name" required autofocus pattern="[a-zA-Z0-9_.\-]+" />
          <small>{{ $t('modules.name_hint') }}</small>
        </label>
        <label class="create__field">
          <span>{{ $t('labels.description') }}</span>
          <InputText v-model="form.description" />
        </label>
        <label class="create__field">
          <span>{{ $t('labels.gitlab_namespace') }}</span>
          <Select
            v-model="form.namespaceId"
            :options="namespaces"
            option-value="id"
            option-label="fullPath"
            show-clear
            :placeholder="$t('modules.own_namespace')"
          />
        </label>
        <label v-if="registry.configured" class="create__check">
          <Checkbox v-model="form.register" binary input-id="register-on-create" />
          <span>{{ $t('modules.register_on_create') }}</span>
        </label>
        <div class="create__actions">
          <Button text type="button" :label="$t('labels.cancel')" @click="showCreate = false" />
          <Button type="submit" :label="$t('labels.create')" :loading="creating" :disabled="!form.name" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="showRegister" modal :header="$t('modules.register')" :style="{ width: '36rem' }">
      <form class="create" @submit.prevent="register(registerLocation.trim())">
        <p class="registry__hint">{{ $t('modules.register_hint', { registry: registry.location }) }}</p>
        <Message v-if="registerError" severity="error" :closable="false">{{ $te(registerError) ? $t(registerError) : registerError }}</Message>
        <label class="create__field">
          <span>{{ $t('modules.location') }}</span>
          <InputText v-model="registerLocation" :placeholder="`${registry.location?.split(':')[0] || 'gitlab'}:group/name`" class="ident" autofocus />
        </label>
        <div v-if="suggestions.length" class="create__field">
          <span>{{ $t('modules.suggestions') }}</span>
          <ul class="suggestions" role="list">
            <li v-for="s in suggestions" :key="s.location">
              <button type="button" class="suggestion" @click="registerLocation = s.location">
                <span class="ident">{{ s.location }}</span>
                <span class="pkg__unpublished">{{ s.latest ? `v${s.latest}` : $t('modules.unpublished') }}</span>
              </button>
            </li>
          </ul>
        </div>
        <div class="create__actions">
          <Button text type="button" :label="$t('labels.cancel')" @click="showRegister = false" />
          <Button type="submit" :label="$t('modules.register')" :loading="registering" :disabled="!registerLocation.trim()" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.registry { display: flex; flex-direction: column; gap: 14px; min-height: 100%; box-sizing: border-box; padding: 20px 28px 28px; }
.registry__bar { display: flex; align-items: center; gap: 14px; }
.registry__search { width: 320px; max-width: 100%; }
.registry__count { font-size: 12px; color: var(--p-text-muted-color); font-variant-numeric: tabular-nums; }
.registry__hint { margin: 0; font-size: 13px; color: var(--p-text-muted-color); max-width: 70ch; }
.registry__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
.registry__empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 56px 0; color: var(--p-text-muted-color); text-align: center; }
.registry__empty i { font-size: 28px; }
.registry__empty p { margin: 0; max-width: 46ch; }
.pkg-row { position: relative; display: flex; min-width: 0; }
.pkg {
  --p-card-body-padding: 0; --p-card-body-gap: 0; --p-card-caption-gap: 0;
  --p-card-border-radius: 10px; --p-card-shadow: var(--card-shadow);
  width: 100%; cursor: pointer; overflow: hidden; min-width: 0; border: 1px solid var(--p-content-border-color);
  transition: border-color .12s, transform .12s, box-shadow .12s;
}
.pkg:hover { border-color: var(--p-primary-color); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0, 0, 0, .28); }
.pkg:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.pkg :deep(.p-card-body) { height: 100%; }
.pkg :deep(.p-card-content) { padding: 10px 12px 6px; flex: 1; }
.pkg :deep(.p-card-footer) { padding: 4px 12px 10px; }
.pkg__top { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 12px; background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-content-hover-background)); border-bottom: 1px solid var(--p-content-border-color); }
.pkg__icon {
  flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; font-size: 13px;
  background: color-mix(in srgb, var(--p-primary-color) 16%, var(--p-content-background)); color: var(--p-primary-color);
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 35%, var(--p-content-border-color));
}
.pkg__name { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkg__version { font-family: var(--font-mono, monospace); }
.pkg__desc {
  margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--p-text-secondary-color);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 2.9em;
}
.pkg__desc--none { color: var(--p-text-faint-color); }
.pkg__foot { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; color: var(--p-text-muted-color); }
.pkg__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pkg__unpublished, .pkg__count { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; }
.pkg--unavailable { opacity: .6; cursor: default; }
.pkg__go { color: var(--p-text-faint-color); transition: transform .12s, color .12s; }
.pkg:hover .pkg__go { color: var(--p-primary-color); transform: translateX(2px); }
.pkg-row__remove { position: absolute; top: 6px; right: 6px; opacity: 0; transition: opacity .12s; }
.pkg-row:hover .pkg-row__remove, .pkg-row:focus-within .pkg-row__remove { opacity: 1; }
@media (hover: none) { .pkg-row__remove { opacity: 1; } }
.pkg-row:hover .pkg__top .p-tag, .pkg-row:focus-within .pkg__top .p-tag { visibility: hidden; }
.create { display: flex; flex-direction: column; gap: 14px; }
.create__field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.create__field small { color: var(--p-text-muted-color); }
.create__actions { display: flex; justify-content: flex-end; gap: 8px; }
.create__check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.suggestions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow: auto; }
.suggestion {
  width: 100%; display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; cursor: pointer; text-align: left;
  border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); font: inherit;
}
.suggestion:hover { background: var(--p-content-hover-background); }
</style>
