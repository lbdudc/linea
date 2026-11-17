<script setup>
// What a person with an account on this server (the local git host) does about it themselves: their password and their git token.
import { ref } from 'vue'
import settingsService from 'src/services/settingsService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Password from 'primevue/password'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

const emit = defineEmits(['close'])
const t = useT()

const visible = ref(true)
const current = ref('')
const next = ref('')
const token = ref('')
const busy = ref(false)

const message = (e) => errorMessage(e, t)

const change = async () => {
  busy.value = true
  try {
    await settingsService.changeOwnPassword({ currentPassword: current.value, newPassword: next.value })
    current.value = ''
    next.value = ''
    notify({ type: 'positive', message: t('account.changed') })
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  } finally {
    busy.value = false
  }
}

const regenerate = async () => {
  busy.value = true
  try {
    token.value = await settingsService.regenerateGitToken()
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  } finally {
    busy.value = false
  }
}

const copy = () => navigator.clipboard?.writeText(token.value)
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t('account.title')" :style="{ width: '30rem' }" data-account-dialog @hide="emit('close')">
    <form class="account" @submit.prevent="change">
      <Password v-model="current" :placeholder="t('account.current_password')" :feedback="false" toggle-mask autocomplete="current-password" fluid />
      <Password v-model="next" :placeholder="t('account.new_password')" :feedback="false" toggle-mask autocomplete="new-password" fluid />
      <small class="account__hint">{{ t('account.change_hint') }}</small>
      <Button :label="t('account.change')" icon="pi pi-key" :loading="busy" :disabled="!current || !next" name="change-password" type="submit" />
    </form>

    <h3>{{ t('account.token_title') }}</h3>
    <p>{{ t('account.token_hint') }}</p>
    <Button :label="t('account.regenerate')" icon="pi pi-refresh" severity="secondary" :loading="busy" name="regenerate-token" @click="regenerate" />
    <Message v-if="token" severity="warn" :closable="false">
      {{ t('account.token_new') }}
      <InputText :model-value="token" readonly fluid />
      <Button :label="t('account.copy')" size="small" text @click="copy" />
    </Message>
  </Dialog>
</template>

<style scoped lang="scss">
.account {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__hint { color: var(--p-text-muted-color); }
}
</style>
