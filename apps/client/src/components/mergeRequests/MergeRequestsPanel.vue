<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Avatar from 'primevue/avatar'
import PrimeButton from 'primevue/button'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import mergeRequestService from 'src/services/mergeRequestService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { relativeShort } from 'src/utils/relativeTime'
import LabelTag from 'components/issues/LabelTag.vue'
import FilterPill from 'components/issues/FilterPill.vue'
import MergeRequestDetail from './MergeRequestDetail.vue'
import MergeRequestForm from './MergeRequestForm.vue'
import TemplatesDialog from 'components/issues/TemplatesDialog.vue'

// The merge requests of the repository of a line or of a product, the same on every git host. The address says what is open (`?mr=` a
// number for one, `new` for the form; nothing for the list). Laid out like the pipelines: a bar of controls and rows that are cards
// with the colour of how they stand. The ones LINEA opens itself (syncs and generations) can be told apart and narrowed to.
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
})
const t = useT()
const route = useRoute()
const router = useRouter()

const meta = ref(null)
const page = ref({ items: [], page: 1, perPage: 20, hasMore: false })
const loading = ref(true)
const failed = ref(false)
const creating = ref(false)
const templatesOpen = ref(false)

const state = ref('opened')
const origin = ref('all')
const search = ref('')
const author = ref('')
const reviewer = ref('')
const labels = ref([])
const pageNumber = ref(1)

const view = computed(() => {
  const wanted = String(route.query.mr ?? '')
  if (wanted === 'new') return { name: 'new' }
  return /^\d+$/.test(wanted) ? { name: 'detail', number: Number(wanted) } : { name: 'list' }
})
const open = (mr) => router.push({ query: { ...route.query, mr, mrtab: undefined } })
const back = () => {
  const { mr: _mr, mrtab: _tab, ...rest } = route.query
  router.push({ query: rest })
}

const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const caps = computed(() => meta.value?.capabilities.mergeRequests ?? {})
const ago = (at) => relativeShort(at)
const initial = (name) => String(name ?? '?').charAt(0).toUpperCase()
const colorOf = (name) => meta.value?.labels.find((label) => label.name === name)?.color
const filtered = computed(() => Boolean(search.value || author.value || reviewer.value || labels.value.length || origin.value !== 'all'))
const labelOptions = computed(() => (meta.value?.labels ?? []).map((label) => ({ value: label.name, label: label.name, color: label.color })))
const hasFilters = computed(() => Boolean(author.value || reviewer.value || labels.value.length))
const clearFilters = () => { author.value = ''; reviewer.value = ''; labels.value = [] }
const toneOf = (request) => (request.state === 'merged' ? 'merged' : request.state === 'closed' ? 'closed' : 'open')
const iconOf = (request) => (request.state === 'merged' ? 'pi pi-check-circle' : request.state === 'closed' ? 'pi pi-times-circle' : 'pi pi-circle')
const toCicd = () => router.push({ query: { tab: 'cicd' } })

const STATES = computed(() => [
  { value: 'opened', label: t('mrs.state_opened_plural') }, { value: 'merged', label: t('mrs.state_merged_plural') },
  { value: 'closed', label: t('mrs.state_closed_plural') }, { value: 'all', label: t('mrs.state_all') },
])
const ORIGINS = computed(() => [
  { value: 'all', label: t('mrs.origin_all') }, { value: 'manual', label: t('mrs.origin_manual') },
  { value: 'sync', label: t('mrs.origin_sync') }, { value: 'generation', label: t('mrs.origin_generation') },
])
const originNote = computed(() => (origin.value === 'sync' ? t('mrs.origin_hint_sync') : origin.value === 'generation' ? t('mrs.origin_hint_generation') : ''))

const load = async () => {
  loading.value = true
  failed.value = false
  try {
    page.value = await mergeRequestService.list({
      kind: props.kind, id: props.id,
      filter: { state: state.value, origin: origin.value, search: search.value.trim(), author: (author.value ?? '').trim(), reviewer: (reviewer.value ?? '').trim(), labels: labels.value, page: pageNumber.value },
    })
  } catch (error) {
    failed.value = true
    fail(error)
  } finally {
    loading.value = false
  }
}
const loadMeta = async () => {
  try { meta.value = await mergeRequestService.meta({ kind: props.kind, id: props.id }) } catch (error) { failed.value = true; loading.value = false; fail(error) }
}

onMounted(async () => { await loadMeta(); if (meta.value) await load() })
watch(() => [props.kind, props.id], async () => { meta.value = null; pageNumber.value = 1; await loadMeta(); if (meta.value) await load() })
let typing
watch([state, origin, labels], () => { pageNumber.value = 1; load() })
watch([search, author, reviewer], () => { clearTimeout(typing); typing = setTimeout(() => { pageNumber.value = 1; load() }, 300) })
watch(pageNumber, load)
watch(view, (now, before) => { if (now.name === 'list' && before?.name !== 'list' && meta.value) load() })

const create = async (fields) => {
  creating.value = true
  try {
    const made = await mergeRequestService.create({ kind: props.kind, id: props.id, ...fields })
    notify({ type: 'positive', message: t('mrs.created', { number: made.number }) })
    open(made.number)
  } catch (error) {
    fail(error)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="ln-panel">
  <div class="mrs ln-block ln-fields" name="mrs-panel">
    <div v-if="!meta && !failed" class="mrs__loading"><Skeleton height="2.4rem" /><Skeleton height="12rem" /></div>
    <div v-else-if="failed && !meta" class="mrs__empty" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('mrs.load_failed') }}
      <PrimeButton text size="small" :label="$t('labels.retry')" @click="loadMeta().then(load)" />
    </div>

    <MergeRequestDetail v-else-if="view.name === 'detail'" :kind="kind" :id="id" :number="view.number" :meta="meta" @back="back" @changed="load" />

    <div v-else-if="view.name === 'new'" class="mrs__new">
      <PrimeButton text size="small" icon="pi pi-arrow-left" class="mrs__backbtn" :label="$t('mrs.back')" @click="back" />
      <MergeRequestForm :meta="meta" :saving="creating" @save="create" @cancel="back" />
    </div>

    <template v-else>
      <div class="mrs__head">
        <Tabs :value="origin" class="mrs__tabs" @update:value="origin = $event">
          <TabList>
            <Tab v-for="entry in ORIGINS" :key="entry.value" :value="entry.value" :name="`mrs-origin-${entry.value}`">{{ entry.label }}</Tab>
          </TabList>
        </Tabs>
        <span class="mrs__spacer" />
        <span class="mrs__actions">
          <PrimeButton v-if="meta.capabilities.templates?.editable" name="mrs-templates" text size="small" icon="pi pi-file-edit" :label="$t('templates.manage')" @click="templatesOpen = true" />
          <PrimeButton name="mrs-new" size="small" icon="pi pi-plus" :label="$t('mrs.new')" @click="open('new')" />
        </span>
        <TemplatesDialog v-model:visible="templatesOpen" :kind="kind" :id="id" subject="mr" @hide="loadMeta" />
      </div>

      <div class="mrs__bar" name="mrs-bar">
        <IconField class="mrs__search">
          <InputIcon class="pi pi-search" />
          <InputText v-model="search" name="mrs-search" fluid size="small" :placeholder="$t('mrs.search')" :aria-label="$t('mrs.search')" />
        </IconField>
        <FilterPill v-model="state" name="mrs-state" :label="$t('mrs.state')" :options="STATES" :clearable="false" />
        <FilterPill v-model="author" name="mrs-author" :label="$t('mrs.filter_author')" :options="meta.members ?? []" custom />
        <FilterPill v-if="caps.reviewers" v-model="reviewer" name="mrs-reviewer" :label="$t('mrs.filter_reviewer')" :options="meta.members ?? []" custom />
        <FilterPill v-if="caps.labels && meta.labels.length" v-model="labels" name="mrs-labels" :label="$t('mrs.filter_labels')" :options="labelOptions" multiple />
        <PrimeButton v-if="hasFilters" text size="small" name="mrs-clear" :label="$t('mrs.clear_filters')" @click="clearFilters" />
      </div>
      <p v-if="originNote" class="mrs__note">{{ originNote }} <button type="button" class="ln-link" @click="toCicd">{{ $t('mrs.see_in_cicd') }}</button></p>

      <ul v-if="loading" class="mrs__list"><li v-for="n in 4" :key="n"><Skeleton height="3.6rem" /></li></ul>
      <div v-else-if="failed" class="mrs__empty" role="alert"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('mrs.load_failed') }} <PrimeButton text size="small" :label="$t('labels.retry')" @click="load" /></div>
      <div v-else-if="!page.items.length" class="mrs__empty" name="mrs-empty"><i class="pi pi-inbox" aria-hidden="true" /> {{ filtered ? $t('mrs.empty_filtered') : $t('mrs.empty') }}</div>

      <ul v-else class="mrs__list">
        <li v-for="request in page.items" :key="request.number" class="mr" :class="`mr--${toneOf(request)}`">
          <button type="button" class="mr__row" name="mr-row" @click="open(request.number)">
            <i class="mr__icon" :class="iconOf(request)" aria-hidden="true" />
            <span class="mr__main">
              <span class="mr__title">{{ request.title }}</span>
              <span class="mr__meta">
                <span class="mr__num">!{{ request.number }}</span>
                <span>{{ $t('mrs.created_by', { author: request.author ?? '?', when: ago(request.createdAt) }) }}</span>
                <span class="mr__branches"><code>{{ request.sourceBranch }}</code><i class="pi pi-arrow-right" aria-hidden="true" /><code>{{ request.targetBranch }}</code></span>
                <Tag v-if="request.origin !== 'manual'" :value="$t(`mrs.origin_tag_${request.origin}`)" severity="info" rounded />
                <LabelTag v-for="label in request.labels" :key="label" :name="label" :color="colorOf(label)" />
                <span v-if="request.hasConflicts" class="mr__conflict"><i class="pi pi-exclamation-triangle" aria-hidden="true" /></span>
              </span>
            </span>
            <span class="mr__end">
              <span v-if="request.reviewers.length" class="mr__people" :title="request.reviewers.join(', ')"><Avatar v-for="name in request.reviewers.slice(0, 3)" :key="name" :label="initial(name)" shape="circle" size="small" /></span>
              <span v-if="request.commentCount" class="mr__comments"><i class="pi pi-comment" aria-hidden="true" /> {{ request.commentCount }}</span>
              <i class="pi pi-angle-right mr__chevron" aria-hidden="true" />
            </span>
          </button>
        </li>
      </ul>

      <div v-if="!loading && (pageNumber > 1 || page.hasMore)" class="ln-actions mrs__pager">
        <span class="ln-actions__note">{{ $t('mrs.page', { page: pageNumber }) }} · {{ $t('mrs.showing', { n: page.items.length }) }}</span>
        <PrimeButton size="small" severity="secondary" outlined icon="pi pi-angle-left" :label="$t('mrs.previous')" :disabled="pageNumber <= 1" @click="pageNumber -= 1" />
        <PrimeButton size="small" severity="secondary" outlined icon="pi pi-angle-right" icon-pos="right" :label="$t('mrs.next')" :disabled="!page.hasMore" @click="pageNumber += 1" />
      </div>
    </template>
  </div>
  </div>
</template>

<style scoped>
.mrs { min-width: 0; gap: 12px; }

.mrs__loading { display: flex; flex-direction: column; gap: 12px; }
.mrs__new { display: flex; flex-direction: column; gap: 14px; }
.mrs__backbtn { align-self: flex-start; margin-left: -8px; }
.mrs__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--card-border); }
.mrs__tabs { flex: 0 1 auto; min-width: 0; }
.mrs__tabs :deep(.p-tab:first-child) { padding-left: 0; }
.mrs__tabs { --p-tabs-tablist-background: transparent; --p-tabs-tablist-border-width: 0; --p-tabs-tabpanel-background: transparent; }
.mrs__tabs :deep(.p-tab-active) { box-shadow: inset 0 -2px 0 var(--p-primary-color); color: var(--p-primary-color); }
.mrs__tabs :deep(.p-tablist),.mrs__tabs :deep(.p-tablist-content), .mrs__tabs :deep(.p-tablist-tab-list) { background: transparent; }
.mrs__tabs :deep(.p-tablist-content) { overflow-x: auto; }
.mrs__spacer { flex: 1 1 0; }
.mrs__actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.mrs__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mrs__search { flex: 0 1 15rem; min-width: 10rem; }
.mrs__note { margin: 0; font-size: 0.75rem; color: var(--text-muted); }
.mrs__empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 12px; color: var(--text-muted); font-size: 0.8125rem; }
.mrs__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--card-border); }
.mr { --tone: var(--status-ok); border-bottom: 1px solid var(--card-border); }
.mr--merged { --tone: var(--sync); }
.mr--closed { --tone: var(--status-bad); }
.mr__row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 6px; background: none; border: 0; text-align: left; color: inherit; font: inherit; font-size: 0.8125rem; cursor: pointer; }
.mr__row:hover { background: var(--p-content-hover-background); }
.mr__row:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
.mr__icon { flex: none; font-size: 1rem; color: var(--tone); align-self: flex-start; margin-top: 2px; }
.mr__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mr__title { font-size: 0.875rem; font-weight: 600; color: var(--text-heading); overflow-wrap: anywhere; }
.mr__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; font-size: 0.75rem; color: var(--text-muted); }
.mr__num { font-family: var(--font-mono, ui-monospace, monospace); }
.mr__branches { display: inline-flex; align-items: center; gap: 6px; }
.mr__branches code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.6875rem; padding: 0 6px; border-radius: 4px; background: var(--p-content-hover-background); color: var(--text-heading); }
.mr__branches i { font-size: 0.625rem; }
.mr__conflict { color: var(--status-bad); }
.mr__end { flex: none; display: flex; align-items: center; gap: 12px; color: var(--text-muted); font-size: 0.75rem; }
.mr__people { display: inline-flex; }
.mr__people :deep(.p-avatar) + :deep(.p-avatar) { margin-left: -8px; box-shadow: 0 0 0 2px var(--card-bg); }
.mr__comments { display: inline-flex; align-items: center; gap: 4px; }
.mrs__pager { padding-top: 6px; }
@media (max-width: 640px) { .mr__end { display: none; } .mrs__search { flex: 1 1 100%; } }
</style>
