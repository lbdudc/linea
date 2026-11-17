import { computed } from 'vue'
import { usePortfolio, healthOf, lineHealth } from 'src/composables/usePortfolio'
import generationStore from 'stores/generationStore'

export function useDashboard() {
  const { lines, products, linesLoading, productsLoading, healthLoading } = usePortfolio()

  const totalLines = computed(() => (lines.value || []).length)
  const totalProducts = computed(() => (products.value || []).length)
  const healthyCount = computed(() => (products.value || []).filter((p) => healthOf(p).isHealthy).length)
  const issueCount = computed(() => (products.value || []).filter((p) => healthOf(p).hasIssue).length)

  const linesWithHealth = computed(() => {
    if (!lines.value) return []
    return lines.value.map((line) => {
      const { total, ok, bad } = lineHealth(line)
      return { ...line, total, healthy: ok, issues: bad }
    })
  })

  const productsEnriched = computed(() => {
    if (!products.value) return []
    return products.value.map((p) => {
      const { health, conflicts, isHealthy, hasIssue } = healthOf(p)
      return { ...p, health, conflicts, isHealthy, hasIssue }
    })
  })

  const productsWithIssues = computed(() => productsEnriched.value.filter((p) => p.hasIssue))

  const activeDeployments = computed(() =>
    generationStore.jobs.filter((j) => ['pending', 'running'].includes(j.status))
  )

  const recentDeployments = computed(() =>
    generationStore.jobs
      .filter((j) => ['success', 'warning', 'error'].includes(j.status))
      .slice(0, 4)
  )

  return {
    lines, products, linesLoading, productsLoading, healthLoading,
    totalLines, totalProducts, healthyCount, issueCount,
    linesWithHealth,
    productsWithIssues,
    activeDeployments, recentDeployments,
  }
}
