<script>
import GitLabButton from '../common/GitLabButton.vue'
import entityTable from 'src/mixins/entityTable'
import LightTable from '../common/LightTable.vue'
import Tooltip from 'primevue/tooltip'

export default {
  components: { GitLabButton, LightTable },
  directives: { tooltip: Tooltip },
  mixins: [entityTable],
  props: {
    tableData:    { type: Array,  required: true },
    filter:       { type: String, default: '' },
    // 'all' | 'ok' | 'bad' | 'pending' | 'mrs': which products are listed, by how they are doing
    status:       { type: String, default: 'all' },
    clearTrigger: { type: Number, default: 0 },
    // result of the health check by product id: { isHealthy, error, errorType }
    health:       { type: Object, default: () => ({}) },
    healthLoading: { type: Boolean, default: false },
    // saved changes that no generation has deployed, by product id: { pending, version }
    deployments:  { type: Object, default: () => ({}) },
    // { ids: [...] }: select those products (each request is a new object)
    selectRequest: { type: Object, default: null },
  },
  emits: ['update:selection'],
  data() {
    return {
      tableSelection: [],
      columns: [
        { name: 'name',        field: 'name',        align: 'left',   label: 'labels.name',         sortable: true  },
        { name: 'version',     field: 'version',     align: 'center', label: 'labels.version',       sortable: false },
        { name: 'status',                            align: 'center', label: 'labels.status',        sortable: false },
        { name: 'createdAt',   field: 'createdAt',   align: 'center', label: 'labels.creation_date', sortable: false },
        { name: 'lastSyncAt',  field: 'lastSyncAt',  align: 'center', label: 'labels.last_sync',     sortable: false },
        { name: 'actions',                           align: 'center', label: 'labels.actions',       sortable: false },
      ],
    }
  },
  computed: {
    tableColumns() {
      return this.columns.map((col) => ({
        key: col.name,
        header: this.$t(col.label),
        field: col.field,
        align: col.align,
        sortable: col.sortable,
      }))
    },
    filteredData() {
      const named = this.filterByName(this.data, this.filter)
      if (this.status === 'ok') return named.filter((p) => this.statusOf(p) === 'ok')
      if (this.status === 'bad') return named.filter((p) => this.statusOf(p) === 'bad')
      if (this.status === 'pending') return named.filter((p) => this.isPending(p))
      if (this.status === 'mrs') return named.filter((p) => (this.health[String(p._id)]?.openMRs ?? 0) > 0)
      return named
    },
  },
  watch: {
    tableData() {
      this.tableSelection = []
    },
    tableSelection(newVal) {
      this.$emit('update:selection', newVal)
    },
    clearTrigger() {
      this.tableSelection = []
    },
    selectRequest(request) {
      const wanted = new Set((request?.ids ?? []).map(String))
      this.tableSelection = this.data.filter((product) => wanted.has(String(product._id)))
    },
  },
  methods: {
    statusOf(product) {
      const r = this.health[String(product._id)]
      if (!r) return 'checking'
      return r.isHealthy ? 'ok' : 'bad'
    },
    statusLabel(product) {
      const status = this.statusOf(product)
      if (status === 'ok') return this.$t('labels.healthy')
      if (status === 'bad') return this.$t('labels.needs_attention')
      return '…'
    },
    isPending(product) {
      return this.deployments[String(product._id)]?.pending === true
    },
    statusDetail(product) {
      const r = this.health[String(product._id)]
      return r && !r.isHealthy ? (r.error || '') : ''
    },
    syncDays(lastSyncAt) {
      if (!lastSyncAt) return null
      const ms = Date.now() - new Date(lastSyncAt).getTime()
      return Math.floor(ms / 86400000)
    },
    syncLabel(lastSyncAt) {
      const d = this.syncDays(lastSyncAt)
      if (d === null) return this.$t('labels.sync_never')
      if (d === 0) return this.$t('labels.sync_today')
      return this.$t('labels.sync_days_ago', { n: d })
    },
    showProductDetail(id) {
      this.$router.push(`/products/${id}`)
    },
  },
}
</script>

<template>
  <LightTable
    v-model:selection="tableSelection"
    :columns="tableColumns"
    :rows="filteredData"
    variant="app"
    selectable
    :per-page="5"
    :row-height="48"
    @row-click="showProductDetail($event._id)"
  >
    <template #cell-name="{ row }">
      <span class="product-name">{{ row.name }}</span>
    </template>

    <template #cell-version="{ row }">
      <span class="version-badge">v{{ row.version }}</span>
      <span
        v-if="isPending(row)"
        class="pending-tag"
        name="product-pending"
        v-tooltip="$t('generation.pending_tooltip')"
      ><span class="pending-tag__dot" />{{ $t('generation.pending') }}</span>
    </template>

    <template #cell-status="{ row }">
      <span class="status" :class="`status--${statusOf(row)}`" v-tooltip="statusDetail(row) || null">
        <span class="status__dot" />{{ statusLabel(row) }}
      </span>
    </template>

    <template #cell-lastSyncAt="{ row }">
      <span class="sync-text">{{ syncLabel(row.lastSyncAt) }}</span>
    </template>

    <template #cell-actions="{ row }">
      <div class="action-btn-group" @click.stop>
        <template v-if="row.repo">
          <GitLabButton
            :id="row.repo.id"
            type="repository"
            :href="row.repo.webUrl"
            @click.stop
          />
          <GitLabButton
            :id="row.repo.id"
            type="code"
            :href="row.repo.webIdeUrl"
            @click.stop
          />
        </template>
      </div>
    </template>

    <template #empty>
      <div class="table-empty">{{ $t('labels.no_data_available') }}</div>
    </template>
  </LightTable>
</template>

<style scoped lang="scss">
.product-name {
  font-weight: 500;
  color: var(--text-heading);
}

.version-badge {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 6px;
  padding: 2px 7px;
}

.pending-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 8px;
  padding: 1px 8px;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: 20px;
  color: var(--status-warn);
  background: var(--status-warn-soft);
  border: 1px solid var(--status-warn-border);
  vertical-align: middle;

  &__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
}

.action-btn-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  &--ok &__dot { background: var(--status-ok); }
  &--bad { color: var(--status-bad); }
  &--bad &__dot { background: var(--status-bad); }
}

.sync-text {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.table-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
}
</style>
