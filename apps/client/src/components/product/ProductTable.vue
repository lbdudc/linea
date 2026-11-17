<script>
import entityTable from 'src/mixins/entityTable'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import LightTable from 'components/common/LightTable.vue'
import GitLabButton from 'components/common/GitLabButton.vue'
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'
import GeneratePreviewDialog from 'components/generation/GeneratePreviewDialog.vue'
import generationStore from 'stores/generationStore'
import runStore from 'stores/runStore'
import { relativeShort } from 'src/utils/relativeTime'
import { toCsv, downloadText } from 'src/utils/csv'
import productService from 'src/services/productService'
import { notify } from 'src/composables/useNotify'
import { pendingDeletionLabel } from 'src/utils/pendingDeletion'
import { usePortfolio, healthOf, hasPendingChanges } from 'src/composables/usePortfolio'


export default {
  components: {
    LightTable, IconField, InputIcon, InputText, GitLabButton, GeneratePreviewDialog,
    PrimeSelect: Select, PrimeButton: Button,
  },
  directives: { tooltip: Tooltip },
  mixins: [entityTable],

  props: {
    tableData: { type: Array, required: true },
    loading: { type: Boolean, default: false },
    inactiveProducts: { type: Array, default: () => [] },
    inactiveLoading: { type: Boolean, default: false },
  },

  emits: ['restored'],

  setup() {
    usePortfolio()
    return { generationOf: (p) => healthOf(p).lastGeneration, statusOfProduct: (p) => healthOf(p).status, reasonsOf: (p) => healthOf(p).reasons, isPending: hasPendingChanges }
  },

  data() {
    return {
      filter: '',
      lineFilter: null,
      statusFilter: 'all',
      changesFilter: 'all',
      restoring: null,
      chosen: [],
      generateOpen: false,
      syncing: false,
    }
  },

  computed: {
    columns() {
      const t = (key) => this.$t(key)
      return [
        { key: 'name', header: t('labels.product'), sortable: true },
        { key: 'line', header: t('labels.line'), class: 'col-xs' },
        { key: 'version', header: t('labels.version'), class: 'col-wide' },
        { key: 'changes', header: t('generation.changes'), class: 'col-wide' },
        { key: 'status', header: t('labels.status') },
        { key: 'lastGeneration', header: t('products_bulk.last_generation'), class: 'col-wide' },
        { key: 'createdAt', header: t('labels.creation_date'), class: 'col-wide' },
        { key: 'repository', header: '', class: 'col-actions' },
      ]
    },

    filterOptions() {
      const inactive = this.inactiveProducts.length
      return [
        { key: 'all', label: this.$t('labels.filter_active_products') },
        { key: 'ok', label: this.$t('labels.healthy') },
        { key: 'bad', label: this.$t('labels.needs_attention') },
        { key: 'inactive', label: inactive ? `${this.$t('labels.filter_inactive_products')} (${inactive})` : this.$t('labels.filter_inactive_products') },
      ]
    },

    showingInactive() {
      return this.statusFilter === 'inactive'
    },

    inactiveColumns() {
      return [
        { key: 'name', header: this.$t('labels.product') },
        { key: 'line', header: this.$t('labels.line'), class: 'col-xs' },
        { key: 'version', header: this.$t('labels.version'), class: 'col-wide' },
        { key: 'createdAt', header: this.$t('labels.creation_date'), class: 'col-wide' },
        { key: 'deletion', header: this.$t('labels.deletion_column') },
        { key: 'repository', header: '', class: 'col-actions' },
      ]
    },

    inactiveRows() {
      const rows = this.filterByName(this.inactiveProducts, this.filter)
      return this.lineFilter ? rows.filter((p) => p.line === this.lineFilter) : rows
    },

    lineOptions() {
      const rows = this.showingInactive ? this.inactiveProducts : this.data
      const names = [...new Set([...rows.map((p) => p.line), this.lineFilter].filter(Boolean))].sort()
      return [
        { value: null, label: this.$t('labels.all_lines') },
        ...names.map((n) => ({ value: n, label: n })),
      ]
    },

    changesOptions() {
      return [
        { key: 'pending', label: this.$t('generation.pending') },
        { key: 'deployed', label: this.$t('generation.deployed') },
      ]
    },

    toGenerate() {
      return this.chosen.map((product) => ({ id: product._id, name: product.name, version: product.version }))
    },

    pendingCount() {
      return this.data.filter((p) => this.isPending(p)).length
    },

    filteredData() {
      let rows = this.filterByName(this.data, this.filter)
      if (this.lineFilter) rows = rows.filter((p) => p.line === this.lineFilter)
      if (this.statusFilter !== 'all' && !this.showingInactive) {
        rows = rows.filter((p) => this.statusOfProduct(p) === this.statusFilter)
      }
      if (this.changesFilter === 'pending') rows = rows.filter((p) => this.isPending(p))
      if (this.changesFilter === 'deployed') rows = rows.filter((p) => !this.isPending(p))
      return rows
    },

    isFiltered() {
      return Boolean(this.filter) || this.lineFilter !== null || this.statusFilter !== 'all' || this.changesFilter !== 'all'
    },
  },

  watch: {
    '$route.query': { handler: 'applyRouteFilters' },
  },

  created() {
    this.applyRouteFilters()
  },

  methods: {
    // `?line=name&status=inactive`: where the list of lines sends to see the products of one
    applyRouteFilters() {
      const query = this.$route?.query
      if (!query) return
      if (query.line) this.lineFilter = query.line
      if (query.status === 'inactive') this.statusFilter = 'inactive'
      if (query.health === 'attention') this.statusFilter = 'bad'
      if (query.health === 'ok') this.statusFilter = 'ok'
      if (query.changes === 'pending') this.changesFilter = 'pending'
    },

    deletionLabel(product) {
      return pendingDeletionLabel(this.$t, product.deletesOn)
    },

    showProductDetail(id) {
      this.$router.push(`/products/${id}`)
    },

    restoreHint(product) {
      if (product.lineFirst) return this.$t('labels.restore_line_first')
      if (product.canRestore === false) return this.$t('labels.restore_needs_owner')
      return this.$t('labels.restore')
    },

    async restore(product) {
      this.restoring = product._id
      try {
        await productService.restoreProduct({ repoId: product.repoId })
        notify({ type: 'positive', message: this.$t('labels.product_restored', { name: product.name }) })
        this.$emit('restored')
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
      } finally {
        this.restoring = null
      }
    },

    lastGenerationOf(product) {
      const generation = this.generationOf(product)
      if (!generation) return null
      return {
        outcome: generation.outcome,
        label: this.$t(`products_bulk.generation_${generation.outcome}`),
        when: relativeShort(generation.at, this.$i18n.locale),
      }
    },

    exportRows() {
      return this.chosen.length ? this.chosen : this.filteredData
    },

    exportCsv() {
      const rows = this.exportRows().map((product) => {
        const generation = this.generationOf(product)
        return {
          name: product.name,
          line: product.line,
          version: product.version,
          status: this.statusOfProduct(product),
          pending_changes: this.isPending(product) ? 'yes' : 'no',
          last_generation: generation?.outcome ?? '',
          last_generation_at: generation?.at ? new Date(generation.at).toISOString() : '',
        }
      })
      downloadText('products.csv', toCsv(rows), 'text/csv')
    },

    startBulkGeneration(items) {
      const byId = new Map(this.chosen.map((product) => [String(product._id), product]))
      generationStore.enqueue(items.map((item) => {
        const product = byId.get(String(item.id))
        return { _id: item.id, name: item.name, lineId: product?.lineId, lineName: product?.line, bump: item.bump, version: product?.version, deployable: true }
      }))
      notify({ type: 'positive', message: this.$t('products_bulk.generating', { n: items.length }) })
      this.chosen = []
    },

    async syncChosen() {
      this.syncing = true
      let done = 0
      let failed = 0
      for (const product of this.chosen) {
        const finish = runStore.begin({ id: product._id, name: product.name, lineName: product.line })
        try {
          await productService.syncProduct({ id: product._id })
          done += 1
        } catch {
          failed += 1
        } finally {
          finish()
        }
      }
      this.syncing = false
      this.chosen = []
      notify({ type: failed ? 'warning' : 'positive', message: this.$t('products_bulk.synced', { done, failed }) })
    },

    clearFilters() {
      this.filter = ''
      this.lineFilter = null
      this.statusFilter = 'all'
      this.changesFilter = 'all'
    },

    statusLabel(product) {
      const status = this.statusOfProduct(product)
      if (status === 'ok') return this.$t('labels.healthy')
      if (status === 'bad') return this.$t('labels.needs_attention')
      return '…'
    },

    statusTitle(product) {
      return this.reasonsOf(product).map((reason) => this.$t(`labels.health_reason_${reason}`)).join(' · ')
    },

    cellStatusClass(product) {
      const suffix = this.statusOfProduct(product)
      return suffix ? `cell-status--${suffix}` : ''
    },
  },
}
</script>

<template>
  <div class="products-table">
    <div class="products-table__filters">
      <IconField class="products-table__search">
        <InputIcon><i class="pi pi-search" style="font-size: 14px" aria-hidden="true" /></InputIcon>
        <InputText
          v-model="filter"
          :placeholder="$t('labels.search_by_name')"
          :aria-label="$t('labels.search_by_name')"
          class="products-table__input"
        />
        <InputIcon v-if="filter" class="products-table__clear" @click="filter = ''">
          <i class="pi pi-times" style="font-size: 13px" aria-hidden="true" />
        </InputIcon>
      </IconField>

      <PrimeSelect
        v-model="lineFilter"
        :options="lineOptions"
        option-label="label"
        option-value="value"
        :aria-label="$t('labels.spl')"
        :placeholder="$t('labels.all_lines')"
        class="products-table__line"
      />

      <div class="products-table__pills">
        <button
          v-for="f in filterOptions"
          :key="f.key"
          type="button"
          class="pill"
          :class="{ 'pill--active': statusFilter === f.key }"
          @click="statusFilter = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <div v-if="!showingInactive" class="products-table__pills" role="group" :aria-label="$t('generation.changes')">
        <button
          v-for="f in changesOptions"
          :key="f.key"
          type="button"
          class="pill"
          :class="{ 'pill--active': changesFilter === f.key }"
          :aria-pressed="changesFilter === f.key"
          @click="changesFilter = changesFilter === f.key ? 'all' : f.key"
        >
          {{ f.label }}<template v-if="f.key === 'pending' && pendingCount"> · {{ pendingCount }}</template>
        </button>
      </div>

      <PrimeButton
        v-if="!showingInactive"
        text
        size="small"
        icon="pi pi-download"
        name="products-export"
        :label="$t('products_bulk.export')"
        :disabled="!filteredData.length"
        @click="exportCsv"
      />

      <button v-if="isFiltered" type="button" class="products-table__reset" @click="clearFilters">
        <i class="pi pi-filter-slash" aria-hidden="true" /> {{ $t('labels.clear_filters') }}
      </button>

      <div class="products-table__spacer" />

      <span class="products-table__count">
        {{ showingInactive ? $t('labels.products_count', { n: inactiveRows.length, m: inactiveProducts.length }) : $t('labels.products_count', { n: filteredData.length, m: data.length }) }}
      </span>
    </div>

    <div v-if="chosen.length && !showingInactive" class="products-table__bulk" name="products-bulk">
      <strong>{{ $t('products_bulk.selected', { n: chosen.length }) }}</strong>
      <PrimeButton size="small" icon="pi pi-play" name="bulk-generate" :label="$t('products_bulk.generate')" @click="generateOpen = true" />
      <PrimeButton size="small" severity="secondary" outlined icon="pi pi-sync" name="bulk-sync" :loading="syncing" :label="$t('products_bulk.sync')" @click="syncChosen" />
      <PrimeButton size="small" severity="secondary" outlined icon="pi pi-download" name="bulk-export" :label="$t('products_bulk.export_selected')" @click="exportCsv" />
      <PrimeButton text size="small" severity="secondary" name="bulk-clear" :label="$t('products_bulk.clear')" @click="chosen = []" />
    </div>

    <GeneratePreviewDialog
      v-if="toGenerate.length"
      v-model:visible="generateOpen"
      :products="toGenerate"
      @confirm="startBulkGeneration"
    />

    <div class="products-table__body">
      <LightTable
        v-if="showingInactive"
        :columns="inactiveColumns"
        :rows="inactiveRows"
        :loading="inactiveLoading"
        :per-page="10"
        :row-height="40"
      >
        <template #cell-name="{ row: p }">
          <span class="cell-truncated">{{ p.name }}</span>
        </template>

        <template #cell-line="{ row: p }">
          <span class="cell-soft cell-truncated">{{ p.line ?? '—' }}</span>
        </template>

        <template #cell-version="{ row: p }">
          <span class="cell-mono">{{ p.version ?? '—' }}</span>
        </template>

        <template #cell-createdAt="{ row: p }">
          <span class="cell-mono cell-mono--dim cell-mono--small">{{ p.createdAt }}</span>
        </template>

        <template #cell-deletion="{ row: p }">
          <span class="products-table__deletion" :name="`product-deletion-${p._id}`">
            <i class="pi pi-clock" aria-hidden="true" /> {{ deletionLabel(p) }}
          </span>
        </template>

        <template #cell-repository="{ row: p }">
          <div class="cell-end">
            <GitLabButton :id="p.repoId" :host="p.gitHost" type="repository" :href="p.webUrl" />
            <span v-tooltip="{ value: restoreHint(p), class: 'tooltip-wide', fitContent: false }" @click.stop>
              <PrimeButton
                text rounded size="small"
                icon="pi pi-replay"
                :name="`product-restore-${p._id}`"
                :aria-label="restoreHint(p)"
                :loading="restoring === p._id"
                :disabled="p.lineFirst === true || p.canRestore === false || Boolean(restoring)"
                @click.stop="restore(p)"
              />
            </span>
          </div>
        </template>

        <template #empty>
          <div class="design-table__empty">
            <i class="pi pi-inbox" style="font-size: 26px" aria-hidden="true" />
            <span>{{ $t('labels.no_inactive_products') }}</span>
          </div>
        </template>
      </LightTable>

      <LightTable
        v-else
        :columns="columns"
        :rows="filteredData"
        :loading="loading"
        :per-page="10"
        :row-height="40"
        selectable
        v-model:selection="chosen"
        @row-click="showProductDetail($event._id)"
      >
        <template #cell-name="{ row: p }">
          <span class="cell-truncated">{{ p.name }}</span>
          <span
            v-if="p.lineDeleted"
            class="unmaintained-tag"
            :name="`product-unmaintained-${p._id}`"
            :title="$t('labels.product_unmaintained_banner')"
          ><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('labels.product_unmaintained') }}</span>
        </template>

        <template #cell-line="{ row: p }">
          <span class="cell-soft cell-truncated">{{ p.line }}</span>
        </template>

        <template #cell-version="{ row: p }">
          <span class="cell-mono">{{ p.version }}</span>
        </template>

        <template #cell-changes="{ row: p }">
          <span
            v-if="isPending(p)"
            class="pending-tag"
            name="product-pending"
            :title="$t('generation.pending_tooltip')"
          ><span class="pending-tag__dot" />{{ $t('generation.pending') }}</span>
          <span v-else class="cell-soft">—</span>
        </template>

        <template #cell-status="{ row: p }">
          <div class="cell-status" :class="cellStatusClass(p)" :title="statusTitle(p)">
            <span class="cell-status__dot" />
            <span class="cell-status__text">{{ statusLabel(p) }}</span>
          </div>
        </template>

        <template #cell-lastGeneration="{ row: p }">
          <span v-if="lastGenerationOf(p)" class="generation-cell" :class="`generation-cell--${lastGenerationOf(p).outcome}`" :name="`product-last-generation-${p._id}`">
            {{ lastGenerationOf(p).label }} <small>{{ lastGenerationOf(p).when }}</small>
          </span>
          <span v-else class="cell-soft">—</span>
        </template>

        <template #cell-createdAt="{ row: p }">
          <span class="cell-mono cell-mono--dim cell-mono--small">{{ p.createdAt }}</span>
        </template>

        <template #cell-repository="{ row: p }">
          <div class="cell-end">
            <span @click.stop>
              <GitLabButton v-if="p.repo?.webUrl" :id="p.repo.id" :host="p.gitHost" type="repository" :href="p.repo.webUrl" />
            </span>
            <i class="pi pi-chevron-right cell-end__chevron" aria-hidden="true" />
          </div>
        </template>

        <template #empty>
          <div class="design-table__empty">
            <i class="pi pi-inbox" style="font-size: 26px" aria-hidden="true" />
            <span>{{ $t('dashboard.no_products_match') }}</span>
          </div>
        </template>
      </LightTable>
    </div>
  </div>
</template>

<style scoped lang="scss">
.products-table__bulk {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 20px 8px;
  padding: 8px 12px;
  border: 1px solid var(--p-primary-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  font-size: 0.8125rem;
}

.generation-cell {
  font-size: 0.8125rem;
  small { color: var(--text-muted); margin-left: 4px; }
  &--success { color: var(--status-ok); }
  &--warning { color: var(--status-warn); }
  &--error { color: var(--status-bad); }
}

.products-table {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__filters {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
  }

  &__search { width: 260px; }

  &__deletion {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--status-warn);
    white-space: nowrap;
  }

  &__input {
    width: 100%;
    height: 34px;
    border-radius: 5px;
    background: var(--p-content-background);
    font-size: 13px;
  }

  &__clear {
    right: 8px;
    left: auto;
    cursor: pointer;
  }

  &__line {
    min-width: 210px;

    :deep(.p-select-label) {
      padding-top: 0;
      padding-bottom: 0;
      line-height: 32px;
      font-size: 13px;
    }
  }

  &__pills {
    display: flex;
    gap: 6px;
  }

  &__spacer { flex-grow: 1; }

  &__reset {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--p-text-muted-color);
    cursor: pointer;

    &:hover { color: var(--p-text-color); }
  }

  &__count {
    font-size: 13px;
    color: var(--p-text-dim-color);
  }

  &__body {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
  }
}

.unmaintained-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 1px 8px;
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
  border-radius: 20px;
  color: var(--status-warn);
  background: var(--status-warn-soft);
  border: 1px solid var(--status-warn-border);

  .pi { font-size: 0.6875rem; }
}

.pending-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 20px;
  color: var(--status-warn);
  background: var(--status-warn-soft);
  border: 1px solid var(--status-warn-border);

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
}

// narrow screens: the product and how it is doing; the rest is on its page
@media (max-width: 700px) {
  .products-table :deep(.col-wide) { display: none; }

  .products-table__search,
  .products-table__line { width: 100%; min-width: 0; flex: 1 1 100%; }

  .products-table__pills { flex-wrap: wrap; }
  .products-table__spacer { display: none; }
}

@media (max-width: 480px) {
  .products-table :deep(.col-xs) { display: none; }
}
</style>
