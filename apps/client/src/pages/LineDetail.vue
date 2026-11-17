<script>
import lineService from 'src/services/lineService'
import productService from 'src/services/productService'
import generationStore from 'stores/generationStore'
import { notify } from 'src/composables/useNotify'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Tooltip from 'primevue/tooltip'
import ProductSummaryTable from '../components/product/ProductSummaryTable.vue'
import GeneratePreviewDialog from '../components/generation/GeneratePreviewDialog.vue'
import GenerationResultDialog from '../components/generation/GenerationResultDialog.vue'
import { formatDate } from 'src/services/utils'
import { offerRollbackUndo } from 'src/composables/useRollbackUndo';
import { healthOf, healthMap, conflictsMap, deploymentsMap, ensureStatusesFor, ensureDeployments, invalidateDeployments } from 'src/composables/usePortfolio'
import { slotItems } from 'src/plugins/registry'
import { pluginTabKey } from 'src/plugins/lineTabs'
import LineShell from 'components/line/LineShell.vue'
import LineCicd from 'components/line/LineCicd.vue'
import LineVersions from 'components/line/LineVersions.vue'
import IssuesPanel from 'components/issues/IssuesPanel.vue'
import MergeRequestsPanel from 'components/mergeRequests/MergeRequestsPanel.vue'
import ProductComparisonModal from '../components/product/ProductComparisonModal.vue'

export default {
  name: 'LineDetail',
  components: {
    PrimeButton: Button,
    Skeleton,
    IconField,
    InputIcon,
    InputText,
    Tag,
    ProductSummaryTable,
    GeneratePreviewDialog,
    GenerationResultDialog,
    LineShell,
    LineCicd,
    LineVersions,
    IssuesPanel,
    MergeRequestsPanel,
    ProductComparisonModal,
  },
  directives: { tooltip: Tooltip },
  props: {
    id: { type: String, required: true },
  },
  data() {
    return {
      lineData:      {},
      productSearch:        '',
      productStatus:        'all',
      loadError:            null,
      selectedProducts:     [],
      // a request to the table to select the products with saved changes that no generation has deployed
      selectRequest:        null,
      generateDialog:       false,
      // the dialog that follows the generations this page asked for: their jobs in the queue, and whether it is open
      resultDialog:         false,
      resultJobIds:         [],
      clearSelectionTrigger: 0,
      showComparison: false,
    }
  },
  computed: {
    // the side bar is the navigation: the address says which of the two views of the line is open
    tab() {
      const wanted = String(this.$route?.query?.tab ?? '')
      // `activity` was the tab of both things
      if (this.pluginTab(wanted)) return wanted
      return wanted === 'mrs' ? 'mrs' : wanted === 'issues' ? 'issues' : wanted === 'history' ? 'history' : wanted === 'deployments' || wanted === 'cicd' || wanted === 'activity' ? 'cicd' : 'products'
    },
    gitlabPath() {
      if (!this.lineData.webUrl) return ''
      try {
        return new URL(this.lineData.webUrl).pathname.replace(/^\/+/, '') || ''
      } catch {
        return ''
      }
    },
    // the health, change requests and pending changes of the products come from the portfolio, which asks for them once for every page
    // (the side bar, the lists and this one): this page only reads them, as they arrive
    deployments() {
      return deploymentsMap.value
    },
    healthSummary() {
      const products = this.lineData.products
      if (!products) return null
      if (!products.length) return { valid: 0, invalid: 0, total: 0, openMRs: 0, failing: [] }
      if (products.some((p) => !(String(p._id) in healthMap.value))) return null
      const results = products.map((p) => {
        const id = String(p._id)
        const health = healthMap.value[id] ?? { valid: null }
        const conflicts = conflictsMap.value[id] ?? { conflictingMRs: 0, openMRs: 0 }
        const { isHealthy } = healthOf(p)
        return {
          productId: p._id,
          name: p.name,
          isHealthy,
          errorType: health.errorType,
          error: health.error,
          openMRs: conflicts.openMRs || 0,
        }
      })
      const valid = results.filter((r) => r.isHealthy).length
      return {
        valid,
        invalid: results.length - valid,
        total: results.length,
        openMRs: results.reduce((sum, r) => sum + r.openMRs, 0),
        failing: results.filter((r) => !r.isHealthy),
        results,
      }
    },
    healthSummaryLoading() {
      return this.healthSummary === null
    },
    failingCount() {
      return this.healthSummary ? this.healthSummary.invalid : 0
    },
    hasFailures() {
      return this.failingCount > 0
    },
    finishedGenerations() {
      return generationStore.jobs.filter((job) => ['success', 'warning', 'error'].includes(job.status)).length
    },
    // the generations of the last batch, as the dialog that follows them wants them
    generationRuns() {
      return this.resultJobIds
        .map((id) => generationStore.jobs.find((job) => job.id === id))
        .filter(Boolean)
        .map((job) => ({
          id: job.id,
          productId: job.productId,
          name: job.productName,
          fromVersion: job.fromVersion,
          toVersion: job.toVersion,
          status: job.status,
          messages: job.messages,
          result: job.result,
          deployable: job.deployable,
          startedAt: job.startedAt,
        }))
    },
    // what the dialog that precedes a generation is given: the selected products, with the version they have now
    selectedForGeneration() {
      return this.selectedProducts.map((p) => ({ id: String(p._id), name: p.name, version: p.version }))
    },
    // the products with saved changes that no generation has deployed
    pendingProducts() {
      return (this.lineData.products ?? []).filter((p) => this.deployments[String(p._id)]?.pending === true)
    },
    // the filters of the list say how many products each one keeps: that is where the totals of the line live
    statusFilters() {
      const results = Object.values(this.healthByProduct)
      const count = (predicate) => results.filter(predicate).length
      const loaded = this.healthSummary !== null
      return [
        { key: 'all', label: this.$t('labels.gen_filter_all'), n: (this.lineData.products ?? []).length },
        { key: 'ok', label: this.$t('labels.healthy'), n: loaded ? count((r) => r.isHealthy) : null },
        { key: 'bad', label: this.$t('labels.needs_attention'), n: loaded ? count((r) => !r.isHealthy) : null },
        { key: 'pending', label: this.$t('generation.pending'), n: this.pendingProducts.length },
        { key: 'mrs', label: this.$t('labels.open_mrs'), n: loaded ? count((r) => r.openMRs > 0) : null },
      ]
    },
    healthByProduct() {
      const map = {}
      for (const r of (this.healthSummary?.results ?? [])) map[String(r.productId)] = r
      return map
    },
  },
  watch: {
    // a generation that ends changes what is saved-but-not-deployed: the tags are read again, once the queue has settled
    finishedGenerations() {
      invalidateDeployments()
      ensureDeployments()
    },
    // the old addresses of the model and the modules (`?tab=model`, `?tab=modules`) lead to their own pages
    '$route.query.tab'() {
      this.redirectLegacyTab()
    },
    id(newId, oldId) {
      if (newId !== oldId) this.reloadAll()
    },
  },
  mounted() {
    this.reloadAll()
    this.redirectLegacyTab()
  },
  methods: {
    // the tab a plugin added to the line, when `key` is its
    pluginTab(key) {
      return slotItems('line.tabs', { lineId: this.id, line: this.lineData, kind: this.lineData?.kind }).find((item) => pluginTabKey(item) === key)
    },
    redirectLegacyTab() {
      const wanted = String(this.$route?.query?.tab ?? '')
      const target = { model: 'model', modules: 'modules' }[wanted]
      if (target && this.$router) this.$router.replace(`/lines/${this.id}/${target}`)
    },
    reloadAll() {
      this.lineData = { _id: this.id }
      this.loadError = null
      this.selectedProducts = []
      this.clearSelectionTrigger += 1
      this.productSearch = ''
      this.productStatus = 'all'
      this.showComparison = false
      this.getLineData()
    },
    async getLineData() {
      const requested = this.id
      try {
        const data = await lineService.findLineById(this)
        // the line was changed while this one was on its way: its answer is not the one on screen
        if (requested !== this.id) return
        this.lineData = data
        this.lineData.products = this.lineData.products.map(p => ({
          ...p, createdAt: formatDate(p.createdAt),
        }))
        this.lineData.members = this.lineData.members.map(m => ({
          ...m, role: `labels.role${m.role}`,
        }))
        this.loadStatuses()
      } catch (error) {
        if (requested !== this.id) return
        this.lineData = {}
        this.loadError = error.response?.data?.error || 'error_messages.internal_error'
      }
    },
    // `items` are what the dialog says: the products that stay in and the part each one raises
    generateSelected(items) {
      const count = items.length
      const versions = Object.fromEntries(this.selectedForGeneration.map((p) => [p.id, p.version]))
      this.resultJobIds = generationStore.enqueue(
        items.map(item => ({
          _id: item.id,
          name: item.name,
          lineId: this.lineData._id,
          lineName: this.lineData.name,
          bump: item.bump,
          version: versions[item.id],
          deployable: true,
        }))
      )
      this.resultDialog = true
      this.clearSelectionTrigger++
      notify({
        type: 'info',
        message: this.$t('labels.generation_queued', { n: count }),
        position: 'bottom-right',
        timeout: 3000,
      })
    },
    notifyError(code) {
      notify({ type: 'negative', message: this.$t(code) })
    },
    // back to the version a generation started from: it is restored and generated again as a new version of the same product
    async rollbackRun({ productId, version }) {
      const run = this.generationRuns.find((r) => r.productId === productId)
      const leftVersion = run?.toVersion
      try {
        await productService.restoreVersion({ id: productId, version })
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
        return
      }
      const ids = generationStore.enqueue([{
        _id: productId, name: run?.name ?? '', lineId: this.lineData._id, lineName: this.lineData.name,
        bump: 'patch', version: run?.toVersion, deployable: true,
      }])
      this.resultJobIds = [...this.resultJobIds.filter((id) => this.generationRuns.find((r) => r.id === id)?.productId !== productId), ...ids]
      offerRollbackUndo({ t: (key, args) => this.$t(key, args), leftVersion, restore: (v) => productService.restoreVersion({ id: productId, version: v }), again: () => this.retryRun(productId) })
    },
    retryRun(productId) {
      const run = this.generationRuns.find((r) => r.productId === productId)
      if (!run) return
      const ids = generationStore.enqueue([{
        _id: productId, name: run.name, lineId: this.lineData._id, lineName: this.lineData.name,
        bump: 'patch', version: run.fromVersion || run.toVersion, deployable: run.deployable,
      }])
      this.resultJobIds = [...this.resultJobIds.filter((id) => this.generationRuns.find((r) => r.id === id)?.productId !== productId), ...ids]
    },
    // the products of the line that the portfolio does not hold statuses for yet are asked for; the rest is read from what it loaded
    loadStatuses() {
      return ensureStatusesFor((this.lineData.products ?? []).map((p) => p._id))
    },
    selectPending() {
      this.selectRequest = { ids: this.pendingProducts.map((p) => String(p._id)) }
    },
  },
}
</script>

<template>
  <LineShell :id="id" ref="shell" :active="tab" :line="lineData" :fill="Boolean(pluginTab(tab))">
    <div v-if="loadError" class="line-error" role="alert">
      <i class="pi pi-exclamation-circle" style="font-size: 36px; color: var(--p-text-faint-color)" aria-hidden="true" />
      <div class="line-error__title">{{ $t(loadError) }}</div>
      <PrimeButton text :label="$t('labels.go_back')" @click="$router.push('/lines')">
        <template #icon><i class="pi pi-arrow-left" style="font-size: 14px" aria-hidden="true" /></template>
      </PrimeButton>
    </div>

    <div v-else-if="lineData._id || tab === 'products'" class="line-panel" :class="{ 'line-panel--fill': Boolean(pluginTab(tab)) }">
    <template v-if="tab === 'products'">
      <section class="section ln-block">
        <div v-if="lineData.products" class="products-toolbar">
          <IconField class="products-toolbar__search">
            <InputIcon><i class="pi pi-search" style="font-size: 14px; color: var(--p-text-faint-color)" aria-hidden="true" /></InputIcon>
            <InputText v-model="productSearch" size="small" :placeholder="$t('labels.filter_products')" class="products-toolbar__input" />
            <InputIcon v-if="productSearch" class="products-toolbar__clear" @click="productSearch = ''" :aria-label="$t('labels.cancel')">
              <i class="pi pi-times" style="font-size: 13px; color: var(--p-text-faint-color)" aria-hidden="true" />
            </InputIcon>
          </IconField>

          <div class="products-toolbar__pills" role="group" :aria-label="$t('labels.status')">
            <button
              v-for="f in statusFilters"
              :key="f.key"
              type="button"
              class="pill"
              :class="{ 'pill--active': productStatus === f.key }"
              :name="`products-filter-${f.key}`"
              @click="productStatus = f.key"
            >
              {{ f.label }}<template v-if="f.n !== null && (f.key === 'all' || f.n > 0 || productStatus === f.key)"> · {{ f.n }}</template>
            </button>
          </div>

          <button
            v-if="productSearch || productStatus !== 'all'"
            type="button"
            class="products-toolbar__reset"
            @click="productSearch = ''; productStatus = 'all'"
          >
            <i class="pi pi-filter-slash" aria-hidden="true" /> {{ $t('labels.clear_filters') }}
          </button>

          <div class="products-toolbar__spacer" />

          <PrimeButton
            v-if="pendingProducts.length > 0 && selectedProducts.length === 0"
            text
            :label="$t('generation.select_pending', { n: pendingProducts.length })"
            name="select-pending"
            @click="selectPending"
          >
            <template #icon><i class="pi pi-clock" style="font-size: 15px" aria-hidden="true" /></template>
          </PrimeButton>

          <PrimeButton
            v-if="generationRuns.length"
            text
            :label="$t('generation.gr_open')"
            name="open-generation-result"
            @click="resultDialog = true"
          >
            <template #icon><i class="pi pi-list-check" style="font-size: 16px" aria-hidden="true" /></template>
          </PrimeButton>
          <template v-if="selectedProducts.length > 0">
            <Tag severity="primary" class="sel-chip">{{ selectedProducts.length }}</Tag>
            <PrimeButton
              v-if="selectedProducts.length >= 2"
              text
              :label="$t('labels.compare')"
              @click="showComparison = true"
            >
              <template #icon><i class="pi pi-clone" style="font-size: 16px" aria-hidden="true" /></template>
            </PrimeButton>
            <PrimeButton
              :style="{ background: 'var(--status-ok)', borderColor: 'var(--status-ok)', color: 'var(--status-on-solid)' }"
              :label="$t('labels.generate_selected')"
              name="generate-selected"
              @click="generateDialog = true"
            >
              <template #icon><i class="pi pi-play" style="font-size: 16px" aria-hidden="true" /></template>
            </PrimeButton>
            <PrimeButton text rounded :aria-label="$t('labels.cancel')" @click="clearSelectionTrigger++">
              <template #icon><i class="pi pi-times" style="font-size: 16px; color: var(--p-text-muted-color)" aria-hidden="true" /></template>
            </PrimeButton>
            <span class="v-sep" />
          </template>
        </div>

        <GeneratePreviewDialog
          v-model:visible="generateDialog"
          :products="selectedForGeneration"
          @confirm="generateSelected"
        />
        <GenerationResultDialog
          v-if="generationRuns.length"
          v-model:visible="resultDialog"
          :runs="generationRuns"
          @minimize="resultDialog = false"
          @rollback="rollbackRun"
          @cancel="(id) => generationStore.cancel(id)"
          @retry="retryRun"
          @error="notifyError"
        />

        <template v-if="lineData.products">
          <ProductSummaryTable
            v-if="lineData.products.length > 0"
            :tableData="lineData.products"
            :filter="productSearch"
            :status="productStatus"
            :clearTrigger="clearSelectionTrigger"
            :health="healthByProduct"
            :health-loading="healthSummaryLoading"
            :deployments="deployments"
            :select-request="selectRequest"
            @update:selection="selectedProducts = $event"
          />
          <div v-else class="products-empty">
            <i class="pi pi-box" style="font-size: 48px; color: var(--p-text-faint-color)" aria-hidden="true" />
            <div class="products-empty__title">{{ $t('labels.no_products') }}</div>
            <div class="products-empty__desc">{{ $t('labels.no_products_desc') }}</div>
            <div class="products-empty__actions">
              <PrimeButton :label="$t('labels.create_product')" @click="$router.push(`/lines/${id}/new-product`)">
                <template #icon><i class="pi pi-plus" style="font-size: 16px" aria-hidden="true" /></template>
              </PrimeButton>
            </div>
          </div>
        </template>
        <!-- the toolbar and the rows have their place while the products arrive: what is below does not move when they do -->
        <div v-else class="products-ghost" aria-hidden="true">
          <div class="products-ghost__toolbar">
            <Skeleton width="280px" height="34px" />
            <Skeleton v-for="w in [64, 96, 140, 120]" :key="w" :width="`${w}px`" height="28px" border-radius="14px" />
          </div>
          <Skeleton v-for="i in 5" :key="i" height="40px" class="products-ghost__row" />
        </div>
      </section>

    </template>

    <component :is="pluginTab(tab).component" v-else-if="pluginTab(tab)" :line-id="id" :line="lineData" />
    <MergeRequestsPanel v-else-if="tab === 'mrs'" kind="line" :id="id" />
    <IssuesPanel v-else-if="tab === 'issues'" kind="line" :id="id" />
    <LineVersions v-else-if="tab === 'history'" :line-id="id" :version="lineData.version" />

    <!-- what the generations and syncs of the line do, and how they are set up: one tab -->
    <LineCicd v-else :line-id="id" />
    </div>

    <ProductComparisonModal v-model="showComparison" :products="selectedProducts" />
  </LineShell>
</template>

<style scoped lang="scss">
.line-panel { min-height: 100%; }
.line-panel--fill { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.line-error { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 72px 24px; }
.line-error__title { font-size: 15px; font-weight: 600; }

.section { margin-bottom: 28px; &:last-child { margin-bottom: 0; } }

.products-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;

  &__search {
    width: 280px;
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

  &__spacer { flex-grow: 1; }

  &__pills { display: flex; flex-wrap: wrap; gap: 6px; margin-left: 6px; }

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
}

.v-sep {
  display: inline-block;
  width: 1px;
  height: 20px;
  background: var(--p-content-border-color);
  margin: 0 4px;
}

.sel-chip {
  font-variant-numeric: tabular-nums;
}

.products-ghost {
  &__toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; min-height: 34px; }
  &__row { margin-bottom: 8px; }
}

.products-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 52px 24px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: var(--p-text-color);
    margin-top: 4px;
  }

  &__desc {
    font-size: 13px;
    color: var(--p-text-muted-color);
    text-align: center;
    max-width: 320px;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>
