import { InvalidArgumentError } from '../errors.js'
import { planProductDeletion, type DeletionStep, type HostDeletionTraits, type HostId } from './deletion.js'

export interface PendingItem {
  repositoryId: HostId
  namespaceId: HostId
  repositoryScheduled: boolean
  namespaceScheduled: boolean
}

export interface PendingProduct extends PendingItem {
  id: string
}

export interface RestorationStep extends DeletionStep {
  action: 'restore' | 'delete'
}

export interface LineRestorationPlan {
  steps: RestorationStep[]
  restoredProductIds: string[]
  pendingProductIds: string[]
}

const restoring = ({ repositoryId, namespaceId, repositoryScheduled, namespaceScheduled }: PendingItem): RestorationStep[] => [
  ...(namespaceScheduled ? [{ action: 'restore' as const, kind: 'namespace' as const, id: namespaceId }] : []),
  ...(repositoryScheduled ? [{ action: 'restore' as const, kind: 'repository' as const, id: repositoryId }] : []),
]

export const planProductRestoration = ({ product }: { product: PendingItem }): RestorationStep[] => restoring(product)

export const planLineRestoration = ({ line, products, restoreProductIds, host }: {
  line: PendingItem
  products: PendingProduct[]
  restoreProductIds?: string[]
  host: HostDeletionTraits
}): LineRestorationPlan => {
  const known = new Set(products.map((product) => product.id))
  const stranger = restoreProductIds?.find((id) => !known.has(id))
  if (stranger !== undefined) throw new InvalidArgumentError(`The product to restore "${stranger}" is not waiting to be deleted in this line.`)

  const wanted = new Set(restoreProductIds ?? known)
  const chosen = products.filter((product) => wanted.has(product.id))
  const left = products.filter((product) => !wanted.has(product.id))
  const comesBackWithLine = (product: PendingProduct): boolean => line.namespaceScheduled && !product.repositoryScheduled && !product.namespaceScheduled

  return {
    steps: [
      ...restoring(line),
      ...chosen.flatMap(restoring),
      ...left.filter(comesBackWithLine).flatMap((product) => (
        planProductDeletion({ product, host }).map((step): RestorationStep => ({ action: 'delete', ...step }))
      )),
    ],
    restoredProductIds: chosen.map((product) => product.id),
    pendingProductIds: left.map((product) => product.id),
  }
}
