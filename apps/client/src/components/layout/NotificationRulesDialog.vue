<script setup>
import { ref, onMounted } from 'vue'
import notificationService from 'src/services/notificationService'
import lineService from 'src/services/lineService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ToggleSwitch from 'primevue/toggleswitch'
import InputNumber from 'primevue/inputnumber'
import MultiSelect from 'primevue/multiselect'

const emit = defineEmits(['close'])
const t = useT()

const visible = ref(true)
const rules = ref(null)
const lines = ref([])
const error = ref(null)
const busy = ref(false)

onMounted(async () => {
  try {
    const [loaded, enrolled] = await Promise.all([notificationService.getRules(), lineService.findEnrolledLines().catch(() => [])])
    rules.value = loaded
    lines.value = enrolled.map((line) => ({ id: String(line._id ?? line.id), name: line.name }))
  } catch (e) {
    error.value = errorMessage(e, t)
  }
})

const save = async () => {
  busy.value = true
  try {
    rules.value = await notificationService.setRules(rules.value)
    notify({ type: 'positive', message: t('notifications.rules_saved') })
    visible.value = false
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t('notifications.rules_title')" :style="{ width: '34rem' }" name="notification-rules" @after-hide="emit('close')">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <template v-if="rules">
      <p class="rules__about">{{ t('notifications.rules_about') }}</p>
      <label class="rules__row"><ToggleSwitch v-model="rules.failed" name="rule-failed" /><span>{{ t('notifications.rule_failed') }}</span></label>
      <label class="rules__row"><ToggleSwitch v-model="rules.conflicts" name="rule-conflicts" /><span>{{ t('notifications.rule_conflicts') }}</span></label>
      <label class="rules__row"><ToggleSwitch v-model="rules.stuck" name="rule-stuck" /><span>{{ t('notifications.rule_stuck') }}</span></label>
      <div class="rules__field" :class="{ 'rules__field--off': !rules.stuck }">
        <label for="rule-minutes">{{ t('notifications.rule_minutes') }}</label>
        <InputNumber v-model="rules.stuckMinutes" input-id="rule-minutes" :min="5" :max="1440" suffix=" min" show-buttons :disabled="!rules.stuck" name="rule-minutes" />
      </div>
      <div class="rules__field">
        <label for="rule-lines">{{ t('notifications.rule_lines') }}</label>
        <MultiSelect v-model="rules.lineIds" input-id="rule-lines" :options="lines" option-label="name" option-value="id" filter display="chip" :placeholder="t('notifications.rule_lines_none')" name="rule-lines" />
        <small>{{ t('notifications.rule_lines_hint') }}</small>
      </div>
    </template>
    <template #footer>
      <Button :label="t('notifications.rules_cancel')" severity="secondary" text @click="visible = false" />
      <Button :label="t('notifications.rules_save')" :disabled="!rules || busy" name="rules-save" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.rules {
  &__about { margin: 0 0 12px; color: var(--text-muted); font-size: 0.875rem; }
  &__row { display: flex; align-items: center; gap: 12px; padding: 8px 0; cursor: pointer; }
  &__field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  &__field--off { opacity: 0.55; }
  &__field small { color: var(--text-muted); }
}
</style>
