import { planLineRestoration, planProductRestoration, type LineRestorationPlan, type RestorationStep } from '@lbdudc/linea-core'
import type { GitProvider, PendingDeletion } from './provider.js'

const run = async ({ provider, token, steps }: { provider: GitProvider, token: string, steps: RestorationStep[] }): Promise<void> => {
  for (const { action, kind, id } of steps) {
    if (action === 'delete') {
      if (kind === 'repository') await provider.deleteRepository({ token, id })
      else await provider.deleteNamespace({ token, id })
    } else if (kind === 'repository') await provider.restoreRepository({ token, id })
    else await provider.restoreNamespace({ token, id })
  }
}

const itemOf = ({ id, namespaceId, repositoryScheduled, namespaceScheduled }: PendingDeletion) => ({
  repositoryId: id,
  namespaceId: namespaceId as string | number,
  repositoryScheduled,
  namespaceScheduled,
})

export const restoreLineOnHost = async ({ provider, token, line, products, restoreProductIds }: {
  provider: GitProvider
  token: string
  line: PendingDeletion
  products: PendingDeletion[]
  restoreProductIds?: string[]
}): Promise<LineRestorationPlan> => {
  const plan = planLineRestoration({
    line: itemOf(line),
    products: products.map((product) => ({ id: String(product.id), ...itemOf(product) })),
    ...(restoreProductIds ? { restoreProductIds } : {}),
    host: provider.capabilities().deletion,
  })
  await run({ provider, token, steps: plan.steps })
  return plan
}

export const restoreProductOnHost = ({ provider, token, product }: { provider: GitProvider, token: string, product: PendingDeletion }): Promise<void> => (
  run({ provider, token, steps: planProductRestoration({ product: itemOf(product) }) })
)
