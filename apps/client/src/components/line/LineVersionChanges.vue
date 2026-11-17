<script setup>
import { computed, ref, watch, getCurrentInstance } from 'vue'
import lineService from 'src/services/lineService'
import { diffLines, hunksOf, countChanges, diffModules, diffPackages, moduleName } from 'src/utils/textDiff'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'
import { useT } from 'src/composables/useT'

// What a version of the line changed against the one before it (or against the one the history was asked to compare it with):
// the modules that came in, went out or changed their accepted versions, and the lines of the feature model.
const props = defineProps({
  lineId: { type: String, required: true },
  version: { type: String, default: null },
  // the version to compare with; without it, the one before
  from: { type: String, default: null },
})

const instance = getCurrentInstance()
const t = useT()

const loading = ref(false)
const error = ref(null)
const data = ref(null)
let sequence = 0

const load = async () => {
  if (!props.version) { data.value = null; return }
  const mine = ++sequence
  loading.value = true
  error.value = null
  data.value = null
  try {
    const result = await lineService.getVersion({ id: props.lineId, version: props.version, previous: props.from })
    if (mine === sequence) data.value = result
  } catch (e) {
    if (mine === sequence) error.value = t(e.response?.data?.error || 'labels.lv_not_kept')
  } finally {
    if (mine === sequence) loading.value = false
  }
}
watch(() => [props.lineId, props.version, props.from], load, { immediate: true })

const before = computed(() => data.value?.previous ?? null)
const modules = computed(() => diffModules(before.value?.modules, data.value?.modules))

// the modules the line asked for, each with the versions it accepts and the one it got; and, apart, everything they brought in
const packages = computed(() => diffPackages(before.value?.packages, data.value?.packages))
const hasPackages = computed(() => Array.isArray(data.value?.packages))
const directRows = computed(() => {
  const was = before.value?.modules ?? {}
  const is = data.value?.modules ?? {}
  const byLocation = new Map(packages.value.map((p) => [p.location, p]))
  return [...new Set([...Object.keys(was), ...Object.keys(is)])].map((location) => {
    const pkg = byLocation.get(location)
    const rangeStatus = !(location in was) ? 'add' : !(location in is) ? 'del' : was[location] !== is[location] ? 'chg' : 'same'
    const status = rangeStatus !== 'same' ? rangeStatus : pkg?.status === 'chg' ? 'chg' : 'same'
    return {
      location, name: moduleName(location), status,
      rangeFrom: was[location] ?? null, rangeTo: is[location] ?? null,
      from: pkg?.from ?? null, to: pkg?.to ?? null,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
})
const directLocations = computed(() => new Set(directRows.value.map((r) => r.location)))
const indirectRows = computed(() => packages.value.filter((p) => !directLocations.value.has(p.location)))
const showUnchanged = ref(false)
const visibleIndirect = computed(() => (before.value && !showUnchanged.value ? indirectRows.value.filter((p) => p.status !== 'same') : indirectRows.value))
const hiddenIndirect = computed(() => indirectRows.value.length - visibleIndirect.value.length)
const SIGN = { add: '+', del: '−', chg: '~', same: '' }

const modelDiff = computed(() => diffLines(before.value?.featureModel?.content ?? '', data.value?.featureModel?.content ?? ''))
const counts = computed(() => countChanges(modelDiff.value))
const hunks = computed(() => (before.value ? hunksOf(modelDiff.value, 3) : []))
const formatChanged = computed(() => Boolean(before.value) && before.value.featureModel?.type !== data.value?.featureModel?.type)
const nothing = computed(() => Boolean(before.value)
  && !modules.value.any
  && !directRows.value.some((r) => r.status !== 'same')
  && !indirectRows.value.some((r) => r.status !== 'same')
  && counts.value.added + counts.value.removed === 0
  && !formatChanged.value)

const when = computed(() => {
  const at = data.value?.savedAt
  return at ? new Intl.DateTimeFormat(instance?.proxy?.$i18n?.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at)) : null
})
const marker = (type) => (type === 'add' ? '+' : type === 'del' ? '−' : ' ')
</script>

<template>
  <div class="lvc">
    <div v-if="loading" class="lvc__loading"><Skeleton v-for="i in 6" :key="i" height="22px" /></div>
    <Message v-else-if="error" severity="warn" :closable="false">{{ error }}</Message>
    <p v-else-if="!version" class="lvc__empty">{{ $t('labels.lv_pick') }}</p>

    <template v-else-if="data">
      <header class="lvc__head">
        <h3 class="lvc__title ident">v{{ data.version }}</h3>
        <span v-if="before" class="lvc__meta">{{ $t('labels.lv_against', { version: before.version }) }}</span>
        <span v-else class="lvc__meta">{{ $t('labels.lv_first') }}</span>
        <span v-if="when" class="lvc__meta">· {{ when }}</span>
      </header>

      <p v-if="nothing" class="lvc__empty">{{ $t('labels.lv_no_changes') }}</p>

      <section v-if="data.modular || directRows.length" class="lvc__block">
        <h4>
          {{ $t('labels.lv_modules') }}
          <span class="lvc__counts">
            <span v-if="modules.added.length" class="lvc__plus">+{{ modules.added.length }}</span>
            <span v-if="modules.removed.length" class="lvc__minus">−{{ modules.removed.length }}</span>
            <span v-if="modules.changed.length || directRows.some((r) => r.status === 'chg')">~{{ directRows.filter((r) => r.status === 'chg').length }}</span>
          </span>
        </h4>
        <p v-if="!directRows.length" class="lvc__empty">{{ $t('labels.lv_modules_count', { n: 0 }) }}</p>
        <ul v-else class="lvc__modules">
          <li v-for="m in directRows" :key="m.location" class="lvc__module" :class="`lvc__module--${m.status}`">
            <span class="lvc__sign">{{ SIGN[m.status] }}</span>
            <span class="ident lvc__name">{{ m.name }}</span>
            <span class="lvc__range ident">
              <template v-if="m.status === 'del'">{{ m.rangeFrom }}<template v-if="m.from"> · v{{ m.from }}</template></template>
              <template v-else-if="before && m.from && m.to && m.from !== m.to">v{{ m.from }} → v{{ m.to }}</template>
              <template v-else-if="m.to">v{{ m.to }}</template>
              <template v-if="m.status !== 'del' && m.rangeTo"> <span class="lvc__accepts">({{ before && m.rangeFrom && m.rangeFrom !== m.rangeTo ? `${m.rangeFrom} → ${m.rangeTo}` : m.rangeTo }})</span></template>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="hasPackages && indirectRows.length" class="lvc__block">
        <h4>
          {{ $t('labels.lv_dependencies') }}
          <span class="lvc__counts">
            <span v-if="indirectRows.some((r) => r.status === 'add')" class="lvc__plus">+{{ indirectRows.filter((r) => r.status === 'add').length }}</span>
            <span v-if="indirectRows.some((r) => r.status === 'del')" class="lvc__minus">−{{ indirectRows.filter((r) => r.status === 'del').length }}</span>
            <span v-if="indirectRows.some((r) => r.status === 'chg')">~{{ indirectRows.filter((r) => r.status === 'chg').length }}</span>
          </span>
        </h4>
        <p v-if="!visibleIndirect.length" class="lvc__empty">{{ $t('labels.lv_dependencies_same') }}</p>
        <ul v-else class="lvc__modules">
          <li v-for="p in visibleIndirect" :key="p.location" class="lvc__module" :class="`lvc__module--${p.status}`">
            <span class="lvc__sign">{{ SIGN[p.status] }}</span>
            <span class="ident lvc__name">{{ p.name }}</span>
            <span class="lvc__kind">{{ p.kind === 'metamodel' ? $t('modules.metamodels').toLowerCase() : $t('modules.modules').toLowerCase() }}</span>
            <span class="lvc__range ident">
              <template v-if="p.status === 'chg'">v{{ p.from }} → v{{ p.to }}</template>
              <template v-else>v{{ p.to ?? p.from }}</template>
            </span>
          </li>
        </ul>
        <button v-if="before && indirectRows.length" type="button" class="lvc__toggle" @click="showUnchanged = !showUnchanged">
          {{ showUnchanged ? $t('labels.lv_hide_same') : $t('labels.lv_show_same', { n: hiddenIndirect || indirectRows.filter((r) => r.status === 'same').length }) }}
        </button>
      </section>

      <section class="lvc__block">
        <h4>
          {{ $t('labels.lv_model') }}
          <span v-if="data.featureModel" class="lvc__type ident">{{ data.featureModel.type }}</span>
          <span v-if="before && !formatChanged" class="lvc__counts">
            <span class="lvc__plus">+{{ counts.added }}</span>
            <span class="lvc__minus">−{{ counts.removed }}</span>
          </span>
        </h4>
        <p v-if="!data.featureModel" class="lvc__empty">{{ $t('labels.lv_not_kept') }}</p>
        <p v-else-if="formatChanged" class="lvc__empty">
          {{ $t('labels.lv_format_changed', { from: before.featureModel?.type, to: data.featureModel.type }) }}
        </p>
        <template v-else-if="before">
          <p v-if="!hunks.length" class="lvc__empty">{{ $t('labels.lv_model_same') }}</p>
          <template v-else>
            <div v-for="(hunk, h) in hunks" :key="h" class="lvc__hunk">
              <div v-for="(line, i) in hunk.lines" :key="i" class="lvc__line" :class="`lvc__line--${line.type}`">
                <span class="lvc__mark">{{ marker(line.type) }}</span><span class="lvc__text">{{ line.text }}</span>
              </div>
            </div>
          </template>
        </template>
        <pre v-else class="lvc__plain ident">{{ data.featureModel.content }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped lang="scss">
.lvc { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.lvc__loading { display: flex; flex-direction: column; gap: 8px; }
.lvc__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.lvc__title { margin: 0; font-size: 18px; font-weight: 600; }
.lvc__meta { font-size: 13px; color: var(--p-text-muted-color); }
.lvc__empty { margin: 0; font-size: 13px; color: var(--p-text-faint-color); }
.lvc__block h4 { margin: 0 0 8px; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--p-text-muted-color); }
.lvc__type { padding: 1px 6px; border: 1px solid var(--p-content-border-color); border-radius: 4px; font-size: 10px; }
.lvc__counts { display: inline-flex; gap: 8px; font-family: var(--font-mono); text-transform: none; letter-spacing: 0; }
.lvc__plus { color: var(--status-ok); }
.lvc__minus { color: var(--status-bad); }

.lvc__modules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.lvc__module { display: flex; align-items: center; gap: 10px; padding: 5px 10px; border-radius: 5px; font-size: 13px; }
.lvc__module--add { background: rgba(46, 160, 67, 0.14); }
.lvc__module--del { background: var(--status-bad-soft); }
.lvc__module--chg { background: var(--p-highlight-soft); }
.lvc__module--same { color: var(--p-text-muted-color); }
.lvc__name { font-weight: 600; }
.lvc__kind { font-size: 11px; color: var(--p-text-faint-color); }
.lvc__accepts { color: var(--p-text-faint-color); }
.lvc__toggle { margin-top: 8px; padding: 0; border: 0; background: none; color: var(--p-primary-color); font: inherit; font-size: 12px; cursor: pointer; &:hover { text-decoration: underline; } }
.lvc__sign { width: 12px; text-align: center; font-family: var(--font-mono); }
.lvc__range { margin-left: auto; font-size: 12px; color: var(--p-text-muted-color); }

.lvc__hunk { margin-bottom: 10px; border: 1px solid var(--p-content-border-color); border-radius: 6px; overflow: hidden; font-family: var(--font-mono); font-size: 12px; }
.lvc__line { display: flex; gap: 8px; padding: 0 10px; white-space: pre; line-height: 1.6; }
.lvc__line--add { background: rgba(46, 160, 67, 0.16); }
.lvc__line--del { background: var(--status-bad-soft); }
.lvc__mark { width: 10px; flex-shrink: 0; color: var(--p-text-muted-color); }
.lvc__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.lvc__plain { margin: 0; max-height: 420px; overflow: auto; padding: 12px; border: 1px solid var(--p-content-border-color); border-radius: 6px; font-size: 12px; line-height: 1.5; }
</style>
