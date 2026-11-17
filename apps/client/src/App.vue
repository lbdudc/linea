<template>
  <router-view />

  <Toast />
  <Toast group="top" position="top-center" />

  <Toast group="accion">
    <template #message="{ message }">
      <component :is="ICONO_AVISO[message.severity] ?? ICONO_AVISO.info" class="p-toast-message-icon" />
      <div class="p-toast-message-text">
        <span v-if="message.summary" class="p-toast-summary">{{ message.summary }}</span>
        <div v-if="message.detail" class="p-toast-detail">{{ message.detail }}</div>
        <PrimeButton
          v-if="message.action"
          class="toast-accion"
          :label="message.action.label"
          size="small"
          text
          @click="message.action.handler"
        />
      </div>
    </template>
  </Toast>
</template>

<script>
import { defineComponent } from 'vue'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import CheckIcon from '@primevue/icons/check'
import InfoCircleIcon from '@primevue/icons/infocircle'
import ExclamationTriangleIcon from '@primevue/icons/exclamationtriangle'
import TimesCircleIcon from '@primevue/icons/timescircle'

const ICONO_AVISO = {
  success: CheckIcon,
  info: InfoCircleIcon,
  warn: ExclamationTriangleIcon,
  error: TimesCircleIcon,
}
import { restoreSession, keepSessionAlive } from './services/session';
import { disconnect } from './boot/ws';
import { afterLoginTarget } from './utils/returnTo';

export default defineComponent({
  name: 'App',
  components: { Toast, PrimeButton: Button },

  data() {
    return { ICONO_AVISO }
  },

  created() {
    this.tryLoginUserFromServiceToken();
  },
  methods: {
    async tryLoginUserFromServiceToken(){
      // the router may already be restoring it (it does before showing a page that needs a session): both wait for the same one
      const restored = await restoreSession();
      if (!restored) {
        if (!localStorage.token && this.$route.meta?.requiresAuth && this.$route.path !== '/login') this.$router.push('/login');
        return;
      }
      keepSessionAlive();

      // Keep the requested route: only leave /login, and honour the path the router guard stashed before it bounced us there.
      if (this.$route.path === '/login') {
        this.$router.push(afterLoginTarget(this.$route.query.redirect));
      }
    }
  },
  beforeUnmount() {
    disconnect();
  }
})
</script>

<style>
.p-toast-detail {
  white-space: pre-line;
}
</style>
