<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import PrimeButton from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import mergeRequestService from 'src/services/mergeRequestService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { parsePatch, splitRows } from 'src/utils/diffPatch'
import { highlight } from 'src/utils/highlight'
import MarkdownEditor from 'components/issues/MarkdownEditor.vue'
import ThreadBox from './ThreadBox.vue'

// The code a merge request proposes, file by file: unified or side by side, with the syntax coloured, and the conversations about its
// lines under them. Pointing at a line shows a "+" that opens a comment on it.
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  number: { type: Number, required: true },
  // the conversations about lines of the code (the ones with a position)
  threads: { type: Array, default: () => [] },
  canResolve: { type: Boolean, default: false },
  // closed or merged ones are read, not written on
  readonly: { type: Boolean, default: false },
})
const emit = defineEmits(['changed'])
const t = useT()

const files = ref([])
const loading = ref(true)
const failed = ref(false)
const view = ref('unified')
const collapsed = ref({})
const composer = ref(null)
const draft = ref('')
const busy = ref(false)

const VIEWS = computed(() => [
  { value: 'unified', label: t('mrs.view_unified') },
  { value: 'split', label: t('mrs.view_split') },
])
const fail = (error) => notify({ type: 'negative', message: errorMessage(error, t) })
const target = computed(() => ({ kind: props.kind, id: props.id, number: props.number }))

const load = async () => {
  loading.value = true
  failed.value = false
  try {
    files.value = await mergeRequestService.diff(target.value)
  } catch (error) {
    failed.value = true
    fail(error)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.number, load)

const parsed = computed(() => new Map(files.value.map((file) => [file.newPath, parsePatch(file.patch)])))
const rowsOf = (file) => parsed.value.get(file.newPath) ?? []
const splitOf = (file) => splitRows(rowsOf(file))
const totals = computed(() => ({
  additions: files.value.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.value.reduce((sum, file) => sum + file.deletions, 0),
}))

const keyOf = (path, side, line) => `${path}\u0000${side}\u0000${line}`
const threadsAt = computed(() => {
  const map = new Map()
  for (const thread of props.threads) {
    if (!thread.position) continue
    const key = keyOf(thread.position.path, thread.position.side, thread.position.line)
    map.set(key, [...(map.get(key) ?? []), thread])
  }
  return map
})
const threadsFor = (path, side, line) => (line == null ? [] : (threadsAt.value.get(keyOf(path, side, line)) ?? []))
const composerAt = (path, side, line) => composer.value?.path === path && composer.value?.side === side && composer.value?.line === line

const open = (path, side, line) => { composer.value = { path, side, line }; draft.value = '' }
const sendNew = async () => {
  const body = draft.value.trim()
  if (!body || !composer.value) return
  busy.value = true
  try {
    await mergeRequestService.comment({ ...target.value, body, position: { ...composer.value } })
    composer.value = null
    draft.value = ''
    emit('changed')
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
const reply = async ({ threadId, body }) => {
  busy.value = true
  try {
    await mergeRequestService.comment({ ...target.value, body, threadId })
    emit('changed')
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
const resolve = async ({ threadId, resolved }) => {
  busy.value = true
  try {
    await mergeRequestService.resolve({ ...target.value, threadId, resolved })
    emit('changed')
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}

const STATUS = computed(() => ({ added: t('mrs.file_added'), deleted: t('mrs.file_deleted'), renamed: t('mrs.file_renamed') }))
const pathOf = (file) => (file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.newPath)
const jump = (file) => document.getElementById(`mrfile-${file.newPath}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
</script>

<template>
  <div class="mdiff" name="mr-diff">
    <div v-if="loading" class="mdiff__loading"><Skeleton height="2.4rem" /><Skeleton height="14rem" /></div>
    <div v-else-if="failed" class="mdiff__empty" role="alert"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('mrs.load_failed') }} <PrimeButton text size="small" :label="$t('labels.retry')" @click="load" /></div>
    <div v-else-if="!files.length" class="mdiff__empty"><i class="pi pi-inbox" aria-hidden="true" /> {{ $t('mrs.no_files') }}</div>

    <template v-else>
      <div class="mdiff__bar">
        <span class="mdiff__sum">{{ $t('mrs.files_changed', { n: files.length }) }} · <b class="mdiff__add">+{{ totals.additions }}</b> <b class="mdiff__del">−{{ totals.deletions }}</b></span>
        <SelectButton v-model="view" :options="VIEWS" option-label="label" option-value="value" :allow-empty="false" size="small" class="ln-fields" name="mr-diff-view" />
      </div>

      <div class="mdiff__cols">
        <nav class="mdiff__files" :aria-label="$t('mrs.changes')">
          <button v-for="file in files" :key="file.newPath" type="button" class="mdiff__file" @click="jump(file)">
            <span class="mdiff__name">{{ file.newPath }}</span>
            <span class="mdiff__counts"><b class="mdiff__add">+{{ file.additions }}</b> <b class="mdiff__del">−{{ file.deletions }}</b></span>
          </button>
        </nav>

        <div class="mdiff__list">
          <section v-for="file in files" :id="`mrfile-${file.newPath}`" :key="file.newPath" class="mfile">
            <header class="mfile__head">
              <PrimeButton text rounded size="small" severity="secondary" :icon="collapsed[file.newPath] ? 'pi pi-angle-right' : 'pi pi-angle-down'" :aria-label="collapsed[file.newPath] ? $t('mrs.expand_file') : $t('mrs.collapse_file')" @click="collapsed[file.newPath] = !collapsed[file.newPath]" />
              <span class="mfile__path">{{ pathOf(file) }}</span>
              <Tag v-if="STATUS[file.status]" :value="STATUS[file.status]" :severity="file.status === 'deleted' ? 'danger' : file.status === 'added' ? 'success' : 'info'" rounded />
              <span class="mfile__counts"><b class="mdiff__add">+{{ file.additions }}</b> <b class="mdiff__del">−{{ file.deletions }}</b></span>
            </header>

            <div v-if="!collapsed[file.newPath]" class="mfile__scroll">
              <p v-if="!file.patch" class="mdiff__empty mdiff__empty--small">{{ $t('mrs.no_patch') }}</p>

              <table v-else-if="view === 'unified'" class="mtable">
                <tbody>
                  <template v-for="(row, index) in rowsOf(file)" :key="index">
                    <tr v-if="row.type === 'hunk'" class="mrow mrow--hunk"><td colspan="3">{{ row.text }}</td></tr>
                    <tr v-else class="mrow" :class="`mrow--${row.type}`">
                      <td class="mnum">
                        <button v-if="row.type === 'del' && !readonly" type="button" class="mplus" :aria-label="$t('mrs.add_comment')" @click="open(file.newPath, 'old', row.oldLine)">+</button>{{ row.oldLine }}
                      </td>
                      <td class="mnum">
                        <button v-if="row.type !== 'del' && !readonly" type="button" class="mplus" :aria-label="$t('mrs.add_comment')" @click="open(file.newPath, 'new', row.newLine)">+</button>{{ row.newLine }}
                      </td>
                      <td class="mcode"><span class="mmark">{{ row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ' }}</span><span v-html="highlight(row.text, file.newPath)" /></td>
                    </tr>
                    <tr v-if="row.type !== 'hunk' && (threadsFor(file.newPath, row.type === 'del' ? 'old' : 'new', row.type === 'del' ? row.oldLine : row.newLine).length || composerAt(file.newPath, row.type === 'del' ? 'old' : 'new', row.type === 'del' ? row.oldLine : row.newLine))" class="mrow mrow--thread">
                      <td colspan="3">
                        <div class="mthreads">
                          <ThreadBox v-for="thread in threadsFor(file.newPath, row.type === 'del' ? 'old' : 'new', row.type === 'del' ? row.oldLine : row.newLine)" :key="thread.id" :thread="thread" :can-resolve="canResolve" :busy="busy" @reply="reply" @resolve="resolve" />
                          <div v-if="composerAt(file.newPath, row.type === 'del' ? 'old' : 'new', row.type === 'del' ? row.oldLine : row.newLine)" class="mthreads__new ln-fields">
                            <MarkdownEditor v-model="draft" :rows="3" :placeholder="$t('mrs.comment_placeholder')" />
                            <div class="mthreads__actions">
                              <PrimeButton size="small" :label="$t('mrs.comment')" :disabled="!draft.trim()" :loading="busy" @click="sendNew" />
                              <PrimeButton size="small" severity="secondary" text :label="$t('mrs.cancel_comment')" @click="composer = null" />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>

              <table v-else class="mtable mtable--split">
                <tbody>
                  <template v-for="(pair, index) in splitOf(file)" :key="index">
                    <tr v-if="pair.hunk" class="mrow mrow--hunk"><td colspan="4">{{ pair.hunk.text }}</td></tr>
                    <tr v-else class="mrow">
                      <td class="mnum" :class="pair.left ? `mcell--${pair.left.type}` : 'mcell--empty'">
                        <template v-if="pair.left"><button v-if="!readonly" type="button" class="mplus" :aria-label="$t('mrs.add_comment')" @click="open(file.newPath, 'old', pair.left.oldLine)">+</button>{{ pair.left.oldLine }}</template>
                      </td>
                      <td class="mcode" :class="pair.left ? `mcell--${pair.left.type}` : 'mcell--empty'"><span v-if="pair.left" v-html="highlight(pair.left.text, file.newPath)" /></td>
                      <td class="mnum" :class="pair.right ? `mcell--${pair.right.type}` : 'mcell--empty'">
                        <template v-if="pair.right"><button v-if="!readonly" type="button" class="mplus" :aria-label="$t('mrs.add_comment')" @click="open(file.newPath, 'new', pair.right.newLine)">+</button>{{ pair.right.newLine }}</template>
                      </td>
                      <td class="mcode" :class="pair.right ? `mcell--${pair.right.type}` : 'mcell--empty'"><span v-if="pair.right" v-html="highlight(pair.right.text, file.newPath)" /></td>
                    </tr>
                    <tr v-if="!pair.hunk && (threadsFor(file.newPath, 'old', pair.left?.oldLine).length || threadsFor(file.newPath, 'new', pair.right?.newLine).length || composerAt(file.newPath, 'old', pair.left?.oldLine) || composerAt(file.newPath, 'new', pair.right?.newLine))" class="mrow mrow--thread">
                      <td colspan="4">
                        <div class="mthreads">
                          <ThreadBox v-for="thread in [...threadsFor(file.newPath, 'old', pair.left?.oldLine), ...threadsFor(file.newPath, 'new', pair.right?.newLine)]" :key="thread.id" :thread="thread" :can-resolve="canResolve" :busy="busy" @reply="reply" @resolve="resolve" />
                          <div v-if="composerAt(file.newPath, 'old', pair.left?.oldLine) || composerAt(file.newPath, 'new', pair.right?.newLine)" class="mthreads__new ln-fields">
                            <MarkdownEditor v-model="draft" :rows="3" :placeholder="$t('mrs.comment_placeholder')" />
                            <div class="mthreads__actions">
                              <PrimeButton size="small" :label="$t('mrs.comment')" :disabled="!draft.trim()" :loading="busy" @click="sendNew" />
                              <PrimeButton size="small" severity="secondary" text :label="$t('mrs.cancel_comment')" @click="composer = null" />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mdiff { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.mdiff__loading { display: flex; flex-direction: column; gap: 10px; }
.mdiff__empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 12px; color: var(--text-muted); font-size: 0.8125rem; }
.mdiff__empty--small { padding: 14px; }
.mdiff__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mdiff__sum { font-size: 0.8125rem; color: var(--text-muted); }
.mdiff__add { color: var(--status-ok); font-weight: 600; }
.mdiff__del { color: var(--status-bad); font-weight: 600; }
.mdiff__cols { display: grid; grid-template-columns: 14rem minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .mdiff__cols { grid-template-columns: minmax(0, 1fr); } .mdiff__files { display: none; } }
.mdiff__files { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 8px; max-height: 70vh; overflow: auto; padding: 6px; border: 1px solid var(--card-border); border-radius: 9px; background: var(--card-bg); }
.mdiff__file { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border: 0; border-radius: 6px; background: none; text-align: left; font: inherit; font-size: 0.75rem; color: var(--text-heading); cursor: pointer; }
.mdiff__file:hover { background: var(--p-content-hover-background); }
.mdiff__name { overflow-wrap: anywhere; font-family: var(--font-mono, ui-monospace, monospace); }
.mdiff__counts { font-size: 0.6875rem; }
.mdiff__list { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.mfile { border: 1px solid var(--card-border); border-radius: 9px; background: var(--card-bg); min-width: 0; overflow: hidden; }
.mfile__head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--p-content-hover-background); border-bottom: 1px solid var(--card-border); font-size: 0.8125rem; }
.mfile__path { flex: 1; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-heading); overflow-wrap: anywhere; }
.mfile__counts { font-size: 0.75rem; }
.mfile__scroll { overflow-x: auto; overflow-y: hidden; }
.mtable { width: 100%; border-collapse: collapse; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; line-height: 1.55; }
.mtable--split { table-layout: fixed; }
.mrow td { padding: 0; vertical-align: top; }
.mnum { position: relative; width: 52px; min-width: 52px; padding: 0 8px 0 4px !important; text-align: right; color: var(--text-muted); user-select: none; background: var(--p-content-hover-background); }
.mcode { padding: 0 10px !important; white-space: pre-wrap; word-break: break-word; }
.mmark { display: inline-block; width: 1.2em; color: var(--text-muted); user-select: none; }
.mrow--add td, .mcell--add { background: color-mix(in srgb, var(--status-ok) 13%, transparent); }
.mrow--add .mnum, .mnum.mcell--add { background: color-mix(in srgb, var(--status-ok) 24%, var(--p-content-hover-background)); }
.mrow--del td, .mcell--del { background: color-mix(in srgb, var(--status-bad) 13%, transparent); }
.mrow--del .mnum, .mnum.mcell--del { background: color-mix(in srgb, var(--status-bad) 24%, var(--p-content-hover-background)); }
.mcell--empty { background: var(--p-content-hover-background); }
.mrow--hunk td { padding: 3px 10px; color: var(--text-muted); background: color-mix(in srgb, var(--p-primary-color) 9%, transparent); }
.mrow--thread > td { padding: 8px 10px 10px 62px !important; background: var(--card-bg); }
.mplus { position: absolute; left: 3px; top: 2px; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 4px; background: var(--p-primary-color); color: var(--p-primary-contrast-color); font-size: 0.8125rem; line-height: 16px; opacity: 0; cursor: pointer; }
.mrow:hover .mplus, .mplus:focus-visible { opacity: 1; }
.mthreads { display: flex; flex-direction: column; gap: 8px; max-width: 46rem; font-family: var(--font-body, inherit); white-space: normal; }
.mthreads__new { display: flex; flex-direction: column; gap: 8px; }
.mthreads__actions { display: flex; gap: 8px; }
</style>
<style>
.mcode .hl-kw { color: var(--sync); font-weight: 600; }
.mcode .hl-str { color: var(--status-ok-strong, var(--status-ok)); }
.mcode .hl-num { color: var(--status-warn); }
.mcode .hl-com { color: var(--text-muted); font-style: italic; }
</style>
