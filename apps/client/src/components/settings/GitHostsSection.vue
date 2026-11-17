<script setup>
import { ref, computed, onMounted } from 'vue'
import settingsService from 'src/services/settingsService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { state } from 'stores/userState'
import { hostName } from 'src/boot/gitHost'
import { localized } from 'src/plugins/registry'
import SettingsDialog from 'components/common/SettingsDialog.vue'
import GitHostIcon from 'components/common/GitHostIcon.vue'
import PageHeader from 'components/layout/PageHeader.vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import { useT } from 'src/composables/useT'
import { loadGitHosts, resetGitHosts } from 'stores/gitHosts'

const t = useT()

const hosts = ref([])
const primary = ref(null)
const primaryLocked = ref(false) // linea.config.yml declares it
const loading = ref(true)
const error = ref(null)
const busy = ref(null)
const configuring = ref(null)
const confirming = ref(null) // { host, preview }: switching off a host people are on needs a yes


const load = async () => {
  error.value = null
  try {
    const shown = await settingsService.gitHosts()
    hosts.value = shown.hosts
    primary.value = shown.primary
    primaryLocked.value = Boolean(shown.primaryLocked)
  } catch (e) {
    error.value = e.response?.data?.error ? t(e.response.data.error) : e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const failure = (e) => notify({ type: 'negative', message: errorMessage(e, t) })

const refresh = async () => {
  // the login page, the profile switcher and the menus read the hosts once: tell them
  resetGitHosts()
  await Promise.all([load(), loadGitHosts()])
}

const toggle = async (host, force = false) => {
  busy.value = host.id
  try {
    await settingsService.saveGitHost(host.id, { enabled: !host.enabled, ...(force ? { force: true } : {}) })
    confirming.value = null
    await refresh()
  } catch (e) {
    // a host with lines or people on it: say how many, and switch it off only when asked again
    if (e.response?.data?.preview) confirming.value = { host, preview: e.response.data.preview }
    else failure(e)
  } finally {
    busy.value = null
  }
}

const makePrimary = async (host) => {
  busy.value = host.id
  try {
    await settingsService.setPrimaryHost(host.id)
    await refresh()
  } catch (e) {
    failure(e)
  } finally {
    busy.value = null
  }
}

const missing = (host) => Object.keys(host.schema).filter((key) => host.schema[key].required && host.meta[key]?.missing)
</script>

<template>
  <div class="git-hosts" name="git-hosts">
    <PageHeader compact as="h2" :title="t('git_hosts.title')" :subtitle="t('git_hosts.subtitle')" />

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading" height="8rem" />

    <div v-else class="git-hosts__grid">
      <article v-for="host in hosts" :key="host.id" class="git-host" :data-host="host.id">
        <header class="git-host__head">
          <GitHostIcon :host="host.id" :size="22" />
          <h2>{{ hostName(host.id) }}</h2>
          <Tag v-if="host.id === primary" :value="t('git_hosts.primary')" severity="info" />
          <Tag :value="host.enabled ? t('git_hosts.on') : t('git_hosts.off')" :severity="host.enabled ? 'success' : 'secondary'" />
        </header>

        <p class="git-host__description">{{ t(`git_hosts.about_${host.id}`) }}</p>

        <div class="git-host__tags">
          <Tag v-if="host.locked" :value="t('plugins.declared')" severity="info" icon="pi pi-lock" />
          <Tag :value="localized(host.terms.changeRequest, $i18n.locale)" severity="secondary" />
        </div>

        <Message v-if="!host.enabled && missing(host).length" severity="warn" :closable="false">
          {{ t('plugins.needs_settings', { keys: missing(host).join(', ') }) }}
        </Message>

        <Message v-if="confirming?.host.id === host.id" severity="warn" :closable="false">
          {{ t('git_hosts.in_use', { host: hostName(host.id), ...confirming.preview }) }}
          <div class="git-host__actions">
            <Button :label="t('git_hosts.force_off')" size="small" severity="danger" :loading="busy === host.id" @click="toggle(host, true)" />
            <Button :label="t('plugins.cancel')" size="small" text severity="secondary" @click="confirming = null" />
          </div>
        </Message>

        <footer class="git-host__actions">
          <Button
            v-if="!host.enabled"
            :label="t('plugins.enable')" icon="pi pi-power-off" size="small"
            :disabled="host.locked || Boolean(missing(host).length)" :loading="busy === host.id"
            @click="toggle(host)"
          />
          <Button
            v-else
            :label="t('plugins.disable')" icon="pi pi-pause" size="small" severity="secondary"
            :disabled="host.locked" :loading="busy === host.id"
            @click="toggle(host)"
          />
          <Button
            v-if="host.enabled && host.id !== primary && !primaryLocked"
            :label="t('git_hosts.make_primary')" icon="pi pi-star" size="small" severity="secondary" text :loading="busy === host.id"
            @click="makePrimary(host)"
          />
          <Button :label="t('plugins.configure')" icon="pi pi-cog" size="small" severity="secondary" outlined :disabled="host.locked" @click="configuring = host" />
        </footer>
      </article>
    </div>

    <SettingsDialog
      v-if="configuring"
      :title="t('plugins.settings_title', { name: hostName(configuring.id) })"
      :no-settings="t('plugins.no_settings')"
      :load="async () => { const host = (await settingsService.gitHosts()).hosts.find((h) => h.id === configuring.id); return { schema: host.schema, values: host.values, meta: host.meta } }"
      :save="(patch) => settingsService.saveGitHost(configuring.id, { settings: patch })"
      @close="configuring = null"
      @saved="refresh"
    />
  </div>
</template>

<style scoped lang="scss">
.git-hosts {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
}

.git-host {
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
    gap: 10px;

    h2 {
      flex: 1;
      margin: 0;
      font-size: 1rem;
    }
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
