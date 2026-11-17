import { featuresOf, type FeatureModelTree } from '../feature-model/uvl.js'
import { activateFeature, completeSelection } from './validate-specs.js'

/**
 * A set of valid configurations that has every pair of features together at least once (and every feature on its own): the usual sample to
 * look for interactions between features that no real product exercises. Greedy: each uncovered pair gets a configuration made of the least
 * that has both, which covers whatever else it happens to contain. A pair the model forbids is skipped. `max` caps how many are returned.
 */
export const pairwiseSelections = ({ tree, base = [], max = 50 }: { tree: FeatureModelTree, base?: readonly string[], max?: number }): string[][] => {
  const names = featuresOf({ tree }).map(({ name }) => name).filter((name) => name !== tree.root.name)
  const pairKey = (a: string, b: string): string => (a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
  const pairsOf = (selection: ReadonlySet<string>): string[] => {
    const on = names.filter((name) => selection.has(name))
    return on.flatMap((a, i) => on.slice(i).map((b) => pairKey(a, b)))
  }

  const covered = new Set<string>(pairsOf(completeSelection({ tree, features: base })))
  const configurations: string[][] = []
  for (let i = 0; i < names.length && configurations.length < max; i++) {
    for (let j = i; j < names.length && configurations.length < max; j++) {
      const [a, b] = [names[i]!, names[j]!]
      if (covered.has(pairKey(a, b))) continue
      const withA = activateFeature({ tree, features: base, feature: a })
      const both = withA === undefined ? undefined : a === b ? withA : activateFeature({ tree, features: withA, feature: b })
      // what cannot be had is not tried again
      covered.add(pairKey(a, b))
      if (both === undefined) continue
      configurations.push(both)
      for (const key of pairsOf(new Set(both))) covered.add(key)
    }
  }
  return configurations
}
