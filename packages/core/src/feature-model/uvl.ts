import { UvlParseError } from '../errors.js'

/**
 * The feature model as bango's feature metamodel (`featuremodel`) gives it as JSON (its JSON mapping, `featureModel`), and UVL (the
 * Universal Variability Language, Boolean level) as text. The platform's tools speak UVL (flamapy, the derivation engine); the models are
 * bango's. This is the one place where one becomes the other.
 */

export type GroupKind = 'mandatory' | 'optional' | 'alternative' | 'or' | 'cardinality'

export interface FeatureNode {
  readonly name: string
  readonly abstract?: boolean
  readonly groups: readonly FeatureGroup[]
}

export interface FeatureGroup {
  readonly kind: GroupKind
  /** Only for a `cardinality` group: `[min..max]`; `max` is missing when there is none (`[min..*]`). */
  readonly min?: number
  readonly max?: number
  readonly features: readonly FeatureNode[]
}

export type Formula =
  | { readonly feature: string }
  | { readonly not: Formula }
  | { readonly operator: '&' | '|' | '=>' | '<=>', readonly left: Formula, readonly right: Formula }

export interface FeatureModelTree {
  readonly name: string
  readonly root: FeatureNode
  readonly constraints: readonly Formula[]
}

const PRECEDENCE = new Map<string, number>([['<=>', 1], ['=>', 2], ['|', 3], ['&', 4]])

// ---------------------------------------------------------------------------------------------------------------- print

const KEYWORDS = new Set([
  'include', 'features', 'imports', 'namespace', 'as', 'constraint', 'constraints', 'cardinality', 'String', 'Boolean', 'Integer', 'Real', 'len', 'sum',
  'avg', 'floor', 'ceil', 'Type', 'Arithmetic', 'group-cardinality', 'feature-cardinality', 'aggregate-function', 'string-constraints',
  'or', 'alternative', 'optional', 'mandatory', 'true', 'false'
])
const STRICT_NAME = /^[a-zA-Z][a-zA-Z0-9_#§%?\\'äüöß;]*$/

/** A name as UVL writes it: plain when it can be, else between double quotes (which cannot hold a dot, a quote or a line break). */
export const uvlName = ({ name }: { name: string }): string =>
  STRICT_NAME.test(name) && !KEYWORDS.has(name) ? name : `"${name.replace(/[".\r\n]/g, '_')}"`

const formulaText = (formula: Formula, top: boolean): string => {
  if ('feature' in formula) return uvlName({ name: formula.feature })
  if ('not' in formula) return `!${formulaText(formula.not, false)}`
  const text = `${formulaText(formula.left, false)} ${formula.operator} ${formulaText(formula.right, false)}`
  return top ? text : `(${text})`
}

const groupText = (group: FeatureGroup): string =>
  group.kind !== 'cardinality'
    ? group.kind
    : `[${group.min ?? 0}${group.max === undefined ? '..*' : group.max === group.min ? '' : `..${group.max}`}]`

/** The tree as UVL: tabs, one feature or group to a line, empty groups left out (UVL has none), constraints one to a line. */
export const printUvl = ({ tree }: { tree: FeatureModelTree }): string => {
  const lines = ['features']
  const feature = (node: FeatureNode, depth: number): void => {
    lines.push(`${'\t'.repeat(depth)}${uvlName({ name: node.name })}${node.abstract === true ? ' {abstract}' : ''}`)
    for (const group of node.groups.filter((candidate) => candidate.features.length > 0)) {
      lines.push(`${'\t'.repeat(depth + 1)}${groupText(group)}`)
      for (const child of group.features) feature(child, depth + 2)
    }
  }
  feature(tree.root, 1)
  if (tree.constraints.length > 0) lines.push('', 'constraints', ...tree.constraints.map((constraint) => `\t${formulaText(constraint, true)}`))
  return `${lines.join('\n')}\n`
}

// -------------------------------------------------------------------------------------------------------------- parse

// (the UVL grammar says a plain name starts with a letter, but models published on UVLHub have names that start with `_`: they are read)
const NAME = /^("[^"\r\n]+"|[a-zA-Z_][a-zA-Z0-9_#§%?\\'äüöß;]*)/
const unquote = (text: string): string => (text.startsWith('"') ? text.slice(1, -1) : text)

interface Line {
  readonly no: number
  readonly indent: number
  readonly text: string
}

/**
 * UVL (Boolean level: features with mandatory, optional, alternative, or and cardinality groups, and `! & | => <=>` constraints) as a tree.
 * `namespace`, `include` and `imports` are skipped. What is not supported (typed features, feature cardinalities, arithmetic) is said, with its line.
 * Throws `UvlParseError`.
 */
export const parseUvl = ({ content }: { content: string }): FeatureModelTree => {
  const lines: Line[] = []
  // comments go: `//` to the end of the line, and `/* ... */` (keeping the line breaks so line numbers stay)
  content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' ')).split(/\r?\n/).forEach((raw, index) => {
    const code = raw.replace(/\/\/.*$/, '')
    if (code.trim() !== '') lines.push({ no: index + 1, indent: (/^[ \t]*/.exec(code)?.[0] ?? '').replace(/\t/g, '    ').length, text: code.trim() })
  })
  const fail = (line: Line, message: string): never => {
    throw new UvlParseError(`line ${line.no}: ${message}`)
  }
  let at = 0
  let namespace: string | undefined
  let root: FeatureNode | undefined
  const constraints: Formula[] = []

  const feature = (): FeatureNode => {
    const line = lines[at++]!
    const typed = /^(?:(String|Integer|Boolean|Real)\s+)?(.*)$/.exec(line.text)!
    if (typed[1] !== undefined) fail(line, `typed features (${typed[1]}) are not supported`)
    const rest0 = typed[2] ?? ''
    const named = NAME.exec(rest0)
    if (named === null) return fail(line, `expected a feature name, found '${rest0}'`)
    let rest = rest0.slice(named[0].length).trim()
    if (/^cardinality\b/.test(rest)) fail(line, 'feature cardinalities are not supported')
    let abstract = false
    if (rest.startsWith('{')) {
      const close = rest.lastIndexOf('}')
      if (close < 0) fail(line, "an attribute list is missing its '}'")
      abstract = rest.slice(1, close).split(',').some((attribute) => /^\s*abstract(\s+true)?\s*$/.test(attribute))
      rest = rest.slice(close + 1).trim()
    }
    if (rest !== '') fail(line, `unexpected '${rest}' after the feature name`)
    const groups: FeatureGroup[] = []
    while (at < lines.length && lines[at]!.indent > line.indent) {
      const header = lines[at++]!
      const kind = /^(mandatory|optional|alternative|or)$/.exec(header.text)
      const card = /^\[\s*(\d+)\s*(?:\.\.\s*(\d+|\*)\s*)?\]$/.exec(header.text)
      if (kind === null && card === null) fail(header, `expected mandatory, optional, alternative, or, or a cardinality like [1..2], found '${header.text}'`)
      const features: FeatureNode[] = []
      const indent = at < lines.length ? lines[at]!.indent : 0
      if (!(indent > header.indent)) fail(header, 'a group needs its features, indented below it')
      while (at < lines.length && lines[at]!.indent > header.indent) {
        if (lines[at]!.indent !== indent) fail(lines[at]!, 'the features of a group must be indented the same')
        features.push(feature())
      }
      if (kind !== null) groups.push({ kind: kind[1] as GroupKind, features })
      else {
        const min = Number(card![1])
        groups.push({ kind: 'cardinality', min, ...(card![2] === '*' ? {} : { max: card![2] === undefined ? min : Number(card![2]) }), features })
      }
    }
    return { name: unquote(named[0]), ...(abstract ? { abstract: true } : {}), groups }
  }

  const constraint = (line: Line): Formula => {
    const tokens = [...line.text.matchAll(/\s*(<=>|=>|[()!&|]|"[^"\r\n]+"|[a-zA-Z_][a-zA-Z0-9_#§%?\\'äüöß;]*|\S)/g)].map((match) => match[1]!)
    let p = 0
    const isName = (token: string | undefined): token is string =>
      token !== undefined && (token.startsWith('"') || /^[a-zA-Z_]/.test(token)) && !PRECEDENCE.has(token)
    const operand = (): Formula => {
      const token = tokens[p++]
      if (token === '!') return { not: operand() }
      if (token === '(') {
        const inner = climb(1)
        if (tokens[p++] !== ')') fail(line, "a '(' is not closed")
        return inner
      }
      if (isName(token)) {
        if (tokens[p] === '(' || tokens[p] === '.') fail(line, 'aggregate functions and qualified names are not supported')
        return { feature: unquote(token) }
      }
      return fail(line, token === undefined ? 'the constraint ends too soon' : `unexpected '${String(token)}' (only feature names and ! & | => <=> are supported)`)
    }
    // all the operators group to the left, as in UVL: from the tightest, & | => <=>
    const climb = (least: number): Formula => {
      let left = operand()
      while (PRECEDENCE.has(tokens[p]!) && PRECEDENCE.get(tokens[p]!)! >= least) {
        const operator = tokens[p++] as '&' | '|' | '=>' | '<=>'
        left = { operator, left, right: climb(PRECEDENCE.get(operator)! + 1) }
      }
      return left
    }
    const result = climb(1)
    if (p < tokens.length) fail(line, `unexpected '${String(tokens[p])}'`)
    return result
  }

  while (at < lines.length) {
    const line = lines[at]!
    if (line.indent !== 0) fail(line, 'unexpected indentation')
    const word = /^\w+/.exec(line.text)?.[0]
    if (word === 'namespace') { namespace = line.text.slice(9).trim(); at++ }
    else if (word === 'include' || word === 'imports') { at++; while (at < lines.length && lines[at]!.indent > 0) at++ }
    else if (word === 'features') {
      at++
      if (!(at < lines.length && lines[at]!.indent > 0)) fail(line, "'features' needs its root feature, indented below it")
      const indent = lines[at]!.indent
      root = feature()
      if (at < lines.length && lines[at]!.indent > 0) fail(lines[at]!, indent === lines[at]!.indent ? 'a feature model has one root feature' : 'unexpected indentation')
    } else if (word === 'constraints') {
      at++
      while (at < lines.length && lines[at]!.indent > 0) constraints.push(constraint(lines[at++]!))
    } else fail(line, `expected 'features' or 'constraints', found '${line.text}'`)
  }
  if (root === undefined) throw new UvlParseError("there is no 'features' section")
  return { name: namespace ?? root.name, root, constraints }
}

/** Every feature of the tree, parents first. */
export const featuresOf = ({ tree }: { tree: FeatureModelTree }): FeatureNode[] => {
  const out: FeatureNode[] = []
  const walk = (node: FeatureNode): void => {
    out.push(node)
    for (const group of node.groups) group.features.forEach(walk)
  }
  walk(tree.root)
  return out
}
