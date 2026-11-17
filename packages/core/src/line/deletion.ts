import { InvalidArgumentError } from '../errors.js'

export type HostId = string | number

export interface HostDeletionTraits {
  namespaceIsRepository: boolean
}

export interface DeletionStep {
  kind: 'repository' | 'namespace'
  id: HostId
}

export interface DeletableProduct {
  id: string
  repositoryId: HostId
  namespaceId: HostId
}

export interface DeletableLine {
  repositoryId: HostId
  namespaceId: HostId
}

export interface LineDeletionPlan {
  steps: DeletionStep[]
  deletedProductIds: string[]
  keptProductIds: string[]
  lineSurvives: boolean
}

export const planProductDeletion = ({ product, host }: { product: Pick<DeletableProduct, 'repositoryId' | 'namespaceId'>, host: HostDeletionTraits }): DeletionStep[] => (
  host.namespaceIsRepository
    ? [{ kind: 'namespace', id: product.namespaceId }]
    : [{ kind: 'repository', id: product.repositoryId }, { kind: 'namespace', id: product.namespaceId }]
)

export const planLineDeletion = ({ line, products, keepProductIds = [], host }: {
  line: DeletableLine
  products: DeletableProduct[]
  keepProductIds?: string[]
  host: HostDeletionTraits
}): LineDeletionPlan => {
  const known = new Set(products.map((product) => product.id))
  const stranger = keepProductIds.find((id) => !known.has(id))
  if (stranger !== undefined) throw new InvalidArgumentError(`The product to keep "${stranger}" is not one of the line.`)

  const keep = new Set(keepProductIds)
  const doomed = products.filter((product) => !keep.has(product.id))
  const kept = products.filter((product) => keep.has(product.id))
  const steps: DeletionStep[] = kept.length === 0
    ? [{ kind: 'namespace', id: line.namespaceId }]
    : [...doomed.flatMap((product) => planProductDeletion({ product, host })), { kind: 'repository', id: line.repositoryId }]

  return {
    steps,
    deletedProductIds: doomed.map((product) => product.id),
    keptProductIds: kept.map((product) => product.id),
    lineSurvives: kept.length > 0,
  }
}
