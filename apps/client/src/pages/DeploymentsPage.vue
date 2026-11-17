<script setup>
import { ref, computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import generationStore from 'stores/generationStore'
import GenerationResultDialog from 'components/generation/GenerationResultDialog.vue'
import GeneratePreviewDialog from 'components/generation/GeneratePreviewDialog.vue'
import CicdStatus from 'components/cicd/CicdStatus.vue'
import CicdFrame from 'components/cicd/CicdFrame.vue'
import InstanceSettingsForm from 'components/settings/InstanceSettingsForm.vue'
import PageHeader from 'components/layout/PageHeader.vue'
import { usePortfolio } from 'src/composables/usePortfolio'
import productService from 'src/services/productService'
import { notify } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { offerRollbackUndo } from 'src/composables/useRollbackUndo'
import { state as userState } from 'stores/userState'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Tooltip from 'primevue/tooltip'

const PrimeButton = Button
const PrimeSelect = Select
const vTooltip = Tooltip
const t = useT()
const admin = computed(() => Boolean(userState.user?.admin))

// Everything the generations and syncs of the person's SPLs are doing, and how the scheduler of the syncs is set up.
const mode = ref('status')
const refreshKey = ref(0)

const { lines: portfolioLines, products: portfolio } = usePortfolio({ statuses: false })

// ── what the numbers are narrowed to: an SPL, and one of its products ────────────────────────────────────────────
const route = useRoute()
const router = useRouter()
const lineId = ref(typeof route.query.lineId === 'string' ? route.query.lineId : null)
const productId = ref(typeof route.query.productId === 'string' ? route.query.productId : null)
const lineOptions = computed(() => (portfolioLines.value ?? [])
  .filter((l) => !l.archived)
  .map((l) => ({ value: String(l._id), label: l.name }))
  .sort((a, b) => a.label.localeCompare(b.label)))
const productOptions = computed(() => {
  const line = (portfolioLines.value ?? []).find((l) => String(l._id) === lineId.value)
  return (portfolio.value ?? [])
    .filter((p) => !line || p.line === line.name)
    .map((p) => ({ value: String(p._id), label: p.name, line: p.line }))
    .sort((a, b) => a.label.localeCompare(b.label))
})
// another SPL: the product of the one before does not belong to it
watch(lineId, () => {
  if (productId.value && !productOptions.value.some((o) => o.value === productId.value)) productId.value = null
})
// the address keeps the choice, so a filtered view can be shared and survives a reload
watch([lineId, productId], () => {
  const { lineId: _l, productId: _p, ...rest } = route.query
  router.replace({ query: { ...rest, ...(lineId.value ? { lineId: lineId.value } : {}), ...(productId.value ? { productId: productId.value } : {}) } })
})

// ── generating what is pending ──────────────────────────────────────────────────────────────────────────────────
const generateOpen = shallowRef(false)
const toGenerate = ref([])
const asked = ref({})
const runsOpen = shallowRef(false)
const runIds = ref([])

function askGenerate(product) {
  asked.value = { ...asked.value, [product.id]: product }
  toGenerate.value = [{ id: product.id, name: product.name, version: product.version }]
  generateOpen.value = true
}

// `items` are what the dialog says: the products that stay in and the part each one raises
function startGeneration(items) {
  runIds.value = generationStore.enqueue(items.map((item) => ({
    _id: item.id,
    name: item.name,
    lineId: asked.value[item.id]?.lineId,
    lineName: asked.value[item.id]?.line,
    bump: item.bump,
    version: asked.value[item.id]?.version,
    deployable: true,
  })))
  runsOpen.value = true
}

const queueRuns = computed(() => runIds.value
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
  })))

const fail = (error) => notify({ type: 'negative', message: t(error.response?.data?.error || 'error_messages.internal_error'), position: 'bottom-right' })

// back to a version: it is restored and generated again, as in the product page
async function rollbackRun({ productId, version }) {
  const leftVersion = (portfolio.value ?? []).find((p) => String(p._id) === String(productId))?.version
  try {
    await productService.restoreVersion({ id: productId, version })
  } catch (error) {
    fail(error)
    return
  }
  queueAgain(productId)
  offerRollbackUndo({ t, leftVersion, restore: (v) => productService.restoreVersion({ id: productId, version: v }), again: () => queueAgain(productId) })
}

// a product put in the queue again: from the row that is open, or from the last job it had
function queueAgain(productId) {
  const job = generationStore.jobs.find((j) => j.productId === productId)
  const known = (portfolio.value ?? []).find((p) => String(p._id) === String(productId))
  const ids = generationStore.enqueue([{
    _id: productId,
    name: job?.productName ?? known?.name,
    lineId: job?.lineId ?? known?.lineId,
    lineName: job?.lineName ?? known?.line,
    bump: 'patch',
    version: job?.toVersion || known?.version,
    deployable: true,
  }])
  if (runsOpen.value) {
    runIds.value = [...runIds.value.filter((id) => generationStore.jobs.find((j) => j.id === id)?.productId !== productId), ...ids]
  } else {
    runIds.value = ids
    runsOpen.value = true
  }
}
</script>

<template>
  <div class="page-deployments">
    <PageHeader compact :title="$t('labels.tab_cicd')">
      <template #actions>
        <PrimeButton
          text rounded size="small"
          :aria-label="$t('deployments.refresh')"
          v-tooltip="$t('deployments.refresh')"
          @click="refreshKey++"
        >
          <template #icon><i class="pi pi-refresh" style="font-size: 16px" aria-hidden="true" /></template>
        </PrimeButton>
      </template>
    </PageHeader>

    <div class="page-deployments__main">
      <CicdFrame v-model="mode">
        <template #filters>
          <PrimeSelect
            v-model="lineId" :options="lineOptions" option-value="value" option-label="label" size="small" show-clear
            :placeholder="$t('cicdview.all_lines')" class="page-deployments__filter" name="cicd-filter-line"
          />
          <PrimeSelect
            v-model="productId" :options="productOptions" option-value="value" option-label="label" size="small" show-clear filter
            :placeholder="$t('cicdview.all_products')" class="page-deployments__filter" name="cicd-filter-product"
          />
        </template>
        <template #default="{ period }">
        <CicdStatus
          v-if="mode === 'status'"
          :key="refreshKey"
          :line-id="lineId"
          :product-id="productId"
          :period="period"
          generate-here
          @generate="askGenerate"
        />

        <section v-else class="ln-block" name="cicd-config">
          <header class="ln-block__head">
            <span class="ln-block__title">{{ $t('cicdview.cfg_scheduler') }}</span><span class="ln-block__rule" />
            <span class="ln-row__note">{{ $t('cicdview.cfg_admin') }}</span>
          </header>
          <InstanceSettingsForm v-if="admin" group="scheduler" />
          <p v-else class="ln-block__empty">{{ $t('cicdview.cfg_scheduler_none') }}</p>
        </section>
        </template>
      </CicdFrame>
    </div>

    <GeneratePreviewDialog
      v-if="toGenerate.length"
      v-model:visible="generateOpen"
      :products="toGenerate"
      @confirm="startGeneration"
    />

    <GenerationResultDialog
      v-if="queueRuns.length"
      v-model:visible="runsOpen"
      :runs="queueRuns"
      @minimize="runsOpen = false"
      @rollback="rollbackRun"
      @cancel="(id) => generationStore.cancel(id)"
      @retry="queueAgain"
      @error="(code) => notify({ type: 'negative', message: t(code), position: 'bottom-right' })"
    />

  </div>
</template>

<style scoped lang="scss">
.page-deployments {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 14px 0 0;

  // the page scrolls as one, as the home page does
  &__main {
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
    // the same margins as the panels of the product and line tabs
    padding: 18px 24px 28px;
  }
}

.page-deployments__filter { min-width: 11rem; max-width: 16rem; }

.page-deployments :deep(.header) {
  padding-left: 24px;
  padding-right: 24px;
}
</style>
