import { computed } from 'vue'
import generationStore from 'stores/generationStore'
import runStore from 'stores/runStore'
import { lastDeployment } from 'stores/lastDeployment'

const OUTCOME_OF_STATUS = { success: 'success', warning: 'warning', error: 'error' }

export function useRunningActivity() {
  const running = computed(() => [
    ...generationStore.jobs
      .filter((job) => job.status === 'pending' || job.status === 'running')
      .map((job) => ({ id: job.id, kind: 'generation', state: job.status, productId: job.productId, name: job.productName, line: job.lineName })),
    ...runStore.runs.map((run) => ({ id: run.id, kind: run.kind, state: 'running', productId: run.productId, name: run.productName, line: run.lineName })),
  ])

  const last = computed(() => {
    const finished = generationStore.jobs.find((job) => OUTCOME_OF_STATUS[job.status] && job.finishedAt)
    const fromSession = finished
      ? {
        productId: finished.productId,
        productName: finished.productName,
        version: finished.toVersion || finished.fromVersion,
        outcome: OUTCOME_OF_STATUS[finished.status],
        deployedAt: finished.finishedAt,
      }
      : null
    const known = lastDeployment.value
    if (fromSession && (!known || new Date(fromSession.deployedAt) >= new Date(known.deployedAt))) return fromSession
    return known
  })

  return { running, last }
}
