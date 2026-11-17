<script>
import entityTable from 'src/mixins/entityTable'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import LightTable from 'components/common/LightTable.vue'
import LineKindTag from 'components/line/LineKindTag.vue'
import { usePortfolio, lineHealth, lineProducts, lineMrCount, lineLastSync, daysSince } from 'src/composables/usePortfolio'
import { LINE_KINDS, lineKindOf } from 'src/utils/lineKind'
import GitLabButton from 'components/common/GitLabButton.vue'
import RestoreLineDialog from 'components/line/RestoreLineDialog.vue'
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'
import { pendingDeletionLabel } from 'src/utils/pendingDeletion'

const STALE_DAYS = 14

const SORT_OPTIONS = [
  { value: 'issues', field: 'issues', order: -1, labelKey: 'dashboard.sort_issues' },
  { value: 'stale', field: 'createdAtRaw', order: 1, labelKey: 'dashboard.sort_stale' },
  { value: 'products', field: 'productCount', order: -1, labelKey: 'dashboard.sort_products' },
  { value: 'name', field: 'name', order: 1, labelKey: 'dashboard.sort_az' },
]

export default {
  components: {
    LightTable, LineKindTag, IconField, InputIcon, InputText, GitLabButton, RestoreLineDialog,
    PrimeSelect: Select, PrimeButton: Button,
  },
  directives: { tooltip: Tooltip },
  mixins: [entityTable],

  props: {
    tableData: { type: Array, required: true },
    loading: { type: Boolean, default: false },
    variant: { type: String, default: 'management' },
    inactiveLines: { type: Array, default: () => [] },
    inactiveLoading: { type: Boolean, default: false },
  },

  emits: ['restored'],

  setup() {
    usePortfolio()
    return {
      lineHealthOf: lineHealth,
      lineProductsOf: lineProducts,
      lineMrCountOf: lineMrCount,
      lineLastSyncOf: lineLastSync,
    }
  },

  data() {
    return {
      filter: '',
      statusFilter: 'all',
      kindFilter: 'all',
      sortOption: this.variant === 'dashboard' ? 'issues' : 'name',
      lineToRestore: null,
    }
  },

  computed: {
    isDashboard() {
      return this.variant === 'dashboard'
    },

    columns() {
      const t = (key) => this.$t(key)
      return [
        { key: 'name', header: t('labels.name') },
        { key: 'kind', header: t('modules.line_kind'), class: 'col-wide' },
        { key: 'version', header: t('labels.version'), class: 'col-wide' },
        { key: 'models', header: t('labels.models'), class: 'col-wide' },
        { key: 'productCount', header: t('labels.products'), class: 'col-xs' },
        { key: 'health', header: t('labels.health') },
        this.isDashboard
          ? { key: 'syncDays', header: t('labels.last_sync_short'), class: 'col-xs' }
          : { key: 'mrCount', header: t('labels.mrs'), class: 'col-wide' },
        ...(this.isDashboard ? [] : [
          { key: 'createdAt', header: t('labels.created'), class: 'col-wide col-xs' },
          { key: 'repository', header: '', class: 'col-actions' },
        ]),
      ]
    },

    searchPlaceholderKey() {
      return this.isDashboard ? 'labels.search_by_name' : 'labels.search_lines_placeholder'
    },

    countLabelKey() {
      return 'labels.lines_count'
    },

    filterOptions() {
      if (this.isDashboard) {
        return [
          { key: 'all', label: this.$t('labels.gen_filter_all') },
          { key: 'bad', label: this.$t('dashboard.filter_with_issues') },
          { key: 'stale', label: this.$t('dashboard.filter_unsynced') },
        ]
      }
      return [
        { key: 'all', label: this.$t('labels.filter_active') },
        { key: 'ok', label: this.$t('labels.healthy') },
        { key: 'bad', label: this.$t('labels.needs_attention') },
        { key: 'no-products', label: this.$t('dashboard.no_products') },
        { key: 'inactive', label: this.inactiveLines.length ? `${this.$t('labels.filter_inactive')} (${this.inactiveLines.length})` : this.$t('labels.filter_inactive') },
      ]
    },

    showingInactive() {
      return !this.isDashboard && this.statusFilter === 'inactive'
    },

    inactiveColumns() {
      return [
        { key: 'name', header: this.$t('labels.name') },
        { key: 'kind', header: this.$t('modules.line_kind'), class: 'col-wide' },
        { key: 'version', header: this.$t('labels.version'), class: 'col-wide' },
        { key: 'productCount', header: this.$t('labels.products'), class: 'col-xs' },
        { key: 'createdAt', header: this.$t('labels.created'), class: 'col-wide col-xs' },
        { key: 'deletion', header: this.$t('labels.deletion_column') },
        { key: 'repository', header: '', class: 'col-actions' },
      ]
    },

    inactiveRows() {
      return this.inactiveLines
        .filter((line) => this.matchesSearch(line, this.filter))
        .filter((line) => this.kindFilter === 'all' || lineKindOf(line).kind === this.kindFilter)
    },

    kindOptions() {
      return [
        { value: 'all', label: this.$t('modules.kind_all') },
        ...LINE_KINDS.map(({ kind, label }) => ({ value: kind, label: this.$t(label) })),
      ]
    },

    sortSelectOptions() {
      return SORT_OPTIONS.map((option) => ({ value: option.value, label: this.$t(option.labelKey) }))
    },

    activeSort() {
      return SORT_OPTIONS.find((option) => option.value === this.sortOption) || SORT_OPTIONS[SORT_OPTIONS.length - 1]
    },

    tableRows() {
      return this.data.map((line) => {
        const { ok, bad, total } = this.lineHealthOf(line)
        return {
          ...line,
          issues: bad,
          health: this.buildHealth(ok, bad, total),
          mrCount: this.lineMrCountOf(line),
          syncDays: daysSince(this.lineLastSyncOf(line)),
        }
      })
    },

    isFiltered() {
      return Boolean(this.filter) || this.statusFilter !== 'all' || this.kindFilter !== 'all'
    },

    filteredData() {
      const matching = this.tableRows
        .filter((line) => this.matchesSearch(line, this.filter))
        .filter((line) => this.kindFilter === 'all' || lineKindOf(line).kind === this.kindFilter)
      if (this.statusFilter === 'bad') return matching.filter((line) => line.issues > 0)
      if (this.statusFilter === 'ok') return matching.filter((line) => line.health.key === 'ok')
      if (this.statusFilter === 'stale') return matching.filter((line) => this.isStale(line))
      if (this.statusFilter === 'no-products') return matching.filter((line) => line.productCount === 0)
      return matching
    },
  },

  methods: {
    clearFilters() {
      this.filter = ''
      this.statusFilter = 'all'
      this.kindFilter = 'all'
    },

    showLineDetail(id) {
      this.$router.push(`/lines/${id}`)
    },

    deletionLabel(line) {
      return pendingDeletionLabel(this.$t, line.deletesOn)
    },

    showProducts(line) {
      if (this.showingInactive) {
        this.$router.push({ path: '/products', query: { line: line.name, status: 'inactive' } })
      } else {
        this.$router.push({ path: `/lines/${line._id}`, query: { tab: 'products' } })
      }
    },

    identifier(line) {
      if (!line.webUrl) return '—'
      try {
        return new URL(line.webUrl).pathname.replace(/^\/+/, '') || '—'
      } catch {
        return '—'
      }
    },

    matchesSearch(line, term) {
      const needle = (term ?? '').toLowerCase()
      if (!needle) return true
      if (line.name.toLowerCase().includes(needle)) return true
      if (this.identifier(line).toLowerCase().includes(needle)) return true
      return this.lineProductsOf(line).some((product) => product.name.toLowerCase().includes(needle))
    },

    isStale(line) {
      return line.syncDays === null || line.syncDays >= STALE_DAYS
    },

    syncLabel(line) {
      if (line.syncDays === null) return this.$t('labels.never_synced')
      return `${line.syncDays}d`
    },

    modelsLabel(line) {
      return line.models?.length ? line.models.join(', ') : '—'
    },

    buildHealth(ok, bad, total) {
      if (!total) {
        return { key: 'empty', label: '—', okPct: '0%', badPct: '0%' }
      }
      const pct = (n) => `${Math.round((n / total) * 100)}%`
      if (bad > 0) {
        return { key: 'bad', label: this.$t('labels.needs_attention'), okPct: pct(ok), badPct: pct(bad) }
      }
      if (ok === total) {
        return { key: 'ok', label: this.$t('labels.healthy'), okPct: '100%', badPct: '0%' }
      }
      return { key: 'checking', label: '…', okPct: pct(ok), badPct: '0%' }
    },
  },
}
</script>

<template>
  <div class="lines-table" :class="{ 'lines-table--management': !isDashboard }">
    <div class="lines-table__filters">
      <IconField class="lines-table__search">
        <InputIcon><i class="pi pi-search" style="font-size: 14px" aria-hidden="true" /></InputIcon>
        <InputText
          v-model="filter"
          :placeholder="$t(searchPlaceholderKey)"
          :aria-label="$t(searchPlaceholderKey)"
          class="lines-table__input"
        />
        <InputIcon v-if="filter" class="lines-table__clear" @click="filter = ''">
          <i class="pi pi-times" style="font-size: 13px" aria-hidden="true" />
        </InputIcon>
      </IconField>

      <PrimeSelect
        v-model="sortOption"
        :options="sortSelectOptions"
        option-label="label"
        option-value="value"
        :aria-label="$t('dashboard.sort_label')"
        class="lines-table__sort"
      />

      <PrimeSelect
        v-model="kindFilter"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        :aria-label="$t('modules.line_kind')"
        name="line-kind-filter"
        class="lines-table__sort lines-table__kind"
      />

      <div class="lines-table__pills">
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

      <button v-if="isFiltered" type="button" class="lines-table__reset" @click="clearFilters">
        <i class="pi pi-filter-slash" aria-hidden="true" /> {{ $t('labels.clear_filters') }}
      </button>

      <div class="lines-table__spacer" />

      <span class="lines-table__count">
        {{ showingInactive ? $t(countLabelKey, { n: inactiveRows.length, m: inactiveLines.length }) : $t(countLabelKey, { n: filteredData.length, m: data.length }) }}
      </span>
    </div>

    <div class="lines-table__body">
      <LightTable
        v-if="showingInactive"
        :columns="inactiveColumns"
        :rows="inactiveRows"
        :loading="inactiveLoading"
        :per-page="10"
        :row-height="40"
        :sort-field="activeSort.field"
        :sort-order="activeSort.order"
      >
        <template #cell-name="{ row: line }">
          <span class="cell-truncated">{{ line.name }}</span>
        </template>

        <template #cell-kind="{ row: line }">
          <LineKindTag :line="line" />
        </template>

        <template #cell-version="{ row: line }">
          <span class="cell-mono">{{ line.version ?? '—' }}</span>
        </template>

        <template #cell-productCount="{ row: line }">
          <span class="cell-soft">{{ line.productCount }}</span>
        </template>

        <template #cell-createdAt="{ row: line }">
          <span class="cell-mono cell-mono--dim">{{ line.createdAt }}</span>
        </template>

        <template #cell-deletion="{ row: line }">
          <span class="lines-table__deletion" :name="`line-deletion-${line._id}`">
            <i class="pi pi-clock" aria-hidden="true" /> {{ deletionLabel(line) }}
          </span>
        </template>

        <template #cell-repository="{ row: line }">
          <div class="cell-end">
            <GitLabButton :id="line.repoId" :host="line.gitHost" type="repository" :href="line.webUrl" />
            <span v-tooltip="{ value: line.canRestore === false ? $t('labels.restore_needs_owner') : $t('labels.restore'), class: 'tooltip-wide', fitContent: false }" @click.stop>
              <PrimeButton
                text rounded size="small"
                icon="pi pi-replay"
                :name="`line-restore-${line._id}`"
                :aria-label="line.canRestore === false ? $t('labels.restore_needs_owner') : $t('labels.restore')"
                :disabled="line.canRestore === false"
                @click.stop="lineToRestore = line"
              />
            </span>
            <PrimeButton
              text rounded size="small"
              icon="pi pi-chevron-right"
              class="lines-table__products"
              :name="`line-products-${line._id}`"
              :aria-label="$t('labels.view_products')"
              :disabled="line.productCount === 0"
              v-tooltip="{ value: $t('labels.view_products'), class: 'tooltip-wide', fitContent: false }"
              @click.stop="showProducts(line)"
            />
          </div>
        </template>

        <template #empty>
          <div class="design-table__empty">
            <i class="pi pi-inbox" style="font-size: 26px" aria-hidden="true" />
            <span>{{ $t('labels.no_inactive_lines') }}</span>
          </div>
        </template>
      </LightTable>

      <LightTable
        v-else
        :columns="columns"
        :rows="filteredData"
        :loading="loading"
        :per-page="isDashboard ? 8 : 10"
        :row-height="isDashboard ? 36 : 40"
        :sort-field="activeSort.field"
        :sort-order="activeSort.order"
        @row-click="showLineDetail($event._id)"
      >
        <template #cell-name="{ row: line }">
          <span v-if="!isDashboard" class="cell-truncated">
            {{ line.name }}
          </span>
          <div v-else class="cell-name-wrap">
            <span class="cell-name">{{ line.name }}</span>
          </div>
        </template>

        <template #cell-kind="{ row: line }">
          <LineKindTag :line="line" />
        </template>

        <template #cell-version="{ row: line }">
          <span class="cell-mono">{{ line.version }}</span>
        </template>

        <template #cell-models="{ row: line }">
          <span class="cell-mono cell-truncated">{{ modelsLabel(line) }}</span>
        </template>

        <template #cell-productCount="{ row: line }">
          <span class="cell-soft">{{ line.productCount }}</span>
        </template>

        <template #cell-health="{ row: line }">
          <div class="cell-health">
            <div class="health-bar">
              <div class="health-bar__ok" :style="{ width: line.health.okPct }" />
              <div class="health-bar__bad" :style="{ width: line.health.badPct }" />
            </div>
            <PrimeButton
              v-if="line.productCount === 0"
              text
              size="small"
              icon="pi pi-plus"
              class="lines-table__first-product"
              :name="`line-first-product-${line._id}`"
              :label="$t('onboarding.create_first_product')"
              @click.stop="$router.push(`/lines/${line._id}/new-product`)"
            />
            <span v-else class="cell-health__text" :class="`cell-health__text--${line.health.key}`">
              {{ line.health.label }}
            </span>
          </div>
        </template>

        <template #cell-mrCount="{ row: line }">
          <span class="cell-mono">{{ line.mrCount }}</span>
        </template>

        <template #cell-syncDays="{ row: line }">
          <div class="cell-end">
            <span class="cell-mono" :class="isStale(line) ? 'cell-sync--stale' : 'cell-mono--dim'">
              {{ syncLabel(line) }}
            </span>
            <i class="pi pi-chevron-right cell-end__chevron" aria-hidden="true" />
          </div>
        </template>

        <template #cell-createdAt="{ row: line }">
          <span class="cell-mono cell-mono--dim">{{ line.createdAt }}</span>
        </template>

        <template #cell-repository="{ row: line }">
          <div class="cell-end">
            <span @click.stop>
              <GitLabButton v-if="line.webUrl" :id="line.repoId" :host="line.gitHost" type="repository" :href="line.webUrl" />
            </span>
            <PrimeButton
              text rounded size="small"
              icon="pi pi-chevron-right"
              class="lines-table__products"
              :name="`line-products-${line._id}`"
              :aria-label="$t('labels.view_products')"
              :disabled="line.productCount === 0"
              v-tooltip="{ value: $t('labels.view_products'), class: 'tooltip-wide', fitContent: false }"
              @click.stop="showProducts(line)"
            />
          </div>
        </template>

        <template #empty>
          <div class="design-table__empty">
            <i class="pi pi-inbox" style="font-size: 26px" aria-hidden="true" />
            <span>{{ $t('dashboard.no_lines_match') }}</span>
          </div>
        </template>
      </LightTable>

      <RestoreLineDialog
        v-if="!isDashboard"
        :model-value="Boolean(lineToRestore)"
        :line="lineToRestore"
        @update:model-value="(open) => { if (!open) lineToRestore = null }"
        @restored="$emit('restored')"
      />

    </div>
  </div>
</template>

<style scoped lang="scss">
.lines-table__first-product { padding-inline: 6px; font-size: 0.75rem; white-space: nowrap; }

.lines-table {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &__filters {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
  }

  &__search { width: 280px; }

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

  &__sort {
    min-width: 190px;

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

  &__count {
    font-size: 13px;
    color: var(--p-text-dim-color);
  }

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

  // the same measures as the list of products
  &--management {
    gap: 16px;

    .lines-table__filters { gap: 8px 12px; }
    .lines-table__search { flex: 0 1 260px; width: auto; min-width: 150px; }
    .lines-table__sort { flex-shrink: 0; min-width: 150px; }
    .lines-table__pills { flex-shrink: 0; }
    .lines-table__count { flex-shrink: 0; white-space: nowrap; }
  }

  &__products.p-button {
    color: var(--p-text-faint-color);

    :deep(.p-button-icon) { font-size: 13px; }

    &:not(:disabled):hover { color: var(--p-text-color); }
  }

  &__deletion {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--status-warn);
    white-space: nowrap;
  }

  &__body {
    position: relative;
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
  }
}

// narrow screens: name, products, health and the last column are what a line needs; the rest is on its page
@media (max-width: 700px) {
  .lines-table :deep(.col-wide) { display: none; }

  .lines-table .lines-table__search,
  .lines-table .lines-table__sort { width: 100%; min-width: 0; flex: 1 1 100%; }

  .lines-table .lines-table__pills { flex-wrap: wrap; flex-shrink: 1; }
  .lines-table .cell-name-kind { flex-direction: column; align-items: flex-start; gap: 3px; }
  .lines-table__spacer { display: none; }
  .cell-health { flex-direction: column; align-items: flex-start; gap: 4px; }
  .cell-health .health-bar { width: 72px; }
}

// phones: just the name and how it is doing
@media (max-width: 480px) {
  .lines-table :deep(.col-xs) { display: none; }
  .lines-table .cell-name,
  .lines-table .cell-path { max-width: 140px; }
  .lines-table .cell-name { font-size: 16px; }
}

.cell-name-kind {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cell-name-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cell-name {
  display: block;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--lg { font-size: 17px; }
}

.cell-path {
  display: block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--p-text-dim-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-sync--stale {
  color: var(--status-warn);
}

.cell-health {
  display: flex;
  align-items: center;
  gap: 11px;

  &__text {
    font-size: 12px;
    white-space: nowrap;
    color: var(--p-text-muted-color);

    &--ok { color: var(--status-ok); }
    &--bad { color: var(--status-bad); }
  }
}

</style>
