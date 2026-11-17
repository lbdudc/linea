import {
  planLineDeletion, planProductDeletion,
  type DeletableLine, type DeletableProduct, type DeletionStep, type LineDeletionPlan
} from '@lbdudc/linea-core'
import type { GitProvider, Id } from './provider.js'

const isAlreadyGone = (error: unknown): boolean => {
  const { status, message } = error as { status?: number, message?: string }
  return status === 404 || (status === 400 && /already (been )?marked for deletion/i.test(message ?? ''))
}

const run = async ({ provider, token, steps }: { provider: GitProvider, token: string, steps: DeletionStep[] }): Promise<void> => {
  for (const { kind, id } of steps) {
    try {
      if (kind === 'repository') await provider.deleteRepository({ token, id })
      else await provider.deleteNamespace({ token, id })
    } catch (error) {
      if (!isAlreadyGone(error)) throw error
    }
  }
}

export const deleteLineOnHost = async ({ provider, token, line, products, keepProductIds }: {
  provider: GitProvider
  token: string
  line: DeletableLine
  products: DeletableProduct[]
  keepProductIds?: string[]
}): Promise<LineDeletionPlan> => {
  const plan = planLineDeletion({ line, products, keepProductIds: keepProductIds ?? [], host: provider.capabilities().deletion })
  await run({ provider, token, steps: plan.steps })
  return plan
}

export const deleteProductOnHost = ({ provider, token, product }: {
  provider: GitProvider
  token: string
  product: Pick<DeletableProduct, 'repositoryId' | 'namespaceId'>
}): Promise<void> => run({ provider, token, steps: planProductDeletion({ product, host: provider.capabilities().deletion }) })

export const deleteEmptyLineNamespace = ({ provider, token, namespaceId }: { provider: GitProvider, token: string, namespaceId: Id }): Promise<void> => (
  run({ provider, token, steps: [{ kind: 'namespace', id: namespaceId }] })
)
