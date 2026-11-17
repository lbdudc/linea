<script>
import { usePortfolio, refresh, refreshIfStale } from 'src/composables/usePortfolio'
import productService from 'src/services/productService'
import { formatDate } from 'src/services/utils'
import { notify } from 'src/composables/useNotify'
import ProductTable from 'components/product/ProductTable.vue'
import PageHeader from 'components/layout/PageHeader.vue'

export default {
  name: 'ProductManagement',
  components: { ProductTable, PageHeader },
  setup() {
    const { products, productsLoading } = usePortfolio()
    return { portfolioProducts: products, loading: productsLoading }
  },
  data() {
    return { inactiveProducts: [], inactiveLoading: true }
  },
  computed: {
    products() {
      return this.portfolioProducts ?? []
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
        this.inactiveProducts = (await productService.findInactiveProducts()).map((product) => ({
          ...product,
          createdAt: product.createdAt ? formatDate(product.createdAt) : '—',
        }))
      } catch (error) {
        this.inactiveProducts = []
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
      } finally {
        this.inactiveLoading = false
      }
    },
  },
}
</script>

<template>
  <div class="page-products">
    <PageHeader compact :title="$t('labels.product_management')" />

    <ProductTable :tableData="products" :inactive-products="inactiveProducts" :inactive-loading="inactiveLoading" :loading="loading" @restored="onRestored" />
  </div>
</template>

<style scoped>
.page-products {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 30px 36px 0;
  gap: 22px;
}

@media (max-width: 600px) {
  .page-products {
    padding: 18px 16px 0;
    gap: 16px;
  }
}
</style>
