<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import settingsService from 'src/services/settingsService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { state } from 'stores/userState'
import { hostName } from 'src/boot/gitHost'
import PageHeader from 'components/layout/PageHeader.vue'
import GitHostIcon from 'components/common/GitHostIcon.vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import { useT } from 'src/composables/useT'

const t = useT()
const route = useRoute()
const router = useRouter()

const users = ref([])
const loading = ref(true)
const error = ref(null)

// the dialog that makes an account, or sets a password: `target` is the person whose it is (none: a new one)
const dialog = ref(false)
const target = ref(null)
const form = ref({ username: '', password: '', admin: false })
const saving = ref(false)
const leaving = ref(null) // the person being deleted
const heir = ref(null)

const message = (e) => errorMessage(e, t)

const load = async () => {
  error.value = null
  try {
    users.value = await settingsService.users()
  } catch (e) {
    error.value = message(e)
  } finally {
    loading.value = false
  }
}
// the person may not be known yet when the page opens (a reload restores the session first): load as soon as they are an administrator
load()

const open = (person = null) => {
  target.value = person
  form.value = { username: '', password: '', admin: false }
  dialog.value = true
}

watch(() => route.query.add, (wanted) => {
  if (!wanted) return
  open()
  const { add: _add, ...rest } = route.query
  router.replace({ query: rest })
}, { immediate: true })

const toggleAdmin = async (person) => {
  try {
    await settingsService.setAdmin(person.id, !person.admin)
    notify({ type: 'positive', message: t('users.role_changed') })
    await load()
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  }
}

const signOutEverywhere = async (person) => {
  try {
    await settingsService.signOutEverywhere(person.id)
    notify({ type: 'positive', message: t('users.signed_out') })
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  }
}

const toggleDisabled = async (person) => {
  try {
    await settingsService.setDisabled(person.id, !person.disabled)
    notify({ type: 'positive', message: t('users.state_changed') })
    await load()
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  }
}

const askDelete = (person) => { leaving.value = person; heir.value = null }
const heirs = computed(() => users.value.filter((person) => person.id !== leaving.value?.id && !person.disabled).map((person) => person.username))

const confirmDelete = async () => {
  saving.value = true
  try {
    await settingsService.deleteUser(leaving.value.id, heir.value)
    notify({ type: 'positive', message: t('users.deleted') })
    leaving.value = null
    await load()
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  } finally {
    saving.value = false
  }
}

const save = async () => {
  saving.value = true
  try {
    if (target.value) await settingsService.setPassword(target.value.id, form.value.password)
    else await settingsService.createUser(form.value)
    notify({ type: 'positive', message: t(target.value ? 'users.password_set' : 'users.created') })
    dialog.value = false
    await load()
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="users" name="users">
    <PageHeader compact as="h2" :title="t('users.title')" :subtitle="t('users.subtitle')">
      <template #actions>
        <Button :label="t('users.add')" icon="pi pi-plus" size="small" name="add-user" @click="open()" />
      </template>
    </PageHeader>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Skeleton v-if="loading" height="8rem" />

    <table v-else class="users__table">
      <thead>
        <tr><th>{{ t('labels.username') }}</th><th>{{ t('users.host') }}</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="person in users" :key="person.id" :data-user="person.username">
          <td>
            {{ person.username }}
            <Tag v-if="person.admin" :value="t('users.admin')" severity="info" />
            <Tag v-if="person.disabled" :value="t('users.disabled')" severity="secondary" />
          </td>
          <td>
            <GitHostIcon :host="person.host" :size="14" /> {{ hostName(person.host) }}
            <Tag v-if="person.hostOff" :value="t('users.host_off')" severity="warn" />
          </td>
          <td class="users__actions">
            <Button
              :label="person.admin ? t('users.remove_admin') : t('users.make_admin')"
              :icon="person.admin ? 'pi pi-shield' : 'pi pi-user-plus'" size="small" severity="secondary" text
              name="toggle-admin"
              @click="toggleAdmin(person)"
            />
            <Button
              :label="t('users.sign_out_everywhere')" icon="pi pi-sign-out" size="small" severity="secondary" text
              name="sign-out-everywhere"
              @click="signOutEverywhere(person)"
            />
            <Button
              v-if="person.host === 'local'"
              :label="t('users.set_password')" icon="pi pi-key" size="small" severity="secondary" text
              @click="open(person)"
            />
            <Button
              :label="person.disabled ? t('users.enable') : t('users.disable')"
              :icon="person.disabled ? 'pi pi-check-circle' : 'pi pi-ban'" size="small" severity="secondary" text
              name="toggle-disabled"
              @click="toggleDisabled(person)"
            />
            <Button
              v-if="person.id !== state.user?.userId"
              :label="t('users.delete')" icon="pi pi-trash" size="small" severity="danger" text
              name="delete-user"
              @click="askDelete(person)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <Dialog :visible="Boolean(leaving)" modal :header="t('users.delete_title', { name: leaving?.username })" :style="{ width: '28rem' }" @update:visible="leaving = null">
      <p>{{ t('users.delete_body') }}</p>
      <Select v-model="heir" :options="heirs" :placeholder="t('users.nobody')" show-clear fluid :aria-label="t('users.transfer_to')" />
      <template #footer>
        <Button :label="t('plugins.cancel')" text severity="secondary" @click="leaving = null" />
        <Button :label="t('users.delete')" icon="pi pi-trash" severity="danger" :loading="saving" name="confirm-delete" @click="confirmDelete" />
      </template>
    </Dialog>

    <Dialog v-model:visible="dialog" modal :header="target ? t('users.set_password_for', { name: target.username }) : t('users.add')" :style="{ width: '26rem' }">
      <form class="users__form" @submit.prevent="save">
        <InputText v-if="!target" v-model="form.username" name="new-username" :placeholder="t('labels.username')" autocomplete="off" fluid />
        <Password v-model="form.password" input-id="new-password" :placeholder="t('labels.password')" :feedback="false" toggle-mask autocomplete="new-password" fluid />
        <label v-if="!target" class="users__check"><Checkbox v-model="form.admin" binary input-id="new-admin" /> {{ t('users.admin') }}</label>
      </form>
      <template #footer>
        <Button :label="t('plugins.cancel')" text severity="secondary" @click="dialog = false" />
        <Button :label="t('plugins.save')" icon="pi pi-check" :loading="saving" :disabled="(!target && !form.username) || !form.password" name="save-user" @click="save" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped lang="scss">
.users {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__table {
    width: 100%;
    border-collapse: collapse;

    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }

    th {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      text-transform: uppercase;
    }
  }

  &__actions {
    text-align: right;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
