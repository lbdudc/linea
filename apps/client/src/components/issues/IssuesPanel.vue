<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Avatar from 'primevue/avatar'
import PrimeButton from 'primevue/button'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import issueService from 'src/services/issueService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { relativeShort } from 'src/utils/relativeTime'
import IssueDetail from './IssueDetail.vue'
import IssueForm from './IssueForm.vue'
import LabelTag from './LabelTag.vue'
import FilterPill from './FilterPill.vue'
import TemplatesDialog from './TemplatesDialog.vue'

// The issues of the repository of a line or of a product, the same on every git host. The address says what is open (`?issue=` a number
// for one issue, `new` for the form; nothing for the list), so a link goes straight to it. Laid out like the pipelines: a bar of
// controls, then a panel whose rows are cards with the colour of how they stand.
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
const search = ref('')
const author = ref('')
const assignee = ref('')
const labels = ref([])
const milestone = ref(null)
const pageNumber = ref(1)

const view = computed(() => {
  const wanted = String(route.query.issue ?? '')
  if (wanted === 'new') return { name: 'new' }
  return /^\d+$/.test(wanted) ? { name: 'detail', number: Number(wanted) } : { name: 'list' }
})
const open = (issue) => router.push({ query: { ...route.query, issue } })
const back = () => {
  const { issue: _gone, ...rest } = route.query
  router.push({ query: rest })
}

const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const caps = computed(() => meta.value?.capabilities.issues ?? {})
const ago = (at) => relativeShort(at)
const colorOf = (name) => meta.value?.labels.find((label) => label.name === name)?.color
const initial = (name) => String(name ?? '?').charAt(0).toUpperCase()
const filtered = computed(() => Boolean(search.value || author.value || assignee.value || labels.value.length || milestone.value))
const labelOptions = computed(() => (meta.value?.labels ?? []).map((label) => ({ value: label.name, label: label.name, color: label.color })))
const hasFilters = computed(() => Boolean(author.value || assignee.value || labels.value.length || milestone.value))
const clearFilters = () => { author.value = ''; assignee.value = ''; labels.value = []; milestone.value = null }

const STATES = computed(() => [
  { value: 'opened', label: t('issues.state_opened_plural') },
  { value: 'closed', label: t('issues.state_closed_plural') },
  { value: 'all', label: t('issues.state_all') },
])

const load = async () => {
  loading.value = true
  failed.value = false
  try {
    page.value = await issueService.list({
      kind: props.kind, id: props.id,
      filter: { state: state.value, search: search.value.trim(), author: (author.value ?? '').trim(), assignee: (assignee.value ?? '').trim(), labels: labels.value, milestone: milestone.value || undefined, page: pageNumber.value },
    })
  } catch (error) {
    failed.value = true
    fail(error)
  } finally {
    loading.value = false
  }
}
const loadMeta = async () => {
  try { meta.value = await issueService.meta({ kind: props.kind, id: props.id }) } catch (error) { failed.value = true; loading.value = false; fail(error) }
}

onMounted(async () => { await loadMeta(); if (meta.value) await load() })
watch(() => [props.kind, props.id], async () => { meta.value = null; pageNumber.value = 1; await loadMeta(); if (meta.value) await load() })
// a filter that changes starts again from the first page; the text waits for a pause in the typing
let typing
watch([state, labels, milestone], () => { pageNumber.value = 1; load() })
watch([search, author, assignee], () => { clearTimeout(typing); typing = setTimeout(() => { pageNumber.value = 1; load() }, 300) })
watch(pageNumber, load)
watch(view, (now, before) => { if (now.name === 'list' && before?.name !== 'list' && meta.value) load() })

const create = async (fields) => {
  creating.value = true
  try {
    const made = await issueService.create({ kind: props.kind, id: props.id, ...fields })
    notify({ type: 'positive', message: t('issues.created', { number: made.number }) })
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
  <div class="issues ln-block ln-fields" name="issues-panel">
    <div v-if="!meta && !failed" class="issues__loading"><Skeleton height="2.4rem" /><Skeleton height="12rem" /></div>
    <div v-else-if="failed && !meta" class="issues__empty" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('issues.load_failed') }}
      <PrimeButton text size="small" :label="$t('labels.retry')" @click="loadMeta().then(load)" />
    </div>

    <IssueDetail v-else-if="view.name === 'detail'" class="issues__narrow" :kind="kind" :id="id" :number="view.number" :meta="meta" @back="back" @changed="load" />

    <div v-else-if="view.name === 'new'" class="issues__narrow issues__new">
      <div class="issues__top">
        <PrimeButton text size="small" icon="pi pi-arrow-left" :label="$t('issues.back')" @click="back" />
      </div>
      <IssueForm :meta="meta" :saving="creating" @save="create" @cancel="back" />
    </div>

    <template v-else>
      <div class="issues__bar" name="issues-bar">
        <IconField class="issues__search">
          <InputIcon class="pi pi-search" />
          <InputText v-model="search" name="issues-search" fluid size="small" :placeholder="$t('issues.search')" :aria-label="$t('issues.search')" />
        </IconField>
        <FilterPill v-model="state" name="issues-state" :label="$t('issues.state')" :options="STATES" :clearable="false" />
        <FilterPill v-model="author" name="issues-author" :label="$t('issues.filter_author')" :options="meta.members ?? []" custom />
        <FilterPill v-if="caps.assignees" v-model="assignee" name="issues-assignee" :label="$t('issues.filter_assignee')" :options="meta.members ?? []" custom />
        <FilterPill v-if="caps.labels && meta.labels.length" v-model="labels" name="issues-labels" :label="$t('issues.filter_labels')" :options="labelOptions" multiple />
        <FilterPill v-if="caps.milestones && meta.milestones.length" v-model="milestone" name="issues-milestone" :label="$t('issues.filter_milestone')" :options="meta.milestones.map((entry) => entry.title)" />
        <PrimeButton v-if="hasFilters" text size="small" name="issues-clear" :label="$t('issues.clear_filters')" @click="clearFilters" />
        <span class="issues__spacer" />
        <span class="issues__actions">
          <PrimeButton v-if="meta.capabilities.templates?.editable" name="issues-templates" text size="small" icon="pi pi-file-edit" :label="$t('templates.manage')" @click="templatesOpen = true" />
          <PrimeButton name="issues-new" size="small" icon="pi pi-plus" :label="$t('issues.new')" @click="open('new')" />
        </span>
        <TemplatesDialog v-model:visible="templatesOpen" :kind="kind" :id="id" subject="issue" @hide="loadMeta" />
      </div>

      <section class="issues__block">
        <ul v-if="loading" class="issues__list"><li v-for="n in 4" :key="n"><Skeleton height="3.4rem" /></li></ul>
        <div v-else-if="failed" class="issues__empty" role="alert"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('issues.load_failed') }} <PrimeButton text size="small" :label="$t('labels.retry')" @click="load" /></div>
        <div v-else-if="!page.items.length" class="issues__empty" name="issues-empty"><i class="pi pi-inbox" aria-hidden="true" /> {{ filtered ? $t('issues.empty_filtered') : $t('issues.empty') }}</div>

        <ul v-else class="issues__list">
          <li v-for="issue in page.items" :key="issue.number" class="issue" :class="issue.state === 'closed' ? 'issue--closed' : 'issue--open'">
            <button type="button" class="issue__row" name="issue-row" @click="open(issue.number)">
              <i class="issue__icon" :class="issue.state === 'closed' ? 'pi pi-check-circle' : 'pi pi-exclamation-circle'" aria-hidden="true" />
              <span class="issue__main">
                <span class="issue__title">{{ issue.title }}</span>
                <span class="issue__meta">
                  <span class="issue__num">#{{ issue.number }}</span>
                  <span>{{ $t('issues.opened_by', { author: issue.author ?? '?', when: ago(issue.createdAt) }) }}</span>
                  <span v-if="issue.milestone"><i class="pi pi-flag" aria-hidden="true" /> {{ issue.milestone }}</span>
                  <LabelTag v-for="label in issue.labels" :key="label" :name="label" :color="colorOf(label)" />
                </span>
              </span>
              <span class="issue__end">
                <span v-if="issue.assignees.length" class="issue__people" :title="issue.assignees.join(', ')">
                  <Avatar v-for="name in issue.assignees.slice(0, 3)" :key="name" :label="initial(name)" shape="circle" size="small" />
                </span>
                <span v-if="issue.commentCount" class="issue__comments"><i class="pi pi-comment" aria-hidden="true" /> {{ issue.commentCount }}</span>
                <i class="pi pi-angle-right issue__chevron" aria-hidden="true" />
              </span>
            </button>
          </li>
        </ul>

        <div v-if="!loading && (pageNumber > 1 || page.hasMore)" class="ln-actions issues__pager">
          <span class="ln-actions__note">{{ $t('issues.page', { page: pageNumber }) }} · {{ $t('issues.showing', { n: page.items.length }) }}</span>
          <PrimeButton size="small" severity="secondary" outlined icon="pi pi-angle-left" :label="$t('issues.previous')" :disabled="pageNumber <= 1" @click="pageNumber -= 1" />
          <PrimeButton size="small" severity="secondary" outlined icon="pi pi-angle-right" icon-pos="right" :label="$t('issues.next')" :disabled="!page.hasMore" @click="pageNumber += 1" />
        </div>
      </section>
    </template>
  </div>
  </div>
</template>

<style scoped>
.issues { min-width: 0; gap: 12px; }

.issues__narrow { width: 100%; }
.issues__new { display: flex; flex-direction: column; gap: 14px; }
.issues__loading { display: flex; flex-direction: column; gap: 12px; }
.issues__top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.issues__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.issues__search { flex: 0 1 15rem; min-width: 10rem; }
.issues__spacer { flex: 1 1 0; }
.issues__actions { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.issues__block { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.issues__empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 12px; color: var(--text-muted); font-size: 0.8125rem; }
.issues__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--card-border); }
.issue { --tone: var(--status-ok); border-bottom: 1px solid var(--card-border); }
.issue--closed { --tone: var(--sync); }
.issue__row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 6px; background: none; border: 0; text-align: left; color: inherit; font: inherit; font-size: 0.8125rem; cursor: pointer; }
.issue__row:hover { background: var(--p-content-hover-background); }
.issue__row:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
.issue__icon { flex: none; font-size: 1rem; color: var(--tone); align-self: flex-start; margin-top: 2px; }
.issue__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.issue__title { font-size: 0.875rem; font-weight: 600; color: var(--text-heading); overflow-wrap: anywhere; }
.issue__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; font-size: 0.75rem; color: var(--text-muted); }
.issue__num { font-family: var(--font-mono, ui-monospace, monospace); }
.issue__end { flex: none; display: flex; align-items: center; gap: 12px; color: var(--text-muted); font-size: 0.75rem; }
.issue__people { display: inline-flex; }
.issue__people :deep(.p-avatar) + :deep(.p-avatar) { margin-left: -8px; box-shadow: 0 0 0 2px var(--card-bg); }
.issue__comments { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.issue__chevron { font-size: 0.75rem; }
.issues__pager { padding-top: 6px; }
@media (max-width: 640px) { .issue__end { display: none; } .issues__search { flex: 1 1 100%; } }
</style>
