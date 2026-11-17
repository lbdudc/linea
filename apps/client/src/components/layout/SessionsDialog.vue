<script setup>
// The sign-ins of the person (one per browser or device): they see where they are signed in and can end any of them.
import { ref, onMounted } from 'vue'
import userService from 'src/services/userService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'

const emit = defineEmits(['close', 'ended-all'])
const t = useT()

const visible = ref(true)
const sessions = ref([])
const loading = ref(true)
const error = ref(null)
const busy = ref(false)

const load = async () => {
  try {
    sessions.value = await userService.sessions()
  } catch (e) {
    error.value = errorMessage(e, t)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// "Chrome on macOS", as far as the browser says so
const deviceOf = (userAgent) => {
  if (!userAgent) return t('sessions.unknown_device')
  const found = [['Edg/', 'Edge'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Version/', 'Safari']].find(([mark]) => userAgent.includes(mark))
  const major = found && userAgent.split(found[0])[1]?.match(/^\d+/)?.[0]
  const browser = found && [found[1], major].filter(Boolean).join(' ')
  const system = [['iPhone', 'iOS'], ['iPad', 'iPadOS'], ['Android', 'Android'], ['Mac OS X', 'macOS'], ['Windows', 'Windows'], ['Linux', 'Linux']].find(([mark]) => userAgent.includes(mark))?.[1]
  return [browser, system].filter(Boolean).join(' · ') || userAgent.slice(0, 40)
}
const when = (at) => (at ? new Date(at).toLocaleString() : '')
const NEW_MS = 24 * 3600_000
const isNew = (session) => !session.current && session.signedInAt && Date.now() - new Date(session.signedInAt).getTime() < NEW_MS

const act = async (work, { leaves = false } = {}) => {
  busy.value = true
  try {
    await work()
    if (leaves) return emit('ended-all')
    await load()
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = false
  }
}
const end = (session) => act(() => userService.endSession(session.id), { leaves: session.current })
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t('sessions.title')" :style="{ width: '40rem' }" @after-hide="emit('close')">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <p>{{ t('sessions.about') }}</p>

    <ul class="sessions">
      <li v-for="session in sessions" :key="session.id" class="sessions__row" :data-session="session.id">
        <div class="sessions__what">
          <strong>{{ deviceOf(session.userAgent) }}</strong>
          <Tag v-if="session.current" severity="success" :value="t('sessions.this_one')" />
          <Tag v-else-if="isNew(session)" severity="warn" :value="t('sessions.new_one')" :data-new-session="session.id" />
          <small>{{ session.ip }} · {{ t('sessions.signed_in', { when: when(session.signedInAt) }) }} · {{ t('sessions.last_active', { when: when(session.lastActive) }) }}</small>
        </div>
        <Button :label="t('sessions.end')" icon="pi pi-sign-out" size="small" severity="secondary" text :disabled="busy" :data-end-session="session.current ? 'current' : 'other'" @click="end(session)" />
      </li>
    </ul>

    <template #footer>
      <Button :label="t('sessions.end_others')" size="small" severity="secondary" outlined :disabled="busy || sessions.length < 2" data-end-others @click="act(() => userService.endOtherSessions())" />
      <Button :label="t('sessions.end_all')" size="small" severity="danger" outlined :disabled="busy" data-end-all @click="act(() => userService.endAllSessions(), { leaves: true })" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.sessions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--p-content-border-color);
  }

  &__what {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;

    small { flex-basis: 100%; color: var(--p-text-muted-color); }
  }
}
</style>
