import { ref, shallowRef, computed } from 'vue'
import productService from 'src/services/productService'
import { ciMap, deploymentsMap, ensureDeployments, invalidateDeployments, loadCi } from 'src/composables/usePortfolio'

const GROUP = 20

const groups = (ids) => {
  const out = []
  for (let i = 0; i < ids.length; i += GROUP) out.push(ids.slice(i, i + GROUP))
  return out
}

// What the deployments page knows about the products as a whole, beyond the history: which of them have saved changes that no
// generation has put in their code, and how the pipeline of each one is. Best effort: a product that cannot be read is "unknown".
// `source`: a ref with the products another part of the app already loaded (the portfolio of the home page): they are not asked
// for again. Without it the list of enrolled products is read here.
export function useDeploymentsOverview({ source = null } = {}) {
  const own = shallowRef([])          // [{ id, name, version, line, lineId }]
  const deployments = ref({})         // id -> { pending, version, restorable }
  const pipelines = ref({})           // id -> { status, webUrl }
  const loading = shallowRef(false)

  const shape = (p) => ({ id: String(p._id), name: p.name, version: p.version, line: p.line, lineId: String(p.lineId ?? '') })
  const products = computed(() => (source ? (source.value ?? []).map(shape) : own.value))

  let loadedOnce = false

  async function load() {
    loading.value = true
    try {
      if (source) {
        // the first load joins what the portfolio has; a later one is a refresh
        if (loadedOnce) invalidateDeployments()
        loadedOnce = true
        // the portfolio already asks for these (once, shared by every page): this only waits for them
        await ensureDeployments()
        await loadCi(products.value.map((p) => p.id))
        deployments.value = deploymentsMap.value
        pipelines.value = ciMap.value
        return
      }
      const list = await productService.findEnrolledLines()
      own.value = (Array.isArray(list) ? list : []).map(shape)
      const ids = products.value.map((p) => p.id)
      const [deployed, piped] = await Promise.all([
        Promise.allSettled(groups(ids).map((group) => productService.getProductsDeployments({ ids: group }))),
        Promise.allSettled(groups(ids).map((group) => productService.getProductsPipelines({ ids: group }))),
      ])
      deployments.value = Object.assign({}, ...deployed.filter((r) => r.status === 'fulfilled').map((r) => r.value))
      pipelines.value = Object.assign({}, ...piped.filter((r) => r.status === 'fulfilled').map((r) => r.value))
    } catch {
      own.value = []
    } finally {
      loading.value = false
    }
  }

  // the products with saved changes nobody generated: what is left to deploy
  const pending = computed(() => products.value
    .filter((p) => deployments.value[p.id]?.pending === true)
    .map((p) => ({ ...p, pipeline: pipelines.value[p.id] ?? null })))

  // the products that failed their last pipeline
  const failing = computed(() => products.value
    .filter((p) => ['failed', 'canceled'].includes(pipelines.value[p.id]?.status))
    .map((p) => ({ ...p, pipeline: pipelines.value[p.id] })))

  const versionOf = (id) => products.value.find((p) => p.id === String(id))?.version ?? null

  return { products, pipelines, pending, failing, loading, load, versionOf }
}
