<script setup>
import { ref, computed, watch, onMounted, nextTick, getCurrentInstance } from 'vue'
import { useRouter } from 'vue-router'
import lineService from 'src/services/lineService'
import { useLineProducts, refresh as refreshPortfolio } from 'src/composables/usePortfolio'
import { useDeletable } from 'src/composables/useDeletable'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Tooltip from 'primevue/tooltip'
import PrimeMenu from 'primevue/menu'
import GitLabButton from 'components/common/GitLabButton.vue'
import DeleteLineDialog from 'components/line/DeleteLineDialog.vue'
import MigrationStatusPanel from 'components/line/MigrationStatusPanel.vue'
import LineTabs from 'components/line/LineTabs.vue'
import LineKindTag from 'components/line/LineKindTag.vue'
import MembersDialog from 'components/line/MembersDialog.vue'
import Dialog from 'primevue/dialog'
import { state } from 'stores/userState'
import { useT } from 'src/composables/useT'
import { relativeDays } from 'src/utils/relativeTime'

// The frame every page of a line shares (its products, modules, feature model and activity): the same header, the same tabs and the
// same container, so changing tab changes what is inside and nothing else.
const vTooltip = Tooltip

const props = defineProps({
  id: { type: String, required: true },
  active: { type: String, required: true },
  // the line, when the page loads it (it may still be arriving); otherwise the frame asks for it
  line: { type: Object, default: null },
  // the content fills the container and scrolls by itself (the editor), instead of being a padded column
  fill: { type: Boolean, default: false },
})

const instance = getCurrentInstance()
const t = useT()
const router = useRouter()
// the products of the line that are not healthy, from the portfolio the side bar already loaded: the same on every page of the line
const { failing: failingCount } = useLineProducts(() => props.id)

const own = ref(null)
const data = computed(() => (props.line?.name ? props.line : own.value))
const loadOwn = async (id) => {
  try {
    const found = await lineService.findLineById({ id })
    if (id === props.id) own.value = found
  } catch {
    own.value = null
  }
}
watch(
  () => [props.id, props.line !== null],
  async ([id, given]) => {
    if (given) return
    own.value = null
    await loadOwn(id)
  },
  { immediate: true },
)
// the page that saves the line's model asks for the header again: its version has just changed
const reload = () => (props.line !== null ? Promise.resolve() : loadOwn(props.id))

// the members as the owner last saw them (the line itself is not loaded again for it)
const membersNow = ref(null)
const managing = ref(false)
// the owner of a line of this server's own host manages who works on it here (the other hosts do it themselves)
const canManage = computed(() => data.value?.gitHost === 'local' && (Boolean(state.user?.admin) || (data.value?.members ?? []).some((m) => m.username === state.user?.username && Number(String(m.role).replace('labels.role', '')) === 50)))

// who works on the line: initials in the header, the username and the role on hover
const members = computed(() => (membersNow.value ?? data.value?.members ?? []).map((m) => ({
  username: m.username,
  role: typeof m.role === 'string' && m.role.startsWith('labels.') ? m.role : `labels.role${m.role}`,
})))

const ageText = computed(() => {
  const created = data.value?.createdAt
  if (!created) return ''
  return t('labels.line_created_relative', { time: relativeDays(created, instance?.proxy?.$i18n?.locale) })
})

// each tab starts at the top of its container, whatever the one before was scrolled to
const content = ref(null)
const toTop = () => { if (content.value) content.value.scrollTop = 0 }
onMounted(toTop)
watch(() => props.active, () => nextTick(toTop))

const menu = ref(null)
const showMigration = ref(false)
const confirmDelete = ref(false)

const showMembers = ref(false)
const cannotDelete = useDeletable({ ids: () => [props.id], ask: (ids) => lineService.getDeletableLines({ ids }) })
const items = computed(() => [
  // who works on the line: a dialog from here, not a strip at the foot of its pages
  { label: `${t('labels.members')}${members.value.length ? ` (${members.value.length})` : ''}`, icon: 'pi pi-users', command: () => { if (canManage.value) managing.value = true; else showMembers.value = true } },
  { label: t('labels.migration_status'), icon: 'pi pi-arrow-right-arrow-left', command: () => { showMigration.value = true } },
  { separator: true },
  { label: cannotDelete(props.id) ? t('labels.delete_owner_only') : t('labels.delete'), icon: 'pi pi-trash', class: 'overflow-menu-item--negative', disabled: cannotDelete(props.id), command: () => { confirmDelete.value = true } },
])

const lineDeleted = () => {
  refreshPortfolio()
  router.push('/')
}

defineExpose({ openMigration: () => { showMigration.value = true }, items, confirmDelete, reload })
</script>

<template>
  <div class="line-shell">
    <header class="detalle-cabecera">
      <Button text rounded class="detalle-cabecera__volver" :aria-label="$t('labels.go_back')" @click="router.push('/lines')">
        <template #icon><i class="pi pi-arrow-left" style="font-size: 18px" aria-hidden="true" /></template>
      </Button>

      <div class="detalle-cabecera__texto">
        <div class="detalle-cabecera__title-row">
          <Skeleton v-if="!data" width="180px" height="26px" />
          <template v-else>
            <h1 class="detalle-cabecera__title">{{ data.name }}</h1>
            <span class="chip-version ident">v{{ data.version }}</span>
            <LineKindTag :line="data" />
            <button
              v-if="failingCount > 0"
              type="button"
              class="detalle-cabecera__estado"
              @click="showMigration = true"
            >
              <span class="detalle-cabecera__punto" />
              {{ $tc('labels.products_with_failures', failingCount, { n: failingCount }) }}
            </button>
            <span v-if="ageText" class="detalle-cabecera__meta">{{ ageText }}</span>
          </template>
        </div>
      </div>

      <div class="detalle-cabecera__actions">
        <GitLabButton v-if="data" :id="data.repoId" :host="data.gitHost" :text="true" type="repository" :href="data.webUrl" />
        <Skeleton v-else width="80px" height="32px" />
        <Button name="product-create" :label="$t('labels.create_product')" @click="router.push(`/lines/${id}/new-product`)">
          <template #icon><i class="pi pi-plus" style="font-size: 16px" aria-hidden="true" /></template>
        </Button>
        <Button text rounded class="detalle-cabecera__mas" :aria-label="$t('labels.actions')" @click="menu.toggle($event)">
          <template #icon><i class="pi pi-ellipsis-v" style="font-size: 18px" aria-hidden="true" /></template>
        </Button>
        <PrimeMenu ref="menu" :model="items" popup class="overflow-menu">
          <template #itemicon="{ item }"><i :class="item.icon" style="font-size: 18px" aria-hidden="true" /></template>
        </PrimeMenu>
      </div>
    </header>

    <div class="detalle-pestanas">
      <LineTabs :id="id" :active="active" />
    </div>


    <main ref="content" class="line-shell__content" :class="{ 'line-shell__content--fill': fill }">
      <slot />
    </main>

    <Dialog v-model:visible="showMembers" modal :header="$t('labels.members')" :style="{ width: '24rem' }" data-test="members-dialog">
      <ul class="line-members-list">
        <li v-for="m in members" :key="m.username"><span class="line-members-list__avatar">{{ m.username ? m.username[0].toUpperCase() : '?' }}</span><strong>{{ m.username }}</strong><span class="text-muted">{{ $t(m.role) }}</span></li>
        <li v-if="!members.length" class="text-muted">—</li>
      </ul>
    </Dialog>
    <MembersDialog v-if="managing" :line-id="id" @close="managing = false" @changed="(list) => (membersNow = list)" />
    <DeleteLineDialog v-model="confirmDelete" :line="data ? { ...data, _id: data._id ?? id } : null" @deleted="lineDeleted" />
    <MigrationStatusPanel v-model:dialog="showMigration" :lineId="id" />
  </div>
</template>

<style scoped lang="scss">
.line-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }

@media (max-width: 600px) {
  .line-shell .detalle-cabecera { flex-wrap: wrap; }
  .line-shell .detalle-cabecera__texto { flex-basis: calc(100% - 50px); }
  .line-shell .detalle-cabecera__actions { margin-left: auto; }
}

.detalle-cabecera {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 8px;
  min-height: 56px;
  box-sizing: border-box;

  &__volver { flex-shrink: 0; color: var(--p-text-muted-color); }
  &__texto { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; }
  &__title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
  &__title { margin: 0; font-family: var(--font-sans); font-size: 24px; font-weight: 300; line-height: 1.1; min-width: 0; overflow-wrap: anywhere; }
  &__meta { font-size: 13px; color: var(--p-text-muted-color); }
  &__actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  &__mas { color: var(--p-text-muted-color); }

  &__estado {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 3px 11px;
    border: 1px solid var(--status-bad-border);
    border-radius: 20px;
    background: var(--status-bad-soft);
    color: var(--status-bad);
    font: inherit;
    font-size: 12px;
    line-height: 1.5;
    cursor: pointer;

    &:hover { border-color: var(--status-bad); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
  }

  &__punto { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
}

.chip-version {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 4px;
  background: var(--p-content-hover-background);
  font-size: 13px;
  color: var(--p-text-secondary-color);
}

.detalle-pestanas {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 20px;
  min-height: 42px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.line-members-list {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;
  li { display: flex; align-items: center; gap: 10px; }
  &__avatar {
    width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    background: var(--p-button-primary-background); color: var(--p-primary-contrast-color); font-size: 10px; font-weight: 700;
  }
  .text-muted { margin-left: auto; font-size: 0.8rem; }
}

.line-shell__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 28px;

  &--fill { padding: 0; overflow: hidden; display: flex; flex-direction: column; }

  :deep(.ln-panel) { padding: 0; }
}
</style>

<style lang="scss">
.p-menu.overflow-menu { min-width: 200px; }

.p-menu.overflow-menu .p-menu-item.overflow-menu-item--negative {
  .p-menu-item-content,
  .p-menu-item-content i {
    color: var(--status-bad);
  }
}
</style>
