<script setup>
import { ref, onMounted } from 'vue'
import InstanceSettingsForm from './InstanceSettingsForm.vue'
import pluginService from 'src/services/pluginService'
import settingsService from 'src/services/settingsService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { downloadBlob, downloadJson } from 'src/utils/download'
import { useT } from 'src/composables/useT'
import PageHeader from 'components/layout/PageHeader.vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Tag from 'primevue/tag'

const t = useT()
const busy = ref(null)

const run = async (name, work) => {
  busy.value = name
  try {
    await work()
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = null
  }
}

// a config file to bring in: first what it would change, then (on a yes) the changes
const text = ref('')
const fileName = ref('')
const plan = ref(null)
const applied = ref(null)

const pick = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  fileName.value = file.name
  text.value = await file.text()
  plan.value = null
  applied.value = null
  check()
}
const check = () => run('check', async () => { plan.value = await settingsService.importConfig(text.value, false) })
const apply = () => run('apply', async () => {
  const done = await settingsService.importConfig(text.value, true)
  applied.value = done.applied
  plan.value = null
  loadHistory().catch(() => undefined)
  notify({ type: done.applied.every((result) => result.ok) ? 'positive' : 'warn', message: t('backup.applied', { n: done.applied.filter((result) => result.ok).length }) })
})

// backups of the database
const backupList = ref({ items: [], everyHours: 0, keep: 7 })
const preview = ref(null)
const history = ref([])
const loadBackups = async () => { backupList.value = await settingsService.backups() }
const loadHistory = async () => { history.value = await settingsService.importHistory() }
onMounted(() => { loadBackups().catch(() => undefined); loadHistory().catch(() => undefined) })
const backupNow = () => run('backup', async () => {
  const made = await settingsService.runBackup()
  notify({ type: 'positive', message: t('backup.backup_made', { name: made.name }) })
  await loadBackups()
})
const look = (name) => run(`preview-${name}`, async () => { preview.value = await settingsService.backupPreview(name) })
const getBackup = (name) => run(`file-${name}`, async () => downloadBlob(await settingsService.backupFile(name), name))
const size = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`)
const rollback = (entry) => run(`rollback-${entry.id}`, async () => {
  const { results } = await settingsService.rollbackImport(entry.id)
  notify({ type: results.every((result) => result.ok) ? 'positive' : 'warn', message: t('backup.rolled_back', { n: results.filter((result) => result.ok).length }) })
  await loadHistory()
})

const downloadConfig = () => run('config', async () => downloadBlob(new Blob([await pluginService.exportConfig()], { type: 'text/yaml' }), 'linea.config.yml'))
const downloadAudit = () => run('audit', async () => downloadJson(await settingsService.audit({ limit: 500 }), 'linea-audit.json'))
</script>

<template>
  <div class="backup">
    <PageHeader compact as="h2" :title="t('backup.title')" :subtitle="t('backup.subtitle')" />

    <section class="backup__item">
      <div>
        <h3>{{ t('backup.config') }}</h3>
        <p>{{ t('backup.config_about') }}</p>
      </div>
      <Button :label="t('backup.download')" icon="pi pi-download" size="small" severity="secondary" outlined :loading="busy === 'config'" data-backup="config" @click="downloadConfig" />
    </section>

    <section class="backup__item">
      <div>
        <h3>{{ t('backup.audit') }}</h3>
        <p>{{ t('backup.audit_about') }}</p>
      </div>
      <Button :label="t('backup.download')" icon="pi pi-download" size="small" severity="secondary" outlined :loading="busy === 'audit'" data-backup="audit" @click="downloadAudit" />
    </section>

    <section class="backup__import" data-backup-databases>
      <div>
        <h3>{{ t('backup.databases') }}</h3>
        <p>{{ t('backup.databases_about') }}</p>
      </div>
      <InstanceSettingsForm group="backup" @saved="loadBackups" />
      <div><Button :label="t('backup.backup_now')" icon="pi pi-database" size="small" :loading="busy === 'backup'" data-backup="now" @click="backupNow" /></div>
      <p v-if="!backupList.items.length" class="backup__none">{{ t('backup.no_backups') }}</p>
      <table v-else class="backup__plan" data-backup-list>
        <tbody>
          <tr v-for="item in backupList.items" :key="item.name" :data-backup-file="item.name">
            <td class="backup__mono">{{ item.name }}</td>
            <td>{{ size(item.size) }}</td>
            <td>
              <Button text size="small" :label="t('backup.look')" :loading="busy === `preview-${item.name}`" @click="look(item.name)" />
              <Button text size="small" icon="pi pi-download" :label="t('backup.download')" :loading="busy === `file-${item.name}`" @click="getBackup(item.name)" />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="preview" class="backup__preview" data-backup-preview>
        <strong>{{ t('backup.preview_of', { name: preview.name }) }}</strong>
        <table class="backup__plan">
          <thead><tr><th>{{ t('backup.collection') }}</th><th>{{ t('backup.in_backup') }}</th><th>{{ t('backup.now') }}</th></tr></thead>
          <tbody><tr v-for="row in preview.collections" :key="row.collection"><td class="backup__mono">{{ row.collection }}</td><td>{{ row.backup }}</td><td>{{ row.now }}</td></tr></tbody>
        </table>
        <small>{{ t('backup.restore_note') }}</small>
      </div>
    </section>

    <section v-if="history.length" class="backup__import" data-backup-history>
      <div>
        <h3>{{ t('backup.history') }}</h3>
        <p>{{ t('backup.history_about') }}</p>
      </div>
      <table class="backup__plan">
        <tbody>
          <tr v-for="entry in history" :key="entry.id" :data-history="entry.id">
            <td>{{ new Date(entry.at).toLocaleString() }}</td>
            <td>{{ entry.by }}</td>
            <td>{{ entry.changes.map((change) => `${change.area}:${change.id}`).join(', ') }}</td>
            <td>
              <Tag v-if="entry.rolledBackAt" severity="secondary" :value="t('backup.was_rolled_back')" />
              <Button v-else text size="small" icon="pi pi-undo" :label="t('backup.rollback')" :loading="busy === `rollback-${entry.id}`" :data-rollback="entry.id" @click="rollback(entry)" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="backup__import" data-backup-import>
      <div>
        <h3>{{ t('backup.import') }}</h3>
        <p>{{ t('backup.import_about') }}</p>
      </div>
      <input type="file" accept=".yml,.yaml,text/yaml" name="config-file" @change="pick">

      <Message v-if="plan && !plan.changes.length" severity="success" :closable="false">{{ t('backup.nothing_to_change') }}</Message>
      <table v-if="plan?.changes.length" class="backup__plan">
        <thead>
          <tr><th>{{ t('backup.col_what') }}</th><th>{{ t('backup.col_key') }}</th><th>{{ t('backup.col_before') }}</th><th>{{ t('backup.col_after') }}</th></tr>
        </thead>
        <tbody v-for="change in plan.changes" :key="`${change.area}:${change.id}`" :data-change="`${change.area}:${change.id}`">
          <tr v-for="(row, index) in change.rows" :key="row.key">
            <td><template v-if="index === 0"><Tag severity="secondary" :value="t(`backup.areas.${change.area}`)" /> <strong>{{ change.id }}</strong></template></td>
            <td class="backup__mono">{{ row.key }}</td>
            <td class="backup__mono backup__before">{{ row.before }}</td>
            <td class="backup__mono backup__after">{{ row.after }}</td>
          </tr>
        </tbody>
      </table>
      <Message v-for="note in plan?.notes ?? []" :key="note" severity="info" :closable="false">{{ note }}</Message>
      <Message v-for="warning in plan?.warnings ?? []" :key="warning" severity="warn" :closable="false">{{ warning }}</Message>
      <div v-if="plan?.changes.length"><Button :label="t('backup.apply')" icon="pi pi-check" size="small" :loading="busy === 'apply'" data-backup="apply" @click="apply" /></div>

      <Message v-for="result in applied ?? []" :key="`${result.area}:${result.id}`" :severity="result.ok ? 'success' : 'error'" :closable="false">
        {{ result.area }} {{ result.id }}: {{ result.ok ? t('backup.done') : result.error }}
      </Message>
    </section>
  </div>
</template>

<style scoped lang="scss">
.backup {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    max-width: 44rem;

    h3 { margin: 0 0 4px; }
    p { margin: 0; color: var(--p-text-muted-color); }
  }

  &__import {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    max-width: 44rem;

    h3 { margin: 0 0 4px; }
    p { margin: 0; color: var(--p-text-muted-color); }
  }

  &__mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8125rem; }
  &__before { color: var(--p-text-muted-color); }
  &__none { color: var(--p-text-muted-color); }
  &__preview { display: flex; flex-direction: column; gap: 6px; }

  &__plan {
    border-collapse: collapse;

    td { padding: 6px 12px 6px 0; vertical-align: top; border-bottom: 1px solid var(--p-content-border-color); }
  }
}
</style>
