<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import pluginService from 'src/services/pluginService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { state } from 'stores/userState'
import { localized } from 'src/plugins/registry'
import { reloadForPlugins } from 'src/plugins/host'
import { downloadBlob } from 'src/utils/download'
import SettingsDialog from 'components/common/SettingsDialog.vue'
import PluginServiceDialog from './PluginServiceDialog.vue'
import PageHeader from 'components/layout/PageHeader.vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Tooltip from 'primevue/tooltip'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import SelectButton from 'primevue/selectbutton'
import { useT } from 'src/composables/useT'

const t = useT()
const vTooltip = Tooltip

const plugins = ref([])
const loading = ref(true)
const error = ref(null)
const busy = ref(null)
const tab = ref('installed')
const configuring = ref(null)
const inspecting = ref(null)
const working = ref({}) // id -> 'starting' | 'stopping': a start or stop of its service is in flight

const downloadConfig = async () => {
  try {
    downloadBlob(new Blob([await pluginService.exportConfig()], { type: 'text/yaml' }), 'linea.config.yml')
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  }
}

const tabs = computed(() => [
  { value: 'installed', label: t('plugins.installed') },
  { value: 'market', label: t('plugins.market') },
])
const shown = computed(() => (tab.value === 'installed' ? plugins.value.filter((p) => p.installed) : plugins.value))

const load = async () => {
  error.value = null
  try {
    plugins.value = await pluginService.list()
  } catch (e) {
    error.value = e.response?.data?.error ? t(e.response.data.error) : e.message
  } finally {
    loading.value = false
  }
}
// the services of remote plugins come and go: the page asks again now and then, and every few seconds while containers are changing
const HEALTH_POLL_MS = 30_000
const BUSY_POLL_MS = 3_000
let timer = null
let stopped = false
const changing = () => Object.keys(working.value).length > 0 || plugins.value.some((p) => ['starting', 'degraded'].includes(p.serviceState?.state))
const tick = async () => {
  await load()
  if (!stopped) timer = setTimeout(tick, changing() ? BUSY_POLL_MS : HEALTH_POLL_MS)
}
onMounted(() => { tick() })
onBeforeUnmount(() => { stopped = true; clearTimeout(timer) })

const healthHint = (plugin) => {
  const detail = plugin.healthDetail
  if (!detail) return ''
  return detail.status === 'up'
    ? t('plugins.health_up_hint', { ms: detail.latencyMs })
    : t('plugins.health_down_hint', { why: detail.error ?? '' })
}

// what the containers are doing: running, starting, degraded (up with one crashed), failed, stopped, unavailable (no Docker)
const SERVICE_LOOK = {
  running: ['service_running', 'success'],
  starting: ['service_starting', 'warn'],
  degraded: ['service_degraded', 'warn'],
  failed: ['service_failed', 'danger'],
  unavailable: ['service_unavailable', 'warn'],
  stopped: ['service_stopped', 'secondary'],
}
const serviceTag = (plugin) => {
  // while a start or stop of it is in flight the containers are changing: say so instead of the state of a moment ago
  if (working.value[plugin.id]) return { label: t(`plugins.service_${working.value[plugin.id]}`), severity: 'warn', pending: true }
  // LINEA cannot see Docker here (its own container, say) but the service answers: someone else runs it, and that is not a problem
  if (external(plugin)) return { label: t('plugins.service_external'), severity: 'secondary' }
  const [key, severity] = SERVICE_LOOK[plugin.serviceState?.state] ?? SERVICE_LOOK.stopped
  return { label: t(`plugins.${key}`), severity }
}
const external = (plugin) => plugin.serviceState?.state === 'unavailable' && plugin.health === 'up'
// no Docker to start or stop it with, so there are no controls (the row says why in its tooltip)
const manageable = (plugin) => Boolean(plugin.serviceState) && plugin.serviceState.state !== 'unavailable'
// what the page tells about a plugin that is on and whose service does not answer, when the service row does not already say it
const unreachable = (plugin) => {
  if (!plugin.enabled || plugin.health !== 'down' || working.value[plugin.id]) return null
  const state = plugin.serviceState?.state
  if (state === 'running') return 'plugins.service_up_unreachable'
  if (!plugin.serviceState || state === 'unavailable') return 'plugins.service_unreachable'
  return null
}
const serviceUp = (plugin) => ['running', 'starting', 'degraded'].includes(plugin.serviceState?.state)
// plugins enabled whose service is not up: the page says it (the plugin is on, what it needs is not)
const serviceDownButOn = (plugin) => plugin.enabled && plugin.serviceState && !serviceUp(plugin) && plugin.serviceState.state !== 'unavailable'

const statusOf = (plugin) =>
  plugin.installed && plugin.loadError
    ? { label: t('plugins.st_failed'), severity: 'warn' }
    : plugin.enabled
    ? { label: t('plugins.st_enabled'), severity: 'success' }
    : plugin.installed
      ? { label: t('plugins.st_disabled'), severity: 'secondary' }
      : { label: t('plugins.st_available'), severity: 'contrast' }

// What a plugin adds to the interface comes and goes with the page: after a change that touches the client it is loaded again.
const WORKING_AS = { enable: 'starting', startService: 'starting', disable: 'stopping', stopService: 'stopping' }
const act = async (plugin, action) => {
  busy.value = plugin.id
  if (plugin.serviceState && WORKING_AS[action]) working.value = { ...working.value, [plugin.id]: WORKING_AS[action] }
  try {
    const updated = await pluginService[action](plugin.id)
    plugins.value = plugins.value.map((p) => (p.id === plugin.id ? updated : p))
    notify({ type: 'positive', message: t('plugins.changed') })
    if (plugin.client && ['enable', 'disable', 'uninstall'].includes(action)) setTimeout(reloadForPlugins, 600)
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = null
    const { [plugin.id]: _done, ...rest } = working.value
    working.value = rest
    load()
  }
}
</script>

<template>
  <div class="plugins">
    <PageHeader compact as="h2" :title="t('plugins.title')" :subtitle="t('plugins.subtitle')">
      <template #actions>
        <Button :label="t('plugins.refresh')" icon="pi pi-refresh" size="small" severity="secondary" outlined :loading="loading" @click="load" />
        <Button :label="t('plugins.download_config')" icon="pi pi-download" size="small" severity="secondary" outlined @click="downloadConfig" />
        <SelectButton v-model="tab" :options="tabs" option-label="label" option-value="value" :allow-empty="false" />
      </template>
    </PageHeader>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div v-if="loading" class="plugins__grid">
      <Skeleton v-for="n in 3" :key="n" height="11rem" />
    </div>

    <p v-else-if="!shown.length && !error" class="plugins__empty">
      {{ t(tab === 'installed' ? 'plugins.empty_installed' : 'plugins.empty_market') }}
    </p>

    <div v-else class="plugins__grid">
      <article v-for="plugin in shown" :key="plugin.id" class="plugin" :data-plugin="plugin.id">
        <header class="plugin__head">
          <i :class="['pi', plugin.icon || 'pi-box', 'plugin__icon']" aria-hidden="true" />
          <div class="plugin__title">
            <h2>{{ localized(plugin.name, $i18n.locale) || plugin.id }}</h2>
            <span class="plugin__version">v{{ plugin.version }}</span>
          </div>
          <Tag :value="statusOf(plugin).label" :severity="statusOf(plugin).severity" />
        </header>

        <p class="plugin__description">{{ localized(plugin.description, $i18n.locale) }}</p>

        <dl class="plugin__facts">
          <div>
            <dt>{{ t('plugins.where') }}</dt>
            <dd>
              {{ plugin.inProcess ? t('plugins.in_process') : t('plugins.remote') }}
              <i v-if="plugin.declared" class="pi pi-lock plugin__lock" v-tooltip.top="t('plugins.declared_hint')" />
              <Tag v-if="!plugin.compatible && !plugin.error" :value="t('plugins.incompatible', { requires: plugin.requires?.linea })" severity="warn" />
            </dd>
          </div>
          <div v-if="plugin.serviceState">
            <dt>{{ t('plugins.service') }}</dt>
            <dd v-tooltip.top="external(plugin) ? t('plugins.service_external_hint') : plugin.serviceState.error ? t('plugins.service_hint', { why: plugin.serviceState.error }) : ''">
              <i v-if="serviceTag(plugin).pending" class="pi pi-spin pi-spinner plugin__spin" />
              <span v-else :class="['plugin__dot', `plugin__dot--${serviceTag(plugin).severity}`]" />
              {{ serviceTag(plugin).label }}
              <span v-if="plugin.serviceState.total" class="plugin__muted">· {{ t('plugins.containers_of', { n: plugin.serviceState.containers, total: plugin.serviceState.total }) }}</span>
            </dd>
          </div>
          <div v-if="plugin.health">
            <dt>{{ t('plugins.connection') }}</dt>
            <dd v-tooltip.top="healthHint(plugin)">
              <span :class="['plugin__dot', plugin.health === 'up' ? 'plugin__dot--success' : 'plugin__dot--danger']" />
              {{ t(`plugins.${plugin.health}`) }}
            </dd>
          </div>
        </dl>

        <Message v-if="plugin.settingsMissing?.length" severity="warn" :closable="false">
          {{ t('plugins.needs_settings', { keys: plugin.settingsMissing.join(', ') }) }}
        </Message>
        <Message v-if="plugin.unavailable" severity="warn" :closable="false">{{ t('plugins.unavailable', { why: plugin.unavailable }) }}</Message>
        <Message v-if="serviceDownButOn(plugin) && !working[plugin.id]" severity="warn" :closable="false">{{ t('plugins.service_down_but_on') }}</Message>
        <Message v-if="unreachable(plugin)" severity="warn" :closable="false">{{ t(unreachable(plugin), { why: plugin.healthDetail?.error ?? '' }) }}</Message>
        <Message v-if="plugin.restartRequired" severity="info" :closable="false">{{ t('plugins.restart_required') }}</Message>
        <Message v-if="plugin.declaredOff" severity="warn" :closable="false">{{ t('plugins.declared_off', { why: plugin.declaredOff }) }}</Message>
        <Message v-if="plugin.error || plugin.loadError" severity="error" :closable="false">
          {{ t('plugins.load_error', { error: plugin.error || plugin.loadError }) }}
        </Message>

        <footer class="plugin__actions">
          <Button
            v-if="!plugin.installed"
            :label="t('plugins.install')" icon="pi pi-download" size="small"
            :disabled="plugin.declared || !plugin.compatible || Boolean(plugin.error) || Boolean(plugin.unavailable)" :loading="busy === plugin.id"
            @click="act(plugin, 'install')"
          />
          <template v-else>
            <Button
              v-if="plugin.loadError"
              :label="t('plugins.retry')" icon="pi pi-refresh" size="small" name="plugin-retry"
              :disabled="plugin.declared" :loading="busy === plugin.id"
              @click="act(plugin, 'enable')"
            />
            <Button
              v-if="!plugin.enabled"
              :label="t('plugins.enable')" icon="pi pi-power-off" size="small"
              :disabled="plugin.declared || Boolean(plugin.unavailable) || Boolean(plugin.settingsMissing?.length)" :loading="busy === plugin.id"
              @click="act(plugin, 'enable')"
            />
            <Button
              v-else
              :label="t('plugins.disable')" icon="pi pi-pause" size="small" severity="secondary"
              :disabled="plugin.declared" :loading="busy === plugin.id"
              @click="act(plugin, 'disable')"
            />
            <template v-if="manageable(plugin)">
              <Button
                v-if="!serviceUp(plugin)"
                icon="pi pi-play" size="small" severity="secondary" outlined name="plugin-service-start"
                v-tooltip.top="t('plugins.service_start')" :aria-label="t('plugins.service_start')"
                :disabled="plugin.serviceState.state === 'unavailable' || Boolean(plugin.settingsMissing?.length)" :loading="busy === plugin.id"
                @click="act(plugin, 'startService')"
              />
              <Button
                v-else
                icon="pi pi-stop" size="small" severity="secondary" outlined name="plugin-service-stop"
                v-tooltip.top="t('plugins.service_stop')" :aria-label="t('plugins.service_stop')" :loading="busy === plugin.id"
                @click="act(plugin, 'stopService')"
              />
              <Button
                icon="pi pi-align-left" size="small" severity="secondary" outlined name="plugin-service-logs"
                v-tooltip.top="t('plugins.service_logs')" :aria-label="t('plugins.service_logs')"
                @click="inspecting = plugin"
              />
            </template>
            <Button
              v-if="plugin.settingsSchema"
              icon="pi pi-cog" size="small" severity="secondary" outlined
              v-tooltip.top="t('plugins.configure')" :aria-label="t('plugins.configure')"
              @click="configuring = plugin"
            />
            <Button
              icon="pi pi-trash" size="small" text severity="danger" class="plugin__uninstall"
              v-tooltip.top="t('plugins.uninstall')" :aria-label="t('plugins.uninstall')"
              :disabled="plugin.declared" :loading="busy === plugin.id"
              @click="act(plugin, 'uninstall')"
            />
          </template>
          <a v-if="plugin.enabled && plugin.remote?.web" :href="plugin.remote.web" target="_blank" rel="noopener" class="plugin__open">
            <Button :label="t('plugins.open')" icon="pi pi-external-link" size="small" text as="span" />
          </a>
        </footer>
      </article>
    </div>

    <PluginServiceDialog
      v-if="inspecting"
      :plugin="inspecting"
      :title="t('plugins.service_title', { name: localized(inspecting.name, $i18n.locale) || inspecting.id })"
      @changed="load"
      @close="inspecting = null"
    />

    <SettingsDialog
      v-if="configuring"
      :title="t('plugins.settings_title', { name: localized(configuring.name, $i18n.locale) || configuring.id })"
      :no-settings="t('plugins.no_settings')"
      :load="() => pluginService.getSettings(configuring.id)"
      :save="(patch) => pluginService.saveSettings(configuring.id, patch)"
      :options-url="(spec) => `/plugins/${configuring.id}/${spec.optionsFrom}`"
      @close="configuring = null"
      @saved="load"
    />
  </div>
</template>

<style scoped lang="scss">
.plugins {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }

  &__empty {
    color: var(--p-text-muted-color);
  }
}

.plugin {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);

  &__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__icon {
    font-size: 24px;
    color: var(--p-primary-color);
  }

  &__title {
    flex: 1;
    min-width: 0;

    h2 {
      margin: 0;
      font-size: 1rem;
    }
  }

  &__version {
    font-size: 0.75rem;
    color: var(--p-text-muted-color);
  }

  &__description {
    margin: 0;
    flex: 1;
    color: var(--p-text-muted-color);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__facts {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.875rem;

    > div { display: flex; gap: 8px; align-items: center; }
    dt { width: 5.5rem; color: var(--p-text-muted-color); }
    dd { margin: 0; display: flex; align-items: center; gap: 6px; }
  }

  &__spin { font-size: 0.75rem; color: var(--p-text-muted-color); }
  &__lock { font-size: 0.75rem; color: var(--p-text-muted-color); }
  &__muted { color: var(--p-text-muted-color); }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-neutral-solid);

    &--success { background: var(--status-ok-solid); }
    &--danger { background: var(--status-bad-solid); }
    &--warn { background: var(--status-warn-solid); }
  }

  &__uninstall { margin-left: auto; }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
}
</style>
