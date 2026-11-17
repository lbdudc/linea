import { featuresOf, type FeatureModelTree, type FeatureNode } from '../../feature-model/uvl.js'
import { InvalidArgumentError } from '../../errors.js'
import type { MetamodelEngine } from '../metamodels/engine.js'
import { FEATURE_MODEL_GRAMMAR, FEATURE_SELECTION_GRAMMAR } from './constants.js'
import { bangoName } from './names.js'

/** A feature selection as a model of the feature metamodel (`featureselection`): `selection of <model> { select ... }`. */
export const selectionText = ({ model, features }: { model: string, features: readonly string[] }): string =>
  `selection of ${bangoName({ name: model })} {\n${features.map((feature) => `  select ${bangoName({ name: feature })}\n`).join('')}}\n`

/** The least a group asks for: all of a mandatory one, none of an optional one, one of an alternative or an or, `min` of a cardinality one. */
const needed = (kind: string, size: number, min: number | undefined): number =>
  kind === 'mandatory' ? size : kind === 'alternative' || kind === 'or' ? 1 : kind === 'cardinality' ? Math.min(min ?? 0, size) : 0

/**
 * The smallest selection the tree of a feature model accepts, by its groups alone: what is mandatory, and the first features of every
 * alternative, or and cardinality group that is in. (Constraints are not looked at: whoever uses it checks the result with the feature
 * metamodel, which also adds what the constraints need.) The root is not listed: every selection has it.
 */
export const defaultSelection = ({ tree }: { tree: FeatureModelTree }): string[] => {
  const chosen: FeatureNode[] = []
  const take = (node: FeatureNode): void => {
    for (const group of node.groups) {
      const count = needed(group.kind, group.features.length, group.min)
      for (const child of group.features.slice(0, count)) {
        chosen.push(child)
        take(child)
      }
    }
  }
  take(tree.root)
  // in the order of the model
  const order = new Map(featuresOf({ tree }).map((node, index) => [node, index]))
  return chosen.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).map((node) => node.name)
}

export interface SelectionVerdict {
  readonly valid: boolean
  /** What the feature metamodel finds wrong with the selection, one message each. */
  readonly problems: readonly string[]
  /** The selection once what the model implies is added (the root, ancestors, mandatory features, what the constraints need). */
  readonly completed: readonly string[]
}

/**
 * What the feature metamodel says of selections of features against a feature model: whether each is valid, and with what it is completed.
 * `engine` is one prepared for an SPL (`prepareEngine`), so the feature metamodel is loaded; the model is offered to the selections
 * as it is to a product. Selections are independent of each other.
 */
export const checkSelections = async ({
  engine,
  tree,
  selections
}: {
  engine: MetamodelEngine
  tree: FeatureModelTree
  selections: readonly (readonly string[])[]
}): Promise<SelectionVerdict[]> => {
  const model = (await engine.importJson({ featureModel: tree })).texts[FEATURE_MODEL_GRAMMAR]
  if (model === undefined) throw new InvalidArgumentError('The feature metamodel did not make a model of the feature tree.')
  await engine.setContributed([{ origin: 'level-1', metamodel: FEATURE_MODEL_GRAMMAR, text: model }])
  const verdicts: SelectionVerdict[] = []
  for (const features of selections) {
    const states = await engine.setInstances({ [FEATURE_SELECTION_GRAMMAR]: selectionText({ model: tree.name, features }) })
    const problems = states.flatMap((state) => state.problems).filter((problem) => problem.severity === 'error').map((problem) => problem.message)
    const json = (await engine.toJson(FEATURE_SELECTION_GRAMMAR)) as { features?: string[] } | undefined
    verdicts.push({ valid: problems.length === 0, problems, completed: json?.features ?? [] })
  }
  return verdicts
}
