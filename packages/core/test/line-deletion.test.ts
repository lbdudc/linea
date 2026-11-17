import { describe, it, expect } from 'vitest'
import { InvalidArgumentError, planLineDeletion, planProductDeletion } from '../src/index.js'

const line = { repositoryId: 1, namespaceId: 10 }
const products = [
  { id: 'a', repositoryId: 2, namespaceId: 20 },
  { id: 'b', repositoryId: 3, namespaceId: 30 },
]
const nested = { namespaceIsRepository: false }
const flat = { namespaceIsRepository: true }

describe('planLineDeletion', () => {
  it('with nothing to keep, the namespace of the line takes everything at once', () => {
    expect(planLineDeletion({ line, products, host: nested })).toEqual({
      steps: [{ kind: 'namespace', id: 10 }],
      deletedProductIds: ['a', 'b'],
      keptProductIds: [],
      lineSurvives: false,
    })
  })

  it('a product to keep leaves the namespace in place: the rest goes one by one, the line last', () => {
    expect(planLineDeletion({ line, products, keepProductIds: ['b'], host: nested })).toEqual({
      steps: [{ kind: 'repository', id: 2 }, { kind: 'namespace', id: 20 }, { kind: 'repository', id: 1 }],
      deletedProductIds: ['a'],
      keptProductIds: ['b'],
      lineSurvives: true,
    })
  })

  it('where a namespace is a repository, a product goes in one step', () => {
    expect(planLineDeletion({ line, products, keepProductIds: ['b'], host: flat }).steps).toEqual([
      { kind: 'namespace', id: 20 },
      { kind: 'repository', id: 1 },
    ])
  })

  it('keeping every product deletes only the repository of the line', () => {
    expect(planLineDeletion({ line, products, keepProductIds: ['a', 'b'], host: nested }).steps).toEqual([{ kind: 'repository', id: 1 }])
  })

  it('refuses to keep a product that is not of the line', () => {
    expect(() => planLineDeletion({ line, products, keepProductIds: ['other'], host: nested })).toThrow(InvalidArgumentError)
  })
})

describe('planProductDeletion', () => {
  it('takes the repository and then the namespace that holds it', () => {
    expect(planProductDeletion({ product: products[0]!, host: nested })).toEqual([{ kind: 'repository', id: 2 }, { kind: 'namespace', id: 20 }])
  })

  it('takes only the namespace where it is the repository', () => {
    expect(planProductDeletion({ product: products[0]!, host: flat })).toEqual([{ kind: 'namespace', id: 20 }])
  })
})
