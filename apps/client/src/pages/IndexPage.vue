<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useDashboard } from 'src/composables/useDashboard'
import { useGenerationsChart } from 'src/composables/useGenerationsChart'
import { useAttentionInbox } from 'src/composables/useAttentionInbox'
import { refreshIfStale } from 'src/composables/usePortfolio'
import FirstRunChecklist from 'components/dashboard/FirstRunChecklist.vue'
import GenerationsChart from 'src/components/dashboard/GenerationsChart.vue'
import LineBreakdown from 'src/components/dashboard/LineBreakdown.vue'
import SuccessTrend from 'src/components/dashboard/SuccessTrend.vue'
import TopFailing from 'src/components/dashboard/TopFailing.vue'
import SyncFreshnessPanel from 'src/components/dashboard/SyncFreshnessPanel.vue'
import AttentionInbox from 'components/home/AttentionInbox.vue'
import HomeViewSwitch from 'components/home/HomeViewSwitch.vue'
import LinesHealthCard from 'components/home/LinesHealthCard.vue'
import NeedYouPill from 'components/home/NeedYouPill.vue'
import { useDashboardSummary, changeBetween } from 'src/composables/useDashboardSummary'
import { useDeploymentsOverview } from 'src/composables/useDeploymentsOverview'
import { homeView } from 'stores/homeView'

const {
  lines: portfolioLines,
  products: portfolioProducts,
  linesLoading, productsLoading, healthLoading,
  linesWithHealth,
} = useDashboard()

const deployments = useDeploymentsOverview({ source: portfolioProducts })
let deploymentsAsked = false
watch(() => (portfolioProducts.value ?? []).length, (count) => {
  if (count > 0 && !deploymentsAsked) { deploymentsAsked = true; deployments.load() }
}, { immediate: true })

const FIRST_RUN_KEY = 'linea.firstRun.dismissed'
const readDismissed = () => {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === '1'
  } catch {
    return false
  }
}
const firstRunDismissed = ref(readDismissed())
const dismissFirstRun = () => {
  firstRunDismissed.value = true
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1')
  } catch {
    firstRunDismissed.value = true
  }
}
const showFirstRun = computed(() => !firstRunDismissed.value
  && !linesLoading.value
  && !productsLoading.value
  && Boolean(portfolioLines.value)
  && !(portfolioProducts.value ?? []).some((product) => product.version && product.version !== '0.0.0'))

const PERIOD_OPTIONS = [7, 30, 90]
const generationsPeriod = ref(30)

const { summary: overview, loading: summaryLoading } = useDashboardSummary(generationsPeriod)
const { days: generationsDays, maxTotal: generationsMaxTotal } = useGenerationsChart({ summary: overview, period: generationsPeriod })
const generationsLoading = computed(() => summaryLoading.value && !overview.value)
const summaryPending = computed(() => summaryLoading.value && !overview.value)

const current = computed(() => overview.value?.deployments?.current ?? null)
const previous = computed(() => overview.value?.deployments?.previous ?? null)
const volumeDelta = computed(() => changeBetween(current.value?.total, previous.value?.total, { mode: 'relative' }))
const rateDelta = computed(() => changeBetween(current.value?.successRate, previous.value?.successRate, { mode: 'points' }))

const inboxFilter = ref('all')
const { all: inboxAll, visible: inboxVisible, counts: inboxCounts } = useAttentionInbox({
  products: portfolioProducts,
  pending: deployments.pending,
  failing: deployments.failing,
  filter: inboxFilter,
})
const inboxLoading = computed(() => productsLoading.value || healthLoading.value || deployments.loading.value)

watch(inboxAll, () => { if (inboxFilter.value !== 'all' && inboxCounts.value[inboxFilter.value] === 0) inboxFilter.value = 'all' })

const showInbox = computed(() => homeView.view !== 'panel')
const showPanel = computed(() => homeView.view !== 'inbox')
const chartHeight = computed(() => (homeView.view === 'panel' ? 260 : 112))

const lineCards = computed(() => {
  const severityById = new Map(inboxAll.value.map((item) => [item.id, item.severity]))
  const ratesByName = new Map((overview.value?.deployments?.byLine ?? []).map((line) => [line.name, line.successRate]))
  return linesWithHealth.value.map((line) => {
    const own = (portfolioProducts.value ?? []).filter((product) => product.line === line.name)
    let ok = 0
    let warn = 0
    let bad = 0
    for (const product of own) {
      const severity = severityById.get(String(product._id))
      if (severity === 3) bad += 1
      else if (severity) warn += 1
      else ok += 1
    }
    return { id: String(line._id), name: line.name, ok, warn, bad, total: own.length, rate: ratesByName.get(line.name) ?? null }
  })
})

onMounted(() => {
  refreshIfStale()
})
</script>

<template>
  <div class="dashboard">
    <div class="dashboard__scroll">
      <div class="dashboard__bar">
        <NeedYouPill v-if="homeView.view === 'panel'" :count="inboxAll.length" />
        <HomeViewSwitch />
      </div>

      <FirstRunChecklist
        v-if="showFirstRun"
        :lines="portfolioLines"
        :products="portfolioProducts ?? []"
        @dismiss="dismissFirstRun"
      />

      <div class="dashboard__content">
        <AttentionInbox
          v-if="showInbox"
          v-model:filter="inboxFilter"
          :items="inboxVisible"
          :total="inboxAll.length"
          :counts="inboxCounts"
          :loading="inboxLoading && inboxAll.length === 0"
        />

        <template v-if="showPanel">
          <div class="dashboard__cards">
            <LinesHealthCard class="dashboard__lines" :lines="lineCards" />
            <section class="dashboard__generations">
              <GenerationsChart
                v-model:period="generationsPeriod"
                :periods="PERIOD_OPTIONS"
                :days="generationsDays"
                :max-total="generationsMaxTotal"
                :loading="generationsLoading"
                :delta="volumeDelta"
                :height="chartHeight"
                :success-rate="current?.successRate ?? null"
                :rate-delta="rateDelta"
              />
            </section>
          </div>

          <div class="dashboard__insights">
            <SuccessTrend class="insight insight--trend" :days="generationsDays" :loading="generationsLoading" />
            <LineBreakdown
              class="insight insight--line"
              :lines="overview?.deployments?.byLine ?? []"
              :days="generationsPeriod"
              :loading="summaryPending"
            />
            <TopFailing
              class="insight insight--top"
              :products="overview?.deployments?.topFailing ?? []"
              :days="generationsPeriod"
              :loading="summaryPending"
            />
            <SyncFreshnessPanel
              class="insight insight--fresh"
              :staleness="overview?.products?.staleness"
              :stalest="overview?.products?.stalest ?? []"
              :loading="summaryPending"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dashboard {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.dashboard__scroll {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 20px 36px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  container: dash / inline-size;
}

.dashboard__bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: -4px;
}

.dashboard__content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.dashboard__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.dashboard__lines {
  flex: 1 1 320px;
}

.dashboard__generations {
  flex: 2 1 420px;
  min-width: 0;
  padding: 10px 14px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  background: var(--p-content-background);
}

.dashboard__insights {
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  gap: 14px;
}

.insight {
  grid-column: span 20;
  min-width: 0;
  box-sizing: border-box;
  padding: 10px 14px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  background: var(--p-content-background);
}

@container dash (min-width: 700px) {
  .insight--line,
  .insight--top { grid-column: span 10; }
}

@container dash (min-width: 1000px) {
  .insight--trend { grid-column: span 12; }
  .insight--line { grid-column: span 8; }
  .insight--top,
  .insight--fresh { grid-column: span 10; }
}

@container dash (min-width: 1500px) {
  .insight--trend { grid-column: span 6; }
  .insight--line { grid-column: span 4; }
  .insight--top,
  .insight--fresh { grid-column: span 5; }
}
</style>
