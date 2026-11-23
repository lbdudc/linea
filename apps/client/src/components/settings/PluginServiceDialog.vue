<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import pluginService from 'src/services/pluginService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import ConfirmDialog from 'primevue/confirmdialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import Message from 'primevue/message'

// The service a plugin runs in Docker: its containers, what can be done with them, and what they have been saying (`docker compose logs`).
const props = defineProps({ plugin: { type: Object, required: true }, title: { type: String, default: '' } })
const emit = defineEmits(['close', 'changed'])
const t = useT()
const confirm = useConfirm()

const visible = ref(true)
const info = ref(null) // state, containers and the last operation: asked again every few seconds
const logText = ref('')
const loading = ref(true)
const failed = ref(null)
const busy = ref(false)
const tail = ref(200)
const follow = ref(true)
const live = ref(false) // the logs arrive by the stream (else they are asked for)
const reconnecting = ref(false)
const ALL = '*' // PrimeVue's Select reads an empty value as "nothing chosen"
const only = ref(ALL)
const logBox = ref(null)
const atBottom = ref(true)
const tails = computed(() => [100, 200, 500, 1000, 2000].map((value) => ({ value, label: t('plugins.log_lines', { n: value }) })))
const REFRESH_MS = 3000
const MAX_LOG = 400_000 // characters kept: a service that talks a lot does not fill the page's memory
const service = () => (only.value === ALL ? null : only.value)

const scrollDown = () => nextTick(() => { if (logBox.value && atBottom.value) logBox.value.scrollTop = logBox.value.scrollHeight })
const onScroll = () => {
  const box = logBox.value
  if (box) atBottom.value = box.scrollHeight - box.scrollTop - box.clientHeight < 40
}
const jump = () => { atBottom.value = true; scrollDown() }

// the state (containers, operation): always polled; the logs too when they are not streamed
const loadState = async ({ withLogs = false } = {}) => {
  try {
    const data = await pluginService.serviceLogs(props.plugin.id, tail.value, service(), { logs: withLogs })
    info.value = data
    if (withLogs) { logText.value = data.logs; scrollDown() }
    failed.value = null
  } catch (e) {
    failed.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}

// the stream: what comes is gathered and shown a few times a second, whatever the speed of the service
let controller = null
let pending = ''
let flush = null
let retry = null
const showPending = () => {
  flush = null
  if (!pending) return
  logText.value = (logText.value + pending).slice(-MAX_LOG)
  pending = ''
  scrollDown()
}
const stopStream = () => {
  controller?.abort()
  controller = null
  clearTimeout(retry)
  live.value = false
}
const startStream = async () => {
  stopStream()
  const mine = new AbortController()
  controller = mine
  logText.value = ''
  pending = ''
  let first = true
  try {
    await pluginService.followServiceLogs(props.plugin.id, {
      tail: tail.value,
      service: service(),
      signal: mine.signal,
      onData: (text) => {
        if (first) { first = false; live.value = true; reconnecting.value = false; loading.value = false }
        pending += text
        flush ??= setTimeout(showPending, 150)
      },
    })
    // the end of the stream is a container that was recreated (a restart, a rebuild): asked again
  } catch (e) {
    if (mine.signal.aborted) return
    if (first) { failed.value = errorMessage(e, t); live.value = false; return await loadState({ withLogs: true }) } // no stream here: the logs are asked for
  }
  if (mine.signal.aborted) return
  reconnecting.value = true
  retry = setTimeout(() => { if (follow.value && !mine.signal.aborted) startStream() }, 2000)
}

const restartLogs = async () => {
  if (follow.value) startStream() // it lasts as long as the dialog is open: not awaited
  else { stopStream(); await loadState({ withLogs: true }) }
}

let timer = null
onMounted(async () => {
  await loadState()
  await restartLogs()
  timer = setInterval(() => loadState({ withLogs: !live.value && follow.value }), REFRESH_MS)
})
onBeforeUnmount(() => { clearInterval(timer); stopStream(); clearTimeout(flush) })
watch([follow, tail, only], restartLogs)
const onlyOptions = computed(() => [{ value: ALL, label: t('plugins.log_all') }, ...(info.value?.containers ?? []).map((c) => ({ value: c.service, label: c.service }))])

// `docker compose logs` lines are `service | 2026-11-23T10:46:44.1Z message`: pulled apart so that each part reads at a glance
const LINE = /^(\S+?)\s+\|\s(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/
const ERROR = /\b(error|fatal|panic|exception|ERR!?)\b|"s":"(E|F)"/i
const WARN = /\b(warn(ing)?|deprecat\w+)\b|"s":"W"/i
const lines = computed(() => {
  const colors = new Map()
  return String(logText.value ?? '').split('\n').filter(Boolean).map((raw, i) => {
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
const operation = computed(() => info.value?.operation ?? null)
const working = computed(() => Boolean(operation.value && !operation.value.finishedAt))
const operationFailed = computed(() => (operation.value?.finishedAt && operation.value.error ? operation.value : null))
const unavailable = computed(() => info.value?.state === 'unavailable')

// what is asked is answered at once (a build takes minutes): how it goes is in the operation, which the state brings
const run = async (call) => {
  busy.value = true
  try {
    await call()
    emit('changed')
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = false
    await loadState()
  }
}
const act = (action) => run(() => pluginService[action](props.plugin.id))
const actOn = (container, action) => run(() => pluginService.containerAction(props.plugin.id, container.service, action))
const ask = (action, message) => confirm.require({
  group: 'service',
  message: t(message, { name: props.title || props.plugin.id }),
  icon: 'pi pi-exclamation-triangle',
  acceptLabel: t(action === 'rebuildService' ? 'plugins.service_rebuild' : 'plugins.service_down_short'),
  rejectLabel: t('labels.cancel'),
  acceptProps: { severity: 'danger', size: 'small' },
  rejectProps: { severity: 'secondary', text: true, size: 'small' },
  accept: () => act(action),
})
const copy = async () => {
  try {
    await navigator.clipboard.writeText(logText.value ?? '')
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
    <ConfirmDialog group="service" />
    <div class="svc">
      <Message v-if="failed" severity="error" :closable="false">{{ failed }}</Message>
      <Message v-if="unavailable" severity="warn" :closable="false">{{ t('plugins.service_hint', { why: info.error }) }}</Message>
      <Message v-if="working" severity="info" :closable="false" name="plugin-service-operation">
        <i class="pi pi-spin pi-spinner" /> {{ t(`plugins.service_op_${operation.kind}`) }}<template v-if="operation.service"> · {{ operation.service }}</template>
      </Message>
      <Message v-if="operationFailed" severity="error" :closable="false" name="plugin-service-operation-failed">
        {{ t('plugins.service_op_failed') }} ({{ operationFailed.kind }}): {{ operationFailed.error }}
        <pre v-if="operationFailed.output" class="svc__output">{{ operationFailed.output }}</pre>
      </Message>

      <ul v-if="info?.containers?.length" class="svc__containers">
        <li v-for="c in info.containers" :key="c.name">
          <span class="svc__name">{{ c.service || c.name }}</span>
          <Tag :value="c.health ? `${c.state} · ${c.health}` : c.state" :severity="severityOf(c)" />
          <span v-if="c.ports?.length" class="svc__ports">{{ c.ports.join(', ') }}</span>
          <span class="svc__status">{{ c.status }}</span>
          <span class="svc__spacer" />
          <Button
            v-if="c.state !== 'running'" icon="pi pi-play" size="small" severity="secondary" text rounded name="plugin-container-start"
            :aria-label="t('plugins.container_start')" v-tooltip.top="t('plugins.container_start')" :disabled="working || busy" @click="actOn(c, 'start')"
          />
          <template v-else>
            <Button
              icon="pi pi-refresh" size="small" severity="secondary" text rounded name="plugin-container-restart"
              :aria-label="t('plugins.container_restart')" v-tooltip.top="t('plugins.container_restart')" :disabled="working || busy" @click="actOn(c, 'restart')"
            />
            <Button
              icon="pi pi-stop" size="small" severity="secondary" text rounded name="plugin-container-stop"
              :aria-label="t('plugins.container_stop')" v-tooltip.top="t('plugins.container_stop')" :disabled="working || busy" @click="actOn(c, 'stop')"
            />
          </template>
        </li>
      </ul>
      <p v-else-if="info && !unavailable" class="svc__none">{{ t('plugins.service_no_containers') }}</p>

      <div class="svc__bar">
        <Button v-if="!running" :label="t('plugins.service_start')" icon="pi pi-play" size="small" :loading="busy || working" :disabled="unavailable" name="plugin-service-start" @click="act('startService')" />
        <template v-else>
          <Button :label="t('plugins.service_restart')" icon="pi pi-refresh" size="small" severity="secondary" outlined :disabled="busy || working" name="plugin-service-restart" @click="act('restartService')" />
          <Button :label="t('plugins.service_stop')" icon="pi pi-stop" size="small" severity="secondary" outlined :disabled="busy || working" name="plugin-service-stop" @click="act('stopService')" />
        </template>
        <Button :label="t('plugins.service_rebuild')" icon="pi pi-wrench" size="small" severity="secondary" outlined :disabled="unavailable || busy || working" name="plugin-service-rebuild" @click="ask('rebuildService', 'plugins.confirm_rebuild')" />
        <Button :label="t('plugins.service_down')" icon="pi pi-trash" size="small" severity="danger" text :disabled="unavailable || busy || working || !info?.containers?.length" name="plugin-service-down" @click="ask('downService', 'plugins.confirm_down')" />
      </div>

      <div class="svc__bar">
        <Select v-model="only" :options="onlyOptions" option-label="label" option-value="value" size="small" />
        <Select v-model="tail" :options="tails" option-label="label" option-value="value" size="small" />
        <label class="svc__follow"><ToggleSwitch v-model="follow" /> {{ t('plugins.log_follow') }}</label>
        <Tag v-if="follow && live" :value="t('plugins.log_live')" severity="success" />
        <Tag v-else-if="follow && reconnecting" :value="t('plugins.log_reconnecting')" severity="warn" />
        <span class="svc__spacer" />
        <Button icon="pi pi-refresh" size="small" severity="secondary" text :aria-label="t('plugins.refresh')" :loading="loading" @click="restartLogs" />
        <Button icon="pi pi-copy" size="small" severity="secondary" text :aria-label="t('plugins.log_copy')" :disabled="!logText" @click="copy" />
      </div>

      <div class="svc__logwrap">
        <div ref="logBox" class="svc__log" tabindex="0" role="log" @scroll="onScroll">
          <div v-for="line in lines" :key="line.i" :class="['svc__line', line.level && `svc__line--${line.level}`]">
            <span v-if="line.time" class="svc__time" :title="line.date">{{ line.time }}</span>
            <span v-if="line.service" :class="['svc__tag', `svc__tag--${line.color}`]">{{ line.service }}</span>
            <span class="svc__text">{{ line.text }}</span>
          </div>
          <p v-if="!lines.length && !loading" class="svc__empty">{{ t('plugins.log_empty') }}</p>
        </div>
        <Button v-if="follow && !atBottom" class="svc__jump" :label="t('plugins.log_jump')" icon="pi pi-arrow-down" size="small" severity="secondary" @click="jump" />
      </div>
      <Message v-if="info?.error && !unavailable" severity="warn" :closable="false">{{ info.error }}</Message>
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
  &__output { margin: 6px 0 0; max-height: 8rem; overflow: auto; white-space: pre-wrap; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  &__logwrap { position: relative; }
  &__jump { position: absolute; right: 16px; bottom: 12px; box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 20%, transparent); }

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
