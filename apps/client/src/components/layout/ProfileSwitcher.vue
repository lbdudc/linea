<script setup>
// LINEA shows one remote at a time. A person signed in to several git hosts picks which one the lines, products and deployments are of:
// that is their profile. Switching asks the server (it scopes what it lists) and tells the shell, which starts over on the new remote.
import { ref, computed } from 'vue'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import { state } from 'stores/userState'
import { gitHosts } from 'stores/gitHosts'
import { hostName } from 'src/boot/gitHost'
import userService from 'src/services/userService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import GitHostIcon from 'components/common/GitHostIcon.vue'

const emit = defineEmits(['switched'])
const t = useT()

const menu = ref(null)
const busy = ref(false)

// the hosts that are on and that this person has an account on
const profiles = computed(() => {
  const linked = new Set(state.user?.hosts ?? [])
  return gitHosts.hosts.filter((host) => linked.has(host.id)).map((host) => host.id)
})
const active = computed(() => state.user?.activeHost ?? profiles.value[0])

const pick = async (host) => {
  menu.value?.hide()
  if (busy.value || host === active.value) return
  busy.value = true
  try {
    const { hosts, activeHost } = await userService.setProfile({ host })
    state.user = { ...state.user, hosts, activeHost }
    emit('switched', activeHost)
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="profiles.length > 1" class="profile-switcher" data-profile-switcher :data-active-profile="active">
    <Button
      text
      size="small"
      class="profile-switcher__btn"
      :loading="busy"
      :aria-label="`${t('labels.profile_switch')} (${hostName(active)})`"
      @click="(e) => menu?.toggle(e)"
    >
      <GitHostIcon :host="active" :size="16" />
      <span class="profile-switcher__name">{{ hostName(active) }}</span>
      <i class="pi pi-angle-down" aria-hidden="true" />
    </Button>

    <Popover ref="menu" :pt="{ content: { style: 'padding: var(--space-1) 0' } }">
      <div class="profile-menu">
        <div class="profile-menu__heading">{{ t('labels.profile_in_use') }}</div>
        <button
          v-for="host in profiles"
          :key="host"
          type="button"
          class="profile-menu__row"
          :data-profile="host"
          :aria-current="host === active"
          @click="pick(host)"
        >
          <GitHostIcon :host="host" :size="16" class="profile-menu__icon" />
          <span class="profile-menu__label">{{ hostName(host) }}</span>
          <i v-if="host === active" class="pi pi-check profile-menu__check" aria-hidden="true" />
        </button>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.profile-switcher__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--p-text-color);
}
.profile-switcher__name {
  font-weight: 600;
}

.profile-menu { user-select: none; min-width: 11rem; }
.profile-menu__heading {
  padding: var(--space-1) var(--space-3) 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}
.profile-menu__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  background: transparent;
  color: var(--p-text-color);
  font: inherit;
  font-size: var(--text-base);
  text-align: left;
  cursor: pointer;
}
.profile-menu__row:hover,
.profile-menu__row:focus-visible {
  background: var(--p-content-hover-background);
  outline: none;
}
.profile-menu__icon { color: var(--p-text-muted-color); }
.profile-menu__label { flex: 1; }
.profile-menu__check { color: var(--p-primary-color); font-size: var(--text-xs); }
</style>
