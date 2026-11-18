<script setup>
// Who reaches the repositories of a line (or of one product) on its git host, at what level and from where; what a person with enough
// level changes here LINEA writes to the host, to the line's repository and to its products'.
import { ref, computed, onMounted } from 'vue'
import lineService from 'src/services/lineService'
import productService from 'src/services/productService'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import AutoComplete from 'primevue/autocomplete'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Tag from 'primevue/tag'

const props = defineProps({
  id: { type: String, required: true },
  // `line`: the line and, through it, its products; `product`: one product, apart from its line
  scope: { type: String, default: 'line' },
  // a product asks the people of its line's host: the line it belongs to
  lineId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'changed'])
const t = useT()

const isProduct = computed(() => props.scope === 'product')
const service = computed(() => (isProduct.value ? productService : lineService))
const visible = ref(true)
const access = ref(null)
const busy = ref(false)
const role = ref(30)
const query = ref('')
const found = ref([])

const overrides = computed(() => new Map((access.value?.overrides ?? []).map((entry) => [entry.username, entry.level])))
const options = computed(() => [
  ...(access.value?.levels ?? [40, 30, 20]).slice().reverse().map((value) => ({ value, label: t(`labels.role${value}`) })),
  ...(isProduct.value ? [{ value: 0, label: t('access.none') }] : []),
])
// a level from a group can only be raised on the repository: the host refuses to go below it
const optionsFor = (entry) => (entry.source === 'inherited' ? options.value.filter((option) => option.value >= entry.level) : options.value)
// a person the product closes itself to is not on the host: they are listed from what the product records
const rows = computed(() => {
  const entries = (access.value?.entries ?? []).map((entry) => ({ ...entry, level: entry.accessLevel }))
  for (const [username, level] of overrides.value) if (level === 0 && !entries.some((entry) => entry.username === username)) entries.push({ username, level: 0, source: 'direct', managed: true })
  return entries.sort((a, b) => b.level - a.level || a.username.localeCompare(b.username))
})
const names = (list) => list.map((entry) => entry.username).join(', ')
const drift = computed(() => access.value?.drift ?? { missing: [], unknown: [] })
const hasDrift = computed(() => drift.value.missing.length > 0 || drift.value.unknown.length > 0)
const canManage = computed(() => Boolean(access.value?.canManage))
const myLevel = computed(() => access.value?.myLevel ?? 0)

const run = async (action) => {
  busy.value = true
  try {
    const result = await action()
    // a change answers with what the host refused and the access as it is now; a read answers with the access
    access.value = result?.access ?? result
    if (result?.failures?.length) notify({ type: 'warning', message: t('access.failures', { targets: result.failures.map((failure) => failure.target).join(', ') }) })
    emit('changed', access.value)
  } catch (e) {
    notify({ type: 'negative', message: errorMessage(e, t) })
  } finally {
    busy.value = false
  }
}

onMounted(() => run(() => service.value.getAccess(props.id)))

const search = async ({ query: q }) => {
  try {
    found.value = await lineService.searchAccessUsers(isProduct.value ? props.lineId : props.id, q)
  } catch {
    found.value = []
  }
}
const label = (user) => (typeof user === 'string' ? user : user?.username ?? '')
const set = (username, value) => run(() => service.value.setAccess(props.id, username, value))
const add = async () => {
  const username = label(query.value).trim()
  if (!username) return
  await run(() => service.value.setAccess(props.id, username, role.value))
  query.value = ''
}
const remove = (entry) => run(() => (isProduct.value ? productService.setAccess(props.id, entry.username, 0) : lineService.removeAccess(props.id, entry.username)))
const follow = (entry) => run(() => productService.clearAccess(props.id, entry.username))
const reapply = (removeUnknown) => run(() => lineService.reapplyAccess(props.id, removeUnknown))
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="t(isProduct ? 'access.titleProduct' : 'access.title')" :style="{ width: '44rem', maxWidth: '96vw' }" data-access-dialog @hide="emit('close')">
    <p v-if="access" class="access__me" data-test="access-me">
      <span>{{ t('access.yourRole') }}</span>
      <Tag :value="myLevel ? t(`labels.role${myLevel}`) : t('access.none')" :severity="canManage ? 'success' : 'secondary'" />
      <small v-if="!canManage">{{ t('access.cannotManage') }}</small>
    </p>
    <div class="access__scroll">
      <table class="access">
        <thead>
          <tr>
            <th scope="col">{{ t('access.person') }}</th>
            <th scope="col">{{ t('access.origin') }}</th>
            <th scope="col" class="access__col-level">{{ t('access.level') }}</th>
            <th scope="col" class="access__col-actions"><span class="sr-only">{{ t('access.actions') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in rows" :key="entry.username" :data-access="entry.username">
            <td>
              <span class="access__person">
                <span class="access__avatar" aria-hidden="true">{{ entry.username[0]?.toUpperCase() }}</span>
                <span class="access__name">{{ entry.username }}</span>
              </span>
            </td>
            <td>
              <span class="access__tags">
                <Tag v-if="entry.source === 'inherited'" :value="t('access.inherited')" severity="secondary" data-source="inherited" />
                <Tag v-if="isProduct && overrides.has(entry.username)" :value="t('access.overridden')" severity="info" data-source="override" />
                <Tag v-else-if="entry.managed" :value="t('access.managed')" severity="success" data-source="linea" />
                <Tag v-else-if="entry.source !== 'inherited'" :value="t('access.direct')" severity="contrast" data-source="direct" />
              </span>
            </td>
            <td class="access__col-level">
              <span v-if="entry.level === 50 || !canManage || false" class="access__level">{{ entry.level ? t(`labels.role${entry.level}`) : t('access.none') }}</span>
              <Select v-else :model-value="entry.level" :options="optionsFor(entry)" option-label="label" option-value="value" size="small" :disabled="busy" class="access__select" @update:model-value="(value) => set(entry.username, value)" />
            </td>
            <td class="access__col-actions">
              <Button v-if="isProduct && overrides.has(entry.username) && canManage" icon="pi pi-undo" size="small" text v-tooltip="t('access.follow')" :aria-label="t('access.follow')" :disabled="busy" name="follow-line" @click="follow(entry)" />
              <Button v-if="canManage && entry.level > 0 && entry.level < 50 && entry.source !== 'inherited'" icon="pi pi-times" size="small" text severity="danger" :aria-label="t('access.remove')" :disabled="busy" name="remove-access" @click="remove(entry)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <form v-if="canManage" class="access__add" @submit.prevent="add">
      <AutoComplete v-model="query" :suggestions="found" option-label="username" :placeholder="t('access.search')" :min-length="2" fluid name="access-user" @complete="search" />
      <Select v-model="role" :options="options.filter((option) => option.value > 0)" option-label="label" option-value="value" />
      <Button :label="t('access.add')" icon="pi pi-user-plus" :loading="busy" :disabled="!label(query).trim()" name="add-access" type="submit" />
    </form>
    <Message v-if="hasDrift" severity="warn" :closable="false" size="small" class="access__drift" data-access-drift>
      <strong>{{ t('access.drift') }}</strong>
      <div v-if="drift.missing.length">{{ t('access.driftMissing', { names: names(drift.missing) }) }}</div>
      <div v-if="drift.unknown.length">{{ t('access.driftUnknown', { names: names(drift.unknown) }) }}</div>
      <div v-if="canManage && !isProduct" class="access__actions">
        <Button :label="t('access.reapply')" size="small" severity="secondary" :disabled="busy" name="reapply-access" @click="reapply(false)" />
        <Button v-if="drift.unknown.length" :label="t('access.removeUnknown')" size="small" severity="danger" text :disabled="busy" name="reapply-remove-unknown" @click="reapply(true)" />
      </div>
    </Message>
  </Dialog>
</template>

<style scoped lang="scss">
.access__me {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.access__scroll {
  max-height: 28rem;
  overflow: auto;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  margin-bottom: 16px;
}

.access {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 12px;
    text-align: left;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--p-text-muted-color);
    background: var(--p-content-background);
    border-bottom: 1px solid var(--p-content-border-color);
  }

  td {
    padding: 6px 12px;
    vertical-align: middle;
    border-bottom: 1px solid var(--p-content-border-color);
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr:hover {
    background: var(--p-content-hover-background);
  }

  &__col-level {
    width: 11rem;
  }

  &__col-actions {
    width: 5rem;
    text-align: right;
    white-space: nowrap;
  }

  &__person {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  &__avatar {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--p-button-primary-background);
    color: var(--p-primary-contrast-color);
    font-size: 0.7rem;
    font-weight: 700;
  }

  &__name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  &__tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  &__level {
    color: var(--p-text-muted-color);
  }

  &__select {
    width: 100%;
  }

  &__add {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;

    > :first-child {
      flex: 1 1 14rem;
      min-width: 0;
    }
  }

  &__drift {
    margin-top: 12px;
  }

  &__actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
