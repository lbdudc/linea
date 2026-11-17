<script setup>
// Who works on a line of this server's own git host, and what each may do: the owner gives a level (reporter, developer, maintainer)
// to people who have an account here, changes it, and takes it away. Other hosts manage their members themselves.
import { ref, computed, onMounted } from 'vue'
import lineService from 'src/services/lineService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

const props = defineProps({ lineId: { type: String, required: true } })
const emit = defineEmits(['close', 'changed'])
const t = useT()

const visible = ref(true)
const members = ref([])
const username = ref('')
const role = ref(30)
const busy = ref(false)
const ROLES = [40, 30, 20]
const options = computed(() => ROLES.map((value) => ({ value, label: t(`labels.role${value}`) })))

const message = (e) => errorMessage(e, t)

const apply = async (action) => {
  busy.value = true
  try {
    members.value = await action()
    emit('changed', members.value)
  } catch (e) {
    notify({ type: 'negative', message: message(e) })
  } finally {
    busy.value = false
  }
}

onMounted(() => apply(() => lineService.listMembers(props.lineId)))

const add = () => apply(async () => {
  const list = await lineService.setMember(props.lineId, username.value.trim(), role.value)
  username.value = ''
  return list
})
const change = (member, value) => apply(() => lineService.setMember(props.lineId, member.username, value))
const remove = (member) => apply(() => lineService.removeMember(props.lineId, member.username))
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t('members.title')" :style="{ width: '32rem' }" data-members-dialog @hide="emit('close')">
    <ul class="members">
      <li v-for="member in members" :key="member.username" :data-member="member.username">
        <span class="members__name">{{ member.username }}</span>
        <span v-if="member.role === 50" class="members__owner">{{ t('labels.role50') }}</span>
        <template v-else>
          <Select :model-value="member.role" :options="options" option-label="label" option-value="value" size="small" :disabled="busy" @update:model-value="(value) => change(member, value)" />
          <Button icon="pi pi-times" size="small" text severity="danger" :aria-label="t('members.remove')" :disabled="busy" name="remove-member" @click="remove(member)" />
        </template>
      </li>
    </ul>
    <form class="members__add" @submit.prevent="add">
      <InputText v-model="username" name="member-username" :placeholder="t('members.username')" autocomplete="off" fluid />
      <Select v-model="role" :options="options" option-label="label" option-value="value" />
      <Button :label="t('members.add')" icon="pi pi-user-plus" :loading="busy" :disabled="!username.trim()" name="add-member" type="submit" />
    </form>
    <small>{{ t('members.hint') }}</small>
  </Dialog>
</template>

<style scoped lang="scss">
.members {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__name {
    flex: 1;
    font-weight: 600;
  }

  &__owner {
    color: var(--p-text-muted-color);
  }

  &__add {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
}
</style>
