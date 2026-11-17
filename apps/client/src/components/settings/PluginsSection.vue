<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import pluginService from 'src/services/pluginService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { state } from 'stores/userState'
import { localized } from 'src/plugins/registry'
import { reloadForPlugins } from 'src/plugins/host'
import { downloadBlob } from 'src/utils/download'
import SettingsDialog from 'components/common/SettingsDialog.vue'
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
// the services of remote plugins come and go: the page asks again now and then
const HEALTH_POLL_MS = 30_000
let timer = null
onMounted(() => {
  load()
  timer = setInterval(load, HEALTH_POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))

const healthHint = (plugin) => {
  const detail = plugin.healthDetail
  if (!detail) return ''
  return detail.status === 'up'
    ? t('plugins.health_up_hint', { ms: detail.latencyMs })
    : t('plugins.health_down_hint', { why: detail.error ?? '' })
}

const statusOf = (plugin) =>
  plugin.installed && plugin.loadError
    ? { label: t('plugins.st_failed'), severity: 'warn' }
    : plugin.enabled
    ? { label: t('plugins.st_enabled'), severity: 'success' }
    : plugin.installed
      ? { label: t('plugins.st_disabled'), severity: 'secondary' }
      : { label: t('plugins.st_available'), severity: 'contrast' }

// What a plugin adds to the interface comes and goes with the page: after a change that touches the client it is loaded again.
const act = async (plugin, action) => {
  busy.value = plugin.id
  try {
    const updated = await pluginService[action](plugin.id)
    plugins.value = plugins.value.map((p) => (p.id === plugin.id ? updated : p))
    notify({ type: 'positive', message: t('plugins.changed') })
    if (plugin.client && ['enable', 'disable', 'uninstall'].includes(action)) setTimeout(reloadForPlugins, 600)
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = null
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

        <div class="plugin__tags">
          <Tag :value="plugin.inProcess ? t('plugins.in_process') : t('plugins.remote')" severity="secondary" />
          <Tag v-if="plugin.declared" :value="t('plugins.declared')" severity="info" icon="pi pi-lock" v-tooltip.top="t('plugins.declared_hint')" />
          <Tag v-if="plugin.health" v-tooltip.top="healthHint(plugin)" :value="t(`plugins.${plugin.health}`)" :severity="plugin.health === 'up' ? 'success' : 'danger'" />
          <Tag v-if="!plugin.compatible && !plugin.error" :value="t('plugins.incompatible', { requires: plugin.requires?.linea })" severity="warn" />
        </div>

        <Message v-if="plugin.settingsMissing?.length" severity="warn" :closable="false">
          {{ t('plugins.needs_settings', { keys: plugin.settingsMissing.join(', ') }) }}
        </Message>
        <Message v-if="plugin.unavailable" severity="warn" :closable="false">{{ t('plugins.unavailable', { why: plugin.unavailable }) }}</Message>
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
            <Button
              v-if="plugin.settingsSchema"
              :label="t('plugins.configure')" icon="pi pi-cog" size="small" severity="secondary" outlined
              @click="configuring = plugin"
            />
            <Button
              :label="t('plugins.uninstall')" icon="pi pi-trash" size="small" text severity="danger"
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
  }

  &__tags,
  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
}
</style>
