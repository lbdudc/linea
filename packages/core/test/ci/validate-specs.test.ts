import { describe, expect, it } from 'vitest'
import { ablateFeature, activateFeature, parseUvl, validateProductSelections } from '../../src/index.js'

const UVL = `features
\tShop
\t\tmandatory
\t\t\tCore
\t\toptional
\t\t\tBanner
\t\t\tPayments
\t\t\t\talternative
\t\t\t\t\tCard
\t\t\t\t\tPaypal
\t\t\tGift
constraints
\tGift => Payments
`

const check = (name: string, features: string[] | Record<string, boolean>): string[] =>
  (validateProductSelections({ featureModel: UVL, products: [{ name, features }] })[0]?.problems ?? []).map(({ message }) => message)

describe('validateProductSelections', () => {
  it('accepts valid selections', () => {
    expect(check('a', ['Shop', 'Core'])).toEqual([])
    expect(check('b', ['Shop', 'Core', 'Payments', 'Card', 'Gift'])).toEqual([])
    expect(check('c', { Shop: true, Core: true, Banner: false })).toEqual([])
  })

  it('adds what the model implies before checking: the root, ancestors, mandatory children and what constraints need', () => {
    expect(check('a', ['Core'])).toEqual([])
    expect(check('a', ['Shop'])).toEqual([])
    expect(check('a', ['Shop', 'Core', 'Card'])).toEqual([])
    expect(check('a', ['Gift', 'Card'])).toEqual([])
  })

  it('reports unknown features and groups that were not decided', () => {
    expect(check('a', ['Shop', 'Core', 'Nope'])).toEqual(['"Nope" is not a feature of the model.'])
    expect(check('a', ['Shop', 'Core', 'Payments'])[0]).toMatch(/alternative group of "Payments" needs 1 of Card, Paypal; 0 selected/)
    expect(check('a', ['Shop', 'Core', 'Payments', 'Card', 'Paypal'])[0]).toMatch(/2 selected/)
  })

  it('reports what a constraint brings that leaves a group undecided', () => {
    expect(check('a', ['Shop', 'Core', 'Gift'])[0]).toMatch(/alternative group of "Payments"/)
  })
})

describe('violated constraints', () => {
  it('are reported when no completion can fix them', () => {
    const uvl = 'features\n\tShop\n\t\toptional\n\t\t\tA\n\t\t\tB\nconstraints\n\t!(A & B)\n'
    const [report] = validateProductSelections({ featureModel: uvl, products: [{ name: 'x', features: ['Shop', 'A', 'B'] }] })
    expect(report?.problems.map(({ message }) => message)).toEqual(['Constraint not satisfied: !(A & B).'])
  })
})

describe('ablateFeature', () => {
  const tree = parseUvl({ content: UVL })

  it('takes a feature out with what hangs from it', () => {
    expect(ablateFeature({ tree, features: ['Shop', 'Core', 'Payments', 'Card'], feature: 'Payments' })?.sort()).toEqual(['Core', 'Shop'])
    expect(ablateFeature({ tree, features: ['Shop', 'Core', 'Banner'], feature: 'Banner' })?.sort()).toEqual(['Core', 'Shop'])
  })

  it('is undefined when the model does not allow the product without it', () => {
    expect(ablateFeature({ tree, features: ['Shop', 'Core'], feature: 'Core' })).toBeUndefined()
    expect(ablateFeature({ tree, features: ['Shop', 'Core'], feature: 'Banner' })).toBeUndefined()
    expect(ablateFeature({ tree, features: ['Shop', 'Core'], feature: 'Shop' })).toBeUndefined()
    expect(ablateFeature({ tree, features: ['Shop', 'Core', 'Payments', 'Card', 'Gift'], feature: 'Payments' })).toBeUndefined()
  })
})

describe('activateFeature', () => {
  const tree = parseUvl({ content: UVL })

  it('makes a valid selection with the feature and what has to come with it', () => {
    expect(activateFeature({ tree, features: ['Shop', 'Core'], feature: 'Banner' })?.sort()).toEqual(['Banner', 'Core', 'Shop'])
    // Payments asks for a choice between Card and Paypal: the first one is taken
    expect(activateFeature({ tree, features: ['Shop', 'Core'], feature: 'Payments' })?.sort()).toEqual(['Card', 'Core', 'Payments', 'Shop'])
    // Gift needs Payments, which needs a choice
    expect(activateFeature({ tree, features: ['Shop', 'Core'], feature: 'Gift' })?.sort()).toEqual(['Card', 'Core', 'Gift', 'Payments', 'Shop'])
  })

  it('is undefined for a feature that is not in the model or that the constraints forbid', () => {
    expect(activateFeature({ tree, features: ['Shop'], feature: 'Nope' })).toBeUndefined()
    const forbidding = parseUvl({ content: 'features\n\tShop\n\t\toptional\n\t\t\tA\n\t\t\tB\nconstraints\n\tA => !A\n' })
    expect(activateFeature({ tree: forbidding, features: ['Shop'], feature: 'A' })).toBeUndefined()
  })
})
