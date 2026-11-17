<script setup>
import { ref } from 'vue'
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
  notify({ type: done.applied.every((result) => result.ok) ? 'positive' : 'warn', message: t('backup.applied', { n: done.applied.filter((result) => result.ok).length }) })
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

    <section class="backup__import" data-backup-import>
      <div>
        <h3>{{ t('backup.import') }}</h3>
        <p>{{ t('backup.import_about') }}</p>
      </div>
      <input type="file" accept=".yml,.yaml,text/yaml" name="config-file" @change="pick">

      <Message v-if="plan && !plan.changes.length" severity="success" :closable="false">{{ t('backup.nothing_to_change') }}</Message>
      <table v-if="plan?.changes.length" class="backup__plan">
        <tbody>
          <tr v-for="change in plan.changes" :key="`${change.area}:${change.id}`" :data-change="`${change.area}:${change.id}`">
            <td><Tag severity="secondary" :value="t(`backup.areas.${change.area}`)" /> <strong>{{ change.id }}</strong></td>
            <td><div v-for="line in change.summary" :key="line">{{ line }}</div></td>
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

  &__plan {
    border-collapse: collapse;

    td { padding: 6px 12px 6px 0; vertical-align: top; border-bottom: 1px solid var(--p-content-border-color); }
  }
}
</style>
