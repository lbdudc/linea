<script setup>
import { computed } from 'vue'
import PrimeButton from 'primevue/button'
import PrimeSelect from 'primevue/select'
import ProgressSpinner from 'primevue/progressspinner'
import Tooltip from 'primevue/tooltip'
import GenerationLogList from 'src/components/generation/GenerationLogList.vue'
import SyncRunRow from 'src/components/generation/SyncRunRow.vue'
import { pipelineColorVar, pipelineWord } from 'src/utils/pipelineStatus'

/**
 * The history of a product: the versions it was generated as, newest first, each expandable to the log of its generation, with what can
 * be done to a version (see how it was deployed, what it changed, take its spec or code, go back to it) and a comparison of any two points.
 * It only shows: what each action does is up to the page, which hears of it.
 */
const props = defineProps({
  versions: { type: Array, required: true },
  /** The syncs of the product (they have no version of their own): each is shown above the version the product was at when it ran. */
  syncs: { type: Array, default: () => [] },
  /** `all` | `versions` | `syncs`. */
  filter: { type: String, default: 'all' },
  /** `[{ label, value }]` for the two selects of the comparison. */
  options: { type: Array, required: true },
  from: { type: String, default: null },
  to: { type: String, default: null },
  versionPipelines: { type: Object, default: () => ({}) },
  expandedVersion: { type: String, default: null },
  logs: { type: Object, default: () => ({}) },
  logsLoading: { type: Object, default: () => ({}) },
  /** The export in flight (`v1.0.0:spec`, `v1.0.0:zip`), one at a time. */
  exporting: { type: String, default: null },
  armedRestore: { type: String, default: null },
  restoring: { type: Boolean, default: false },
})
const emit = defineEmits(['update:from', 'update:to', 'compare', 'toggle', 'open-deployment', 'open-menu', 'export-spec', 'export-zip', 'restore'])

const vTooltip = Tooltip

// Newest first: a sync belongs to the version the product had when it ran, so it goes just above that version (after the next one).
const syncsAbove = computed(() => {
  const groups = {}
  const known = new Set(props.versions)
  const top = []
  for (const run of props.syncs.filter((r) => r.status !== 'running')) {
    if (run.version && known.has(run.version)) (groups[run.version] ??= []).push(run)
    else top.push(run)
  }
  return { groups, top }
})
const showVersions = computed(() => props.filter !== 'syncs')
const showSyncs = computed(() => props.filter !== 'versions')
</script>

<template>
  <div>
  <div v-if="showVersions" class="history-compare" name="history-compare" role="group" :aria-label="$t('generation.compare_versions')">
    <span class="history-compare__label">{{ $t('generation.compare_versions') }}</span>
    <PrimeSelect
      :model-value="from"
      @update:model-value="emit('update:from', $event)"
      :options="options"
      option-label="label"
      option-value="value"
      size="small"
      :placeholder="$t('generation.compare_from')"
      name="compare-from"
      class="history-compare__select"
    />
    <i class="pi pi-arrow-right text-faint" aria-hidden="true" />
    <PrimeSelect
      :model-value="to"
      @update:model-value="emit('update:to', $event)"
      :options="options"
      option-label="label"
      option-value="value"
      size="small"
      :placeholder="$t('generation.compare_to')"
      name="compare-to"
      class="history-compare__select"
    />
    <PrimeButton
      size="small"
      :label="$t('generation.compare_action')"
      :disabled="!from || !to || from === to"
      name="compare-run"
      @click="emit('compare')"
    >
      <template #icon><i class="pi pi-arrow-right-arrow-left" style="font-size: 13px" aria-hidden="true" /></template>
    </PrimeButton>
  </div>

  <div class="history-timeline">
    <template v-if="showSyncs">
      <SyncRunRow v-for="run in syncsAbove.top" :key="run._id" :run="run" class="timeline-sync" />
    </template>
    <template v-for="version in versions" :key="version">
    <template v-if="showSyncs">
      <SyncRunRow v-for="run in syncsAbove.groups[version] ?? []" :key="run._id" :run="run" class="timeline-sync" />
    </template>
    <div
      v-if="showVersions"
      class="timeline-item"
      :class="{ 'timeline-item--expanded': expandedVersion === version }"
    >
      <div class="timeline-item__head">
        <button
          class="timeline-item__row"
          :aria-expanded="expandedVersion === version ? 'true' : 'false'"
          @click="emit('toggle', version)"
        >
          <div class="timeline-item__dot" />
          <span class="timeline-item__version">v{{ version }}</span>
          <span
            v-if="versionPipelines[version]"
            class="timeline-item__pipeline"
            :style="{ color: pipelineColorVar(versionPipelines[version].status) }"
            :name="`version-pipeline-${version}`"
          >● {{ $t(`generation.gr_pipeline_${pipelineWord(versionPipelines[version].status)}`) }}</span>
          <div class="timeline-item__spacer" />
          <ProgressSpinner
            v-if="logsLoading[version]"
            style="width: 16px; height: 16px"
            :dt="{ colorOne: 'var(--p-primary-color)', colorTwo: 'var(--p-primary-color)', colorThree: 'var(--p-primary-color)', colorFour: 'var(--p-primary-color)' }"
          />
          <i v-else :class="expandedVersion === version ? 'pi pi-angle-up' : 'pi pi-angle-down'" class="text-faint" style="font-size: 18px" aria-hidden="true" />
        </button>

        <div class="timeline-item__actions" :name="`version-actions-${version}`">
          <PrimeButton
            text rounded size="small" icon="pi pi-send"
            :aria-label="$t('generation.gr_open_deployment')"
            v-tooltip.bottom="$t('generation.gr_open_deployment')"
            :name="`version-deployment-${version}`"
            @click="emit('open-deployment', version)"
          />
          <PrimeButton
            text rounded size="small" icon="pi pi-arrow-right-arrow-left"
            :aria-label="$t('generation.version_changes')"
            v-tooltip.bottom="$t('generation.version_changes')"
            :name="`version-changes-${version}`"
            @click="emit('open-menu', $event, version)"
          />
          <PrimeButton
            text rounded size="small" icon="pi pi-download"
            :aria-label="$t('generation.export_spec')"
            v-tooltip.bottom="$t('generation.export_spec')"
            :disabled="Boolean(exporting)"
            :loading="exporting === `v${version}:spec`"
            :name="`version-spec-${version}`"
            @click="emit('export-spec', version)"
          />
          <PrimeButton
            text rounded size="small" icon="pi pi-box"
            :aria-label="$t('generation.export_code')"
            v-tooltip.bottom="$t('generation.export_code')"
            :disabled="Boolean(exporting)"
            :loading="exporting === `v${version}:zip`"
            :name="`version-zip-${version}`"
            @click="emit('export-zip', version)"
          />
          <PrimeButton
            text rounded size="small"
            :icon="armedRestore === version ? 'pi pi-check' : 'pi pi-replay'"
            :severity="armedRestore === version ? 'danger' : undefined"
            :aria-label="$t('generation.version_restore')"
            v-tooltip.bottom="armedRestore === version ? $t('generation.version_restore_confirm', { version }) : $t('generation.version_restore')"
            :disabled="restoring"
            :name="`version-restore-${version}`"
            @click="emit('restore', version)"
          />
        </div>
      </div>

      <transition name="slide-down">
        <div v-if="expandedVersion === version && logs[version]" class="timeline-item__logs">
          <div class="timeline-item__logs-list">
            <GenerationLogList :logs="logs[version]" />
          </div>
        </div>
      </transition>
    </div>
    </template>
  </div>
  </div>
</template>

<style scoped lang="scss">
.timeline-item__head {
  display: flex;
  align-items: center;
  gap: 4px;

  .timeline-item__row { flex: 1; min-width: 0; }
}

.timeline-item__pipeline {
  margin-left: 12px;
  font-size: 0.75rem;
  white-space: nowrap;
}

.timeline-item__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
}

.history-compare {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0 0;

  &__label { font-size: 0.8125rem; color: var(--text-muted); margin-right: 4px; }
  &__select { min-width: 150px; }
}

.timeline-sync { margin: 0 0 0 24px; }

.history-timeline {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
}

.timeline-item {
  position: relative;
  padding-left: 24px;

  &::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 22px;
    bottom: 0;
    width: 2px;
    background: var(--card-border);
  }

  &:last-child::before { display: none; }

  &__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px;
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    text-align: left;
    border-radius: 6px;

    &:hover       { background: var(--surface-alt); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); }
  }

  &__dot {
    position: absolute;
    left: 0;
    top: 18px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--card-bg);
    border: 2px solid var(--p-primary-color);
    flex-shrink: 0;
  }

  &--expanded &__dot { background: var(--p-primary-color); }

  &__version {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-heading);
    font-family: var(--font-mono);
  }

  &__spacer { flex: 1; }

  &__logs {
    padding: 0 0 8px 0;
    border-left: 2px solid var(--card-border);
    margin-left: -17px;
    padding-left: 17px;
  }

  &__logs-list {
    display: flex;
    flex-direction: column;
  }
}

.text-faint { color: var(--p-text-faint-color); }

.slide-down-enter-active { transition: all 0.2s ease-out; }
.slide-down-leave-active { transition: all 0.15s ease-in; }
.slide-down-enter-from,
.slide-down-leave-to    { opacity: 0; transform: translateY(-6px); }
</style>
