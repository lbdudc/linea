<script setup>
import { computed, getCurrentInstance } from 'vue'
import { relativeShort } from 'src/utils/relativeTime'

// The sync of a product at a glance, as one cell of the strip on the overview: whether its code is in line with its SPL as of the last sync,
// when that was and when the next runs. A sync never changes the version. It only shows; the page runs the sync.
const props = defineProps({
  /** What the server says about the product's automation (see ProductAutomation); null while it arrives. */
  automation: { type: Object, default: null },
  /** The last run of a sync of this product, or null if there is none. */
  lastRun: { type: Object, default: null },
  syncing: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
defineEmits(['sync', 'configure'])
const instance = getCurrentInstance()

// ok: nothing to do; warn: a person has to look; bad: it failed
const TONES = { unchanged: 'ok', merged: 'ok', drift: 'warn', mr: 'warn', failed: 'bad' }
const status = computed(() => props.lastRun?.status ?? null)
const when = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')
const next = computed(() => (props.automation?.effective?.enabled ? props.automation.nextSyncAt ?? null : null))
const schedule = computed(() => {
  const effective = props.automation?.effective
  if (!effective?.enabled) return null
  return effective.preset === 'cron' ? effective.cron : instance.proxy.$t(`automation.preset_${effective.preset}`)
})
</script>

<template>
  <div class="ln-strip__cell" name="product-sync-card">
    <span class="ln-strip__label">{{ $t('automation.sync') }}</span>
    <strong class="ln-strip__value" :class="`ln-strip__value--${TONES[status] ?? 'none'}`" name="sync-status">
      {{ status ? $t(`automation.status_${status}`, { n: lastRun.files }) : $t('automation.never_synced') }}
    </strong>
    <span class="ln-strip__sub">
      <template v-if="lastRun?.reason">{{ $te(`automation.reason_${lastRun.reason}`) ? $t(`automation.reason_${lastRun.reason}`) : lastRun.reason }} · </template>
      <template v-if="lastRun">{{ $t('automation.last_sync', { when: when(lastRun.finishedAt ?? lastRun.startedAt) }) }}</template>
      <template v-if="lastRun && next"> · </template>
      <template v-if="next">{{ $t('automation.next_sync', { when: when(next) }) }}</template>
      <template v-if="!lastRun && !next">{{ $t('automation.version_unchanged') }}</template>
    </span>
    <span class="ln-strip__links">
      <button type="button" class="ln-link ln-link--sync" :disabled="disabled || syncing" name="sync-now" @click="$emit('sync')">
        <i v-if="syncing" class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('automation.sync_now') }}
      </button>
      <a v-if="lastRun?.mr?.url" :href="lastRun.mr.url" target="_blank" rel="noopener" class="ln-link">!{{ lastRun.mr.number }}</a>
      <button v-if="automation" type="button" class="ln-link" name="sync-configure" @click="$emit('configure')">
        {{ schedule ? `${automation.effective.source === 'line' ? $t('automation.inherited') : $t('automation.own')} · ${schedule}` : $t('automation.not_scheduled') }}
      </button>
    </span>
  </div>
</template>
