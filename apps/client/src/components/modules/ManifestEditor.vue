<script setup>
import { ref, computed, watch } from 'vue'
import packageService from 'src/services/packageService'
import { notify } from 'src/composables/useNotify'
import { describeError } from './describeError'
import { nameOfLocation, relativeReference, resolveReference } from './locations'
import { pathOf } from './packageRoutes'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Badge from 'primevue/badge'
import Tag from 'primevue/tag'
import { useT } from 'src/composables/useT'

/**
 * What a package declares about itself, as a form: the metamodels (and, for a module, the modules) it needs, and the models it offers.
 * It writes `.linea/module.json` / `metamodel.json`; the manifest is the one source of truth, and this is a way to edit it without knowing its shape.
 *
 * A module declares the metamodels it wants. An SPL made of modules is valid when the metamodels of all of them compose, so this is
 * where a module says what its models are written in.
 */
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [String, Number], required: true },
  // { location, manifest, files }
  pkg: { type: Object, required: true },
  // the packages of the registry: { module: [...], metamodel: [...] }, each { location, name, latest }
  registry: { type: Object, default: () => ({ module: [], metamodel: [] }) },
})
const emit = defineEmits(['saved'])

const t = useT()

const isModule = computed(() => props.kind === 'module')
const manifestPath = computed(() => (isModule.value ? '.linea/module.json' : 'metamodel.json'))
const from = computed(() => props.pkg.location)

const rowsOf = (record) =>
  Object.entries(record ?? {}).map(([reference, range]) => ({ location: resolveReference(from.value, reference), range }))

const draftOf = (manifest) => ({
  metamodels: rowsOf(isModule.value ? manifest.requires?.metamodels : manifest.requires),
  modules: isModule.value ? rowsOf(manifest.requires?.modules) : [],
  offers: isModule.value ? Object.entries(manifest.offers ?? {}).map(([metamodel, path]) => ({ metamodel, path })) : [],
})

const draft = ref(draftOf(props.pkg.manifest))
const addingMetamodel = ref(null)
const addingModule = ref(null)
const saving = ref(false)
const error = ref(null)

/** The manifest this form describes: what is written to GitLab. */
const manifestFor = (d) => {
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [relativeReference(from.value, r.location), (r.range ?? '').trim() || '*']))
  if (!isModule.value) return { ...props.pkg.manifest, requires: toMap(d.metamodels) }
  return {
    ...props.pkg.manifest,
    requires: { modules: toMap(d.modules), metamodels: toMap(d.metamodels) },
    offers: Object.fromEntries(d.offers.filter((o) => o.metamodel && o.path).map((o) => [o.metamodel, o.path])),
  }
}

const written = computed(() => JSON.stringify(manifestFor(draft.value)))
const original = computed(() => JSON.stringify(manifestFor(draftOf(props.pkg.manifest))))
const dirty = computed(() => written.value !== original.value)

watch(() => props.pkg.manifest, (manifest) => { draft.value = draftOf(manifest) })

const known = (kind, location) => (props.registry[kind] ?? []).find((p) => p.location === location)
const nameOf = (kind, location) => known(kind, location)?.name ?? nameOfLocation(location)
const optionsFor = (kind, rows) =>
  (props.registry[kind] ?? []).filter((p) => p.location !== from.value && !rows.some((r) => r.location === p.location))

const add = (kind, rows, location) => {
  const pkg = known(kind, location)
  if (!pkg) return
  rows.push({ location, range: pkg.latest ? `^${pkg.latest}` : '*' })
}
const addMetamodel = () => { add('metamodel', draft.value.metamodels, addingMetamodel.value); addingMetamodel.value = null }
const addModule = () => { add('module', draft.value.modules, addingModule.value); addingModule.value = null }
const remove = (rows, index) => rows.splice(index, 1)

// what a module may offer a model of: the metamodels it declares; and where its models are
const offerableMetamodels = computed(() => [...new Set(draft.value.metamodels.map((r) => nameOf('metamodel', r.location)))])
const modelFiles = computed(() => (props.pkg.files ?? []).filter((f) => f.startsWith('models/')))
// a module offers one model of each metamodel
const notYetOffered = computed(() => offerableMetamodels.value.filter((name) => !draft.value.offers.some((o) => o.metamodel === name)))
const addOffer = () => {
  const metamodel = notYetOffered.value[0]
  if (!metamodel) return
  const named = modelFiles.value.find((f) => f.includes(metamodel))
  draft.value.offers.push({ metamodel, path: named ?? modelFiles.value[0] ?? `models/${metamodel}.instance` })
}

const save = async () => {
  saving.value = true
  error.value = null
  try {
    await packageService.saveFile({
      kind: props.kind,
      id: props.id,
      path: manifestPath.value,
      content: `${JSON.stringify(manifestFor(draft.value), null, 2)}\n`,
      message: `Declare what ${props.pkg.manifest.name} needs`,
    })
    notify({ type: 'positive', message: t('modules.declaration_saved'), timeout: 2500 })
    emit('saved')
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="decl" :aria-label="$t('modules.declaration')">
    <div class="decl__grid">
      <div class="decl__block">
        <h3><i class="pi pi-sitemap" aria-hidden="true" />{{ $t('modules.needs_metamodels') }} <Badge :value="draft.metamodels.length" severity="secondary" /></h3>
        <ul v-if="draft.metamodels.length" role="list" class="rows">
          <li v-for="(row, index) in draft.metamodels" :key="row.location" class="row">
            <router-link v-if="known('metamodel', row.location)" :to="pathOf('metamodel', known('metamodel', row.location).id)" class="row__name row__link ident">{{ nameOf('metamodel', row.location) }}</router-link>
            <span v-else class="row__name ident">{{ nameOf('metamodel', row.location) }} <Tag severity="warn" :value="$t('modules.not_in_registry')" /></span>
            <InputText v-model="row.range" size="small" class="row__range ident" :aria-label="$t('modules.versions_accepted')" />
            <Button text rounded size="small" severity="secondary" icon="pi pi-times" :aria-label="$t('labels.delete')" @click="remove(draft.metamodels, index)" />
          </li>
        </ul>
        <p v-else class="decl__empty">{{ $t(isModule ? 'modules.needs_no_metamodels' : 'modules.needs_nothing') }}</p>
        <div class="add">
          <Select
            v-model="addingMetamodel"
            :options="optionsFor('metamodel', draft.metamodels)"
            option-value="location"
            option-label="name"
            filter
            size="small"
            :placeholder="$t('modules.add_metamodel')"
            :empty-message="$t('modules.no_metamodels')"
            class="add__select"
          />
          <Button size="small" icon="pi pi-plus" :aria-label="$t('modules.add')" :disabled="!addingMetamodel" name="add-metamodel" @click="addMetamodel" />
        </div>
      </div>

      <div v-if="isModule" class="decl__block">
        <h3><i class="pi pi-box" aria-hidden="true" />{{ $t('modules.needs_modules') }} <Badge :value="draft.modules.length" severity="secondary" /></h3>
        <ul v-if="draft.modules.length" role="list" class="rows">
          <li v-for="(row, index) in draft.modules" :key="row.location" class="row">
            <router-link v-if="known('module', row.location)" :to="pathOf('module', known('module', row.location).id)" class="row__name row__link ident">{{ nameOf('module', row.location) }}</router-link>
            <span v-else class="row__name ident">{{ nameOf('module', row.location) }} <Tag severity="warn" :value="$t('modules.not_in_registry')" /></span>
            <InputText v-model="row.range" size="small" class="row__range ident" :aria-label="$t('modules.versions_accepted')" />
            <Button text rounded size="small" severity="secondary" icon="pi pi-times" :aria-label="$t('labels.delete')" @click="remove(draft.modules, index)" />
          </li>
        </ul>
        <p v-else class="decl__empty">{{ $t('modules.needs_no_modules') }}</p>
        <div class="add">
          <Select
            v-model="addingModule"
            :options="optionsFor('module', draft.modules)"
            option-value="location"
            option-label="name"
            filter
            size="small"
            :placeholder="$t('modules.add_module')"
            :empty-message="$t('modules.no_modules')"
            class="add__select"
          />
          <Button size="small" icon="pi pi-plus" :aria-label="$t('modules.add')" :disabled="!addingModule" name="add-module" @click="addModule" />
        </div>
      </div>

      <div v-if="isModule" class="decl__block">
        <h3><i class="pi pi-upload" aria-hidden="true" />{{ $t('modules.offers') }} <Badge :value="draft.offers.length" severity="secondary" /></h3>
        <ul v-if="draft.offers.length" role="list" class="rows">
          <li v-for="(offer, index) in draft.offers" :key="index" class="row row--offer">
            <Select v-model="offer.metamodel" :options="offerableMetamodels.filter((name) => name === offer.metamodel || notYetOffered.includes(name))" size="small" class="row__select" :aria-label="$t('modules.metamodel')" />
            <Select v-model="offer.path" :options="modelFiles" editable size="small" class="row__select ident" :aria-label="$t('modules.files')" />
            <Button text rounded size="small" severity="secondary" icon="pi pi-times" :aria-label="$t('labels.delete')" @click="remove(draft.offers, index)" />
          </li>
        </ul>
        <p v-else class="decl__empty">{{ $t('modules.offers_nothing') }}</p>
        <Button text size="small" class="add__offer" icon="pi pi-plus" :label="$t('modules.add_offer')" :disabled="!notYetOffered.length" name="add-offer" @click="addOffer" />
      </div>
    </div>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <div v-if="dirty || saving" class="decl__bar">
      <Tag severity="warn" icon="pi pi-pencil" :value="$t('modules.declaration_unsaved')" />
      <Button size="small" icon="pi pi-save" :label="$t('modules.save_declaration')" :disabled="!dirty" :loading="saving" name="save-declaration" @click="save" />
    </div>
  </section>
</template>

<style scoped>
/* three columns split by hairlines instead of three boxes; the save bar only shows when there is something to save */
.decl { display: flex; flex-direction: column; gap: 12px; }
.decl__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0; margin: -2px -14px 0; }
.decl__block { display: flex; flex-direction: column; gap: 8px; padding: 2px 14px; min-width: 0; border-left: 1px solid var(--p-content-border-color); }
.decl__block:first-child { border-left: 0; }
.decl__block h3 { margin: 0 0 2px; display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: .06em; }
.decl__block h3 i { color: var(--p-primary-color); font-size: 12px; }
.decl__empty { margin: 0; font-size: 12px; color: var(--p-text-faint-color); }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 6px; padding: 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--p-content-border-color) 60%, transparent); }
.row__name { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__link { color: var(--p-primary-color); text-decoration: none; }
.row__link:hover { text-decoration: underline; }
.row__range { width: 92px; }
.row__select { flex: 1; min-width: 0; }
.add { display: flex; gap: 6px; margin-top: 2px; }
.add__select { flex: 1; min-width: 0; }
.add__offer { align-self: flex-start; }
.decl__bar { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 10px; border-top: 1px solid var(--p-content-border-color); }
@media (max-width: 600px) {
  .row--offer { flex-wrap: wrap; }
  .row--offer .row__select { flex: 1 1 calc(100% - 40px); }
}
@media (max-width: 1000px) {
  .decl__grid { margin: 0; row-gap: 14px; }
  .decl__block { padding: 0; border-left: 0; }
  .decl__block + .decl__block { padding-top: 14px; border-top: 1px solid var(--p-content-border-color); }
}
</style>
