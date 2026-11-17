<script setup>
import Tooltip from 'primevue/tooltip'
import { computed, onMounted, ref, watch } from 'vue'
import Avatar from 'primevue/avatar'
import PrimeButton from 'primevue/button'
import Select from 'primevue/select'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import issueService from 'src/services/issueService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { renderMarkdown } from 'src/utils/markdown'
import { relativeShort } from 'src/utils/relativeTime'
import IssueForm from './IssueForm.vue'
import LabelTag from './LabelTag.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import SidebarField from './SidebarField.vue'
import TagPicker from './TagPicker.vue'

// One issue as GitLab lays it out: the title, how it stands and who made it; the description on the page itself; the activity below it
// and a side bar with who it is for and how it is grouped, each field editable where it is.
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  number: { type: Number, required: true },
  meta: { type: Object, required: true },
})
const vTooltip = Tooltip
const emit = defineEmits(['back', 'changed'])
const t = useT()

const issue = ref(null)
const comments = ref([])
const loading = ref(true)
const failed = ref(false)
const editing = ref(false)
const saving = ref(false)
const draft = ref('')
const sending = ref(false)

// the side bar field that is open, and what it holds while it is
const field = ref(null)
const draftAssignees = ref([])
const draftLabels = ref([])
const draftMilestone = ref(null)

const target = computed(() => ({ kind: props.kind, id: props.id, number: props.number }))
const isOpen = computed(() => issue.value?.state === 'opened')
const caps = computed(() => props.meta.capabilities.issues)
const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const ago = (at) => relativeShort(at)
const colorOf = (name) => props.meta.labels.find((label) => label.name === name)?.color
const initial = (name) => String(name ?? '?').charAt(0).toUpperCase()

const load = async () => {
  loading.value = true
  failed.value = false
  try {
    ;[issue.value, comments.value] = await Promise.all([issueService.get(target.value), issueService.comments(target.value)])
  } catch (error) {
    failed.value = true
    fail(error)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.number, load)

const apply = async (changes) => {
  saving.value = true
  try {
    issue.value = await issueService.update({ ...target.value, ...changes })
    editing.value = false
    field.value = null
    emit('changed')
  } catch (error) {
    fail(error)
  } finally {
    saving.value = false
  }
}
const toggleState = () => apply({ state: isOpen.value ? 'closed' : 'opened' })

const openField = (name) => {
  draftAssignees.value = [...issue.value.assignees]
  draftLabels.value = [...issue.value.labels]
  draftMilestone.value = issue.value.milestone
  field.value = name
}
const saveField = () => {
  if (field.value === 'assignees') return apply({ assignees: draftAssignees.value })
  if (field.value === 'labels') return apply({ labels: draftLabels.value })
  return apply({ milestone: (draftMilestone.value ?? '').trim() || null })
}

const send = async ({ close = false } = {}) => {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  try {
    comments.value = [...comments.value, await issueService.addComment({ ...target.value, body })]
    draft.value = ''
    if (close) await toggleState()
    else issue.value = { ...issue.value, commentCount: comments.value.length }
  } catch (error) {
    fail(error)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="gdetail" :class="isOpen ? 'gdetail--open' : 'gdetail--closed'" name="issue-detail">
    <div v-if="loading" class="gdetail__loading"><Skeleton height="2.6rem" width="70%" /><Skeleton height="10rem" /></div>
    <div v-else-if="failed || !issue" class="gdetail__missing" role="alert"><PrimeButton text rounded size="small" icon="pi pi-arrow-left" name="issue-back" :aria-label="$t('issues.back')" @click="emit('back')" /> <i class="pi pi-info-circle" aria-hidden="true" /> {{ $t('issues.not_found') }}</div>

    <template v-else>
      <header class="gdetail__head">
        <div class="gdetail__top">
          <div class="gdetail__titlerow">
            <PrimeButton text rounded size="small" icon="pi pi-arrow-left" class="gdetail__back" name="issue-back" :aria-label="$t('issues.back')" v-tooltip.bottom="$t('issues.back')" @click="emit('back')" />
            <h1 class="gdetail__title">{{ issue.title }} <span class="gdetail__num">#{{ issue.number }}</span></h1>
          </div>
          <div class="gdetail__actions">
            <PrimeButton v-if="!editing" size="small" severity="secondary" outlined :label="$t('issues.edit')" name="issue-edit" @click="editing = true" />
            <PrimeButton size="small" severity="secondary" outlined :label="isOpen ? $t('issues.close') : $t('issues.reopen')" name="issue-toggle" :loading="saving" @click="toggleState" />
          </div>
        </div>
        <div class="gdetail__meta">
          <span class="gstate" name="issue-state"><i :class="isOpen ? 'pi pi-circle' : 'pi pi-check-circle'" aria-hidden="true" /> {{ isOpen ? $t('issues.state_opened') : $t('issues.state_closed') }}</span>
          <span>{{ $t('issues.created_by_line', { when: ago(issue.createdAt) }) }} <b>{{ issue.author ?? '?' }}</b></span>
        </div>
      </header>

      <IssueForm v-if="editing" :meta="meta" :issue="issue" :saving="saving" @save="apply" @cancel="editing = false" />

      <div v-else class="gdetail__cols">
        <div class="gdetail__main">
          <div v-if="issue.description" class="gdetail__text issue-md" v-html="renderMarkdown(issue.description)" />
          <p v-else class="gdetail__empty">{{ $t('issues.no_description') }}</p>

          <section class="gdetail__activity ln-fields">
            <h2 class="gdetail__h2">{{ $t('issues.section_activity') }}</h2>
            <p v-if="!comments.length" class="gdetail__empty">{{ $t('issues.no_comments') }}</p>
            <article v-for="comment in comments" :key="comment.id" class="gnote" name="issue-comment">
              <Avatar :label="initial(comment.author)" shape="circle" />
              <div class="gnote__box">
                <header class="gnote__head"><b>{{ comment.author }}</b><span>{{ ago(comment.createdAt) }}</span></header>
                <div class="gnote__body issue-md" v-html="renderMarkdown(comment.body)" />
              </div>
            </article>

            <div class="gcompose">
              <MarkdownEditor v-model="draft" name="issue-comment-text" :rows="4" :placeholder="$t('issues.comment_placeholder')" />
              <div class="gcompose__actions">
                <PrimeButton size="small" name="issue-comment-send" :label="$t('issues.comment')" :loading="sending" :disabled="!draft.trim()" @click="send()" />
                <PrimeButton size="small" severity="secondary" outlined :label="isOpen ? $t('issues.close_and_comment') : $t('issues.reopen_and_comment')" :disabled="!draft.trim()" @click="send({ close: true })" />
              </div>
            </div>
          </section>
        </div>

        <aside class="gdetail__side ln-fields">
          <SidebarField v-if="caps.assignees" :title="$t('issues.field_assignees')" :editing="field === 'assignees'" :saving="saving" @edit="openField('assignees')" @cancel="field = null" @apply="saveField">
            <span v-if="!issue.assignees.length">{{ $t('issues.none') }}</span>
            <span v-for="name in issue.assignees" :key="name" class="gdetail__user"><Avatar :label="initial(name)" shape="circle" size="small" />{{ name }}</span>
            <template #editor><TagPicker v-model="draftAssignees" :options="meta.members ?? []" /></template>
          </SidebarField>
          <SidebarField v-if="caps.labels" :title="$t('issues.field_labels')" :editing="field === 'labels'" :saving="saving" @edit="openField('labels')" @cancel="field = null" @apply="saveField">
            <span v-if="!issue.labels.length">{{ $t('issues.none') }}</span>
            <LabelTag v-for="label in issue.labels" :key="label" :name="label" :color="colorOf(label)" />
            <template #editor><TagPicker v-model="draftLabels" :options="meta.labels.map((label) => label.name)" /></template>
          </SidebarField>
          <SidebarField v-if="caps.milestones" :title="$t('issues.field_milestone')" :editing="field === 'milestone'" :saving="saving" @edit="openField('milestone')" @cancel="field = null" @apply="saveField">
            <Tag v-if="issue.milestone" :value="issue.milestone" severity="info" icon="pi pi-flag" rounded />
            <span v-else>{{ $t('issues.none') }}</span>
            <template #editor><Select v-model="draftMilestone" :options="meta.milestones" option-label="title" option-value="title" editable show-clear fluid :placeholder="$t('issues.no_milestone')" /></template>
          </SidebarField>
          <SidebarField readonly :title="$t('issues.dates')">
            <span class="gdetail__dates">{{ $t('issues.created_on', { date: new Date(issue.createdAt).toLocaleDateString() }) }}<br>{{ $t('issues.updated', { when: ago(issue.updatedAt) }) }}</span>
          </SidebarField>
          <SidebarField v-if="issue.webUrl" readonly :title="$t('issues.in_host')">
            <a class="ln-link" :href="issue.webUrl" target="_blank" rel="noopener noreferrer">{{ $t('issues.open_in_host') }} <i class="pi pi-external-link" aria-hidden="true" /></a>
          </SidebarField>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gdetail { --tone: var(--status-ok); display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.gdetail--closed { --tone: var(--sync); }
.gdetail__titlerow { flex: 1 1 22rem; min-width: 0; display: flex; align-items: flex-start; gap: 6px; }
.gdetail__back { flex: none; margin: 1px 0 0 -10px; }
.gdetail__loading { display: flex; flex-direction: column; gap: 10px; }
.gdetail__missing { display: flex; align-items: center; gap: 8px; color: var(--text-muted); padding: 12px 0; }
.gdetail__head { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--card-border); }
.gdetail__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.gdetail__title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 1.625rem; line-height: 1.25; font-weight: 700; color: var(--text-heading); text-wrap: balance; overflow-wrap: anywhere; }
.gdetail__num { font-weight: 400; color: var(--text-muted); }
.gdetail__actions { display: flex; gap: 8px; }
.gdetail__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.875rem; color: var(--text-muted); }
.gdetail__meta b { color: var(--text-heading); }
.gstate { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; border: 1px solid var(--tone); font-size: 0.8125rem; font-weight: 600; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); }
.gdetail__cols { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 32px; align-items: start; }
@media (max-width: 900px) { .gdetail__cols { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
.gdetail__main { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.gdetail__side { min-width: 0; }
.gdetail__text { font-size: 0.9375rem; line-height: 1.6; overflow-wrap: anywhere; }
.gdetail__empty { margin: 0; color: var(--text-muted); font-size: 0.875rem; }
.gdetail__h2 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 700; color: var(--text-heading); }
.gdetail__activity { display: flex; flex-direction: column; gap: 14px; }
.gdetail__user { display: inline-flex; align-items: center; gap: 8px; color: var(--p-primary-color); font-weight: 500; }
.gdetail__dates { line-height: 1.6; }
.gnote { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; }
.gnote__box { min-width: 0; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); overflow: hidden; }
.gnote__head { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; border-bottom: 1px solid var(--card-border); background: var(--p-content-hover-background); font-size: 0.8125rem; color: var(--text-muted); }
.gnote__head b { color: var(--text-heading); }
.gnote__body { padding: 12px; font-size: 0.875rem; line-height: 1.55; overflow-wrap: anywhere; }
.gcompose { display: flex; flex-direction: column; gap: 10px; }
.gcompose__actions { display: flex; gap: 8px; }
</style>
<style>
.issue-md > :first-child { margin-top: 0; }
.issue-md > :last-child { margin-bottom: 0; }
.issue-md p { margin: 0 0 10px; }
.issue-md ul, .issue-md ol { margin: 0 0 10px; padding-left: 24px; }
.issue-md code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8125em; background: var(--p-content-hover-background); padding: 1px 5px; border-radius: 4px; }
.issue-md pre { overflow-x: auto; padding: 10px 12px; border-radius: 8px; background: var(--p-content-hover-background); border: 1px solid var(--card-border); }
.issue-md pre code { padding: 0; background: transparent; }
.issue-md blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--card-border); color: var(--text-muted); }
.issue-md h3, .issue-md h4, .issue-md h5, .issue-md h6 { margin: 18px 0 8px; font-size: 1.125rem; font-weight: 700; color: var(--text-heading); }
.issue-md a { color: var(--p-primary-color); }
</style>
