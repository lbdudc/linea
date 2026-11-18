<script setup>
import Tooltip from 'primevue/tooltip'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Avatar from 'primevue/avatar'
import PrimeButton from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import mergeRequestService from 'src/services/mergeRequestService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { renderMarkdown } from 'src/utils/markdown'
import { relativeShort } from 'src/utils/relativeTime'
import { pipelineColorVar } from 'src/utils/pipelineStatus'
import LabelTag from 'components/issues/LabelTag.vue'
import MarkdownEditor from 'components/issues/MarkdownEditor.vue'
import SidebarField from 'components/issues/SidebarField.vue'
import TagPicker from 'components/issues/TagPicker.vue'
import MergeRequestDiff from './MergeRequestDiff.vue'
import ThreadBox from './ThreadBox.vue'

// One merge request as GitLab lays it out: the title, how it stands and who opened it; a conversation tab (description, checks,
// approvals, the box that merges it, the activity) and a tab with the code it proposes; a side bar with its people and labels.
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  number: { type: Number, required: true },
  meta: { type: Object, required: true },
})
const vTooltip = Tooltip
const emit = defineEmits(['back', 'changed'])
const t = useT()
const route = useRoute()
const router = useRouter()

const mr = ref(null)
const threads = ref([])
const loading = ref(true)
const failed = ref(false)
const editing = ref(false)
const saving = ref(false)
const draft = ref('')
const sending = ref(false)
const merging = ref(false)
const squash = ref(false)
const deleteBranch = ref(true)
const field = ref(null)
const draftReviewers = ref([])
const draftLabels = ref([])
const editTitle = ref('')
const editDescription = ref('')
const busyThread = ref(false)

const tab = computed(() => (route.query.mrtab === 'files' ? 'files' : 'conversation'))
const setTab = (name) => router.replace({ query: { ...route.query, mrtab: name === 'files' ? 'files' : undefined } })
const caps = computed(() => props.meta.capabilities.mergeRequests)
// a person below Maintainer cannot merge on the host: the button says so before the host refuses
const cannotMerge = computed(() => typeof props.meta.myLevel === 'number' && props.meta.myLevel < 40)
const target = computed(() => ({ kind: props.kind, id: props.id, number: props.number }))
const isOpen = computed(() => mr.value?.state === 'opened')
// A generation's request is LINEA's business (CI/CD decides it). A sync's waits for a person (it was opened to be reviewed), so
// its page has the controls to merge or close it, as a manual one's does.
const managed = computed(() => mr.value && mr.value.origin === 'generation')
const general = computed(() => threads.value.filter((thread) => !thread.position))
const inline = computed(() => threads.value.filter((thread) => thread.position))
const unresolved = computed(() => inline.value.filter((thread) => thread.resolvable && !thread.resolved).length)
const tone = computed(() => (mr.value?.state === 'merged' ? 'var(--sync)' : mr.value?.state === 'closed' ? 'var(--status-bad)' : 'var(--status-ok)'))
const stateWord = computed(() => t(`mrs.state_${mr.value?.state ?? 'opened'}`))
const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const ago = (at) => relativeShort(at)
const initial = (name) => String(name ?? '?').charAt(0).toUpperCase()
const colorOf = (name) => props.meta.labels.find((label) => label.name === name)?.color
const jobsOk = computed(() => (mr.value?.jobs ?? []).filter((job) => job.status === 'success').length)
const jobIcon = (status) => ({ success: 'pi pi-check-circle', failed: 'pi pi-times-circle', running: 'pi pi-spin pi-spinner', canceled: 'pi pi-ban', skipped: 'pi pi-minus-circle' })[status] ?? 'pi pi-clock'

const loadThreads = async () => { threads.value = await mergeRequestService.threads(target.value) }
const load = async () => {
  loading.value = true
  failed.value = false
  try {
    ;[mr.value] = await Promise.all([mergeRequestService.get(target.value), loadThreads()])
  } catch (error) {
    failed.value = true
    fail(error)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.number, load)

const reloadThreads = async () => {
  try {
    await loadThreads()
    mr.value = { ...mr.value, ...(await mergeRequestService.get(target.value)) }
  } catch (error) { fail(error) }
}

const apply = async (changes) => {
  saving.value = true
  try {
    mr.value = { ...mr.value, ...(await mergeRequestService.update({ ...target.value, ...changes })) }
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
const startEdit = () => { editTitle.value = mr.value.title; editDescription.value = mr.value.description; editing.value = true }
const saveEdit = () => { if (editTitle.value.trim()) apply({ title: editTitle.value.trim(), description: editDescription.value }) }
const openField = (name) => { draftReviewers.value = [...mr.value.reviewers]; draftLabels.value = [...mr.value.labels]; field.value = name }
const saveField = () => apply(field.value === 'reviewers' ? { reviewers: draftReviewers.value } : { labels: draftLabels.value })

const send = async () => {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  try {
    await mergeRequestService.comment({ ...target.value, body })
    draft.value = ''
    await reloadThreads()
  } catch (error) {
    fail(error)
  } finally {
    sending.value = false
  }
}
const reply = async ({ threadId, body }) => {
  busyThread.value = true
  try { await mergeRequestService.comment({ ...target.value, body, threadId }); await reloadThreads() } catch (error) { fail(error) } finally { busyThread.value = false }
}
const resolve = async ({ threadId, resolved }) => {
  busyThread.value = true
  try { await mergeRequestService.resolve({ ...target.value, threadId, resolved }); await reloadThreads() } catch (error) { fail(error) } finally { busyThread.value = false }
}

const approve = async () => {
  saving.value = true
  try { await mergeRequestService.approve(target.value); mr.value = await mergeRequestService.get(target.value) } catch (error) { fail(error) } finally { saving.value = false }
}

const merge = async () => {
  merging.value = true
  try {
    await mergeRequestService.merge({ ...target.value, squash: squash.value, deleteSourceBranch: deleteBranch.value })
    notify({ type: 'positive', message: t('mrs.merge_done') })
    mr.value = await mergeRequestService.get(target.value)
    emit('changed')
  } catch (error) {
    if (error.response?.status === 409) {
      notify({ type: 'negative', message: t('mrs.merge_failed') })
      mr.value = await mergeRequestService.get(target.value)
    } else fail(error)
  } finally {
    merging.value = false
  }
}
const toCicd = () => router.push({ query: { tab: 'cicd' } })
</script>

<template>
  <div class="mrd" name="mr-detail">
    <div v-if="loading" class="mrd__loading"><Skeleton height="2.6rem" width="70%" /><Skeleton height="10rem" /></div>
    <div v-else-if="failed || !mr" class="mrd__missing" role="alert"><PrimeButton text rounded size="small" icon="pi pi-arrow-left" name="mr-back" :aria-label="$t('mrs.back')" @click="emit('back')" /> <i class="pi pi-info-circle" aria-hidden="true" /> {{ $t('mrs.not_found') }}</div>

    <template v-else>
      <header class="mrd__head" :style="{ '--tone': tone }">
        <div class="mrd__top">
          <div class="mrd__titlerow">
            <PrimeButton text rounded size="small" icon="pi pi-arrow-left" class="mrd__back" name="mr-back" :aria-label="$t('mrs.back')" v-tooltip.bottom="$t('mrs.back')" @click="emit('back')" />
            <h1 class="mrd__title">{{ mr.title }} <span class="mrd__num">!{{ mr.number }}</span></h1>
          </div>
          <div v-if="!managed" class="mrd__actions">
            <PrimeButton v-if="!editing && isOpen" size="small" severity="secondary" outlined :label="$t('mrs.edit')" name="mr-edit" @click="startEdit" />
            <PrimeButton v-if="mr.state !== 'merged'" size="small" severity="secondary" outlined :label="isOpen ? $t('mrs.close') : $t('mrs.reopen')" name="mr-toggle" :loading="saving" @click="toggleState" />
          </div>
        </div>
        <div class="mrd__meta">
          <span class="mrd__state" name="mr-state"><i :class="mr.state === 'merged' ? 'pi pi-check-circle' : mr.state === 'closed' ? 'pi pi-times-circle' : 'pi pi-circle'" aria-hidden="true" /> {{ stateWord }}</span>
          <Tag v-if="mr.origin !== 'manual'" :value="$t(`mrs.origin_tag_${mr.origin}`)" severity="info" rounded />
          <span>{{ $t('mrs.created_by', { author: mr.author ?? '?', when: ago(mr.createdAt) }) }}</span>
          <span class="mrd__branches"><code>{{ mr.sourceBranch }}</code> <i class="pi pi-arrow-right" aria-hidden="true" /> <code>{{ mr.targetBranch }}</code></span>
        </div>
      </header>

      <Message v-if="managed" severity="info" :closable="false" class="mrd__managed">
        {{ $t('mrs.managed_in_cicd') }} <button type="button" class="ln-link" @click="toCicd">{{ $t('mrs.see_in_cicd') }}</button>
      </Message>

      <nav class="mrd__tabs" role="tablist">
        <button type="button" role="tab" class="mrd__tab" :class="{ 'mrd__tab--on': tab === 'conversation' }" :aria-selected="tab === 'conversation'" name="mr-tab-conversation" @click="setTab('conversation')">{{ $t('mrs.conversation') }} <span class="mrd__count">{{ general.length }}</span></button>
        <button type="button" role="tab" class="mrd__tab" :class="{ 'mrd__tab--on': tab === 'files' }" :aria-selected="tab === 'files'" name="mr-tab-files" @click="setTab('files')">
          {{ $t('mrs.changes') }} <span v-if="inline.length" class="mrd__count">{{ inline.length }}</span>
          <span v-if="unresolved" class="mrd__open" :title="$t('mrs.unresolved_threads', { n: unresolved })" />
        </button>
      </nav>

      <MergeRequestDiff v-if="tab === 'files'" :kind="kind" :id="id" :number="number" :threads="inline" :can-resolve="caps.resolvableThreads" :readonly="!isOpen" @changed="reloadThreads" />

      <div v-else class="mrd__cols">
        <div class="mrd__main ln-fields">
          <div v-if="editing" class="mrd__edit">
            <InputText v-model="editTitle" name="mr-edit-title" fluid maxlength="255" />
            <MarkdownEditor v-model="editDescription" :rows="8" :placeholder="$t('mrs.description_placeholder')" />
            <div class="mrd__row"><PrimeButton size="small" :label="$t('mrs.save')" :loading="saving" @click="saveEdit" /><PrimeButton size="small" severity="secondary" outlined :label="$t('labels.cancel')" @click="editing = false" /></div>
          </div>
          <template v-else>
            <div v-if="mr.description" class="mrd__text issue-md" v-html="renderMarkdown(mr.description)" />
            <p v-else class="mrd__empty">{{ $t('mrs.no_description') }}</p>
          </template>

          <section v-if="mr.pipeline || (mr.jobs && mr.jobs.length)" class="mrd__card" name="mr-checks">
            <header class="mrd__card-head"><i class="pi pi-verified" aria-hidden="true" /> <b>{{ $t('mrs.checks') }}</b><span v-if="mr.jobs.length" class="mrd__muted">{{ $t('mrs.checks_jobs', { ok: jobsOk, n: mr.jobs.length }) }}</span></header>
            <ul class="mrd__jobs"><li v-for="job in mr.jobs" :key="job.id"><i :class="jobIcon(job.status)" :style="{ color: pipelineColorVar(job.status) }" aria-hidden="true" /> <span class="mrd__job">{{ job.name }}</span><span class="mrd__muted">{{ job.stage }}</span></li></ul>
          </section>

          <section v-if="caps.approvals && mr.approvals" class="mrd__card" name="mr-approvals">
            <header class="mrd__card-head"><i class="pi pi-thumbs-up" aria-hidden="true" /> <b>{{ $t('mrs.approvals') }}</b></header>
            <p class="mrd__line">
              <span>{{ mr.approvals.given.length ? `${$t('mrs.approved_by', { names: mr.approvals.given.join(', ') })}.` : $t('mrs.approvals_none') }}{{ mr.approvals.required ? ` ${$t('mrs.approvals_required', { n: mr.approvals.required })}` : '' }}</span>
            </p>
            <PrimeButton v-if="isOpen" class="mrd__approve" size="small" severity="secondary" outlined icon="pi pi-thumbs-up" :label="$t('mrs.approve')" name="mr-approve" :loading="saving" @click="approve" />
          </section>

          <section v-if="!managed" class="mrd__card mrd__merge" name="mr-merge">
            <template v-if="isOpen">
              <header class="mrd__card-head"><i :class="mr.hasConflicts ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'" :style="{ color: mr.hasConflicts ? 'var(--status-bad)' : 'var(--status-ok)' }" aria-hidden="true" /> <b>{{ mr.hasConflicts ? $t('mrs.merge_conflicts', { target: mr.targetBranch }) : $t('mrs.merge_ready') }}</b></header>
              <div v-if="!mr.hasConflicts" class="mrd__mergeopts">
                <label v-if="caps.squash" class="mrd__opt"><span>{{ $t('mrs.merge_strategy') }}</span>
                  <Select v-model="squash" :options="[{ value: false, label: $t('mrs.strategy_merge') }, { value: true, label: $t('mrs.strategy_squash') }]" option-label="label" option-value="value" size="small" name="mr-strategy" />
                </label>
                <label class="mrd__opt mrd__opt--check"><Checkbox v-model="deleteBranch" binary input-id="mr-delete-branch" name="mr-delete-branch" /> <span>{{ $t('mrs.delete_branch') }}</span></label>
              </div>
              <PrimeButton v-if="!mr.hasConflicts" :label="$t('mrs.merge')" icon="pi pi-share-alt" name="mr-merge-button" :loading="merging" :disabled="cannotMerge" @click="merge" />
              <small v-if="cannotMerge && !mr.hasConflicts" class="mrd__level" data-test="merge-level-note">{{ $t('access.needMaintainer', { level: $t(`labels.role${meta.myLevel}`) }) }}</small>
            </template>
            <p v-else-if="mr.state === 'merged'" class="mrd__line"><i class="pi pi-check-circle" :style="{ color: 'var(--sync)' }" aria-hidden="true" /> {{ $t('mrs.merged_note', { when: ago(mr.mergedAt ?? mr.updatedAt), target: mr.targetBranch }) }}</p>
            <p v-else class="mrd__line"><i class="pi pi-times-circle" :style="{ color: 'var(--status-bad)' }" aria-hidden="true" /> {{ $t('mrs.closed_note') }}</p>
          </section>

          <section class="mrd__activity">
            <h2 class="mrd__h2">{{ $t('mrs.activity') }}</h2>
            <p v-if="!general.length" class="mrd__empty">{{ $t('mrs.no_threads') }}</p>
            <ThreadBox v-for="thread in general" :key="thread.id" :thread="thread" :busy="busyThread" @reply="reply" />
            <div class="mrd__compose">
              <MarkdownEditor v-model="draft" name="mr-comment-text" :rows="4" :placeholder="$t('mrs.comment_placeholder')" />
              <div class="mrd__row"><PrimeButton size="small" name="mr-comment-send" :label="$t('mrs.comment')" :loading="sending" :disabled="!draft.trim()" @click="send" /></div>
            </div>
          </section>
        </div>

        <aside class="mrd__side ln-fields">
          <SidebarField v-if="caps.reviewers" :title="$t('mrs.reviewers')" :readonly="managed" :editing="field === 'reviewers'" :saving="saving" @edit="openField('reviewers')" @cancel="field = null" @apply="saveField">
            <span v-if="!mr.reviewers.length">{{ $t('mrs.none') }}</span>
            <span v-for="name in mr.reviewers" :key="name" class="mrd__user"><Avatar :label="initial(name)" shape="circle" size="small" />{{ name }}</span>
            <template #editor><TagPicker v-model="draftReviewers" :options="meta.members ?? []" /></template>
          </SidebarField>
          <SidebarField v-if="caps.labels" :title="$t('mrs.labels')" :readonly="managed" :editing="field === 'labels'" :saving="saving" @edit="openField('labels')" @cancel="field = null" @apply="saveField">
            <span v-if="!mr.labels.length">{{ $t('mrs.none') }}</span>
            <LabelTag v-for="label in mr.labels" :key="label" :name="label" :color="colorOf(label)" />
            <template #editor><TagPicker v-model="draftLabels" :options="meta.labels.map((label) => label.name)" /></template>
          </SidebarField>
          <SidebarField readonly :title="$t('mrs.branches')"><code>{{ mr.sourceBranch }}</code> <i class="pi pi-arrow-right" aria-hidden="true" /> <code>{{ mr.targetBranch }}</code></SidebarField>
          <SidebarField readonly :title="$t('mrs.dates')"><span class="mrd__dates">{{ $t('mrs.created_on', { date: new Date(mr.createdAt).toLocaleDateString() }) }}<br>{{ $t('mrs.updated', { when: ago(mr.updatedAt) }) }}</span></SidebarField>
          <SidebarField v-if="mr.webUrl" readonly :title="$t('mrs.in_host')"><a class="ln-link" :href="mr.webUrl" target="_blank" rel="noopener noreferrer">{{ $t('mrs.open_in_host') }} <i class="pi pi-external-link" aria-hidden="true" /></a></SidebarField>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mrd { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.mrd__titlerow { flex: 1 1 22rem; min-width: 0; display: flex; align-items: flex-start; gap: 6px; }
.mrd__back { flex: none; margin: 1px 0 0 -10px; }
.mrd__loading { display: flex; flex-direction: column; gap: 10px; }
.mrd__missing { display: flex; align-items: center; gap: 8px; color: var(--text-muted); padding: 12px 0; }
.mrd__head { display: flex; flex-direction: column; gap: 10px; }
.mrd__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.mrd__title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 1.625rem; line-height: 1.25; font-weight: 700; color: var(--text-heading); text-wrap: balance; overflow-wrap: anywhere; }
.mrd__num { font-weight: 400; color: var(--text-muted); }
.mrd__actions { display: flex; gap: 8px; }
.mrd__meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.875rem; color: var(--text-muted); }
.mrd__state { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; border: 1px solid var(--tone); font-size: 0.8125rem; font-weight: 600; color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); }
.mrd__branches code, .mrd code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8125em; padding: 1px 6px; border-radius: 4px; background: var(--p-content-hover-background); color: var(--text-heading); }
.mrd__tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--card-border); }
.mrd__tab { display: inline-flex; align-items: center; gap: 6px; padding: 9px 0; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: none; font: inherit; font-size: 0.875rem; color: var(--text-muted); cursor: pointer; }
.mrd__tab:hover { color: var(--text-heading); }
.mrd__tab--on { color: var(--text-heading); font-weight: 600; border-bottom-color: var(--p-primary-color); }
.mrd__count { padding: 0 7px; border-radius: 99px; background: var(--p-content-hover-background); font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
.mrd__open { width: 8px; height: 8px; border-radius: 50%; background: var(--status-warn); }
.mrd__cols { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 32px; align-items: start; }
@media (max-width: 900px) { .mrd__cols { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
.mrd__main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.mrd__side { min-width: 0; }
.mrd__text { font-size: 0.9375rem; line-height: 1.6; overflow-wrap: anywhere; }
.mrd__empty { margin: 0; color: var(--text-muted); font-size: 0.875rem; }
.mrd__edit { display: flex; flex-direction: column; gap: 10px; }
.mrd__row { display: flex; gap: 8px; align-items: center; }
.mrd__card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--tile-border); border-radius: 10px; background: var(--tile-bg); }
.mrd__card-head { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; color: var(--text-heading); }
.mrd__muted { margin-left: auto; font-size: 0.75rem; color: var(--text-muted); }
.mrd__approve, .mrd__merge > .p-button { align-self: flex-start; }
.mrd__line { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 0.875rem; }
.mrd__jobs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mrd__jobs li { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); font-size: 0.8125rem; }
.mrd__job { font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-heading); }
.mrd__mergeopts { display: flex; gap: 16px 24px; flex-wrap: wrap; align-items: center; }
.mrd__opt { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--text-heading); }
.mrd__opt--check { cursor: pointer; }
.mrd__activity { display: flex; flex-direction: column; gap: 12px; }
.mrd__h2 { margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--text-heading); }
.mrd__compose { display: flex; flex-direction: column; gap: 10px; }
.mrd__user { display: inline-flex; align-items: center; gap: 8px; color: var(--p-primary-color); font-weight: 500; }
.mrd__dates { line-height: 1.6; }
.mrd__managed { align-self: stretch; }
</style>
