<script setup>
import { computed, getCurrentInstance, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import Skeleton from 'primevue/skeleton'
import MigrationStatusPanel from 'src/components/line/MigrationStatusPanel.vue'
import { INBOX_FILTERS } from 'src/composables/useAttentionInbox'
import { relativeShort } from 'src/utils/relativeTime'
import { reasonText } from 'src/utils/inboxReason'

const props = defineProps({
  items: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  counts: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
})

const filter = defineModel('filter', { type: String, default: 'all' })

const search = ref('')
const shown = computed(() => {
  const text = search.value.trim().toLowerCase()
  if (!text) return props.items
  return props.items.filter((item) => item.name.toLowerCase().includes(text) || (item.line ?? '').toLowerCase().includes(text))
})

const router = useRouter()
const instance = getCurrentInstance()

const FILTER_LABELS = {
  all: 'home.filter_all',
  fail: 'home.filter_fail',
  conflict: 'home.filter_conflict',
  deploy: 'home.filter_deploy',
  stale: 'home.filter_stale',
}
const ACTION_LABELS = {
  view_error: 'home.action_view_error',
  resolve: 'home.action_resolve',
  deploy: 'home.action_deploy',
  sync: 'home.action_sync',
}

const chipText = reasonText

const when = (since) => (since ? relativeShort(since, instance?.proxy?.$i18n?.locale) : '')

const migrationOpen = shallowRef(false)
const migrationLineId = shallowRef(null)

const run = (item) => {
  const { action } = item
  if (action.needsMigration && item.lineId) {
    migrationLineId.value = String(item.lineId)
    migrationOpen.value = true
    return
  }
  router.push(action.tab ? `/products/${item.id}?tab=${action.tab}` : `/products/${item.id}`)
}
</script>

<template>
  <section class="inbox" :aria-busy="loading" name="attention-inbox">
    <template v-if="loading">
      <div class="inbox__head"><Skeleton width="120px" height="18px" /></div>
      <Skeleton v-for="n in 3" :key="n" height="46px" class="inbox__skeleton" />
    </template>

    <div v-else-if="total === 0" class="inbox__healthy" name="inbox-healthy">
      <i class="pi pi-check" aria-hidden="true" />
      {{ $t('home.all_healthy') }}
    </div>

    <template v-else>
      <div class="inbox__head">
        <h2 class="inbox__title">{{ $t('home.inbox_title') }} <span class="inbox__count">{{ total }}</span></h2>
        <input
          v-model="search"
          type="search"
          class="inbox__search"
          name="inbox-search"
          :placeholder="$t('home.search_placeholder')"
          :aria-label="$t('home.search_placeholder')"
        >
        <div class="inbox__filters" role="group" :aria-label="$t('home.filter_label')">
          <button
            v-for="key in INBOX_FILTERS"
            :key="key"
            type="button"
            class="inbox__chip"
            :class="{ 'inbox__chip--on': filter === key }"
            :aria-pressed="filter === key"
            :name="`inbox-filter-${key}`"
            @click="filter = key"
          >
            {{ $t(FILTER_LABELS[key]) }} {{ counts[key] ?? 0 }}
          </button>
        </div>
      </div>

      <div class="inbox__scroll">
        <div class="inbox__table">
          <p v-if="shown.length === 0" class="inbox__none">{{ $t('home.filter_empty') }}</p>
          <div v-for="item in shown" :key="item.id" class="inbox__row" :name="`inbox-row-${item.id}`">
            <span class="inbox__dot" :class="`inbox__dot--${item.severity === 3 ? 'bad' : 'warn'}`" aria-hidden="true" />
            <span class="inbox__who">
              <router-link :to="`/products/${item.id}`" class="inbox__name">{{ item.name }}</router-link>
              <span class="inbox__line">{{ item.line }}</span>
            </span>
            <span class="inbox__reasons">
              <span v-for="reason in item.reasons" :key="reason.key" class="inbox__reason" :class="`inbox__reason--${reason.tone}`">
                {{ chipText(reason, $t) }}
              </span>
            </span>
            <span class="inbox__end">
              <span class="inbox__when">{{ when(item.since) }}</span>
              <button type="button" class="inbox__action" :name="`inbox-action-${item.id}`" @click="run(item)">
                {{ $t(ACTION_LABELS[item.action.key]) }}
              </button>
            </span>
          </div>
        </div>
      </div>
    </template>

    <MigrationStatusPanel v-if="migrationLineId" v-model:dialog="migrationOpen" :line-id="migrationLineId" />
  </section>
</template>

<style scoped lang="scss">
.inbox {
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  background: var(--p-content-background);
  overflow: hidden;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 10px;
    padding: 10px 14px;
  }

  &__skeleton { margin: 0 14px 8px; width: auto; }

  &__title { margin: 0; font-size: 15px; font-weight: 600; }
  &__count { color: var(--status-bad); }

  &__search {
    flex: 1 1 200px;
    min-width: 0;
    max-width: 320px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 14px;
    font: inherit;
    font-size: 12px;
    color: var(--p-text-color);
    background: var(--p-content-background);

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__filters { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }

  &__chip {
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 14px;
    font: inherit;
    font-size: 12px;
    color: var(--p-text-color);
    background: var(--p-content-background);
    cursor: pointer;

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
    &--on { color: var(--p-primary-contrast-color); background: var(--p-primary-color); border-color: var(--p-primary-color); }
  }

  &__scroll { overflow: auto; max-height: min(460px, 55vh); }
  &__table { min-width: 560px; }
  &__none { margin: 0; padding: 12px 14px; font-size: 12px; color: var(--p-text-muted-color); border-top: 1px solid var(--p-content-hover-background); }

  &__row {
    display: grid;
    grid-template-columns: 8px minmax(150px, 240px) minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-height: 46px;
    padding: 0 14px;
    border-top: 1px solid var(--p-content-hover-background);

    &:hover { background: var(--p-content-hover-background); }
  }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    &--bad { background: var(--status-bad); }
    &--warn { background: var(--status-warn); }
  }

  &__who { display: flex; flex-direction: column; justify-content: center; min-width: 0; line-height: 1.25; }
  &__name { font-weight: 600; font-size: 13px; color: var(--p-text-color); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    &:hover { text-decoration: underline; }
  }
  &__line { font-size: 11px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  &__reasons { display: flex; flex-wrap: wrap; gap: 4px; }
  &__reason {
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 12px;
    color: var(--p-text-muted-color);
    background: var(--p-content-hover-background);

    &--bad { color: var(--status-bad-strong); background: var(--status-bad-soft); }
    &--warn { color: var(--status-warn-strong, var(--status-warn)); background: var(--status-warn-soft); }
  }

  &__end { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  &__when { min-width: 56px; font-size: 12px; text-align: right; color: var(--p-text-muted-color); white-space: nowrap; }

  &__action {
    min-width: 92px;
    min-height: 30px;
    padding: 0 12px;
    border: 1px solid var(--p-primary-color);
    border-radius: 7px;
    font: inherit;
    font-size: 12px;
    color: var(--p-primary-contrast-color);
    background: var(--p-primary-color);
    cursor: pointer;

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
  }

  &__healthy {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    font-weight: 600;
    color: var(--status-ok);
  }
}
</style>
