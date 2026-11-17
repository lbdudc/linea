import { describe, it, expect } from 'vitest'
import { InvalidArgumentError, planLineRestoration, planProductRestoration } from '../src/index.js'

const host = { namespaceIsRepository: false }
const inGroup = (id: string, repositoryId: number, namespaceId: number) => ({ id, repositoryId, namespaceId, repositoryScheduled: false, namespaceScheduled: false })
const onItsOwn = (id: string, repositoryId: number, namespaceId: number) => ({ id, repositoryId, namespaceId, repositoryScheduled: true, namespaceScheduled: true })

describe('planLineRestoration', () => {
  it('with the whole group scheduled, the group brings everything back at once', () => {
    const line = { repositoryId: 1, namespaceId: 10, repositoryScheduled: false, namespaceScheduled: true }

    const plan = planLineRestoration({ line, products: [inGroup('a', 2, 20), inGroup('b', 3, 30)], host })

    expect(plan.steps).toEqual([{ action: 'restore', kind: 'namespace', id: 10 }])
    expect(plan.restoredProductIds).toEqual(['a', 'b'])
    expect(plan.pendingProductIds).toEqual([])
  })

  it('a product left out of a scheduled group is scheduled again, after the group is back', () => {
    const line = { repositoryId: 1, namespaceId: 10, repositoryScheduled: false, namespaceScheduled: true }

    const plan = planLineRestoration({ line, products: [inGroup('a', 2, 20), inGroup('b', 3, 30)], restoreProductIds: ['a'], host })

    expect(plan.steps).toEqual([
      { action: 'restore', kind: 'namespace', id: 10 },
      { action: 'delete', kind: 'repository', id: 3 },
      { action: 'delete', kind: 'namespace', id: 30 },
    ])
    expect(plan.pendingProductIds).toEqual(['b'])
  })

  it('things scheduled one by one come back one by one, the group before what is in it', () => {
    const line = { repositoryId: 1, namespaceId: 10, repositoryScheduled: true, namespaceScheduled: false }

    const plan = planLineRestoration({ line, products: [onItsOwn('a', 2, 20), onItsOwn('b', 3, 30)], restoreProductIds: ['a'], host })

    expect(plan.steps).toEqual([
      { action: 'restore', kind: 'repository', id: 1 },
      { action: 'restore', kind: 'namespace', id: 20 },
      { action: 'restore', kind: 'repository', id: 2 },
    ])
    expect(plan.pendingProductIds).toEqual(['b'])
  })

  it('a product scheduled by itself inside a scheduled group keeps waiting when left out', () => {
    const line = { repositoryId: 1, namespaceId: 10, repositoryScheduled: false, namespaceScheduled: true }

    const plan = planLineRestoration({ line, products: [onItsOwn('a', 2, 20)], restoreProductIds: [], host })

    expect(plan.steps).toEqual([{ action: 'restore', kind: 'namespace', id: 10 }])
  })

  it('refuses a product that is not waiting in the line, before planning anything', () => {
    const line = { repositoryId: 1, namespaceId: 10, repositoryScheduled: true, namespaceScheduled: false }

    expect(() => planLineRestoration({ line, products: [], restoreProductIds: ['x'], host })).toThrow(InvalidArgumentError)
  })
})

describe('planProductRestoration', () => {
  it('brings back its group and then its repository', () => {
    expect(planProductRestoration({ product: onItsOwn('a', 2, 20) })).toEqual([
      { action: 'restore', kind: 'namespace', id: 20 },
      { action: 'restore', kind: 'repository', id: 2 },
    ])
  })
})
