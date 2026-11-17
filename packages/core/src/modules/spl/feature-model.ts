/**
 * Just enough UVL to put the feature models of modules under the root of an SPL: indentation is structure, so it is handled as lines
 * with a level, never as a grammar. What comes out is parsed by the real parser (`parseUvl`) by whoever uses it.
 */

export interface UvlLine {
  readonly level: number
  readonly text: string
}

export interface UvlSections {
  /** Everything before `features` (`namespace`, `include`...), verbatim. */
  readonly preamble: readonly string[]
  readonly features: readonly UvlLine[]
  readonly constraints: readonly UvlLine[]
}

const GROUPS: ReadonlySet<string> = new Set(['mandatory', 'optional', 'or', 'alternative'])

const leading = (line: string): string => /^[ \t]*/.exec(line)?.[0] ?? ''

export const parseUvlSections = ({ content }: { content: string }): UvlSections => {
  const raw = content.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '')
  const usesTabs = raw.some((line) => leading(line).includes('\t'))
  // spaces: the unit of indentation is the smallest one used
  const unit = usesTabs ? 1 : Math.min(...raw.map((line) => leading(line).length).filter((width) => width > 0), Infinity)
  const levelOf = (line: string): number => {
    const space = leading(line)
    return usesTabs ? space.length : Number.isFinite(unit) ? Math.round(space.length / unit) : 0
  }
  const preamble: string[] = []
  const features: UvlLine[] = []
  const constraints: UvlLine[] = []
  let section: 'preamble' | 'features' | 'constraints' | 'other' = 'preamble'
  for (const line of raw) {
    const level = levelOf(line)
    const text = line.trim()
    if (level === 0) {
      section = text === 'features' ? 'features' : text === 'constraints' ? 'constraints' : section === 'preamble' ? 'preamble' : 'other'
      if (section === 'preamble') preamble.push(text)
      continue
    }
    if (section === 'features') features.push({ level, text })
    else if (section === 'constraints') constraints.push({ level, text })
  }
  return { preamble, features, constraints }
}

/** The feature a line of the `features` section declares, or `undefined` for group keywords, cardinalities and attributes. */
export const featureNameOfLine = ({ text }: { text: string }): string | undefined => {
  if (GROUPS.has(text) || text.startsWith('[') || text.startsWith('{')) return undefined
  const quoted = /^"([^"]+)"/.exec(text)
  if (quoted !== null) return quoted[1]
  return /^[A-Za-z_][A-Za-z0-9_]*/.exec(text)?.[0]
}

export const featureNamesOfSections = ({ features }: { features: readonly UvlLine[] }): string[] => {
  const names: string[] = []
  for (const line of features) {
    const name = featureNameOfLine({ text: line.text })
    if (name !== undefined) names.push(name)
  }
  return names
}

/**
 * The features a constraint line names. Lines that compare attributes or aggregate them (`price > 3`, `sum(Cost)`) are not logic
 * about features alone, so they are left out: this only looks at `=>`, `<=>`, `&`, `|`, `!` and parentheses.
 */
export const featuresOfConstraint = ({ text }: { text: string }): string[] => {
  const withoutImplications = text.replace(/<=>|=>/g, ' ')
  if (/[<>=]|[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(withoutImplications)) return []
  const names: string[] = []
  const rest = text.replace(/"([^"]+)"/g, (_match, quoted: string) => { names.push(quoted); return ' ' })
  for (const word of rest.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) names.push(word)
  return names
}

const render = (lines: readonly UvlLine[]): string[] => lines.map(({ level, text }) => '\t'.repeat(level) + text)

/**
 * Puts each module's feature tree under the root feature of the SPL, in a `mandatory` group of the root (the group is added when the root
 * has none), and appends the constraints of the modules to those of the SPL.
 */
export const graftModules = ({
  spl,
  modules
}: {
  spl: UvlSections
  modules: readonly UvlSections[]
}): string => {
  const features = [...spl.features]
  const root = features.findIndex((line) => line.level === 1)
  if (root < 0) throw new Error('The feature model of the SPL has no root feature.')

  // the lines of the subtree of the root end where the next level-1 line starts
  let end = features.findIndex((line, index) => index > root && line.level === 1)
  if (end < 0) end = features.length

  const trees: UvlLine[] = []
  for (const module of modules) {
    const top = Math.min(...module.features.map((line) => line.level))
    for (const line of module.features) trees.push({ level: line.level - top + 3, text: line.text })
  }

  if (trees.length > 0) {
    const group = features.findIndex((line, index) => index > root && index < end && line.level === 2 && line.text === 'mandatory')
    if (group >= 0) {
      let after = group + 1
      while (after < end && (features[after]!).level >= 3) after++
      features.splice(after, 0, ...trees)
    } else {
      features.splice(root + 1, 0, { level: 2, text: 'mandatory' }, ...trees)
    }
  }

  const constraints = [...spl.constraints, ...modules.flatMap((module) => module.constraints)]
  const out = [...spl.preamble, 'features', ...render(features)]
  if (constraints.length > 0) out.push('constraints', ...render(constraints))
  return out.join('\n') + '\n'
}
