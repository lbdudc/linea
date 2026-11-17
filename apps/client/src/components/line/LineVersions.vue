<script setup>
import { computed, ref, watch, getCurrentInstance } from 'vue'
import lineService from 'src/services/lineService'
import LineVersionChanges from 'components/line/LineVersionChanges.vue'
import ChangelogPanel from 'components/changelog/ChangelogPanel.vue'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Skeleton from 'primevue/skeleton'
import { compareVersions } from 'src/utils/versions'

// The versions of a line, like the history of a product: each one is a tag of the repository, kept when the line reached it, and any
// two can be compared. The list is on the left and what the chosen one changed on the right. A line that is older than this history
// starts at the version it had when the history began.
const props = defineProps({
  lineId: { type: String, required: true },
  // the version the line has now: the history is asked again when it changes
  version: { type: String, default: null },
})

const instance = getCurrentInstance()

const versions = ref([])
const loading = ref(true)
const failed = ref(false)
const selected = ref(null)
const selectedFrom = ref(null)
let sequence = 0

const load = async () => {
  const mine = ++sequence
  loading.value = true
  failed.value = false
  try {
    const result = await lineService.getVersions({ id: props.lineId })
    if (mine !== sequence) return
    versions.value = result.versions ?? []
    selected.value = versions.value[0]?.version ?? null
    selectedFrom.value = null
  } catch {
    if (mine === sequence) { failed.value = true; versions.value = []; selected.value = null }
  } finally {
    if (mine === sequence) loading.value = false
  }
}
watch(() => [props.lineId, props.version], load, { immediate: true })

const when = (at) => (at ? new Intl.DateTimeFormat(instance?.proxy?.$i18n?.locale, { dateStyle: 'medium' }).format(new Date(at)) : null)

const choose = (version) => {
  selected.value = version
  selectedFrom.value = null
}

const options = computed(() => versions.value.map((v) => ({ label: `v${v.version}`, value: v.version })))
const compareFrom = ref(null)
const compareTo = ref(null)
const compare = () => {
  const [older, newer] = [compareFrom.value, compareTo.value].sort(compareVersions)
  selected.value = newer
  selectedFrom.value = older
}
</script>

<template>
  <section class="line-versions ln-block">
    <div v-if="loading" class="line-versions__loading"><Skeleton v-for="i in 4" :key="i" height="38px" /></div>
    <p v-else-if="failed || !versions.length" class="line-versions__empty">{{ $t('labels.no_history') }}</p>

    <template v-else>
      <div class="line-versions__list-col">
        <div v-if="versions.length > 1" class="line-versions__compare" role="group" :aria-label="$t('generation.compare_versions')">
          <Select v-model="compareFrom" :options="options" option-label="label" option-value="value" size="small" :placeholder="$t('generation.compare_from')" name="line-compare-from" />
          <i class="pi pi-arrow-right" aria-hidden="true" />
          <Select v-model="compareTo" :options="options" option-label="label" option-value="value" size="small" :placeholder="$t('generation.compare_to')" name="line-compare-to" />
          <Button size="small" icon="pi pi-arrow-right-arrow-left" :aria-label="$t('generation.compare_action')" :disabled="!compareFrom || !compareTo || compareFrom === compareTo" name="line-compare-run" @click="compare" />
        </div>

        <ul class="line-versions__list">
          <li v-for="v in versions" :key="v.version">
            <button
              type="button"
              class="line-versions__row"
              :class="{ 'line-versions__row--on': selected === v.version && !selectedFrom }"
              :name="`line-version-${v.version}`"
              :aria-current="selected === v.version ? 'true' : undefined"
              @click="choose(v.version)"
            >
              <span class="line-versions__dot" :class="{ 'line-versions__dot--current': v.current }" aria-hidden="true" />
              <span class="line-versions__version ident">v{{ v.version }}</span>
              <span v-if="v.current" class="line-versions__current">{{ $t('labels.lv_current') }}</span>
              <span v-else-if="!v.kept" class="line-versions__detail">{{ $t('labels.lv_not_kept') }}</span>
              <span class="line-versions__spacer" />
              <span v-if="v.modules !== null" class="line-versions__detail">{{ $t('labels.lv_modules_count', { n: v.modules }) }}</span>
              <span v-if="v.savedAt" class="line-versions__when">{{ when(v.savedAt) }}</span>
            </button>
            <ChangelogPanel :name="`line-changelog-${v.version}`" :load="() => lineService.getChangelog({ id: lineId, to: v.version })" />
          </li>
        </ul>
        <p v-if="versions.length <= 1" class="line-versions__hint">{{ $t('labels.lv_history_starts') }}</p>
      </div>

      <div class="line-versions__detail-col">
        <ChangelogPanel
          v-if="selectedFrom"
          :key="`${selectedFrom}-${selected}`"
          name="line-changelog-range"
          open
          :label="$t('changelog.title')"
          :load="() => lineService.getChangelog({ id: lineId, from: selectedFrom, to: selected })"
        />
        <LineVersionChanges :line-id="lineId" :version="selected" :from="selectedFrom" />
      </div>
    </template>
  </section>
</template>

<style scoped lang="scss">
.line-versions {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap: 32px;
  align-items: start;
  min-width: 0;

  @media (max-width: 1000px) { grid-template-columns: minmax(0, 1fr); gap: 24px; }
}
.line-versions__loading { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; }
.line-versions__empty { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--p-text-dim-color); }
.line-versions__hint { margin: 8px 0 0; font-size: 12px; color: var(--p-text-dim-color); }
.line-versions__list-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.line-versions__compare { display: flex; align-items: center; gap: 6px; color: var(--p-text-faint-color); :deep(.p-select) { flex: 1; min-width: 0; } }
.line-versions__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.line-versions__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 0;
  border-left: 2px solid transparent;
  border-bottom: 1px solid var(--p-content-hover-background);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover { background: var(--p-content-hover-background); }
  &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
  &--on { border-left-color: var(--p-primary-color); background: var(--p-highlight-soft); }
}
.line-versions__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--p-text-faint-color); }
.line-versions__dot--current { background: var(--status-ok); }
.line-versions__version { font-size: 13px; font-weight: 600; }
.line-versions__current { padding: 0 7px; border-radius: 9px; background: var(--p-highlight-soft); color: var(--p-primary-color); font-size: 11px; }
.line-versions__detail { font-size: 12px; color: var(--p-text-muted-color); }
.line-versions__spacer { flex: 1; }
.line-versions__when { font-size: 12px; color: var(--p-text-dim-color); }
.line-versions__detail-col { min-width: 0; }
</style>
