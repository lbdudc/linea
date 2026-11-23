<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import pluginService from 'src/services/pluginService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import Message from 'primevue/message'

// The service a plugin runs in Docker: its containers and what they have been saying (`docker compose logs`).
const props = defineProps({ plugin: { type: Object, required: true }, title: { type: String, default: '' } })
const emit = defineEmits(['close', 'changed'])
const t = useT()

const visible = ref(true)
const info = ref(null)
const loading = ref(true)
const failed = ref(null)
const busy = ref(false)
const tail = ref(200)
const follow = ref(true)
const ALL = '*' // PrimeVue's Select reads an empty value as "nothing chosen"
const only = ref(ALL)
const logBox = ref(null)
const tails = computed(() => [100, 200, 500, 1000, 2000].map((value) => ({ value, label: t('plugins.log_lines', { n: value }) })))
const REFRESH_MS = 3000

const load = async () => {
  try {
    info.value = await pluginService.serviceLogs(props.plugin.id, tail.value, only.value === ALL ? null : only.value)
    failed.value = null
    if (follow.value) await nextTick(() => { if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight })
  } catch (e) {
    failed.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}

let timer = null
const schedule = () => { clearInterval(timer); timer = follow.value ? setInterval(load, REFRESH_MS) : null }
onMounted(() => { load(); schedule() })
onBeforeUnmount(() => clearInterval(timer))
watch(follow, schedule)
watch([tail, only], load)
const onlyOptions = computed(() => [{ value: ALL, label: t('plugins.log_all') }, ...(info.value?.containers ?? []).map((c) => ({ value: c.service, label: c.service }))])

// `docker compose logs` lines are `service | 2026-11-23T10:46:44.1Z message`: pulled apart so that each part reads at a glance
const LINE = /^(\S+?)\s+\|\s(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/
const ERROR = /\b(error|fatal|panic|exception|ERR!?)\b|"s":"(E|F)"/i
const WARN = /\b(warn(ing)?|deprecat\w+)\b|"s":"W"/i
const lines = computed(() => {
  const colors = new Map()
  return String(info.value?.logs ?? '').split('\n').filter(Boolean).map((raw, i) => {
    const m = LINE.exec(raw)
    const text = m ? m[3] : raw
    if (m && !colors.has(m[1])) colors.set(m[1], colors.size % 6)
    return {
      i,
      service: m ? m[1].replace(/^agents-|^linea-/, '') : null,
      color: m ? colors.get(m[1]) : 0,
      date: m ? m[2].slice(0, 10) : null,
      time: m ? m[2].slice(11, 19) : null,
      text,
      level: ERROR.test(text) ? 'error' : WARN.test(text) ? 'warn' : null,
    }
  })
})

const running = computed(() => ['running', 'starting', 'degraded'].includes(info.value?.state))
const act = async (action) => {
  busy.value = true
  try {
    await pluginService[action](props.plugin.id)
    emit('changed')
    await load()
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
    await load()
  } finally {
    busy.value = false
  }
}
const copy = async () => {
  try {
    await navigator.clipboard.writeText(info.value?.logs ?? '')
    notify({ type: 'positive', message: t('plugins.log_copied') })
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  }
}
const severityOf = (c) =>
  c.state === 'running' ? (c.health === 'unhealthy' ? 'danger' : c.health === 'starting' ? 'warn' : 'success')
    : ['created', 'restarting'].includes(c.state) ? 'warn' : c.exitCode === 0 ? 'secondary' : 'danger'
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" :style="{ width: '60rem', maxWidth: '96vw' }" @hide="emit('close')">
    <div class="svc">
      <Message v-if="failed" severity="error" :closable="false">{{ failed }}</Message>
      <Message v-if="info?.state === 'unavailable'" severity="warn" :closable="false">{{ t('plugins.service_hint', { why: info.error }) }}</Message>

      <ul v-if="info?.containers?.length" class="svc__containers">
        <li v-for="c in info.containers" :key="c.name">
          <span class="svc__name">{{ c.service || c.name }}</span>
          <Tag :value="c.health ? `${c.state} · ${c.health}` : c.state" :severity="severityOf(c)" />
          <span v-if="c.ports?.length" class="svc__ports">{{ c.ports.join(', ') }}</span>
          <span class="svc__status">{{ c.status }}</span>
        </li>
      </ul>
      <p v-else-if="info && info.state !== 'unavailable'" class="svc__none">{{ t('plugins.service_no_containers') }}</p>

      <div class="svc__bar">
        <Button v-if="!running" :label="t('plugins.service_start')" icon="pi pi-play" size="small" :loading="busy" :disabled="info?.state === 'unavailable'" @click="act('startService')" />
        <Button v-else :label="t('plugins.service_stop')" icon="pi pi-stop" size="small" severity="secondary" outlined :loading="busy" @click="act('stopService')" />
        <Select v-model="only" :options="onlyOptions" option-label="label" option-value="value" size="small" />
        <Select v-model="tail" :options="tails" option-label="label" option-value="value" size="small" />
        <label class="svc__follow"><ToggleSwitch v-model="follow" /> {{ t('plugins.log_follow') }}</label>
        <span class="svc__spacer" />
        <Button icon="pi pi-refresh" size="small" severity="secondary" text :aria-label="t('plugins.refresh')" :loading="loading" @click="load" />
        <Button icon="pi pi-copy" size="small" severity="secondary" text :aria-label="t('plugins.log_copy')" :disabled="!info?.logs" @click="copy" />
      </div>

      <div ref="logBox" class="svc__log" tabindex="0" role="log">
        <div v-for="line in lines" :key="line.i" :class="['svc__line', line.level && `svc__line--${line.level}`]">
          <span v-if="line.time" class="svc__time" :title="line.date">{{ line.time }}</span>
          <span v-if="line.service" :class="['svc__tag', `svc__tag--${line.color}`]">{{ line.service }}</span>
          <span class="svc__text">{{ line.text }}</span>
        </div>
        <p v-if="!lines.length && !loading" class="svc__empty">{{ t('plugins.log_empty') }}</p>
      </div>
      <Message v-if="info?.error && info.state !== 'unavailable'" severity="warn" :closable="false">{{ info.error }}</Message>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.svc {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__containers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.875rem;
    }
  }

  &__name { font-weight: 600; min-width: 9rem; }
  &__ports, &__status { color: var(--p-text-muted-color); font-size: 0.8125rem; }
  &__none { margin: 0; color: var(--p-text-muted-color); }

  &__bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  &__follow { display: inline-flex; align-items: center; gap: 6px; font-size: 0.875rem; }
  &__spacer { flex: 1; }

  &__log {
    // a terminal-like pane built on the app's tokens, so it follows the theme by itself (light and dark)
    height: 24rem;
    overflow: auto;
    padding: 6px 0;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    background: color-mix(in srgb, var(--p-text-color) 4%, var(--p-surface-ground));
    color: var(--p-text-secondary-color);
    font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  &__line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 1px 12px;
    border-left: 2px solid transparent;

    &:hover { background: var(--p-content-hover-background); }
    &--error { color: var(--status-bad-strong); background: var(--status-bad-soft); border-left-color: var(--status-bad); }
    &--warn { color: var(--status-warn); background: var(--status-warn-soft); border-left-color: var(--status-warn); }
  }

  &__time { flex: none; color: var(--p-text-dim-color); }
  &__tag {
    flex: none;
    width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    &--0 { color: var(--chart-1); }
    &--1 { color: var(--chart-3); }
    &--2 { color: var(--chart-5); }
    &--3 { color: var(--chart-4); }
    &--4 { color: var(--chart-2); }
    &--5 { color: var(--p-text-muted-color); }
  }
  &__text { min-width: 0; white-space: pre-wrap; word-break: break-word; }
  &__empty { margin: 0; padding: 12px; color: var(--p-text-dim-color); }
}
</style>
