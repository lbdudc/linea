<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import packageService from 'src/services/packageService'
import { describeError } from 'components/modules/describeError'
import PackagePinDialog from 'components/modules/PackagePinDialog.vue'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import { useT } from 'src/composables/useT'

// Where a package is used: the lines and projects (and their products) that have it, at which version, and the way to move each one
// to another version (see `PackagePinDialog`).
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [String, Number], required: true },
  location: { type: String, required: true },
  versions: { type: Array, default: () => [] },
  latest: { type: String, default: null },
})

const t = useT()
const router = useRouter()
const usage = ref(null)
const loading = ref(false)
const error = ref(null)
const pinning = ref(null)
const showPin = computed({ get: () => pinning.value !== null, set: (v) => { if (!v) pinning.value = null } })

const KIND_LABEL = { plain: 'modules.use_kind_plain', project: 'modules.use_kind_project', modular: 'modules.use_kind_modular' }
// what the line asks for is behind what is published
const behind = (use) => Boolean(props.latest && use.version && use.version !== props.latest)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    usage.value = await packageService.usage({ kind: props.kind, id: props.id })
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
}

watch(() => [props.kind, props.id], load, { immediate: true })
</script>

<template>
  <section class="usage" data-test="package-usage">
    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    <Message v-if="usage?.unreadable" severity="warn" :closable="false" data-test="usage-unreadable">{{ $t('modules.used_by_unreadable', { n: usage.unreadable }) }}</Message>
    <Skeleton v-if="loading && !usage" height="90px" />
    <p v-else-if="usage && !usage.lines.length" class="usage__empty">{{ $t('modules.used_by_none') }}</p>
    <DataTable v-else-if="usage" :value="usage.lines" data-key="id" size="small" scrollable class="usage__table">
      <Column :header="$t('modules.use_project')">
        <template #body="{ data: use }">
          <a :href="`/lines/${use.id}`" class="usage__name" @click.prevent="router.push(`/lines/${use.id}`)">{{ use.name }}</a>
          <Tag severity="secondary" :value="$t(KIND_LABEL[use.kind] ?? 'modules.use_kind_plain')" />
        </template>
      </Column>
      <Column :header="$t('modules.use_range')">
        <template #body="{ data: use }"><span class="ident">{{ use.range ?? $t('modules.use_indirect') }}</span></template>
      </Column>
      <Column :header="$t('modules.use_version')">
        <template #body="{ data: use }">
          <span class="ident">v{{ use.version }}</span>
          <Tag v-if="behind(use)" severity="warn" :value="$t('modules.use_behind', { latest: latest })" />
        </template>
      </Column>
      <Column :header="$t('modules.use_products')">
        <template #body="{ data: use }">
          <span v-if="!use.products.length" class="usage__empty">—</span>
          <span v-else :title="use.products.map((p) => p.name).join(', ')">{{ use.products.length }}</span>
        </template>
      </Column>
      <Column>
        <template #body="{ data: use }">
          <Button
            size="small"
            outlined
            icon="pi pi-sort-alt"
            :label="$t('modules.pin_action')"
            :disabled="!use.direct || !versions.length"
            @click="pinning = use"
          />
        </template>
      </Column>
    </DataTable>

    <PackagePinDialog
      v-if="pinning"
      v-model:visible="showPin"
      :line-id="pinning.id"
      :line-name="pinning.name"
      :kind="kind"
      :location="location"
      :versions="versions"
      @saved="load"
    />
  </section>
</template>

<style scoped>
.usage { display: flex; flex-direction: column; gap: 10px; }
.usage__table :deep(th) { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--p-text-muted-color); }
.usage__empty { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }
.usage__name { font-weight: 600; color: var(--p-text-color); text-decoration: none; margin-right: 8px; }
.usage__name:hover { text-decoration: underline; }
</style>
