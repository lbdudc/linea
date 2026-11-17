<script setup>
import { getCurrentInstance } from 'vue'
import { relativeShort } from 'src/utils/relativeTime'

// One sync of a product, on one line: what it found, who started it, the merge request it opened. A sync has no version of its own.
defineProps({
  run: { type: Object, required: true },
  /** Shows which product it was (the SPL's list holds the syncs of all of them). */
  product: { type: String, default: '' },
})
const instance = getCurrentInstance()
const when = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')
const TONES = { unchanged: 'ok', merged: 'ok', drift: 'warn', mr: 'warn', failed: 'bad' }
</script>

<template>
  <div class="sync-row" :name="`sync-run-${run._id}`">
    <span class="sync-row__tag">⟳ {{ $t('automation.sync_tag') }}</span>
    <strong v-if="product" class="sync-row__product">{{ product }}</strong>
    <span :class="`sync-row__status--${TONES[run.status] ?? 'none'}`">{{ $t(`automation.status_${run.status}`, { n: run.files }) }}</span>
    <span v-if="run.reason" class="sync-row__meta">{{ $te(`automation.reason_${run.reason}`) ? $t(`automation.reason_${run.reason}`) : run.reason }}</span>
    <span class="sync-row__meta">{{ run.trigger === 'cron' ? $t('automation.by_scheduler') : $t('automation.by_person') }}</span>
    <a v-if="run.mr?.url" :href="run.mr.url" target="_blank" rel="noopener" class="sync-row__mr">!{{ run.mr.number }}</a>
    <router-link v-else-if="run.mr?.number" class="sync-row__mr" :to="{ path: `/products/${run.productId}`, query: { tab: 'mrs', mr: String(run.mr.number) } }">!{{ run.mr.number }}</router-link>
    <span class="sync-row__spacer" />
    <span class="sync-row__meta">{{ when(run.finishedAt ?? run.startedAt) }}</span>
  </div>
</template>

<style scoped>
.sync-row { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 10px; border-left: 2px solid var(--sync); font-size: 0.8125rem; }
.sync-row__tag, .sync-row__mr { color: var(--sync); font-weight: 600; }
.sync-row__meta { color: var(--text-muted); white-space: nowrap; }
.sync-row__spacer { flex-grow: 1; }
.sync-row__status--ok { color: var(--status-ok); }
.sync-row__status--warn { color: var(--status-warn); }
.sync-row__status--bad { color: var(--status-bad); }
</style>
