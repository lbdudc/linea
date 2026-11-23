<script setup>
import { shallowRef, ref, watch, computed, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { notify, errorMessage } from 'src/composables/useNotify'
import { state } from 'stores/userState'
import { wsConnected } from 'src/boot/ws'
import { LANGUAGES, setLocale } from 'src/boot/i18n'
import { useTheme } from 'src/composables/useTheme'
import userService from 'src/services/userService'
import AppExplorer from 'src/components/layout/AppExplorer.vue'
import generationStore from 'stores/generationStore'
import NavSearchDialog from 'components/common/NavSearchDialog.vue'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import Avatar from 'primevue/avatar'
import Divider from 'primevue/divider'
import ToggleSwitch from 'primevue/toggleswitch'
import Tooltip from 'primevue/tooltip'
import { useT } from 'src/composables/useT'
import { contributions, localized } from 'src/plugins/registry'
import { gitHosts, loadGitHosts, hostById } from 'stores/gitHosts'
import { hostName } from 'src/boot/gitHost'
import { authorizeUrlFor } from 'src/utils/oauth'
import { rememberReturnTo } from 'src/utils/returnTo'
import GitHostIcon from 'components/common/GitHostIcon.vue'
import Message from 'primevue/message'
import ErrorState from 'components/common/ErrorState.vue'
import { missingEntity, clearMissing } from 'stores/missingEntity'
import { searchDialog } from 'stores/searchDialog'
import { appDialogs } from 'stores/appDialogs'
import { useSignOut } from 'src/composables/useSignOut'
import { takeLanguageUndo } from 'src/utils/paletteUndo'
import { slowRequests } from 'stores/slowRequests'
import AccountDialog from 'components/layout/AccountDialog.vue'
import SessionsDialog from 'components/layout/SessionsDialog.vue'
import ProfileSwitcher from 'components/layout/ProfileSwitcher.vue'
import RunningPill from 'components/home/RunningPill.vue'
import NotificationBell from 'components/layout/NotificationBell.vue'
import { setProfileWords } from 'src/boot/hostWords'
import { i18n } from 'src/boot/i18n'

const vTooltip = Tooltip

const instance = getCurrentInstance()
const t = useT()

const router = useRouter()
const route = useRoute()
// the page is about something the server does not know (see stores/missingEntity.js); any navigation starts over
// (by path: a page may add its own query, a tab, to the address it was opened at)
const missing = computed(() => missingEntity.path === route.path)
watch(() => route.path, clearMissing)
const { isDark, toggleTheme } = useTheme()

const searchOpen = computed({
  get: () => searchDialog.open,
  set: (value) => { searchDialog.open = value },
})
const userMenuRef = ref(null)

const onKeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => generationStore.jobs.filter(
    j => ['success', 'warning', 'error'].includes(j.status) && !j._notified
  ),
  (finished) => {
    for (const job of finished) {
      job._notified = true
      notify({
        type:     job.status === 'success' ? 'positive' : job.status === 'warning' ? 'warning' : 'negative',
        message:  `${job.productName}: ${t(
          job.status === 'success' ? 'generation.no_conflicts'
          : job.status === 'warning' ? 'generation.conflicts'
          : 'error_messages.internal_error'
        )}`,
        position: 'bottom-right',
        timeout:  5000,
        action:   { label: t('labels.tab_cicd'), handler: () => router.push('/cicd') },
      })
    }
  }
)

const navItems = computed(() => [
  { path: '/lines',       label: t('labels.lines'),       icon: 'pi-folder-open', isActive: route.path.startsWith('/lines') },
  { path: '/products',    label: t('labels.products'),    icon: 'pi-box',         isActive: route.path.startsWith('/products') },
  { path: '/cicd', label: t('labels.tab_cicd'), icon: 'pi-cloud',       isActive: route.path === '/cicd' },
  { path: '/packages/modules',    label: t('modules.nav'),           icon: 'pi-th-large',    isActive: route.path.startsWith('/packages/modules') },
  { path: '/packages/metamodels', label: t('modules.nav_metamodels'), icon: 'pi-sitemap',     isActive: route.path.startsWith('/packages/metamodels') },
  ...contributions.nav.map((item) => ({
    path: item.to,
    href: item.href,
    label: localized(item.label, instance?.proxy?.$i18n.locale),
    icon: item.icon,
    badge: item.badge?.count ? { count: item.badge.count > 99 ? '99+' : String(item.badge.count), title: localized(item.badge.title, instance?.proxy?.$i18n.locale) } : null,
    isActive: (item.activeFor ?? (item.to ? [item.to] : [])).some((prefix) => route.path.startsWith(prefix)),
  })),
  // configuration is for administrators: the git hosts, the plugins and the people are sections of one view
  ...(state.user?.admin ? [
    { path: '/settings', label: t('configuration.nav'), icon: 'pi-cog', isActive: route.path.startsWith('/settings') },
  ] : []),
])

const languageExpanded = shallowRef(false)

const currentLocale = computed(() => instance?.proxy?.$i18n.locale)

const toggleUserMenu = (evt) => userMenuRef.value?.toggle(evt)

// the git hosts there are several of: which one this person has an account on, and a way to add the others
onMounted(loadGitHosts)
const linkedHosts = computed(() => new Set(state.user?.hosts ?? []))
const connectHost = (host) => {
  const config = hostById(host)
  if (!config) return
  rememberReturnTo(route.fullPath)
  window.location = authorizeUrlFor(config, { mode: 'link' })
}

// the words of the interface follow the remote in use (GitHub's pull requests, LINEA's change requests)
watch(() => state.user?.activeHost, (kind) => { if (kind) setProfileWords({ i18n, kind }) }, { immediate: true })

// signing out of one remote keeps the session and the other remotes; the host of the person's own login cannot go
const isOwnHost = (host) => state.user?.hosts?.[0] === host
const disconnecting = ref(false)
const disconnectHost = async (host) => {
  if (disconnecting.value) return
  disconnecting.value = true
  try {
    const before = state.user?.activeHost
    const { hosts, activeHost } = await userService.unlinkIdentity({ host })
    state.user = { ...state.user, hosts, activeHost }
    if (before !== activeHost) onProfileSwitched()
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    disconnecting.value = false
  }
}

// each remote has its own lines and products: after a switch the app starts over on the new one
const onProfileSwitched = () => window.location.assign('/')

// the person's own account on this server (the local host): the one that has a password and a git token
const hasLocalAccount = computed(() => state.user?.hosts?.[0] === 'local')
const accountOpen = computed({ get: () => appDialogs.account, set: (value) => { appDialogs.account = value } })
const sessionsOpen = computed({ get: () => appDialogs.sessions, set: (value) => { appDialogs.sessions = value } })

const onUserMenuHide = () => { languageExpanded.value = false }

const pickLanguage = (code) => {
  userMenuRef.value?.hide()
  if (code !== currentLocale.value) setLocale(code)
}

const onLogout = () => {
  userMenuRef.value?.hide()
  logout()
}

const logout = useSignOut()

onMounted(() => {
  const previous = takeLanguageUndo()
  if (!previous) return
  notify({
    type: 'positive',
    timeout: 10000,
    message: t('palette.language_changed'),
    action: { label: t('palette.undo'), handler: () => setLocale(previous) },
  })
})
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-toolbar">
        <router-link
          to="/"
          class="app-logo"
          :aria-label="$t('labels.dashboard')"
        >
          <span class="app-logo__img" role="img" aria-label="LINEA" />
          <span class="app-logo__name">LINEA</span>
        </router-link>

        <Divider layout="vertical" class="app-toolbar__sep" :dt="{ borderColor: 'rgba(255,255,255,.25)' }" />

        <nav class="app-nav">
          <template v-for="item in navItems" :key="item.path ?? item.href">
            <a
              v-if="item.href"
              :href="item.href"
              target="_blank"
              rel="noopener"
              class="app-nav__item"
              :aria-label="item.label"
              :title="item.label"
            >
              <i :class="['pi', item.icon, 'app-nav__icon']" aria-hidden="true" />
              <span>{{ item.label }}</span>
            </a>
            <router-link
              v-else
              :to="item.path"
              :class="['app-nav__item', { 'app-nav__item--active': item.isActive }]"
              :aria-label="item.badge ? `${item.label} (${item.badge.count}${item.badge.title ? `: ${item.badge.title}` : ''})` : item.label"
              :title="item.badge?.title ? `${item.label} · ${item.badge.title}` : item.label"
            >
              <i :class="['pi', item.icon, 'app-nav__icon']" aria-hidden="true" />
              <span>{{ item.label }}</span>
              <b v-if="item.badge" class="app-nav__badge" aria-hidden="true">{{ item.badge.count }}</b>
            </router-link>
          </template>
        </nav>

        <div class="app-toolbar__spacer" />

        <RunningPill />

        <Button
          text rounded size="small"
          class="app-toolbar__white-btn" style="margin-right: 4px"
          :aria-label="`${$t('labels.search')} (Ctrl+K)`"
          v-tooltip.bottom="`${$t('labels.search')} (Ctrl+K)`"
          @click="searchOpen = true"
        >
          <template #icon><i class="pi pi-search" style="font-size: 18px" aria-hidden="true" /></template>
        </Button>

        <NotificationBell v-if="state?.user" />

        <ProfileSwitcher @switched="onProfileSwitched" />

        <div
          class="ws-dot" style="margin-right: 8px"
          :class="wsConnected ? 'ws-dot--on' : 'ws-dot--off'"
          v-tooltip.bottom="wsConnected ? $t('labels.ws_connected') : $t('labels.ws_disconnected')"
        />

        <template v-if="state?.user">
          <Button
            text
            class="user-dropdown-btn"
            @click="toggleUserMenu"
          >
            <template #default>
              <div class="user-dropdown__label">
                <Avatar
                  shape="circle"
                  class="user-dropdown__avatar" style="margin-right: 8px"
                  :style="{ background: '#fff', color: 'var(--p-primary-on-light-color)', width: '28px', height: '28px' }"
                >
                  <img v-if="state.user?.avatarUrl" :src="state.user?.avatarUrl" :alt="state.user?.username" />
                  <i v-else class="pi pi-user" style="font-size: 18px" aria-hidden="true" />
                </Avatar>
                <span class="user-dropdown__name">{{ state.user?.username }}</span>
                <i class="pi pi-angle-down user-dropdown__caret" aria-hidden="true" />
              </div>
            </template>
          </Button>

          <Popover ref="userMenuRef" :pt="{ content: { style: 'padding: var(--space-1) 0' } }" @hide="onUserMenuHide">
            <div class="user-menu">
              <button
                type="button"
                class="user-menu__row"
                :aria-expanded="languageExpanded"
                @click="languageExpanded = !languageExpanded"
              >
                <i class="pi pi-globe user-menu__icon" aria-hidden="true" />
                <span class="user-menu__label">{{ $t('labels.language') }}</span>
                <i :class="['pi', languageExpanded ? 'pi-chevron-up' : 'pi-chevron-down', 'user-menu__caret']" aria-hidden="true" />
              </button>

              <div v-if="languageExpanded" class="user-menu__sub">
                <button
                  v-for="lang in LANGUAGES"
                  :key="lang.code"
                  type="button"
                  class="user-menu__row user-menu__row--child"
                  :aria-current="lang.code === currentLocale"
                  @click="pickLanguage(lang.code)"
                >
                  <span class="user-menu__label">{{ lang.name }}</span>
                  <i v-if="lang.code === currentLocale" class="pi pi-check user-menu__check" aria-hidden="true" />
                </button>
              </div>

              <button v-if="hasLocalAccount" type="button" class="user-menu__row" data-account-menu @click="() => { userMenuRef?.hide(); accountOpen = true }">
                <i class="pi pi-key user-menu__icon" aria-hidden="true" />
                <span class="user-menu__label">{{ $t('account.menu') }}</span>
              </button>

              <button type="button" class="user-menu__row" data-sessions-menu @click="() => { userMenuRef?.hide(); sessionsOpen = true }">
                <i class="pi pi-desktop user-menu__icon" aria-hidden="true" />
                <span class="user-menu__label">{{ $t('sessions.menu') }}</span>
              </button>

              <div class="user-menu__row" @click="toggleTheme">
                <i :class="['pi', isDark ? 'pi-sun' : 'pi-moon', 'user-menu__icon']" aria-hidden="true" />
                <span class="user-menu__label">{{ $t('labels.toggle_theme') }}</span>
                <ToggleSwitch :model-value="isDark" @click.stop @update:model-value="toggleTheme" />
              </div>

              <template v-if="gitHosts.hosts.length > 1">
                <div class="user-menu__separator" />
                <div class="user-menu__heading">{{ $t('labels.git_accounts') }}</div>
                <div
                  v-for="host in gitHosts.hosts"
                  :key="host.id"
                  class="user-menu__row user-menu__row--static"
                  :data-git-host="host.id"
                >
                  <GitHostIcon :host="host.id" :size="16" class="user-menu__icon" />
                  <span class="user-menu__label">{{ hostName(host.id) }}</span>
                  <template v-if="linkedHosts.has(host.id)">
                    <i class="pi pi-check user-menu__check" :aria-label="$t('labels.git_connected')" />
                    <button
                      v-if="!isOwnHost(host.id)"
                      type="button"
                      class="user-menu__connect"
                      :data-git-disconnect="host.id"
                      :disabled="disconnecting"
                      @click="disconnectHost(host.id)"
                    >{{ $t('labels.git_disconnect') }}</button>
                  </template>
                  <button v-else type="button" class="user-menu__connect" :data-git-connect="host.id" @click="connectHost(host.id)">{{ $t('labels.git_connect') }}</button>
                </div>
              </template>

              <div class="user-menu__separator" />

              <button type="button" class="user-menu__row user-menu__row--danger" @click="onLogout">
                <i class="pi pi-sign-out user-menu__icon" aria-hidden="true" />
                <span class="user-menu__label">{{ $t('labels.sign_out') }}</span>
              </button>
            </div>
          </Popover>
        </template>
      </div>
    </header>

    <div class="app-body">
      <AppExplorer />

      <main class="app-main">
        <AccountDialog v-if="accountOpen" @close="accountOpen = false" />
        <SessionsDialog v-if="sessionsOpen" @close="sessionsOpen = false" @ended-all="sessionsOpen = false; logout()" />
        <Message v-if="state?.user && state.user.activeHost === null" severity="warn" :closable="false" data-no-host>
          {{ $t('git_hosts.no_host') }}
        </Message>
        <Message v-if="slowRequests.count > 0" severity="info" :closable="false" data-slow-requests>
          {{ $t('labels.still_loading') }}
        </Message>
        <ErrorState v-if="missing" :kind="missingEntity.kind" />
        <router-view v-else />
      </main>
    </div>

    <NavSearchDialog v-model="searchOpen" />
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  // the bar is a surface of the page, like its cards and panels: no colour of its own, so it follows the theme
  background: var(--p-content-background);
  color: var(--p-text-color);
  border-bottom: 1px solid var(--p-content-border-color);
}

.app-toolbar {
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: 0 8px 0 12px;
  gap: 6px;

  &__sep {
    height: 28px !important;
    margin: 0 8px;
  }

  &__spacer { flex: 1; }

  // the icon buttons of the bar (search, theme, language)
  &__white-btn {
    color: var(--p-text-muted-color) !important;
  }
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
  color: inherit;

  // the white logo, painted in the accent colour through its shape
  &__img {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: var(--p-primary-color);
    -webkit-mask: url('/icon-white.png') center / contain no-repeat;
    mask: url('/icon-white.png') center / contain no-repeat;
  }

  &__name {
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: 0.08em;
  }
}

.app-nav {
  display: flex;
  align-items: center;
  gap: 2px;

  &__item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 6px;
    color: var(--p-text-muted-color);
    text-decoration: none;
    font-size: 0.875rem;
    transition: background 0.15s, color 0.15s;

    &:hover {
      background: var(--p-content-hover-background);
      color: var(--p-text-color);
    }

    &--active,
    &--active:hover {
      background: var(--p-highlight-background);
      color: var(--p-primary-color);
    }

    &--external {
      margin-left: 14px;
    }
  }

  &__icon {
    flex-shrink: 0;
    font-size: 16px;
  }

  // a count a plugin puts beside its item (it stays when narrow screens drop the names)
  &__badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--status-warn-soft);
    color: var(--status-warn);
    font-size: 11px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
}

// narrow screens: the bar keeps icons only, then drops the name and the separator, so nothing is cut off
@media (max-width: 900px) {
  .app-nav__item { padding: 6px 8px; }
  .app-nav__item > span { display: none; }
}

@media (max-width: 600px) {
  .app-toolbar { padding: 0 4px 0 8px; gap: 2px; }
  .app-toolbar__sep,
  .app-logo__name,
  .user-dropdown__name,
  .user-dropdown__caret { display: none; }
}

.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: default;

  &--on {
    background: #66bb6a;
    box-shadow: 0 0 5px rgba(102, 187, 106, 0.7);
  }

  &--off {
    background: #ef5350;
    animation: ws-pulse 1.4s ease-in-out infinite;
  }
}

@keyframes ws-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .ws-dot--off { animation: none; }
}

.user-dropdown-btn {
  color: var(--p-text-color) !important;
  padding: 4px 8px !important;
}

.app-toolbar__white-btn,
.user-dropdown-btn {
  &.p-button-text:not(:disabled):hover {
    background: var(--p-content-hover-background);
  }

  &.p-button-text:not(:disabled):active {
    background: var(--p-highlight-background);
  }
}

.user-dropdown__label {
  display: flex;
  align-items: center;
}

.user-dropdown__avatar {
  border: 1px solid var(--p-content-border-color);
}

.user-dropdown__name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-text-color);
}

.user-dropdown__caret {
  color: var(--p-text-muted-color);
  margin-left: 2px;
  font-size: 18px;
}

.user-menu {
  user-select: none;
}

.user-menu__row {
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

  &:hover,
  &:focus-visible {
    background: var(--p-content-hover-background);
    outline: none;
  }

  &--child {
    padding-left: calc(var(--space-3) + 1em + var(--space-2));
  }

  &--danger,
  &--danger .user-menu__icon {
    color: var(--status-bad);
  }
}

.user-menu__icon {
  color: var(--p-text-muted-color);
}

.user-menu__label {
  flex: 1;
}

.user-menu__caret,
.user-menu__check {
  font-size: var(--text-xs);
}

.user-menu__caret {
  color: var(--p-text-muted-color);
}

.user-menu__check {
  color: var(--p-primary-color);
}

.user-menu__separator {
  margin: var(--space-1) 0;
  border-top: 1px solid var(--p-content-border-color);
}

.user-menu__heading {
  padding: var(--space-1) var(--space-3) 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.user-menu__row--static { cursor: default; }

.user-menu__connect {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--p-primary-color);
  cursor: pointer;
}

.user-menu__row:disabled {
  cursor: default;
  opacity: 0.85;
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
