<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import PrimeButton from 'primevue/button'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import issueService from 'src/services/issueService'
import mergeRequestService from 'src/services/mergeRequestService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import MarkdownEditor from './MarkdownEditor.vue'

const props = defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  subject: { type: String, required: true },
})
const t = useT()

const service = computed(() => (props.subject === 'issue' ? issueService : mergeRequestService))
const meta = ref(null)
const failed = ref(false)
const editing = ref(null)
const name = ref('')
const content = ref('')
const saving = ref(false)

const editable = computed(() => meta.value?.capabilities.templates?.editable === true)
const templates = computed(() => meta.value?.templates ?? [])
const paths = computed(() => {
  const place = {
    gitlab: props.subject === 'issue' ? '.gitlab/issue_templates/*.md' : '.gitlab/merge_request_templates/*.md',
    github: props.subject === 'issue' ? '.github/ISSUE_TEMPLATE/*.md' : '.github/pull_request_template.md',
  }
  return place[meta.value?.host] ?? ''
})
const valid = computed(() => name.value.trim().length > 0)

const load = async () => {
  failed.value = false
  try {
    meta.value = await service.value.meta({ kind: props.kind, id: props.id })
  } catch (error) {
    failed.value = true
    notify({ type: 'negative', message: errorMessage(error, t) })
  }
}

const edit = (template) => {
  editing.value = template ? template.name : ''
  name.value = template?.name ?? ''
  content.value = template?.content ?? ''
}
const stop = () => { editing.value = null }

const save = async () => {
  if (!valid.value || saving.value) return
  saving.value = true
  try {
    await service.value.saveTemplate({ kind: props.kind, id: props.id, name: name.value.trim(), content: content.value })
    notify({ type: 'positive', message: t('templates.saved') })
    stop()
    await load()
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  } finally {
    saving.value = false
  }
}

const remove = async (template) => {
  try {
    await service.value.deleteTemplate({ kind: props.kind, id: props.id, name: template.name })
    notify({ type: 'positive', message: t('templates.deleted') })
    await load()
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  }
}

onMounted(load)
watch(() => [props.kind, props.id, props.subject], () => { meta.value = null; stop(); load() })
</script>

<template>
  <div class="tpl ln-fields" :name="`templates-${subject}`">
    <Skeleton v-if="!meta && !failed" height="3rem" />
    <PrimeButton v-else-if="failed" text size="small" :label="$t('labels.retry')" @click="load" />

    <template v-else>
      <p v-if="!editable" class="tpl__note">{{ $t('templates.in_repository', { path: paths }) }}</p>

      <ul v-if="templates.length && editing === null" class="tpl__list">
        <li v-for="template in templates" :key="template.name" class="tpl__row">
          <span class="tpl__name">{{ template.name }}</span>
          <span v-if="editable" class="tpl__actions">
            <PrimeButton text rounded size="small" icon="pi pi-pencil" :aria-label="$t('templates.edit')" :name="`template-edit-${template.name}`" @click="edit(template)" />
            <PrimeButton text rounded size="small" severity="danger" icon="pi pi-trash" :aria-label="$t('templates.delete')" :name="`template-delete-${template.name}`" @click="remove(template)" />
          </span>
        </li>
      </ul>
      <p v-else-if="editing === null" class="tpl__empty">{{ $t('templates.empty') }}</p>

      <form v-if="editing !== null" class="tpl__form" @submit.prevent="save">
        <label class="tpl__field">
          <span class="tpl__label">{{ $t('templates.name') }}</span>
          <InputText v-model="name" name="template-name" maxlength="100" fluid :disabled="editing !== ''" autofocus />
        </label>
        <div class="tpl__field">
          <span class="tpl__label">{{ $t('templates.content') }}</span>
          <MarkdownEditor v-model="content" name="template-content" :rows="10" />
        </div>
        <div class="tpl__bar">
          <PrimeButton type="submit" name="template-save" :label="$t('templates.save')" :loading="saving" :disabled="!valid" />
          <PrimeButton type="button" severity="secondary" outlined :label="$t('labels.cancel')" @click="stop" />
        </div>
      </form>
      <PrimeButton v-else-if="editable" name="template-new" size="small" icon="pi pi-plus" :label="$t('templates.new')" @click="edit(null)" />
    </template>
  </div>
</template>

<style scoped>
.tpl { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.tpl > .p-button { align-self: flex-start; }
.tpl__note, .tpl__empty { margin: 0; font-size: 0.875rem; color: var(--text-muted); }
.tpl__list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; border: 1px solid var(--card-border); border-radius: 6px; }
.tpl__row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--card-border); }
.tpl__row:last-child { border-bottom: 0; }
.tpl__name { font-weight: 600; color: var(--text-heading); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tpl__actions { display: flex; gap: 2px; }
.tpl__form { display: flex; flex-direction: column; gap: 14px; }
.tpl__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tpl__label { font-size: 0.875rem; font-weight: 700; color: var(--text-heading); }
.tpl__bar { display: flex; gap: 8px; }
</style>
