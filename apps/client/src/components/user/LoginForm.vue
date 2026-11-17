<script>
import Message from 'primevue/message'
import Divider from 'primevue/divider'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import userService from '../../services/userService'
import { setUserData } from 'stores/userState'
import { gitHosts, loadGitHosts, hostById } from 'stores/gitHosts'
import { socket, connect } from 'src/boot/ws'
import { hostName } from 'src/boot/gitHost'
import { keepSessionAlive } from '../../services/session'
import { afterLoginTarget, rememberReturnTo } from '../../utils/returnTo'
import { authorizeUrlFor, readOAuthReturn } from '../../utils/oauth'
import GitHostIcon from 'components/common/GitHostIcon.vue'

export default {
  name: 'LoginForm',
  components: { Message, Divider, PrimeButton: Button, GitHostIcon, InputText, Password },
  data() {
    return {
      // the host whose button was pressed, or whose answer is being exchanged
      loadingHost: null,
      error: null,
      // the account of this server: a username and password, not a button
      username: '',
      password: '',
    }
  },
  computed: {
    // one button per git host this LINEA has configured, and none until the server says which (no guessing at GitLab)
    hosts() {
      return gitHosts.hosts
    },
    // the buttons are for the hosts that give a code; the accounts of this server sign in with a form
    buttonHosts() {
      return this.hosts.filter((host) => host.id !== 'local')
    },
    hasLocal() {
      return this.hosts.some((host) => host.id === 'local')
    },
  },
  methods: {
    hostName,
    async loginLocal() {
      if (!this.username || !this.password) return
      this.loadingHost = 'local'
      this.error = null
      try {
        const userData = await userService.loginLocal({ username: this.username, password: this.password })
        this.password = ''
        setUserData(userData)
        localStorage.setItem('token', userData.token)
        connect()
        socket.emit('auth', userData.token)
        keepSessionAlive()
        this.$router.replace(afterLoginTarget(this.$route.query.redirect))
      } catch (error) {
        this.error = error.response?.data?.error || 'error_messages.incorrect_credentials'
      } finally {
        this.loadingHost = null
      }
    },
    async loginWith(host) {
      try {
        this.loadingHost = host
        const config = hostById(host)
        if (!config || !config.clientId || (!config.url && !config.authorizeUrl)) {
          this.error = 'error_messages.internal_error'
          return
        }
        rememberReturnTo(this.$route.query.redirect)
        window.location = authorizeUrlFor(config, { mode: 'login' })
      } catch (error) {
        this.error = error.response?.data?.error || 'error_messages.no_server_response'
      } finally {
        this.loadingHost = null
      }
    },
  },
  async created() {
    await loadGitHosts()
    const code = this.$route.query.code
    // The OAuth code is single-use. Guard against a second run (StrictMode-style
    // re-invoke, a racing caller) replaying a code the host has already spent.
    if (!code || this._loginStarted) return
    this._loginStarted = true
    const answer = readOAuthReturn(this.$route.query, gitHosts.primary ?? 'gitlab')
    if (!answer) {
      this.error = 'error_messages.incorrect_credentials'
      this.$router.replace({ query: {} })
      return
    }
    try {
      this.loadingHost = answer.host
      if (answer.mode === 'link') {
        // an account on another host, added to the person who is signed in: the session stays, and says which hosts it has now
        await userService.linkIdentity({ host: answer.host, code })
        setUserData(await userService.tryLoginUserFromServiceToken())
        this.$router.replace(afterLoginTarget(this.$route.query.redirect))
        return
      }
      const userData = await userService.loginUserFromGitLab({ code, host: answer.host })
      setUserData(userData)
      localStorage.setItem('token', userData.token)
      connect()
      socket.emit('auth', userData.token)
      keepSessionAlive()
      // replace, not push: drop the ?code= history entry so back/reload/tab
      // restore can't re-submit the now-spent code.
      this.$router.replace(afterLoginTarget(this.$route.query.redirect))
    } catch (error) {
      this.error = error.response?.data?.error || 'error_messages.incorrect_credentials'
      this.$router.replace({ query: {} })
    } finally {
      this.loadingHost = null
    }
  },
}
</script>

<template>
  <div class="login-card">
    <Message v-if="error" severity="error" :closable="false" class="login-card__error">
      {{ $t(error) }}
    </Message>

    <form v-if="hasLocal" class="login-card__local" name="local-login" @submit.prevent="loginLocal">
      <InputText v-model="username" name="username" autocomplete="username" :placeholder="$t('labels.username')" fluid />
      <Password v-model="password" input-id="local-password" name="password" autocomplete="current-password" :feedback="false" toggle-mask :placeholder="$t('labels.password')" fluid />
      <PrimeButton type="submit" name="local-submit" :label="$t('labels.sign_in')" :loading="loadingHost === 'local'" :disabled="!username || !password" />
    </form>

    <Divider v-if="buttonHosts.length" align="center" class="login-card__divider">
      <span class="login-card__divider-text">{{ $t('labels.sign_in_with') }}</span>
    </Divider>

    <div class="login-card__actions">
      <PrimeButton
        v-for="host in buttonHosts"
        :key="host.id"
        :name="`${host.id}-submit`"
        :label="`Continue with ${hostName(host.id)}`"
        :loading="loadingHost === host.id"
        :disabled="loadingHost !== null && loadingHost !== host.id"
        :class="['login-card__gitlab-btn', `login-card__host-btn--${host.id}`]"
        @click="loginWith(host.id)"
      >
        <template #icon="{ class: iconClass }">
          <GitHostIcon :host="host.id" :size="18" :class="iconClass" />
        </template>
      </PrimeButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--card-bg);
  border-radius: 20px;
  padding: 28px;
  border: 1px solid var(--card-border);
  box-shadow:
    0 20px 40px -16px rgba(0, 0, 0, 0.18),
    0 2px 6px rgba(0, 0, 0, 0.05);

  &__error {
    margin-bottom: 16px;
  }

  &__local {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 8px;
  }

  // PrimeVue's divider brings its own vertical margin; zero it so the
  // card padding is the only spacing and top/bottom stay equal
  &__divider {
    margin: 0 0 20px;
  }

  &__divider-text {
    font-size: 0.8125rem;
    color: var(--p-text-muted-color);
    white-space: nowrap;
    font-weight: 500;
  }


  &__actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__gitlab-btn {
    width: 100%;
    border-radius: 12px;
    font-weight: 600;
    font-size: 0.9375rem;
    padding: 12px 20px;
    gap: 10px;
    background: var(--gitlab-color-solid) !important;
    border-color: var(--gitlab-color-solid) !important;
    color: var(--p-primary-contrast-color) !important;
    box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--gitlab-color-solid) 60%, transparent);
    transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;

    &:hover {
      filter: brightness(0.94);
      transform: translateY(-1px);
      box-shadow: 0 8px 16px -6px color-mix(in srgb, var(--gitlab-color-solid) 70%, transparent);
    }

    &:active {
      transform: translateY(0);
    }
  }

  // each host has its own colour; GitHub's is the dark one
  &__host-btn--github {
    --gitlab-color-solid: #24292f;
  }
}
</style>
