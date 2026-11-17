import type { SplManifest } from '../types.js'

/**
 * The feature metamodel (bango's `featuremodel` package) and its grammars. Every SPL uses it: its feature model is a model of it (level 1),
 * and the feature selection of each product is a model of `featureselection` (level 0) that selects from it.
 */
export const FEATURE_METAMODEL = {
  /** Where a registry that publishes the LINEA metamodels has it (a workspace on disk has it as `file:metamodels/featuremodel`). */
  location: 'gitlab:linea/metamodels/featuremodel',
  range: '^1.0.0'
} as const

export const FEATURE_MODEL_GRAMMAR = 'featuremodel'
export const FEATURE_SELECTION_GRAMMAR = 'featureselection'

/** The manifest with the feature metamodel in its own `metamodels` (what every SPL has), at `location` when the host has it somewhere else. */
export const withFeatureMetamodel = ({ spl, location = FEATURE_METAMODEL.location }: { spl: SplManifest, location?: string }): SplManifest =>
  spl.metamodels[location] === undefined ? { ...spl, metamodels: { ...spl.metamodels, [location]: FEATURE_METAMODEL.range } } : spl
