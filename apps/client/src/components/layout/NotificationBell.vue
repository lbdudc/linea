<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import Tooltip from 'primevue/tooltip'
import NotificationRulesDialog from './NotificationRulesDialog.vue'
import notificationService from 'src/services/notificationService'
import { notificationLink } from 'src/utils/notificationLink'
import { relativeShort } from 'src/utils/relativeTime'
import { useT } from 'src/composables/useT'

const vTooltip = Tooltip
const POLL_MS = 45000
const ICON = { assigned: 'pi-user-plus', mentioned: 'pi-at', state: 'pi-sync', comment: 'pi-comment', failed: 'pi-times-circle', conflicts: 'pi-exclamation-triangle', stuck: 'pi-clock', waiting: 'pi-hourglass' }

const t = useT()
const router = useRouter()
const instance = getCurrentInstance()
const panel = ref(null)
const items = ref([])
const unread = ref(0)
const loaded = ref(false)
const failed = ref(false)
const rulesOpen = ref(false)
let timer

const label = computed(() => (unread.value ? t('notifications.unread', { count: unread.value }) : t('notifications.title')))
const shown = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))
const when = (value) => relativeShort(value, instance?.proxy?.$i18n?.locale)
const RUN_REASONS = ['failed', 'conflicts', 'stuck']
const headline = (item) => RUN_REASONS.includes(item.reason) ? t(`notifications.run_${item.reason}_${item.state}`, { minutes: item.excerpt }) : t(`notifications.reason_${item.reason}`, { actor: item.actor ?? '?', state: item.state ? t(`notifications.state_${item.state}`) : '' })
const what = (item) => item.subject === 'run' ? item.title : `${t(item.subject === 'mr' ? 'notifications.mr' : 'notifications.issue')} #${item.number}`

const refresh = async () => {
  try {
    const data = await notificationService.list()
    items.value = data.items
    unread.value = data.unread
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    loaded.value = true
  }
}

const toggle = (event) => {
  panel.value?.toggle(event)
  refresh()
}

const open = async (item) => {
  panel.value?.hide()
  if (!item.read) {
    item.read = true
    unread.value = Math.max(0, unread.value - 1)
    notificationService.markRead([item.id]).catch(() => undefined)
  }
  router.push(notificationLink(item))
}

const readAll = async () => {
  try {
    await notificationService.markRead()
    items.value.forEach((item) => { item.read = true })
    unread.value = 0
  } catch {
    failed.value = true
  }
}

const remove = async (item) => {
  try {
    const { unread: left } = await notificationService.remove(item.id)
    items.value = items.value.filter((entry) => entry.id !== item.id)
    unread.value = left
  } catch {
    failed.value = true
  }
}

const tick = () => { if (!document.hidden) refresh() }

onMounted(() => {
  refresh()
  timer = setInterval(tick, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="bell">
    <Button
      text rounded size="small"
      class="app-toolbar__white-btn bell__btn" style="margin-right: 4px"
      name="notifications-bell"
      :aria-label="label"
      v-tooltip.bottom="label"
      @click="toggle"
    >
      <template #icon>
        <i class="pi pi-bell" style="font-size: 18px" aria-hidden="true" />
        <span v-if="unread" class="bell__badge" name="notifications-count">{{ shown }}</span>
      </template>
    </Button>

    <Popover ref="panel" class="bell__popover">
      <div class="bell__panel" name="notifications-panel">
        <div class="bell__head">
          <span class="bell__title">{{ $t('notifications.title') }}</span>
          <span>
            <Button v-if="unread" text size="small" name="notifications-read-all" :label="$t('notifications.mark_all')" @click="readAll" />
            <Button text rounded size="small" severity="secondary" icon="pi pi-cog" name="notifications-rules" :aria-label="$t('notifications.rules_title')" @click="rulesOpen = true" />
          </span>
        </div>
        <p v-if="failed && !items.length" class="bell__empty" role="alert">{{ $t('notifications.load_failed') }}</p>
        <p v-else-if="loaded && !items.length" class="bell__empty" name="notifications-empty">{{ $t('notifications.empty') }}</p>
        <ul v-else class="bell__list">
          <li v-for="item in items" :key="item.id" class="bell__item" :class="{ 'bell__item--unread': !item.read }">
            <button type="button" class="bell__row" name="notification-row" @click="open(item)">
              <i class="pi bell__icon" :class="ICON[item.reason]" aria-hidden="true" />
              <span class="bell__text">
                <span class="bell__line">{{ headline(item) }}</span>
                <span v-if="item.subject === 'run'" class="bell__what"><strong>{{ item.title }}</strong></span>
                <span v-else class="bell__what"><strong>{{ what(item) }}</strong> {{ item.title }}</span>
                <span v-if="item.excerpt && item.reason !== 'state' && item.reason !== 'stuck'" class="bell__excerpt">{{ item.excerpt }}</span>
                <span class="bell__meta">{{ item.target?.name }} · {{ when(item.createdAt) }}</span>
              </span>
              <i v-if="!item.read" class="bell__dot" aria-hidden="true" />
            </button>
            <Button text rounded size="small" severity="secondary" icon="pi pi-times" class="bell__remove" name="notification-remove" :aria-label="$t('notifications.dismiss')" @click="remove(item)" />
          </li>
        </ul>
      </div>
    </Popover>
    <NotificationRulesDialog v-if="rulesOpen" @close="rulesOpen = false" />
  </div>
</template>

<style scoped>
.bell { display: inline-flex; }
.bell__btn { position: relative; }
.bell__badge { position: absolute; top: 2px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--status-bad, #d33); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.bell__panel { width: min(24rem, 90vw); display: flex; flex-direction: column; }
.bell__head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 8px 8px; border-bottom: 1px solid var(--card-border); }
.bell__title { font-weight: 700; color: var(--text-heading); }
.bell__empty { margin: 0; padding: 24px 8px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
.bell__list { margin: 0; padding: 0; list-style: none; max-height: 26rem; overflow-y: auto; }
.bell__item { display: flex; align-items: flex-start; border-bottom: 1px solid var(--card-border); border-left: 3px solid transparent; }
.bell__item:last-child { border-bottom: 0; }
.bell__item--unread { border-left-color: var(--p-primary-color); }
.bell__row { flex: 1; min-width: 0; display: flex; gap: 10px; align-items: flex-start; padding: 10px 8px; background: none; border: 0; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.bell__row:hover { background: var(--p-content-hover-background, rgba(0, 0, 0, 0.04)); }
.bell__icon { margin-top: 3px; color: var(--text-muted); }
.bell__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.bell__line { font-size: 0.8125rem; color: var(--text-muted); }
.bell__what { font-size: 0.875rem; color: var(--text-heading); overflow-wrap: anywhere; }
.bell__excerpt { font-size: 0.8125rem; color: var(--text-muted); overflow-wrap: anywhere; }
.bell__meta { font-size: 0.75rem; color: var(--text-muted); }
.bell__dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--p-primary-color); flex: none; }
.bell__remove { margin: 4px 4px 0 0; flex: none; }
</style>
