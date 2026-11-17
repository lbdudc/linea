import { parseUvl, type FeatureGroup, type FeatureModelTree, type FeatureNode, type Formula } from '../feature-model/uvl.js'

export interface SelectionProblem {
  readonly feature?: string
  readonly message: string
}

export interface ProductSelection {
  readonly name: string
  readonly features: readonly string[] | Readonly<Record<string, boolean>>
}

export interface ProductSelectionReport {
  readonly name: string
  readonly problems: SelectionProblem[]
}

const selectedNames = (features: ProductSelection['features']): Set<string> =>
  new Set(Array.isArray(features)
    ? features as readonly string[]
    : Object.entries(features as Record<string, boolean>).filter(([, on]) => on).map(([name]) => name))

const evaluate = (formula: Formula, on: ReadonlySet<string>): boolean => {
  if ('feature' in formula) return on.has(formula.feature)
  if ('not' in formula) return !evaluate(formula.not, on)
  const left = evaluate(formula.left, on)
  const right = evaluate(formula.right, on)
  switch (formula.operator) {
    case '&': return left && right
    case '|': return left || right
    case '=>': return !left || right
    case '<=>': return left === right
  }
}

const formulaLabel = (formula: Formula): string => {
  if ('feature' in formula) return formula.feature
  if ('not' in formula) return `!${formulaLabel(formula.not)}`
  return `(${formulaLabel(formula.left)} ${formula.operator} ${formulaLabel(formula.right)})`
}

const groupBounds = (group: FeatureGroup): { min: number, max: number } | undefined => {
  switch (group.kind) {
    case 'alternative': return { min: 1, max: 1 }
    case 'or': return { min: 1, max: group.features.length }
    case 'cardinality': return { min: group.min ?? 0, max: group.max ?? group.features.length }
    default: return undefined
  }
}

const checkNode = (node: FeatureNode, on: ReadonlySet<string>, problems: SelectionProblem[]): void => {
  for (const group of node.groups) {
    const chosen = group.features.filter(({ name }) => on.has(name))
    for (const child of group.features) {
      if (group.kind === 'mandatory' && !on.has(child.name)) {
        problems.push({ feature: child.name, message: `"${child.name}" is mandatory under "${node.name}" and is not selected.` })
      }
    }
    const bounds = groupBounds(group)
    if (bounds !== undefined && (chosen.length < bounds.min || chosen.length > bounds.max)) {
      problems.push({
        feature: node.name,
        message: `The ${group.kind} group of "${node.name}" needs ${bounds.min === bounds.max ? bounds.min : `${bounds.min} to ${bounds.max}`} of ${group.features.map(({ name }) => name).join(', ')}; ${chosen.length} selected.`
      })
    }
    for (const child of chosen) checkNode(child, on, problems)
  }
}

const allNames = (node: FeatureNode, into = new Set<string>()): Set<string> => {
  into.add(node.name)
  for (const group of node.groups) for (const child of group.features) allNames(child, into)
  return into
}

/**
 * What a constraint leaves no choice about, given what is selected: `A => B` with A selected needs B, a constraint that is a feature on its
 * own makes it mandatory, an `|` with one way left takes it. Where there is a choice nothing is added. (The rule of the feature selection
 * metamodel, so a spec is read the way the derivation reads it.)
 */
const establish = (formula: Formula, on: ReadonlySet<string>, add: (name: string) => void): void => {
  if (evaluate(formula, on) && !('operator' in formula && (formula.operator === '=>' || formula.operator === '&'))) return
  if ('feature' in formula) add(formula.feature)
  else if ('not' in formula) return
  else if (formula.operator === '&') { establish(formula.left, on, add); establish(formula.right, on, add) }
  else if (formula.operator === '=>') { if (evaluate(formula.left, on)) establish(formula.right, on, add) }
  else if (formula.operator === '<=>') {
    if (evaluate(formula.left, on)) establish(formula.right, on, add)
    if (evaluate(formula.right, on)) establish(formula.left, on, add)
  } else {
    const alternatives = (f: Formula): Formula[] => ('operator' in f && f.operator === '|' ? [...alternatives(f.left), ...alternatives(f.right)] : [f])
    const open = alternatives(formula).filter((alternative) => !('not' in alternative && 'feature' in alternative.not && on.has(alternative.not.feature)))
    if (open.length === 1) establish(open[0]!, on, add)
  }
}

/** The features a selection comes to once what the model implies is added: the root, the ancestors, what is mandatory, what the constraints need. */
export const completeSelection = ({ tree, features }: { tree: FeatureModelTree, features: ProductSelection['features'] }): Set<string> => {
  const on = selectedNames(features)
  on.add(tree.root.name)
  const nodes = new Map<string, FeatureNode>()
  const parents = new Map<string, string>()
  const index = (node: FeatureNode): void => {
    nodes.set(node.name, node)
    for (const group of node.groups) for (const child of group.features) { parents.set(child.name, node.name); index(child) }
  }
  index(tree.root)

  for (let changed = true; changed;) {
    changed = false
    const add = (name: string): void => { if (nodes.has(name) && !on.has(name)) { on.add(name); changed = true } }
    for (const name of [...on]) {
      const parent = parents.get(name)
      if (parent !== undefined) add(parent)
      for (const group of nodes.get(name)?.groups ?? []) if (group.kind === 'mandatory') group.features.forEach((child) => add(child.name))
    }
    for (const constraint of tree.constraints) establish(constraint, on, add)
  }
  return on
}

/**
 * Whether a feature selection is a valid configuration of a feature model: every feature exists and, once what the model implies is added
 * (`completeSelection`), the groups are respected and every cross-tree constraint holds. The rules flamapy applies, checked directly over
 * the tree, so a pipeline can validate every real product in milliseconds and with no Python runtime.
 */
export const validateSelection = ({ tree, features }: { tree: FeatureModelTree, features: ProductSelection['features'] }): SelectionProblem[] => {
  const known = allNames(tree.root)
  const problems: SelectionProblem[] = []
  for (const name of selectedNames(features)) {
    if (!known.has(name)) problems.push({ feature: name, message: `"${name}" is not a feature of the model.` })
  }
  const on = completeSelection({ tree, features })
  checkNode(tree.root, on, problems)
  for (const constraint of tree.constraints) {
    if (!evaluate(constraint, on)) problems.push({ message: `Constraint not satisfied: ${formulaLabel(constraint)}.` })
  }
  return problems
}

/** `validateSelection` over every product of an SPL, against the UVL of its feature model. */
export const validateProductSelections = ({ featureModel, products }: { featureModel: string, products: readonly ProductSelection[] }): ProductSelectionReport[] => {
  const tree = parseUvl({ content: featureModel })
  return products.map(({ name, features }) => ({ name, problems: validateSelection({ tree, features }) }))
}

/**
 * The selection of a product without one of its features (and what hangs from it), for measuring what that feature is worth: the code that
 * disappears is the code the feature brings. `undefined` when the model does not allow it (the feature is mandatory, or something that stays
 * needs it), because that product cannot be derived.
 */
export const ablateFeature = ({ tree, features, feature }: { tree: FeatureModelTree, features: ProductSelection['features'], feature: string }): string[] | undefined => {
  const removed = new Set<string>()
  const collect = (node: FeatureNode): void => { removed.add(node.name); for (const group of node.groups) group.features.forEach(collect) }
  const find = (node: FeatureNode): FeatureNode | undefined =>
    node.name === feature ? node : node.groups.flatMap((group) => group.features).map(find).find((found) => found !== undefined)
  const target = find(tree.root)
  if (target === undefined || target === tree.root) return undefined
  collect(target)

  const complete = completeSelection({ tree, features })
  if (!complete.has(feature)) return undefined
  const kept = [...complete].filter((name) => !removed.has(name))
  const again = completeSelection({ tree, features: kept })
  if (again.has(feature) || validateSelection({ tree, features: kept }).length > 0) return undefined
  return kept
}

/** The first selected group that has fewer features chosen than it needs, with the ones that can still be chosen. */
const deficientGroup = (node: FeatureNode, on: ReadonlySet<string>): { need: number, open: FeatureNode[] } | undefined => {
  for (const group of node.groups) {
    const bounds = groupBounds(group)
    const chosen = group.features.filter(({ name }) => on.has(name))
    if (bounds !== undefined && chosen.length < bounds.min) {
      return { need: bounds.min - chosen.length, open: group.features.filter(({ name }) => !on.has(name)) }
    }
    for (const child of chosen) {
      const deeper = deficientGroup(child, on)
      if (deeper !== undefined) return deeper
    }
  }
  return undefined
}

/**
 * A valid selection that has a feature, made of the least that has to come with it: what the model implies, and the first feature of every
 * group that asks for a choice. Used to measure what a feature brings when no real product has it. `undefined` when no selection with it
 * is valid (the constraints forbid it).
 */
export const activateFeature = ({ tree, features, feature }: { tree: FeatureModelTree, features: ProductSelection['features'], feature: string }): string[] | undefined => {
  if (!allNames(tree.root).has(feature)) return undefined
  let selection = completeSelection({ tree, features: [...selectedNames(features), feature] })
  for (let round = 0; round < 100; round++) {
    if (validateSelection({ tree, features: [...selection] }).length === 0) return [...selection]
    const gap = deficientGroup(tree.root, selection)
    if (gap === undefined) return undefined
    for (const node of gap.open.slice(0, gap.need)) selection.add(node.name)
    selection = completeSelection({ tree, features: [...selection] })
  }
  return undefined
}
