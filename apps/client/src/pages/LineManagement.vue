<script>
import Button from 'primevue/button'
import lineService from 'src/services/lineService'
import { formatDate } from 'src/services/utils'
import { notify } from 'src/composables/useNotify'
import { usePortfolio, refresh, refreshIfStale } from 'src/composables/usePortfolio'
import LineTable from 'components/line/LineTable.vue'
import PageHeader from 'components/layout/PageHeader.vue'

export default {
  name: 'LineManagement',
  components: { LineTable, PageHeader, PrimeButton: Button },
  // the lines are the ones the sidebar already holds: opening the page asks again only when they are older than a minute
  setup() {
    const { lines, linesLoading } = usePortfolio()
    return { portfolioLines: lines, loading: linesLoading }
  },
  data() {
    return { inactiveLines: [], inactiveLoading: true }
  },
  computed: {
    lines() {
      return this.portfolioLines ?? []
    },
  },
  mounted() {
    refreshIfStale()
    this.loadInactive()
  },
  methods: {
    onRestored() {
      refresh()
      this.loadInactive()
    },
    async loadInactive() {
      this.inactiveLoading = true
      try {
        this.inactiveLines = (await lineService.findInactiveLines()).map((line) => ({
          ...line,
          createdAtRaw: line.createdAt,
          createdAt: line.createdAt ? formatDate(line.createdAt) : '—',
        }))
      } catch (error) {
        this.inactiveLines = []
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
      } finally {
        this.inactiveLoading = false
      }
    },
  },
}
</script>

<template>
  <div class="page-lines">
    <PageHeader compact :title="$t('labels.line_management')">
      <template #actions>
        <PrimeButton
          :label="$t('labels.spl_add')"
          icon="pi pi-plus"
          @click="$router.push('/add')"
        />
      </template>
    </PageHeader>

    <LineTable :tableData="lines" :inactive-lines="inactiveLines" :inactive-loading="inactiveLoading" :loading="loading" @restored="onRestored" />
  </div>
</template>

<style scoped>
.page-lines {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 30px 36px 0;
  gap: 22px;
}

@media (max-width: 600px) {
  .page-lines {
    padding: 18px 16px 0;
    gap: 16px;
  }
}
</style>
