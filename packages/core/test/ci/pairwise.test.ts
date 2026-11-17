import { describe, expect, it } from 'vitest'
import { completeSelection, pairwiseSelections, parseUvl, validateSelection } from '../../src/index.js'

const tree = parseUvl({
  content: 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tBanner\n\t\t\tPayments\n\t\t\t\talternative\n\t\t\t\t\tCard\n\t\t\t\t\tPaypal\n\t\t\tGift\nconstraints\n\tGift => Payments\n'
})

describe('pairwiseSelections', () => {
  const samples = pairwiseSelections({ tree, base: ['Shop'] })

  it('gives valid configurations only', () => {
    expect(samples.length).toBeGreaterThan(0)
    for (const features of samples) expect(validateSelection({ tree, features }), features.join()).toEqual([])
  })

  it('covers every pair of features that the model allows together, and each feature on its own', () => {
    const base = completeSelection({ tree, features: ['Shop'] })
    const all = [base, ...samples.map((features) => completeSelection({ tree, features }))]
    const names = ['Core', 'Banner', 'Payments', 'Card', 'Paypal', 'Gift']
    for (const a of names) {
      expect(all.some((on) => on.has(a)), a).toBe(true)
      for (const b of names) {
        // Card and Paypal are alternatives: they never go together
        if (new Set([a, b]).size === 2 && [a, b].every((n) => n === 'Card' || n === 'Paypal')) continue
        expect(all.some((on) => on.has(a) && on.has(b)), `${a}+${b}`).toBe(true)
      }
    }
  })

  it('stays within max', () => {
    expect(pairwiseSelections({ tree, base: ['Shop'], max: 2 })).toHaveLength(2)
  })
})
