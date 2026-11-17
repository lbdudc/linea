<script setup>
// The settings of one group of the instance (sign-in, modules, audit): a field per setting, saved together. Only what changes is sent;
// "default" takes a saved setting back to its default; what linea.config.yml declares is shown but locked.
import { ref, computed } from 'vue'
import settingsService from 'src/services/settingsService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import InfoHint from 'src/components/common/InfoHint.vue'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'

const props = defineProps({ group: { type: String, required: true } })
const t = useT()

const schema = ref({})
const meta = ref({})
const form = ref({})
const initial = ref({})
const resetting = ref(new Set())
const loading = ref(true)
const saving = ref(false)
const error = ref(null)

const keys = computed(() => Object.keys(schema.value).filter((key) => schema.value[key].group === props.group))
const changed = computed(() => keys.value.some((key) => form.value[key] !== initial.value[key]) || resetting.value.size > 0)

const show = ({ schema: shownSchema, values, meta: shownMeta }) => {
  schema.value = shownSchema
  meta.value = shownMeta
  form.value = { ...values }
  initial.value = { ...values }
  resetting.value = new Set()
}

const load = async () => {
  try {
    show(await settingsService.instance())
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
load()

const reset = (key) => {
  resetting.value = new Set([...resetting.value, key])
  form.value = { ...form.value, [key]: schema.value[key].default }
}

const save = async () => {
  const patch = Object.fromEntries(keys.value.filter((key) => !meta.value[key]?.locked && !resetting.value.has(key) && form.value[key] !== initial.value[key]).map((key) => [key, form.value[key]]))
  for (const key of resetting.value) patch[key] = null
  saving.value = true
  try {
    show(await settingsService.saveInstance(patch))
    notify({ type: 'positive', message: t('instance.saved') })
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="instance-form">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading" height="12rem" />

    <form v-else class="instance-form__fields" @submit.prevent="save">
      <div v-for="key in keys" :key="key" class="instance-form__field" :data-setting="key">
        <label :for="`instance-${key}`" class="instance-form__label">
          {{ t(`instance.fields.${key}`) }}
          <InfoHint :text="t(`instance.hints.${key}`)" />
          <Tag v-if="meta[key]?.locked" severity="info" icon="pi pi-lock" :value="t('instance.locked')" />
          <Tag v-else-if="meta[key]?.source === 'stored' && !resetting.has(key)" severity="secondary" :value="t('instance.changed')" />
        </label>
        <div class="instance-form__input">
          <InputNumber
            v-if="schema[key].type === 'number'"
            v-model="form[key]" :input-id="`instance-${key}`" :min="schema[key].min" :max="schema[key].max"
            :min-fraction-digits="0" :max-fraction-digits="2" :disabled="meta[key]?.locked" show-buttons
          />
          <ToggleSwitch
            v-else-if="schema[key].type === 'boolean'"
            v-model="form[key]" :input-id="`instance-${key}`" :disabled="meta[key]?.locked"
          />
          <Select
            v-else
            v-model="form[key]" :input-id="`instance-${key}`" :disabled="meta[key]?.locked"
            :options="schema[key].options.map((value) => ({ value, label: t(`instance.options.${value}`) }))" option-label="label" option-value="value"
          />
          <Button
            v-if="!meta[key]?.locked && form[key] !== schema[key].default" type="button" text size="small"
            icon="pi pi-undo" :label="t('instance.default')" @click="reset(key)"
          />
        </div>
      </div>

      <div><Button type="submit" :label="t('instance.save')" icon="pi pi-check" :disabled="!changed" :loading="saving" /></div>
    </form>
  </div>
</template>

<style scoped lang="scss">
.instance-form {
  &__fields {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 36rem;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  &__input {
    display: flex;
    align-items: center;
    gap: 8px;
  }

}
</style>
