import { PLATFORM_PATHS } from '../constants.js'

export interface SelectableProduct {
  readonly name: string
  readonly features: readonly string[]
}

export interface ProductSelectionResult {
  /** The names of the products to rebuild, the ones that share more of the touched features first. */
  readonly selected: string[]
  /** The features the change touches; empty when `all` is `true`. */
  readonly touchedFeatures: string[]
  /** Everything is selected: the change reaches every product (the platform files, code with no feature in it, a deleted file...). */
  readonly all: boolean
  readonly reason: string
}

const normalize = (file: string): string => file.split('\\').join('/').replace(/^\.\//, '')

/**
 * Which products a change to an SPL can break. A change to a file whose annotations test features reaches the products that have one of
 * them; one to the platform (feature model, config, helpers, transformation, manifests) or to code that tests no feature, or to a file the
 * analysis does not know (deleted), reaches all. A file that tests features also holds code that every product with the file gets, so
 * `baseline` products (the smallest ones) are always added to have that covered. `max` caps the list.
 */
export const selectProducts = ({
  changedFiles,
  featuresByFile,
  products,
  max = Infinity,
  baseline = 1
}: {
  /** Paths from the root of the SPL repository. */
  changedFiles: readonly string[]
  /** `analyzeAnnotations`, of the head of the change. */
  featuresByFile: Record<string, Record<string, number>>
  products: readonly SelectableProduct[]
  max?: number
  baseline?: number
}): ProductSelectionResult => {
  const codePrefix = `${PLATFORM_PATHS.code.replace(/\/$/, '')}/`
  const everything = (reason: string): ProductSelectionResult =>
    ({ selected: products.slice(0, max).map(({ name }) => name), touchedFeatures: [], all: true, reason })

  const touched = new Set<string>()
  for (const raw of changedFiles) {
    const file = normalize(raw)
    if (!file.startsWith(codePrefix)) {
      if (file === 'README.md' || file.startsWith('docs/') || file.startsWith('.gitlab-ci') || file.startsWith('ci/')) continue
      return everything(`"${file}" is part of the platform of the SPL`)
    }
    const features = featuresByFile[file.slice(codePrefix.length)]
    if (features === undefined) return everything(`"${file}" is not in the annotation analysis (deleted or ignored)`)
    const names = Object.keys(features)
    if (names.length === 0) return everything(`"${file}" has no feature in its annotations: every product has it`)
    names.forEach((name) => touched.add(name))
  }

  if (touched.size === 0) return { selected: [], touchedFeatures: [], all: false, reason: 'no file of the SPL changed that products depend on' }

  const overlap = (product: SelectableProduct): number => product.features.filter((name) => touched.has(name)).length
  const hit = products.filter((product) => overlap(product) > 0).sort((a, b) => overlap(b) - overlap(a) || a.name.localeCompare(b.name))
  const selected = [...hit]
  const rest = products.filter((product) => !hit.includes(product)).sort((a, b) => a.features.length - b.features.length || a.name.localeCompare(b.name))
  while (selected.length < baseline && rest.length > 0) selected.push(rest.shift()!)

  return {
    selected: selected.slice(0, max).map(({ name }) => name),
    touchedFeatures: [...touched].sort(),
    all: false,
    reason: `touches ${[...touched].sort().join(', ')}`
  }
}
