<script setup>
import { computed, ref, watch } from 'vue'
import PrimeButton from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import LabelTag from 'components/issues/LabelTag.vue'
import MarkdownEditor from 'components/issues/MarkdownEditor.vue'
import SidebarField from 'components/issues/SidebarField.vue'
import TagPicker from 'components/issues/TagPicker.vue'
import { useTemplatePicker } from 'src/composables/useTemplatePicker'

// Opens a merge request the way GitLab's form does: the branches it goes from and to, a title and a description on the left, and the
// people and labels in a side bar on the right.
const props = defineProps({
  meta: { type: Object, required: true },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'cancel'])

const caps = computed(() => props.meta.capabilities.mergeRequests)
const hasSide = computed(() => caps.value.labels || caps.value.reviewers)
const source = ref(null)
const target = ref(props.meta.defaultBranch)
const title = ref('')
const touched = ref(false)
const description = ref('')
const labels = ref([])
const reviewers = ref([])
const templates = useTemplatePicker({ templates: () => props.meta.templates, description, preload: true })

// the title a branch suggests: "fix/payments-alt" is "Fix payments alt", until the person writes their own
watch(source, (branch) => {
  if (touched.value || !branch) return
  const words = branch.replace(/^(feat|fix|chore|docs)\//, (_all, kind) => `${kind} `).replace(/[-_/]+/g, ' ').trim()
  title.value = words.charAt(0).toUpperCase() + words.slice(1)
})

const branches = computed(() => props.meta.branches.map((name) => ({ name })))
const suggestions = computed(() => props.meta.labels.map((label) => label.name).filter((name) => !labels.value.includes(name)))
const same = computed(() => Boolean(source.value) && source.value === target.value)
const valid = computed(() => title.value.trim().length > 0 && Boolean(source.value) && Boolean(target.value) && !same.value)

const save = () => {
  if (!valid.value || props.saving) return
  emit('save', {
    title: title.value.trim(), description: description.value, sourceBranch: source.value, targetBranch: target.value,
    ...(caps.value.labels ? { labels: labels.value } : {}), ...(caps.value.reviewers ? { reviewers: reviewers.value } : {}),
  })
}
</script>

<template>
  <form class="mrform ln-fields" name="mr-form" @submit.prevent="save">
    <h2 class="mrform__heading">{{ $t('mrs.new') }}</h2>
    <div class="mrform__cols" :class="{ 'mrform__cols--wide': !hasSide }">
      <div class="mrform__main">
        <div class="mrform__branches">
          <label class="mrform__field"><span class="mrform__label">{{ $t('mrs.from_branch') }}</span>
            <Select v-model="source" name="mr-source" :options="branches" option-label="name" option-value="name" filter fluid :placeholder="$t('mrs.from_branch')" />
          </label>
          <label class="mrform__field"><span class="mrform__label">{{ $t('mrs.to_branch') }}</span>
            <Select v-model="target" name="mr-target" :options="branches" option-label="name" option-value="name" filter fluid :placeholder="$t('mrs.to_branch')" />
          </label>
        </div>
        <small v-if="same" class="mrform__error">{{ $t('mrs.same_branch') }}</small>

        <label class="mrform__field"><span class="mrform__label">{{ $t('mrs.title') }} <span class="mrform__req">({{ $t('mrs.required') }})</span></span>
          <InputText v-model="title" name="mr-title" maxlength="255" fluid @input="touched = true" />
        </label>
        <label v-if="templates.list.value.length" class="mrform__field"><span class="mrform__label">{{ $t('templates.template') }}</span>
          <Select :model-value="templates.chosen.value" name="mr-template" :options="templates.list.value" option-label="name" option-value="name" show-clear fluid :placeholder="$t('templates.none')" @update:model-value="templates.choose" />
        </label>
        <div class="mrform__field"><span class="mrform__label">{{ $t('mrs.description') }}</span>
          <MarkdownEditor v-model="description" name="mr-description" :rows="10" :placeholder="$t('mrs.description_placeholder')" />
        </div>
      </div>

      <aside v-if="hasSide" class="mrform__side">
        <SidebarField v-if="caps.reviewers" always :title="$t('mrs.reviewers')"><template #editor><TagPicker v-model="reviewers" name="mr-reviewers" :options="meta.members ?? []" /></template></SidebarField>
        <SidebarField v-if="caps.labels" always :title="$t('mrs.labels')">
          <template #editor>
            <TagPicker v-model="labels" name="mr-labels" :options="meta.labels.map((label) => label.name)" />
            <span v-if="suggestions.length" class="mrform__suggest">
              <button v-for="name in suggestions.slice(0, 8)" :key="name" type="button" class="mrform__chip" @click="labels.push(name)"><LabelTag :name="name" :color="meta.labels.find((label) => label.name === name)?.color" /></button>
            </span>
          </template>
        </SidebarField>
      </aside>
    </div>
    <div class="mrform__bar">
      <PrimeButton type="submit" name="mr-save" :label="$t('mrs.create')" :loading="saving" :disabled="!valid" />
      <PrimeButton type="button" severity="secondary" outlined :label="$t('labels.cancel')" @click="emit('cancel')" />
    </div>
  </form>
</template>

<style scoped>
.mrform { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.mrform__heading { margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--text-heading); }
.mrform__cols { display: grid; grid-template-columns: minmax(0, 1fr) 17rem; gap: 32px; align-items: start; }
.mrform__cols--wide { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 900px) { .mrform__cols { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
.mrform__main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.mrform__branches { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 600px) { .mrform__branches { grid-template-columns: 1fr; } }
.mrform__field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mrform__label { font-size: 0.875rem; font-weight: 700; color: var(--text-heading); }
.mrform__req { font-weight: 400; color: var(--text-muted); }
.mrform__error { color: var(--status-bad); }
.mrform__side { min-width: 0; }
.mrform__suggest { display: flex; flex-wrap: wrap; gap: 6px; }
.mrform__chip { padding: 0; border: 0; background: none; cursor: pointer; }
.mrform__bar { display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--card-border); }
</style>
