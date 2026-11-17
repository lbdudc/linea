<script setup>
import { ref, computed, onMounted } from 'vue'
import { notify, errorMessage } from 'src/composables/useNotify'
import { localized } from 'src/plugins/registry'
import { useT } from 'src/composables/useT'
import { api } from 'src/boot/axios'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Password from 'primevue/password'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Chips from 'primevue/chips'
import Tag from 'primevue/tag'

// The form of a set of settings (a schema and its values): `load()` answers `{ schema, values, meta }`, `save(patch)` keeps the change,
// `optionsUrl(spec)` is where a setting that lists its choices (`optionsFrom`) asks for them.
const props = defineProps({
  title: { type: String, required: true },
  load: { type: Function, required: true },
  save: { type: Function, required: true },
  optionsUrl: { type: Function, default: null },
  noSettings: { type: String, default: '' },
})
const emit = defineEmits(['close', 'saved'])
const t = useT()

const schema = ref({})
const meta = ref({})
const form = ref({})
const initial = ref({}) // what the form started with: only what the person changes is sent, so the environment's and the defaults' values stay theirs
const options = ref({}) // key -> [{ value, label }] for the settings that list their choices (`optionsFrom`)
const saving = ref(false)
const resetting = ref(new Set()) // the settings to forget what was saved of (back to the environment's value, or the default)
const visible = ref(true)

const keys = computed(() => Object.keys(schema.value))

onMounted(async () => {
  const shown = await props.load()
  schema.value = shown.schema
  meta.value = shown.meta
  // a secret is never sent back: it starts empty, and empty keeps it
  form.value = Object.fromEntries(Object.entries(shown.values).map(([key, value]) => [key, shown.schema[key]?.type === 'secret' ? '' : value]))
  initial.value = JSON.parse(JSON.stringify(form.value))
  for (const [key, spec] of Object.entries(shown.schema)) {
    if (!spec.optionsFrom || !props.optionsUrl) continue
    try {
      options.value[key] = (await api.get(props.optionsUrl(spec))).data
    } catch {
      options.value[key] = [] // the choices could not be loaded: the field stays free text
    }
  }
})

const label = (key) => localized(schema.value[key].label, undefined) || key
const hint = (key) => localized(schema.value[key].description, undefined)
const free = (key) => !schema.value[key].optionsFrom || !options.value[key]?.length

// a secret is forgotten with an explicit answer: empty means "keep it"
const forgetSecret = (key) => { form.value[key] = { clear: true } }
const forgotten = (key) => form.value[key]?.clear === true
const toggleReset = (key) => {
  const next = new Set(resetting.value)
  if (!next.delete(key)) next.add(key)
  resetting.value = next
}

const submit = async () => {
  saving.value = true
  try {
    const changed = (key) => JSON.stringify(form.value[key] ?? null) !== JSON.stringify(initial.value[key] ?? null)
    const patch = Object.fromEntries(keys.value.filter((key) => !meta.value[key]?.locked && changed(key) && !resetting.value.has(key)).map((key) => [key, form.value[key]]))
    for (const key of resetting.value) patch[key] = null
    await props.save(patch)
    notify({ type: 'positive', message: t('plugins.saved') })
    emit('saved')
    emit('close')
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" :style="{ width: '34rem' }" @hide="emit('close')">
    <p v-if="!keys.length">{{ noSettings }}</p>
    <form v-else class="settings" @submit.prevent="submit">
      <div v-for="key in keys" :key="key" class="settings__field">
        <label :for="`setting-${key}`">
          {{ label(key) }}<span v-if="schema[key].required"> *</span>
          <Tag v-if="meta[key]?.locked" :value="t('plugins.setting_locked')" severity="warn" icon="pi pi-lock" />
        </label>

        <Checkbox v-if="schema[key].type === 'boolean'" v-model="form[key]" binary :input-id="`setting-${key}`" :disabled="meta[key]?.locked" />
        <InputNumber v-else-if="schema[key].type === 'number'" v-model="form[key]" :input-id="`setting-${key}`" :min="schema[key].min" :max="schema[key].max" :disabled="meta[key]?.locked" fluid />
        <Select v-else-if="schema[key].type === 'enum'" v-model="form[key]" :input-id="`setting-${key}`" :options="schema[key].options" :disabled="meta[key]?.locked" fluid />
        <Select
          v-else-if="schema[key].optionsFrom && !free(key)"
          v-model="form[key]" :input-id="`setting-${key}`" :options="options[key]" option-label="label" option-value="value" :disabled="meta[key]?.locked" fluid
        />
        <Chips v-else-if="schema[key].type === 'list'" v-model="form[key]" :input-id="`setting-${key}`" :disabled="meta[key]?.locked" fluid />
        <small v-else-if="schema[key].type === 'secret' && forgotten(key)">{{ t('plugins.clear_secret') }} ✓</small>
        <Password
          v-else-if="schema[key].type === 'secret'"
          v-model="form[key]" :input-id="`setting-${key}`" :feedback="false" toggle-mask autocomplete="new-password"
          :placeholder="meta[key]?.source ? t('plugins.secret_set') : ''" :disabled="meta[key]?.locked" fluid
        />
        <InputText v-else v-model="form[key]" :id="`setting-${key}`" :disabled="meta[key]?.locked" fluid />

        <Button
          v-if="schema[key].type === 'secret' && meta[key]?.source === 'stored' && !meta[key]?.locked && !forgotten(key)"
          :label="t('plugins.clear_secret')" size="small" text severity="secondary" class="settings__forget" @click="forgetSecret(key)"
        />
        <Button
          v-if="schema[key].type !== 'secret' && meta[key]?.source === 'stored' && !meta[key]?.locked"
          :label="resetting.has(key) ? t('plugins.reset_undo') : t('plugins.reset')" size="small" text severity="secondary" class="settings__forget" :name="`reset-${key}`" @click="toggleReset(key)"
        />
        <small v-if="hint(key)">{{ hint(key) }}</small>
        <small v-if="meta[key]?.source" class="settings__source">{{ t('plugins.setting_source', { source: meta[key].source }) }}</small>
      </div>
    </form>

    <template #footer>
      <Button :label="t('plugins.cancel')" text severity="secondary" @click="visible = false" />
      <Button v-if="keys.length" :label="t('plugins.save')" icon="pi pi-check" :loading="saving" @click="submit" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;

    label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }
  }

  &__source {
    color: var(--p-text-muted-color);
  }
}
</style>
