<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ProgressBar from 'primevue/progressbar'
import { useRunningActivity } from 'src/composables/useRunningActivity'
import { rememberLastDeployment, lastDeployment } from 'stores/lastDeployment'
import dashboardService from 'src/services/dashboardService'
import { relativeShort } from 'src/utils/relativeTime'

const router = useRouter()
const instance = getCurrentInstance()
const { running, last } = useRunningActivity()

const open = ref(false)
const root = ref(null)
const count = computed(() => running.value.length)

const KIND_LABEL = { generation: 'home.running_generating', sync: 'home.running_syncing' }
const stateLabel = (item) => (item.state === 'pending' ? 'home.running_queued' : KIND_LABEL[item.kind])
const OUTCOME_CLASS = { success: 'ok', warning: 'warn', error: 'bad' }
const when = (value) => (value ? relativeShort(value, instance?.proxy?.$i18n?.locale) : '')

let asked = false
async function loadLast() {
  if (asked || lastDeployment.value) return
  asked = true
  try {
    const data = await dashboardService.get({ days: 7 })
    rememberLastDeployment(data?.recent?.[0])
  } catch {
    asked = false
  }
}

const toggle = () => {
  open.value = !open.value
  if (open.value) loadLast()
}

const go = (item) => {
  open.value = false
  if (item.productId) router.push(`/products/${item.productId}`)
}

const onDocumentClick = (event) => {
  if (open.value && root.value && !root.value.contains(event.target)) open.value = false
}
const onKeyDown = (event) => {
  if (event.key === 'Escape') open.value = false
}

watch(count, (n) => { if (n === 0) open.value = false })
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div v-if="count > 0" ref="root" class="running">
    <button
      type="button"
      class="running__pill"
      name="running-pill"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="toggle"
    >
      <i class="pi pi-sync running__spin" aria-hidden="true" />
      {{ $t('home.running_pill', { n: count }) }}
    </button>

    <div v-if="open" class="running__panel" role="dialog" :aria-label="$t('home.running_label')" name="running-panel">
      <button v-for="item in running" :key="item.id" type="button" class="running__item" @click="go(item)">
        <span class="running__row">
          <strong class="running__name">{{ item.name }}</strong>
          <span class="running__what">{{ $t(stateLabel(item)) }}</span>
        </span>
        <ProgressBar :mode="item.state === 'pending' ? 'determinate' : 'indeterminate'" :value="0" class="running__bar" :show-value="false" />
      </button>

      <button v-if="last" type="button" class="running__last" name="running-last" @click="go(last)">
        <span class="running__dot" :class="`running__dot--${OUTCOME_CLASS[last.outcome] ?? ''}`" aria-hidden="true" />
        <span class="running__last-name">{{ last.productName }}<template v-if="last.version"> v{{ last.version }}</template></span>
        <span class="running__when">{{ when(last.deployedAt) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.running {
  position: relative;
  margin-right: 8px;

  &__pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 14px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--p-primary-color);
    background: var(--p-highlight-background);
    cursor: pointer;

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
  }

  &__spin { font-size: 12px; animation: running-spin 1.2s linear infinite; }

  &__panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 30;
    width: 300px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 10px;
    background: var(--p-content-background);
    box-shadow: 0 10px 24px var(--overlay-shadow);
    color: var(--p-text-color);
  }

  &__item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0;
    border: 0;
    font: inherit;
    font-size: 13px;
    text-align: left;
    color: inherit;
    background: none;
    cursor: pointer;
  }

  &__row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  &__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__what { color: var(--p-text-muted-color); font-size: 12px; }
  &__bar { height: 4px; }

  &__last {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0 0;
    border: 0;
    border-top: 1px solid var(--p-content-border-color);
    font: inherit;
    font-size: 12px;
    color: var(--p-text-muted-color);
    background: none;
    cursor: pointer;

    &:hover { color: var(--p-text-color); }
  }

  &__last-name { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--p-text-faint-color); flex-shrink: 0;
    &--ok { background: var(--status-ok); }
    &--warn { background: var(--status-warn); }
    &--bad { background: var(--status-bad); }
  }
}

@keyframes running-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .running__spin { animation: none; }
}
</style>
