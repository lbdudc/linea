<script setup>
import { ref, computed } from 'vue'
import settingsService from 'src/services/settingsService'
import { errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import PageHeader from 'components/layout/PageHeader.vue'
import InstanceSettingsForm from './InstanceSettingsForm.vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Select from 'primevue/select'

const t = useT()
const PAGE = 50

const entries = ref([])
const loading = ref(true)
const more = ref(false)
const error = ref(null)
const area = ref('')
const areas = computed(() => ['', 'settings', 'plugin', 'user', 'modules'].map((value) => ({ value, label: t(`audit.areas.${value || 'all'}`) })))

const fetchPage = async (before) => {
  loading.value = true
  error.value = null
  try {
    const page = await settingsService.audit({ limit: PAGE, ...(before ? { before } : {}), ...(area.value ? { action: area.value } : {}) })
    entries.value = before ? [...entries.value, ...page] : page
    more.value = page.length === PAGE
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
fetchPage()

const when = (at) => new Date(at).toLocaleString()
const detailOf = (detail) => (detail ? JSON.stringify(detail) : '')
</script>

<template>
  <div class="audit">
    <PageHeader compact as="h2" :title="t('audit.title')" :subtitle="t('audit.subtitle')">
      <template #actions>
        <Select v-model="area" :options="areas" option-label="label" option-value="value" size="small" data-audit-area @change="fetchPage()" />
        <Button icon="pi pi-refresh" size="small" severity="secondary" outlined :aria-label="t('audit.refresh')" @click="fetchPage()" />
      </template>
    </PageHeader>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <p v-else-if="!loading && !entries.length" class="audit__empty">{{ t('audit.empty') }}</p>

    <table v-else class="audit__table">
      <thead>
        <tr><th>{{ t('audit.when') }}</th><th>{{ t('audit.who') }}</th><th>{{ t('audit.what') }}</th><th>{{ t('audit.target') }}</th><th>{{ t('audit.detail') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.id" :data-audit="entry.action">
          <td>{{ when(entry.at) }}</td>
          <td>{{ entry.actor ?? '—' }}</td>
          <td><code>{{ entry.action }}</code></td>
          <td>{{ entry.target ?? '' }}</td>
          <td class="audit__detail">{{ detailOf(entry.detail) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="more"><Button :label="t('audit.more')" size="small" severity="secondary" outlined :loading="loading" @click="fetchPage(entries.at(-1).id)" /></div>

    <h3 class="audit__retention">{{ t('audit.retention') }}</h3>
    <InstanceSettingsForm group="audit" />
  </div>
</template>

<style scoped lang="scss">
.audit {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__table {
    width: 100%;
    border-collapse: collapse;

    th, td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
      vertical-align: top;
    }

    th {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
    }
  }

  &__detail {
    font-family: var(--p-font-mono, monospace);
    font-size: 0.8rem;
    color: var(--p-text-muted-color);
    word-break: break-word;
  }

  &__empty { color: var(--p-text-muted-color); }
  &__retention { margin: 16px 0 0; }
}
</style>
