<script setup>
import { computed, ref } from 'vue'
import PrimeButton from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useT } from 'src/composables/useT'
import { useTemplatePicker } from 'src/composables/useTemplatePicker'
import LabelTag from './LabelTag.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import SidebarField from './SidebarField.vue'
import TagPicker from './TagPicker.vue'

// Writes or edits an issue the way GitLab's form does: the title and the description on the left, who it is for and how it is
// grouped in a side bar on the right, and the buttons at the foot. Labels, assignees and the milestone are free text here: the host
// says whether a name is right.
const props = defineProps({
  meta: { type: Object, required: true },
  issue: { type: Object, default: null },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'cancel'])
const t = useT()

const caps = computed(() => props.meta.capabilities.issues)
const hasSide = computed(() => caps.value.assignees || caps.value.labels || caps.value.milestones)
const title = ref(props.issue?.title ?? '')
const description = ref(props.issue?.description ?? '')
const labels = ref([...(props.issue?.labels ?? [])])
const assignees = ref([...(props.issue?.assignees ?? [])])
const milestone = ref(props.issue?.milestone ?? null)

const templates = useTemplatePicker({ templates: () => props.meta.templates, description, preload: !props.issue })

const suggestions = computed(() => props.meta.labels.map((label) => label.name).filter((name) => !labels.value.includes(name)))
const valid = computed(() => title.value.trim().length > 0)

const save = () => {
  if (!valid.value || props.saving) return
  emit('save', {
    title: title.value.trim(),
    description: description.value,
    ...(caps.value.labels ? { labels: labels.value } : {}),
    ...(caps.value.assignees ? { assignees: assignees.value } : {}),
    ...(caps.value.milestones ? { milestone: (milestone.value ?? '').trim() || null } : {}),
  })
}
</script>

<template>
  <form class="gform ln-fields" name="issue-form" @submit.prevent="save">
    <h2 v-if="!issue" class="gform__heading">{{ $t('issues.new') }}</h2>

    <div class="gform__cols" :class="{ 'gform__cols--wide': !hasSide }">
      <div class="gform__main">
        <label class="gform__field">
          <span class="gform__label">{{ $t('issues.field_title') }} <span class="gform__req">({{ $t('issues.required') }})</span></span>
          <InputText v-model="title" name="issue-title" maxlength="255" fluid autofocus />
        </label>
        <label v-if="!issue && templates.list.value.length" class="gform__field">
          <span class="gform__label">{{ $t('templates.template') }}</span>
          <Select :model-value="templates.chosen.value" name="issue-template" :options="templates.list.value" option-label="name" option-value="name" show-clear fluid :placeholder="$t('templates.none')" @update:model-value="templates.choose" />
        </label>
        <div class="gform__field">
          <span class="gform__label">{{ $t('issues.field_description') }}</span>
          <MarkdownEditor v-model="description" name="issue-description" :rows="12" :placeholder="$t('issues.description_placeholder')" />
        </div>
      </div>

      <aside v-if="hasSide" class="gform__side">
        <SidebarField v-if="caps.assignees" always :title="$t('issues.field_assignees')">
          <template #editor><TagPicker v-model="assignees" name="issue-assignees" :options="meta.members ?? []" /></template>
        </SidebarField>
        <SidebarField v-if="caps.labels" always :title="$t('issues.field_labels')">
          <template #editor>
            <TagPicker v-model="labels" name="issue-labels" :options="meta.labels.map((label) => label.name)" />
            <span v-if="suggestions.length" class="gform__suggest">
              <button v-for="name in suggestions.slice(0, 8)" :key="name" type="button" class="gform__chip" @click="labels.push(name)"><LabelTag :name="name" :color="meta.labels.find((label) => label.name === name)?.color" /></button>
            </span>
          </template>
        </SidebarField>
        <SidebarField v-if="caps.milestones" always :title="$t('issues.field_milestone')">
          <template #editor>
            <Select v-model="milestone" name="issue-milestone" :options="meta.milestones" option-label="title" option-value="title" editable show-clear fluid :placeholder="$t('issues.no_milestone')" />
          </template>
        </SidebarField>
      </aside>
    </div>

    <div class="gform__bar">
      <PrimeButton type="submit" name="issue-save" :label="issue ? $t('issues.save') : $t('issues.create')" :loading="saving" :disabled="!valid" />
      <PrimeButton type="button" severity="secondary" outlined :label="$t('labels.cancel')" @click="emit('cancel')" />
    </div>
  </form>
</template>

<style scoped>
.gform { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.gform__heading { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--text-heading); }
.gform__cols { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 32px; align-items: start; }
.gform__cols--wide { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 900px) { .gform__cols { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
.gform__main { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.gform__side { min-width: 0; }
.gform__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gform__label { font-size: 0.875rem; font-weight: 700; color: var(--text-heading); }
.gform__req { font-weight: 400; color: var(--text-muted); }
.gform__suggest { display: flex; flex-wrap: wrap; gap: 6px; }
.gform__chip { padding: 0; border: 0; background: none; cursor: pointer; }
.gform__chip:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; border-radius: 99px; }
.gform__bar { display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--card-border); }
</style>
